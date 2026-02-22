use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl PtySession {
    pub fn spawn(
        app: AppHandle,
        working_dir: String,
        args: Vec<String>,
        session_id: String,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Resolve claude binary path - .app bundles don't inherit shell PATH
        let claude_path = which::which("claude")
            .or_else(|_| {
                // Try common installation paths
                let home = dirs::home_dir().unwrap_or_default();
                let candidates = [
                    home.join(".local/bin/claude"),
                    home.join(".nvm/versions/node").join("**").join("bin/claude"),
                    std::path::PathBuf::from("/usr/local/bin/claude"),
                    std::path::PathBuf::from("/opt/homebrew/bin/claude"),
                ];
                for candidate in &candidates {
                    if candidate.exists() {
                        return Ok(candidate.clone());
                    }
                }
                Err(which::Error::CannotFindBinaryPath)
            })
            .map_err(|_| "Cannot find 'claude' binary. Make sure Claude Code CLI is installed.".to_string())?;

        let mut cmd = CommandBuilder::new(claude_path);
        for arg in &args {
            cmd.arg(arg);
        }
        cmd.cwd(&working_dir);

        // Inherit environment and ensure PATH includes common binary locations
        let home = dirs::home_dir().unwrap_or_default();
        let mut path_val = std::env::var("PATH").unwrap_or_default();
        let extra_paths = [
            home.join(".local/bin").to_string_lossy().to_string(),
            home.join(".nvm/versions/node").to_string_lossy().to_string(),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        for p in &extra_paths {
            if !path_val.contains(p.as_str()) {
                path_val = format!("{}:{}", p, path_val);
            }
        }

        for (key, value) in std::env::vars() {
            cmd.env(key.clone(), value);
        }
        cmd.env("PATH", &path_val);
        // Ensure HOME is set for claude to find its config
        cmd.env("HOME", home.to_string_lossy().to_string());

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let writer = Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| {
            format!("Failed to get PTY writer: {}", e)
        })?));

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let app_clone = app.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = app_clone.emit("pty-exit", serde_json::json!({"id": session_id}));
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_clone.emit("pty-output", serde_json::json!({"id": session_id, "data": data}));
                    }
                    Err(_) => {
                        let _ = app_clone.emit("pty-exit", serde_json::json!({"id": session_id}));
                        break;
                    }
                }
            }
        });

        Ok(PtySession { writer })
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| format!("Lock error: {}", e))?;
        writer.write_all(data.as_bytes()).map_err(|e| format!("Write error: {}", e))?;
        writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }
}
