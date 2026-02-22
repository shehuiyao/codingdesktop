mod history;
mod pty_manager;

use pty_manager::PtySession;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    session: Mutex<Option<PtySession>>,
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
) -> Result<(), String> {
    let session = PtySession::spawn(app, working_dir, args)?;
    let mut s = state.session.lock().map_err(|e| format!("Lock error: {}", e))?;
    *s = Some(session);
    Ok(())
}

#[tauri::command]
fn send_input(state: State<'_, AppState>, data: String) -> Result<(), String> {
    let s = state.session.lock().map_err(|e| format!("Lock error: {}", e))?;
    match s.as_ref() {
        Some(session) => session.write(&data),
        None => Err("No active session".to_string()),
    }
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
            session: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            get_session,
            get_projects,
            start_session,
            send_input,
            check_claude_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
