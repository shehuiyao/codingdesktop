mod history;
mod pty_manager;

use pty_manager::PtySession;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    sessions: Mutex<HashMap<String, PtySession>>,
    next_id: Mutex<u32>,
}

#[tauri::command]
fn get_history() -> Result<Vec<history::HistoryEntry>, String> {
    history::read_history()
}

#[tauri::command]
fn get_session(project_slug: String, session_id: String) -> Result<Vec<history::SessionMessage>, String> {
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
    args: Vec<String>,
) -> Result<String, String> {
    let mut next = state.next_id.lock().map_err(|e| format!("Lock error: {}", e))?;
    let id = format!("session-{}", *next);
    *next += 1;
    drop(next);

    let session = PtySession::spawn(app, working_dir, args, id.clone())?;
    let mut sessions = state.sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    sessions.insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
fn send_input(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    match sessions.get(&session_id) {
        Some(session) => session.write(&data),
        None => Err(format!("No session with id: {}", session_id)),
    }
}

#[tauri::command]
fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    sessions.remove(&session_id);
    Ok(())
}

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
    let read_dir = std::fs::read_dir(dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

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
    Ok(which::which("claude").is_ok())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            sessions: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            get_session,
            get_projects,
            start_session,
            send_input,
            close_session,
            check_claude_installed,
            list_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
