use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub fn resolve_claude_path() -> Result<PathBuf, String> {
    if let Ok(path) = which::which("claude") {
        return Ok(path);
    }
    let home = dirs::home_dir().unwrap_or_default();
    let candidates = [
        home.join(".local/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
    ];
    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }
    Err("Cannot find 'claude' binary. Make sure Claude Code CLI is installed.".to_string())
}

pub fn augmented_path() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let mut path_val = std::env::var("PATH").unwrap_or_default();
    let extra_paths = [
        home.join(".local/bin").to_string_lossy().to_string(),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin");
                if bin.exists() {
                    let bin_str = bin.to_string_lossy().to_string();
                    if !path_val.contains(&bin_str) {
                        path_val = format!("{}:{}", bin_str, path_val);
                    }
                }
            }
        }
    }
    for p in &extra_paths {
        if !path_val.contains(p.as_str()) {
            path_val = format!("{}:{}", p, path_val);
        }
    }
    path_val
}

pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send>>>,
}

impl PtySession {
    pub fn spawn(
        app: AppHandle,
        working_dir: String,
        session_id: String,
        yolo: bool,
    ) -> Result<Self, String> {
        let claude_path = resolve_claude_path()?;
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 30,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Spawn a full interactive login shell so we get the complete user environment
        // (auth tokens, env vars from .zshrc/.zprofile, nvm, etc.)
        // Then we auto-send the "claude" command to start Claude Code.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l"); // login shell - sources profile
        cmd.arg("-i"); // interactive - sources .zshrc
        cmd.cwd(&working_dir);

        // Set minimal env - the login shell profile will set up the rest
        let home = dirs::home_dir().unwrap_or_default();
        cmd.env("HOME", home.to_string_lossy().to_string());
        cmd.env("TERM", "xterm-256color");
        cmd.env("SHELL", &shell);
        cmd.env("USER", std::env::var("USER").unwrap_or_default());
        cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));
        let path_val = augmented_path();
        cmd.env("PATH", &path_val);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let child: Arc<Mutex<Box<dyn Child + Send>>> = Arc::new(Mutex::new(child));

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let writer = Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| {
            format!("Failed to get PTY writer: {}", e)
        })?));

        let master: Arc<Mutex<Box<dyn MasterPty + Send>>> =
            Arc::new(Mutex::new(pair.master));

        // Auto-send "claude" command after a short delay to let the shell initialize
        let writer_clone = writer.clone();
        let claude_cmd = if yolo {
            format!("{} --dangerously-skip-permissions\n", claude_path.display())
        } else {
            format!("{}\n", claude_path.display())
        };
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(500));
            if let Ok(mut w) = writer_clone.lock() {
                let _ = w.write_all(claude_cmd.as_bytes());
                let _ = w.flush();
            }
        });

        let app_clone = app.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = app_clone
                            .emit("pty-exit", serde_json::json!({"id": session_id}));
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_clone.emit(
                            "pty-output",
                            serde_json::json!({"id": session_id, "data": data}),
                        );
                    }
                    Err(_) => {
                        let _ = app_clone
                            .emit("pty-exit", serde_json::json!({"id": session_id}));
                        break;
                    }
                }
            }
        });

        Ok(PtySession { writer, master, child })
    }

    /// Kill the PTY child process and its entire process group.
    /// This ensures both the shell (zsh) and any child processes (claude) are terminated.
    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            // First try to kill the entire process group so child processes (claude) are also killed
            if let Some(pid) = child.process_id() {
                #[cfg(unix)]
                unsafe {
                    // Kill the process group (negative pid) with SIGTERM first
                    libc::killpg(pid as i32, libc::SIGTERM);
                    // Give processes a moment to handle SIGTERM
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    // Follow up with SIGKILL to ensure everything is dead
                    libc::killpg(pid as i32, libc::SIGKILL);
                    // Also kill the process directly in case it changed process groups
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }
            // Also use the portable-pty kill method as a fallback
            let _ = child.kill();
        }
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| format!("Lock error: {}", e))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|e| format!("Lock error: {}", e))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize error: {}", e))?;
        Ok(())
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}
