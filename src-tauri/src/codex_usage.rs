use chrono::{DateTime, Local, SecondsFormat, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

const CACHE_VERSION: u32 = 2;
const CACHE_FILE_NAME: &str = "codex-usage-cache.json";
static USAGE_CACHE: OnceLock<Mutex<CodexUsageCache>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageReport {
    usage: Vec<CodexUsageItem>,
    speed: Vec<CodexSpeedItem>,
    generated_at: String,
    roots: Vec<String>,
}

impl CodexUsageReport {
    pub fn usage_len(&self) -> usize {
        self.usage.len()
    }

    pub fn speed_len(&self) -> usize {
        self.speed.len()
    }

    pub fn roots_len(&self) -> usize {
        self.roots.len()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexUsageItem {
    date: String,
    hour: u32,
    timestamp: String,
    project: String,
    input: u64,
    cached: u64,
    output: u64,
    reasoning: u64,
    total: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexSpeedItem {
    date: String,
    hour: u32,
    timestamp: String,
    project: String,
    duration: f64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct CodexUsageCache {
    version: u32,
    files: HashMap<String, CachedRollout>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedRollout {
    size: u64,
    modified_ms: u64,
    usage: Vec<CodexUsageItem>,
    speed: Vec<CodexSpeedItem>,
}

fn cache_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join(".coding-desktop")
            .join("cache")
            .join(CACHE_FILE_NAME)
    })
}

fn read_cache() -> CodexUsageCache {
    let Some(path) = cache_path() else {
        return CodexUsageCache::default();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return CodexUsageCache::default();
    };
    let Ok(cache) = serde_json::from_str::<CodexUsageCache>(&content) else {
        return CodexUsageCache::default();
    };
    if cache.version == CACHE_VERSION {
        cache
    } else {
        CodexUsageCache::default()
    }
}

fn usage_cache() -> &'static Mutex<CodexUsageCache> {
    USAGE_CACHE.get_or_init(|| Mutex::new(read_cache()))
}

fn write_cache(cache: &CodexUsageCache) {
    let Some(path) = cache_path() else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(content) = serde_json::to_vec(cache) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, content).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}

fn file_signature(path: &Path) -> Option<(u64, u64)> {
    let metadata = fs::metadata(path).ok()?;
    let modified_ms = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()?;
    Some((metadata.len(), modified_ms))
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
    let mut last_usage: Option<((u64, u64, u64, u64, u64), DateTime<Local>)> = None;

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
                            timestamp: ts.to_rfc3339_opts(SecondsFormat::Secs, false),
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
                let input = usage
                    .get("input_tokens")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0);
                let cached = usage
                    .get("cached_input_tokens")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0);
                let output = usage
                    .get("output_tokens")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0);
                let reasoning = usage
                    .get("reasoning_output_tokens")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0);
                let total = usage
                    .get("total_tokens")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0);
                let signature = (input, cached, output, reasoning, total);

                if let Some((previous_signature, previous_ts)) = last_usage {
                    let seconds_since_previous =
                        ts.signed_duration_since(previous_ts).num_seconds();
                    if previous_signature == signature && (0..=60).contains(&seconds_since_previous)
                    {
                        continue;
                    }
                }

                last_usage = Some((signature, ts));
                usage_items.push(CodexUsageItem {
                    date: ts.format("%Y-%m-%d").to_string(),
                    hour: ts.hour(),
                    timestamp: ts.to_rfc3339_opts(SecondsFormat::Secs, false),
                    project: project.clone(),
                    input,
                    cached,
                    output,
                    reasoning,
                    total,
                });
            }
            _ => {}
        }
    }

    (usage_items, speed_items)
}

fn codex_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    if let Some(home) = dirs::home_dir() {
        let root = home.join(".codex");
        if seen.insert(root.to_string_lossy().to_string()) {
            roots.push(root);
        }
    }

    let subscription_root = PathBuf::from("/tmp/codex-subscription-home/.codex");
    if subscription_root.exists() && seen.insert(subscription_root.to_string_lossy().to_string()) {
        roots.push(subscription_root);
    }

    roots
}

pub fn collect_codex_usage() -> Result<CodexUsageReport, String> {
    let mut usage = Vec::new();
    let mut speed = Vec::new();
    let mut scanned_roots = Vec::new();
    let mut cache = usage_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.version = CACHE_VERSION;
    let mut seen_files = HashSet::new();
    let mut cache_changed = false;

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
                let cache_key = file.to_string_lossy().to_string();
                seen_files.insert(cache_key.clone());
                let Some((size, modified_ms)) = file_signature(&file) else {
                    continue;
                };

                if let Some(cached) = cache.files.get(&cache_key) {
                    if cached.size == size && cached.modified_ms == modified_ms {
                        usage.extend(cached.usage.clone());
                        speed.extend(cached.speed.clone());
                        continue;
                    }
                }

                let (usage_items, speed_items) = read_rollout(&file);
                usage.extend(usage_items.clone());
                speed.extend(speed_items.clone());
                cache.files.insert(
                    cache_key,
                    CachedRollout {
                        size,
                        modified_ms,
                        usage: usage_items,
                        speed: speed_items,
                    },
                );
                cache_changed = true;
            }
        }
    }

    let before_retain = cache.files.len();
    cache.files.retain(|path, _| seen_files.contains(path));
    cache_changed = cache_changed || cache.files.len() != before_retain;
    if cache_changed {
        write_cache(&cache);
    }

    Ok(CodexUsageReport {
        usage,
        speed,
        generated_at: Local::now().to_rfc3339_opts(SecondsFormat::Secs, false),
        roots: scanned_roots,
    })
}
