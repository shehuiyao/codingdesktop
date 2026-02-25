mod chat_runner;
mod history;
mod message_runner;

use chat_runner::ChatProcess;
use message_runner::PtySession;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

struct AppState {
    sessions: Mutex<HashMap<String, PtySession>>,
    chats: Mutex<HashMap<String, ChatProcess>>,
    next_id: Mutex<u32>,
}

#[tauri::command]
fn get_history() -> Result<Vec<history::HistoryEntry>, String> {
    history::read_history()
}

#[tauri::command]
fn get_session(
    project_slug: String,
    session_id: String,
) -> Result<Vec<history::SessionMessage>, String> {
    history::read_session(&project_slug, &session_id)
}

#[tauri::command]
fn get_projects() -> Result<Vec<String>, String> {
    history::list_projects()
}

#[tauri::command]
fn start_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    working_dir: String,
    yolo: Option<bool>,
) -> Result<String, String> {
    let mut next = state
        .next_id
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let id = format!("session-{}", *next);
    *next += 1;
    drop(next);

    let session = PtySession::spawn(app, working_dir, id.clone(), yolo.unwrap_or(false))?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    sessions.insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
fn send_input(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    match sessions.get(&session_id) {
        Some(session) => session.write(&data),
        None => Err(format!("No session with id: {}", session_id)),
    }
}

#[tauri::command]
fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    match sessions.get(&session_id) {
        Some(session) => session.resize(rows, cols),
        None => Err(format!("No session with id: {}", session_id)),
    }
}

#[tauri::command]
fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(session) = sessions.remove(&session_id) {
        session.kill();
    }
    Ok(())
}

// ---- Chat mode commands ----

#[tauri::command]
fn chat_test(working_dir: String) -> Result<String, String> {
    chat_runner::test_chat(&working_dir)
}

#[tauri::command]
fn chat_send(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    message: String,
    working_dir: String,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    // Kill any existing process for this chat
    {
        let mut chats = state
            .chats
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(old) = chats.remove(&chat_id) {
            old.kill();
        }
    }

    let process = chat_runner::send_chat_message(
        app,
        chat_id.clone(),
        message,
        working_dir,
        resume_session_id,
    )?;

    let mut chats = state
        .chats
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    chats.insert(chat_id, process);
    Ok(())
}

#[tauri::command]
fn chat_stop(state: State<'_, AppState>, chat_id: String) -> Result<(), String> {
    let mut chats = state
        .chats
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(process) = chats.remove(&chat_id) {
        process.kill();
    }
    Ok(())
}

