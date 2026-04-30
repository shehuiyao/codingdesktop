use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

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
    #[serde(default)]
    pub tool: Option<String>,
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

fn codex_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex"))
}

fn codex_sub_dir() -> PathBuf {
    PathBuf::from("/tmp/codex-subscription-home/.codex")
}

fn codex_roots() -> Vec<(PathBuf, String)> {
    let mut roots = Vec::new();
    if let Some(d) = codex_dir() {
        roots.push((d, "codex".to_string()));
    }
    roots.push((codex_sub_dir(), "codex_sub".to_string()));
    roots
}

/// Convert a project path like `/Users/foo/bar` to its slug `-Users-foo-bar`.
/// Claude Code replaces all non-alphanumeric characters (except `-`) with `-`.
fn project_path_to_slug(project_path: &str) -> String {
    project_path
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

// ─── Claude history ──────────────────────────────────────────────────────────

fn read_claude_history() -> Result<Vec<HistoryEntry>, String> {
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

    let mut all_entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<HistoryEntry>(trimmed) {
            Ok(mut entry) => {
                entry.tool = Some("claude".to_string());
                all_entries.push(entry);
            }
            Err(_) => continue,
        }
    }

    // Deduplicate: iterate in reverse (latest entries first)
    for entry in all_entries.into_iter().rev() {
        if let Some(ref sid) = entry.session_id {
            if seen_sessions.contains(sid) {
                continue;
            }
            seen_sessions.insert(sid.clone());
        }
        entries.push(entry);
    }

    entries.reverse();
    Ok(entries)
}

fn read_claude_session(
    project_slug: &str,
    session_id: &str,
) -> Result<Vec<SessionMessage>, String> {
    let base = claude_dir()
        .ok_or("Cannot find home directory")?
        .join("projects");

    let session_file = format!("{}.jsonl", session_id);

    let slug = project_path_to_slug(project_slug);
    let mut path = base.join(&slug).join(&session_file);

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

// ─── Codex history ───────────────────────────────────────────────────────────

/// Walk a directory recursively and collect all `.jsonl` file paths.
fn walk_jsonl_files(dir: &PathBuf) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return results;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            results.extend(walk_jsonl_files(&path));
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            results.push(path);
        }
    }
    results
}

fn codex_session_dirs(root: &Path) -> Vec<PathBuf> {
    vec![root.join("sessions"), root.join("archived_sessions")]
}

/// Extract the Codex session UUID from a filename like
/// `rollout-2026-03-01T20-00-26-019ca945-719b-73a2-b408-a8f560398a74`.
/// The UUID is the last 5 hyphen-separated segments.
fn extract_session_id_from_filename(stem: &str) -> Option<String> {
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() < 5 {
        return None;
    }
    let uuid_parts = &parts[parts.len() - 5..];
    let candidate = uuid_parts.join("-");
    // Basic sanity: should be 36 chars (8-4-4-4-12)
    if candidate.len() == 36 {
        Some(candidate)
    } else {
        None
    }
}

#[derive(Debug, Clone)]
struct CodexPromptInfo {
    text: String,
    timestamp: Option<String>,
}

fn timestamp_from_epoch_seconds(ts: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339())
}

fn shorten_display(text: &str) -> Option<String> {
    let cleaned = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .chars()
        .take(80)
        .collect::<String>();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn extract_text_from_codex_content(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(items) => {
            let mut parts = Vec::new();
            for item in items {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    parts.push(text.to_string());
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        _ => None,
    }
}

fn is_bootstrap_prompt(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with("# AGENTS.md instructions") || trimmed.starts_with("<environment_context>")
}

fn read_codex_history_prompts(root: &Path) -> HashMap<String, CodexPromptInfo> {
    let path = root.join("history.jsonl");
    let mut prompts = HashMap::new();
    let Ok(file) = fs::File::open(&path) else {
        return prompts;
    };
    let reader = BufReader::new(file);

    for line in reader.lines().flatten() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        let Some(session_id) = val["session_id"].as_str() else {
            continue;
        };
        let Some(text) = val["text"].as_str().and_then(shorten_display) else {
            continue;
        };
        let timestamp = val["ts"].as_i64().and_then(timestamp_from_epoch_seconds);
        prompts.insert(session_id.to_string(), CodexPromptInfo { text, timestamp });
    }

    prompts
}

fn read_codex_session_summary(
    path: &PathBuf,
    tool: &str,
    prompt_info: Option<&CodexPromptInfo>,
) -> Option<HistoryEntry> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let fallback_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(extract_session_id_from_filename);
    let mut session_id = fallback_id;
    let mut cwd = None;
    let mut timestamp = None;
    let mut last_user_display = None;

    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if let Some(ts) = val["timestamp"].as_str() {
            timestamp = Some(ts.to_string());
        }
        if val["type"].as_str() == Some("session_meta") {
            if session_id.is_none() {
                session_id = val["payload"]["id"].as_str().map(|s| s.to_string());
            }
            cwd = val["payload"]["cwd"].as_str().map(|s| s.to_string());
            if timestamp.is_none() {
                timestamp = val["payload"]["timestamp"].as_str().map(|s| s.to_string());
            }
            continue;
        }

        if val["type"].as_str() != Some("response_item") {
            continue;
        }
        let payload = &val["payload"];
        if payload["type"].as_str() != Some("message") || payload["role"].as_str() != Some("user") {
            continue;
        }
        if let Some(text) = extract_text_from_codex_content(&payload["content"]) {
            if !is_bootstrap_prompt(&text) {
                last_user_display = shorten_display(&text);
            }
        }
    }

    if session_id.is_none() && prompt_info.is_none() && last_user_display.is_none() {
        return None;
    }

    Some(HistoryEntry {
        display: prompt_info
            .map(|info| info.text.clone())
            .or(last_user_display),
        timestamp: prompt_info
            .and_then(|info| info.timestamp.clone())
            .or(timestamp),
        project: cwd,
        session_id,
        tool: Some(tool.to_string()),
    })
}

