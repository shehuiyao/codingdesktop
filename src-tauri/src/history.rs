use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

/// Deserialize a timestamp that may be a JSON number (epoch ms) or a string.
/// Always produces a string suitable for JavaScript's `new Date()`.
fn deserialize_timestamp<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let val: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match val {
        Some(serde_json::Value::Number(n)) => Ok(Some(n.to_string())),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        _ => Ok(None),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub display: Option<String>,
    #[serde(deserialize_with = "deserialize_timestamp", default)]
    pub timestamp: Option<String>,
    pub project: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
}

/// The actual message payload nested inside a session JSONL line.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessagePayload {
    pub role: Option<String>,
    pub content: Option<serde_json::Value>,
}

/// A single line in a session JSONL file.
/// The real format has `type`, `message`, etc. at the top level.
#[derive(Debug, Deserialize)]
struct RawSessionLine {
    #[serde(rename = "type")]
    line_type: Option<String>,
    message: Option<MessagePayload>,
}

/// What we return to the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionMessage {
    pub role: Option<String>,
    pub content: Option<serde_json::Value>,
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
}

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

/// Convert a project path like `/Users/foo/bar` to its slug `-Users-foo-bar`.
/// Claude Code replaces all non-alphanumeric characters (except `-`) with `-`.
fn project_path_to_slug(project_path: &str) -> String {
    project_path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect()
}

pub fn read_history() -> Result<Vec<HistoryEntry>, String> {
    let path = claude_dir()
        .ok_or("Cannot find home directory")?
        .join("history.jsonl");

    if !path.exists() {
        return Ok(vec![]);
    }

    let file = fs::File::open(&path).map_err(|e| format!("Failed to open history: {}", e))?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();
    let mut seen_sessions = HashSet::new();

    // Read all entries first
    let mut all_entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<HistoryEntry>(trimmed) {
            Ok(entry) => all_entries.push(entry),
            Err(_) => continue,
        }
    }

    // Deduplicate: iterate in reverse (latest entries first) and keep only the first occurrence of each sessionId
    for entry in all_entries.into_iter().rev() {
        if let Some(ref sid) = entry.session_id {
            if seen_sessions.contains(sid) {
                continue;
            }
            seen_sessions.insert(sid.clone());
        }
        entries.push(entry);
    }

    // Reverse back so the order is preserved (oldest first; the frontend sorts by timestamp anyway)
    entries.reverse();

    Ok(entries)
}

pub fn read_session(project_slug: &str, session_id: &str) -> Result<Vec<SessionMessage>, String> {
    // The project_slug from the frontend may be a full path like "/Users/foo/bar"
    // or already a slug like "-Users-foo-bar". Try slug conversion first, then fall back.
    let base = claude_dir()
        .ok_or("Cannot find home directory")?
        .join("projects");

    let session_file = format!("{}.jsonl", session_id);

    // Try the slug derived from the project path
    let slug = project_path_to_slug(project_slug);
    let mut path = base.join(&slug).join(&session_file);

    // If that doesn't exist, try using the value as-is (it may already be a slug).
    // Only do this when project_slug is not an absolute path, because PathBuf::join
    // with an absolute path discards the base entirely.
    if !path.exists() && !project_slug.starts_with('/') {
        path = base.join(project_slug).join(&session_file);
    }

    if !path.exists() {
        return Err(format!("Session file not found: {:?}", path));
    }

    let file = fs::File::open(&path).map_err(|e| format!("Failed to open session: {}", e))?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let raw: RawSessionLine = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let line_type = raw.line_type.as_deref().unwrap_or("");

        // Only include user and assistant messages
        if line_type != "user" && line_type != "assistant" {
            continue;
        }

        if let Some(msg) = raw.message {
            messages.push(SessionMessage {
                role: msg.role,
                content: msg.content,
                msg_type: Some(line_type.to_string()),
            });
        }
    }
    Ok(messages)
}

pub fn list_projects() -> Result<Vec<String>, String> {
    let path = claude_dir()
        .ok_or("Cannot find home directory")?
        .join("projects");

    if !path.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read projects: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        if entry.path().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                projects.push(name.to_string());
            }
        }
    }
    Ok(projects)
}
