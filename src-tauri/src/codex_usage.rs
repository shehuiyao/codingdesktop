use chrono::{DateTime, Local, SecondsFormat, Timelike};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageReport {
    usage: Vec<CodexUsageItem>,
    speed: Vec<CodexSpeedItem>,
    generated_at: String,
    roots: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CodexUsageItem {
    date: String,
    hour: u32,
    project: String,
    input: u64,
    cached: u64,
    output: u64,
    reasoning: u64,
    total: u64,
}

#[derive(Debug, Serialize)]
pub struct CodexSpeedItem {
    date: String,
    hour: u32,
    project: String,
    duration: f64,
}

fn parse_time(value: &str) -> Option<DateTime<Local>> {
    if value.trim().is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.with_timezone(&Local))
}

fn project_name(cwd: &str) -> String {
    if cwd.trim().is_empty() {
        return "unknown".to_string();
    }

    let expanded = if let Some(stripped) = cwd.strip_prefix("~/") {
        dirs::home_dir()
            .map(|home| home.join(stripped))
            .unwrap_or_else(|| PathBuf::from(cwd))
    } else {
        PathBuf::from(cwd)
    };

    if let Some(home) = dirs::home_dir() {
        let sengo_root = home.join("Desktop").join("sengo");
        if let Ok(relative) = expanded.strip_prefix(&sengo_root) {
            if let Some(first) = relative.components().next() {
                return first.as_os_str().to_string_lossy().to_string();
            }
            return "sengo".to_string();
        }
    }

    expanded
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| cwd.to_string())
}

fn collect_rollout_files(root: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rollout_files(&path, files);
            continue;
        }

        let is_rollout = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
            .unwrap_or(false);

        if is_rollout {
            files.push(path);
        }
    }
}

fn read_rollout(path: &Path) -> (Vec<CodexUsageItem>, Vec<CodexSpeedItem>) {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let reader = BufReader::new(file);
    let mut project = "unknown".to_string();
    let mut starts: HashMap<String, DateTime<Local>> = HashMap::new();
    let mut usage_items = Vec::new();
    let mut speed_items = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(obj) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let Some(ts) = obj
            .get("timestamp")
            .and_then(|value| value.as_str())
            .and_then(parse_time)
        else {
            continue;
        };

        let payload = obj.get("payload").unwrap_or(&Value::Null);
        if obj.get("type").and_then(|value| value.as_str()) == Some("session_meta") {
            if let Some(cwd) = payload.get("cwd").and_then(|value| value.as_str()) {
                project = project_name(cwd);
            }
            continue;
        }

        if obj.get("type").and_then(|value| value.as_str()) != Some("event_msg") {
            continue;
        }

        let event_type = payload.get("type").and_then(|value| value.as_str());
        let turn_id = payload.get("turn_id").and_then(|value| value.as_str());

        match (event_type, turn_id) {
            (Some("task_started"), Some(id)) => {
                starts.insert(id.to_string(), ts);
            }
            (Some("task_complete"), Some(id)) => {
                if let Some(started_at) = starts.get(id) {
                    let duration =
                        ts.signed_duration_since(*started_at).num_milliseconds() as f64 / 1000.0;
                    if (0.0..=21_600.0).contains(&duration) {
                        speed_items.push(CodexSpeedItem {
                            date: ts.format("%Y-%m-%d").to_string(),
                            hour: ts.hour(),
                            project: project.clone(),
                            duration: (duration * 1000.0).round() / 1000.0,
                        });
                    }
                }
            }
            (Some("token_count"), _) => {
                let usage = payload
                    .get("info")
                    .and_then(|info| info.get("last_token_usage"))
                    .unwrap_or(&Value::Null);
                usage_items.push(CodexUsageItem {
                    date: ts.format("%Y-%m-%d").to_string(),
                    hour: ts.hour(),
                    project: project.clone(),
                    input: usage
                        .get("input_tokens")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0),
                    cached: usage
                        .get("cached_input_tokens")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0),
                    output: usage
                        .get("output_tokens")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0),
                    reasoning: usage
                        .get("reasoning_output_tokens")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0),
                    total: usage
                        .get("total_tokens")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0),
                });
            }
            _ => {}
        }
    }

    (usage_items, speed_items)
}

fn codex_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".codex"));
    }

    let subscription_root = PathBuf::from("/tmp/codex-subscription-home/.codex");
    if subscription_root.exists() {
        roots.push(subscription_root);
    }

    roots
}

pub fn collect_codex_usage() -> Result<CodexUsageReport, String> {
    let mut usage = Vec::new();
    let mut speed = Vec::new();
    let mut scanned_roots = Vec::new();

    for root in codex_roots() {
        let candidate_roots = [root.join("sessions"), root.join("archived_sessions")];
        for candidate in candidate_roots {
            if !candidate.exists() {
                continue;
            }

            scanned_roots.push(candidate.to_string_lossy().to_string());
            let mut files = Vec::new();
            collect_rollout_files(&candidate, &mut files);
            files.sort();

            for file in files {
                let (usage_items, speed_items) = read_rollout(&file);
                usage.extend(usage_items);
                speed.extend(speed_items);
            }
        }
    }

    Ok(CodexUsageReport {
        usage,
        speed,
        generated_at: Local::now().to_rfc3339_opts(SecondsFormat::Secs, false),
        roots: scanned_roots,
    })
}