fn upsert_codex_entry(entries: &mut HashMap<String, HistoryEntry>, entry: HistoryEntry) {
    let Some(id) = entry.session_id.clone() else {
        return;
    };

    match entries.get_mut(&id) {
        Some(existing) => {
            if existing.display.is_none() {
                existing.display = entry.display;
            }
            if entry.timestamp.is_some() && entry.timestamp > existing.timestamp {
                existing.timestamp = entry.timestamp;
            }
            if entry.project.is_some() {
                existing.project = entry.project;
            }
            if entry.tool.is_some() {
                existing.tool = entry.tool;
            }
        }
        None => {
            entries.insert(id, entry);
        }
    }
}

fn read_codex_history() -> Result<Vec<HistoryEntry>, String> {
    let mut entries_by_id: HashMap<String, HistoryEntry> = HashMap::new();

    for (codex, root_tool) in codex_roots() {
        let index_path = codex.join("session_index.jsonl");
        if index_path.exists() {
            let file = fs::File::open(&index_path)
                .map_err(|e| format!("Failed to open codex session_index: {}", e))?;
            let reader = BufReader::new(file);
            for line in reader.lines() {
                let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    let id = match val["id"].as_str() {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let thread_name = val["thread_name"].as_str().map(|s| s.to_string());
                    let updated_at = val["updated_at"].as_str().map(|s| s.to_string());

                    upsert_codex_entry(
                        &mut entries_by_id,
                        HistoryEntry {
                            display: thread_name,
                            timestamp: updated_at,
                            project: None,
                            session_id: Some(id),
                            tool: Some(root_tool.clone()),
                        },
                    );
                }
            }
        }

        let prompts = read_codex_history_prompts(&codex);
        for dir in codex_session_dirs(&codex) {
            for path in walk_jsonl_files(&dir) {
                let session_id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(extract_session_id_from_filename);
                let prompt_info = session_id.as_ref().and_then(|id| prompts.get(id));
                if let Some(summary) = read_codex_session_summary(&path, &root_tool, prompt_info) {
                    upsert_codex_entry(&mut entries_by_id, summary);
                }
            }
        }
    }

    let mut entries: Vec<HistoryEntry> = entries_by_id.into_values().collect();
    entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    entries.reverse();
    Ok(entries)
}

/// Find a Codex session file by scanning ~/.codex/sessions/ for a file ending with `{session_id}.jsonl`.
fn find_codex_session_file(session_id: &str) -> Option<PathBuf> {
    let suffix = format!("{}.jsonl", session_id);

    for (root, _) in codex_roots() {
        for dir in codex_session_dirs(&root) {
            if dir.exists() {
                for path in walk_jsonl_files(&dir) {
                    if let Some(fname) = path.file_name().and_then(|f| f.to_str()) {
                        if fname.ends_with(&suffix) {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }
    None
}

fn read_codex_session(session_id: &str) -> Result<Vec<SessionMessage>, String> {
    let session_file = find_codex_session_file(session_id)
        .ok_or_else(|| format!("Codex session file not found for: {}", session_id))?;

    let file = fs::File::open(&session_file)
        .map_err(|e| format!("Failed to open codex session: {}", e))?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let raw: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if raw["type"].as_str() != Some("response_item") {
            continue;
        }

        let payload = &raw["payload"];
        if payload["type"].as_str() != Some("message") {
            continue;
        }

        let role = match payload["role"].as_str() {
            Some(r) if r == "user" || r == "assistant" => r.to_string(),
            _ => continue, // skip developer/system messages
        };

        let content = payload["content"].clone();
        messages.push(SessionMessage {
            role: Some(role),
            content: Some(content),
            msg_type: Some("response_item".to_string()),
        });
    }

    Ok(messages)
}

// ─── Public API ──────────────────────────────────────────────────────────────

pub fn read_history() -> Result<Vec<HistoryEntry>, String> {
    let mut entries = read_claude_history()?;
    let codex_entries = read_codex_history().unwrap_or_default();
    entries.extend(codex_entries);
    Ok(entries)
}

pub fn read_session(project_slug: &str, session_id: &str) -> Result<Vec<SessionMessage>, String> {
    // Try Claude session format first
    match read_claude_session(project_slug, session_id) {
        Ok(msgs) => return Ok(msgs),
        Err(_) => {}
    }
    // Fall back to Codex session format
    read_codex_session(session_id)
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