// ---- File system commands ----

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = std::path::Path::new(&path);
    if !dir_path.exists() || !dir_path.is_dir() {
        return Err(format!("Not a valid directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir =
        std::fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
        {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|e| format!("metadata error: {}", e))?;
        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }

    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(entries)
}

#[tauri::command]
fn check_claude_installed() -> Result<bool, String> {
    Ok(message_runner::resolve_claude_path().is_ok())
}

#[derive(serde::Serialize)]
struct GitInfo {
    branch: String,
    additions: i64,
    deletions: i64,
}

#[tauri::command]
fn get_git_info(path: String) -> Result<GitInfo, String> {
    use std::process::Command;

    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !branch_output.status.success() {
        return Err("Not a git repository".to_string());
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let diff_output = Command::new("git")
        .args(["diff", "--numstat", "HEAD"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let mut additions: i64 = 0;
    let mut deletions: i64 = 0;

    let diff_text = String::from_utf8_lossy(&diff_output.stdout);
    for line in diff_text.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 2 {
            if let Ok(add) = parts[0].parse::<i64>() {
                additions += add;
            }
            if let Ok(del) = parts[1].parse::<i64>() {
                deletions += del;
            }
        }
    }

    let unstaged_output = Command::new("git")
        .args(["diff", "--numstat"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !diff_output.status.success() {
        let unstaged_text = String::from_utf8_lossy(&unstaged_output.stdout);
        for line in unstaged_text.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                if let Ok(add) = parts[0].parse::<i64>() {
                    additions += add;
                }
                if let Ok(del) = parts[1].parse::<i64>() {
                    deletions += del;
                }
            }
        }
    }

    Ok(GitInfo {
        branch,
        additions,
        deletions,
    })
}

#[derive(serde::Serialize)]
struct BranchList {
    current: String,
    local: Vec<String>,
    remote: Vec<String>,
}

#[tauri::command]
fn list_branches(path: String) -> Result<BranchList, String> {
    use std::process::Command;

    let current_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !current_output.status.success() {
        return Err("Not a git repository".to_string());
    }

    let current = String::from_utf8_lossy(&current_output.stdout)
        .trim()
        .to_string();

    let local_output = Command::new("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to list local branches: {}", e))?;

    let local: Vec<String> = String::from_utf8_lossy(&local_output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let remote_output = Command::new("git")
        .args(["branch", "-r", "--format=%(refname:short)"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to list remote branches: {}", e))?;

    let remote: Vec<String> = String::from_utf8_lossy(&remote_output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !s.contains("HEAD"))
        .collect();

    Ok(BranchList {
        current,
        local,
        remote,
    })
}

#[derive(serde::Serialize)]
struct SwitchResult {
    success: bool,
    message: String,
}

#[tauri::command]
fn switch_branch(path: String, branch: String, force: bool) -> Result<SwitchResult, String> {
    use std::process::Command;

    // Check for dirty working tree
    let status_output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    let status_text = String::from_utf8_lossy(&status_output.stdout);
    if !status_text.trim().is_empty() && !force {
        return Ok(SwitchResult {
            success: false,
            message: "dirty".to_string(),
        });
    }

    let checkout_output = Command::new("git")
        .args(["checkout", &branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git checkout: {}", e))?;

    if checkout_output.status.success() {
        Ok(SwitchResult {
            success: true,
            message: format!("Switched to branch '{}'", branch),
        })
    } else {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr)
            .trim()
            .to_string();
        Ok(SwitchResult {
            success: false,
            message: stderr,
        })
    }
}

#[derive(serde::Serialize)]
struct CommitEntry {
    hash: String,
    message: String,
    author: String,
    time_ago: String,
}

#[tauri::command]
fn get_commit_history(path: String, count: Option<u32>) -> Result<Vec<CommitEntry>, String> {
    use std::process::Command;

    let max_count = count.unwrap_or(20);
    let log_output = Command::new("git")
        .args([
            "log",
            &format!("--max-count={}", max_count),
            "--format=%h\x1f%s\x1f%an\x1f%cr",
        ])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !log_output.status.success() {
        return Err("Failed to get commit history".to_string());
    }

    let commits: Vec<CommitEntry> = String::from_utf8_lossy(&log_output.stdout)
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\x1f').collect();
            if parts.len() >= 4 {
                Some(CommitEntry {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    author: parts[2].to_string(),
                    time_ago: parts[3].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}

// ---- Update check ----

const APP_VERSION: &str = "0.5.4";

#[derive(serde::Serialize)]
struct UpdateInfo {
    current_version: String,
    latest_version: String,
    update_available: bool,
    download_url: String,
}

fn github_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("claude-desktop-updater")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))
}

#[tauri::command]
fn check_for_update() -> Result<UpdateInfo, String> {
    let client = github_client()?;

    let resp = client
        .get("https://api.github.com/repos/shehuiyao/claudedesktop/releases/latest")
        .send()
        .map_err(|e| format!("Failed to check for updates: {}", e))?;

    if !resp.status().is_success() {
        return Ok(UpdateInfo {
            current_version: APP_VERSION.to_string(),
            latest_version: APP_VERSION.to_string(),
            update_available: false,
            download_url: String::new(),
        });
    }

    let json: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let latest_version = tag.strip_prefix('v').unwrap_or(tag).to_string();

    // Find the .dmg asset download URL
    let download_url = json
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset.get("name")?.as_str()?;
                if name.ends_with(".dmg") {
                    asset
                        .get("browser_download_url")
                        .and_then(|u| u.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
        })
        .unwrap_or_default();

    let update_available = version_is_newer(&latest_version, APP_VERSION);

    Ok(UpdateInfo {
        current_version: APP_VERSION.to_string(),
        latest_version,
        update_available,
        download_url,
    })
}

#[tauri::command]
fn download_and_install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use std::io::Write;

    let client = github_client()?;

    // Emit progress to frontend
    let app_clone = app.clone();
    let emit_progress = move |msg: &str| {
        let _ = app_clone.emit("update-progress", msg);
    };

    emit_progress("Downloading...");

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .map_err(|e| format!("Failed to read download: {}", e))?;

    // Save to temp directory
    let tmp_dir = std::env::temp_dir();
    let dmg_path = tmp_dir.join("Claude Desktop_update.dmg");

    let mut file = std::fs::File::create(&dmg_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write DMG: {}", e))?;

    emit_progress("Opening installer...");

    // Open the DMG
    std::process::Command::new("open")
        .arg(&dmg_path)
        .spawn()
        .map_err(|e| format!("Failed to open DMG: {}", e))?;

    let _ = app.emit("update-progress", "done");

    Ok(())
}

/// Compare semver strings: returns true if `latest` is newer than `current`
fn version_is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..l.len().max(c.len()) {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv > cv {
            return true;
        }
        if lv < cv {
            return false;
        }
    }
    false
}

#[derive(serde::Serialize)]
struct SkillInfo {
    name: String,
    source: String,
}

#[tauri::command]
fn list_skills() -> Result<Vec<SkillInfo>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let claude_dir = home.join(".claude");
    let mut skills = Vec::new();

    let skills_dir = claude_dir.join("skills");
    if skills_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        skills.push(SkillInfo {
                            name: name.to_string(),
                            source: "custom".to_string(),
                        });
                    }
                }
            }
        }
    }

    let plugins_file = claude_dir.join("plugins").join("installed_plugins.json");
    if plugins_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&plugins_file) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(plugins) = json.get("plugins").and_then(|p| p.as_object()) {
                    for key in plugins.keys() {
                        let plugin_name = key.split('@').next().unwrap_or(key);
                        skills.push(SkillInfo {
                            name: plugin_name.to_string(),
                            source: "plugin".to_string(),
                        });
                    }
                }
            }
        }
    }

    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    use std::process::Command;
    Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    Ok(())
}

#[tauri::command]
fn confirm_close(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| format!("Failed to close: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            sessions: Mutex::new(HashMap::new()),
            chats: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            get_session,
            get_projects,
            start_session,
            send_input,
            resize_session,
            close_session,
            check_claude_installed,
            list_directory,
            list_skills,
            get_git_info,
            chat_send,
            chat_stop,
            chat_test,
            list_branches,
            switch_branch,
            get_commit_history,
            reveal_in_finder,
            confirm_close,
            check_for_update,
            download_and_install_update,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Prevent the default close
                    api.prevent_close();
                    // Ask frontend for confirmation
                    let window = window.clone();
                    window.emit("close-requested", ()).ok();
                }
                tauri::WindowEvent::Destroyed => {
                    if let Some(state) = window.try_state::<AppState>() {
                        if let Ok(mut sessions) = state.sessions.lock() {
                            let drained: Vec<(String, PtySession)> = sessions.drain().collect();
                            for (_, session) in drained {
                                session.kill();
                            }
                        }
                        if let Ok(mut chats) = state.chats.lock() {
                            let drained: Vec<(String, ChatProcess)> = chats.drain().collect();
                            for (_, process) in drained {
                                process.kill();
                            }
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
