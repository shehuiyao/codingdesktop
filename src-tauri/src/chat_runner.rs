use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::BufRead;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::message_runner::resolve_claude_path;

/// Capture the full environment from an interactive login shell.
fn get_login_shell_env() -> Result<HashMap<String, String>, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let output = Command::new(&shell)
        .arg("-l")
        .arg("-i")
        .arg("-c")
        .arg("env")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to get login env: {}", e))?;

    let env_str = String::from_utf8_lossy(&output.stdout);
    let mut env_map = HashMap::new();
    for line in env_str.lines() {
        if let Some((key, value)) = line.split_once('=') {
            if !key.is_empty() && !key.contains(' ') {
                env_map.insert(key.to_string(), value.to_string());
            }
        }
    }
    Ok(env_map)
}

// Cache login env so we don't re-spawn zsh -l -i for every message
static LOGIN_ENV: std::sync::OnceLock<Mutex<Option<HashMap<String, String>>>> =
    std::sync::OnceLock::new();

fn cached_login_env() -> Result<HashMap<String, String>, String> {
    let lock = LOGIN_ENV.get_or_init(|| Mutex::new(None));
    let mut guard = lock.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(ref env) = *guard {
        return Ok(env.clone());
    }
    let env = get_login_shell_env()?;
    *guard = Some(env.clone());
    Ok(env)
}

pub struct ChatProcess {
    _master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>>,
}

impl ChatProcess {
    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(ref mut child) = *guard {
                if let Some(pid) = child.process_id() {
                    #[cfg(unix)]
                    unsafe {
                        libc::killpg(pid as i32, libc::SIGTERM);
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        libc::killpg(pid as i32, libc::SIGKILL);
                    }
                }
                let _ = child.kill();
            }
            *guard = None;
        }
    }
}

impl Drop for ChatProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

pub fn send_chat_message(
    app: AppHandle,
    chat_id: String,
    message: String,
    working_dir: String,
    resume_session_id: Option<String>,
) -> Result<ChatProcess, String> {
    let claude_path = resolve_claude_path()?;
    let login_env = cached_login_env()?;

    // Use a real PTY so Node.js flushes each JSON line immediately
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 200,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(&claude_path);
    cmd.arg("-p");
    cmd.arg(&message);
    cmd.arg("--verbose");
    cmd.arg("--output-format");
    cmd.arg("stream-json");

    if let Some(ref sid) = resume_session_id {
        cmd.arg("--resume");
        cmd.arg(sid);
    }

    cmd.cwd(&working_dir);

    // Apply cached login shell environment for auth
    for (key, value) in &login_env {
        cmd.env(key, value);
    }
    cmd.env("FORCE_COLOR", "0");

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    drop(pair.slave);

    let child_arc: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>> =
        Arc::new(Mutex::new(Some(child)));
    let master_arc: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>> =
        Arc::new(Mutex::new(Some(pair.master)));

    // Read PTY output line by line — real-time streaming
    let app_clone = app.clone();
    let chat_id_clone = chat_id.clone();
    thread::spawn(move || {
        let buf_reader = std::io::BufReader::new(reader);
        for line_result in buf_reader.lines() {
            match line_result {
                Ok(line) => {
                    let cleaned = strip_ansi(&line);
                    let trimmed = cleaned.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(json) =
                        serde_json::from_str::<serde_json::Value>(trimmed)
                    {
                        let _ = app_clone.emit(
                            "chat-stream",
                            serde_json::json!({
                                "chatId": chat_id_clone,
                                "data": json
                            }),
                        );
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(
            "chat-done",
            serde_json::json!({ "chatId": chat_id_clone }),
        );
    });

    Ok(ChatProcess {
        _master: master_arc,
        child: child_arc,
    })
}

/// Strip ANSI escape sequences and carriage returns from PTY output.
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() || next == '~' {
                        break;
                    }
                }
            } else if chars.peek() == Some(&']') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next == '\x07' {
                        break;
                    }
                    if next == '\x1b' {
                        if chars.peek() == Some(&'\\') {
                            chars.next();
                        }
                        break;
                    }
                }
            } else {
                chars.next();
            }
        } else if c == '\r' {
            continue;
        } else if c.is_control() && c != '\n' && c != '\t' {
            continue;
        } else {
            result.push(c);
        }
    }
    result
}

/// Synchronous test (diagnostic)
pub fn test_chat(working_dir: &str) -> Result<String, String> {
    use std::io::Read;
    let claude_path = resolve_claude_path()?;
    let login_env = cached_login_env()?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 200,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(&claude_path);
    cmd.arg("-p");
    cmd.arg("say hello in one word");
    cmd.arg("--verbose");
    cmd.arg("--output-format");
    cmd.arg("stream-json");
    cmd.cwd(working_dir);

    for (key, value) in &login_env {
        cmd.env(key, value);
    }
    cmd.env("FORCE_COLOR", "0");

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("PTY reader error: {}", e))?;

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Spawn error: {}", e))?;

    drop(pair.slave);

    let mut output = String::new();
    let _ = reader.read_to_string(&mut output);

    let status = child
        .wait()
        .map(|s| format!("{:?}", s))
        .unwrap_or_else(|e| format!("wait error: {}", e));

    let cleaned = strip_ansi(&output);

    Ok(format!(
        "status: {}\nenv_count: {}\n\n--- CLEANED ---\n{}",
        status,
        login_env.len(),
        cleaned.chars().take(2000).collect::<String>()
    ))
}
