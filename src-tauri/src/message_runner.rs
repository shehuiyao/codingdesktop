use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use regex::Regex;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

const CONFIRMATION_TAIL_MAX_CHARS: usize = 2000;
const CONFIRMATION_CUES: [&str; 14] = [
    "do you want to",
    "do you want to make this edit",
    "would you like to proceed",
    "are you sure",
    "proceed",
    "continue",
    "confirm",
    "manual approval",
    "approval",
    "permission",
    "allow",
    "deny",
    "choose an option",
    "select an option",
];

fn ansi_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[P^_].*?\x1b\\|\x1b[@-_]")
            .expect("valid ANSI regex")
    })
}

fn yn_input_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)([\(\[]\s*y(?:es)?\s*/\s*n(?:o)?\s*[\)\]])|\by\s*/\s*n\b")
            .expect("valid y/n regex")
    })
}

fn yes_like_option_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(?:^|\s)(?:[❯›>→]\s*)?\d+\.\s*(yes|proceed|continue|allow|approve)\b")
            .expect("valid yes-like option regex")
    })
}

fn no_like_option_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(?:^|\s)(?:[❯›>→]\s*)?\d+\.\s*(no|cancel|deny|reject)\b")
            .expect("valid no-like option regex")
    })
}

fn any_choice_option_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(?:^|\s)(?:[❯›>→]\s*)?\d+\.\s*(yes|no|cancel|deny|allow|approve|reject|proceed|continue)\b")
            .expect("valid choice option regex")
    })
}

fn numbered_option_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(?:^|\s)\d+[.)]\s+\S").expect("valid numbered option regex"))
}

fn strip_ansi(input: &str) -> String {
    ansi_re().replace_all(input, "").into_owned()
}

fn normalize_terminal_text(input: &str) -> String {
    let stripped = strip_ansi(input).replace('\r', "\n");
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn append_tail(tail: &mut String, chunk: &str, max_chars: usize) {
    if chunk.is_empty() {
        return;
    }
    if !tail.is_empty() {
        tail.push(' ');
    }
    tail.push_str(chunk);
    if tail.len() > max_chars {
        let mut start = tail.len() - max_chars;
        while !tail.is_char_boundary(start) {
            start += 1;
        }
        tail.drain(..start);
    }
}

fn is_confirmation_prompt(window_text: &str) -> bool {
    if window_text.is_empty() {
        return false;
    }

    let text = window_text.to_lowercase();
    let has_confirm_cue = CONFIRMATION_CUES.iter().any(|cue| text.contains(cue));
    let has_edit_confirm_cue = text.contains("do you want to make this edit");
    let has_yn_input = yn_input_re().is_match(window_text);
    let has_yes_like_option = yes_like_option_re().is_match(window_text);
    let has_no_like_option = no_like_option_re().is_match(window_text);
    let has_any_choice_option = any_choice_option_re().is_match(window_text);
    let has_binary_choice_list = has_yes_like_option && has_no_like_option;
    let has_prompt_footer = text.contains("esc to cancel") || text.contains("tab to amend");
    let has_numbered_options = numbered_option_re().find_iter(window_text).count() >= 2;
    let has_proceed_question = text.contains("would you like to proceed");

    if has_edit_confirm_cue && (has_any_choice_option || has_prompt_footer || has_yn_input) {
        return true;
    }
    if has_proceed_question && has_numbered_options && has_any_choice_option {
        return true;
    }
    if has_confirm_cue && has_numbered_options && has_any_choice_option {
        return true;
    }
    if has_confirm_cue && (has_yn_input || has_binary_choice_list || has_prompt_footer) {
        return true;
    }
    if has_binary_choice_list && has_prompt_footer {
        return true;
    }
    has_yn_input && has_confirm_cue
}

/// Find the last valid UTF-8 boundary in a byte slice.
/// Returns the number of bytes that form valid UTF-8 from the start.
/// Any trailing incomplete multi-byte sequence is excluded.
fn find_utf8_boundary(data: &[u8]) -> usize {
    match std::str::from_utf8(data) {
        Ok(_) => data.len(), // All valid
        Err(e) => {
            // valid_up_to() gives us the index of the first invalid byte
            // Everything before it is valid UTF-8
            e.valid_up_to()
        }
    }
}

fn resolve_binary(name: &str, extra_candidates: &[PathBuf]) -> Result<PathBuf, String> {
    if let Ok(path) = which::which(name) {
        return Ok(path);
    }
    let home = dirs::home_dir().unwrap_or_default();
    let common = [
        home.join(format!(".local/bin/{}", name)),
        PathBuf::from(format!("/usr/local/bin/{}", name)),
        PathBuf::from(format!("/opt/homebrew/bin/{}", name)),
    ];
    for candidate in extra_candidates.iter().chain(common.iter()) {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }
    Err(format!("Cannot find '{}' binary. Make sure it is installed.", name))
}

/// 查找 nvm 管理的 node 版本中的某个二进制文件
fn find_in_nvm(name: &str) -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    let nvm_dir = home.join(".nvm/versions/node");
    let mut candidates = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
        let mut versions: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .collect();
        // 按名称倒序，优先用最新版本
        versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        for entry in versions {
            candidates.push(entry.path().join("bin").join(name));
        }
    }
    candidates
}

pub fn resolve_tool_path(tool: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().unwrap_or_default();
    match tool {
        "codex" | "codex_sub" => {
            let mut extras = vec![home.join(".npm-global/bin/codex")];
            extras.extend(find_in_nvm("codex"));
            resolve_binary("codex", &extras)
        }
        "gemini" => {
            let extras = find_in_nvm("gemini");
            resolve_binary("gemini", &extras)
        }
        // 火山 CodingPlan 走 claude 二进制，但注入不同的 API 环境变量
        "volc" => resolve_binary("claude", &[]),
        _ => resolve_binary("claude", &[]),
    }
}

/// 读取火山 API Key（存放在 ~/.claude-desktop/.volc_key）
fn read_volc_key() -> Option<String> {
    let home = dirs::home_dir()?;
    let key_path = home.join(".claude-desktop").join(".volc_key");
    std::fs::read_to_string(&key_path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 确保 Codex 订阅隔离目录存在，并写入最小配置（信任当前工作目录）
fn ensure_codex_subscription_home(working_dir: &str) -> Result<(), String> {
    let codex_dir = std::path::Path::new("/tmp/codex-subscription-home/.codex");
    if !codex_dir.exists() {
        std::fs::create_dir_all(codex_dir)
            .map_err(|e| format!("Failed to create codex subscription directory: {}", e))?;
    }

    let config_path = codex_dir.join("config.toml");
    if !config_path.exists() {
        let config_content = format!(
            "[trusted_projects]\n\"{}\" = true\n",
            working_dir
        );
        std::fs::write(&config_path, config_content)
            .map_err(|e| format!("Failed to write config.toml: {}", e))?;
    }

    Ok(())
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
        tool: String,
        resume_session_id: Option<String>,
        startup_command: Option<String>,
    ) -> Result<Self, String> {
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
        let locale = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string());
        cmd.env("LANG", &locale);
        cmd.env("LC_ALL", &locale);
        cmd.env("LC_CTYPE", &locale);
        let path_val = augmented_path();
        cmd.env("PATH", &path_val);

        // 火山 CodingPlan：覆盖 Anthropic API 端点
        if tool == "volc" {
            cmd.env("ANTHROPIC_BASE_URL", "https://ark.cn-beijing.volces.com/api/coding");
            if let Some(key) = read_volc_key() {
                cmd.env("ANTHROPIC_API_KEY", key);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

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

        // Auto-send CLI command after a short delay to let the shell initialize
        let writer_clone = writer.clone();
        let cli_cmd = if let Some(command) = startup_command {
            format!("{}\n", command)
        } else {
            let tool_path = resolve_tool_path(&tool)?;
            let mut args = Vec::new();
            if tool != "gemini" && tool != "codex" && tool != "codex_sub" {
                // claude / volc 模式：支持 yolo 和 resume
                if yolo {
                    args.push("--dangerously-skip-permissions".to_string());
                }
                if let Some(ref sid) = resume_session_id {
                    args.push("--resume".to_string());
                    args.push(sid.clone());
                }
            }

            // codex_sub 需要确保隔离目录存在，并在命令前设置 HOME
            if tool == "codex_sub" {
                let _ = ensure_codex_subscription_home(&working_dir);
            }

            let cmd_prefix = if tool == "codex_sub" {
                "HOME=/tmp/codex-subscription-home "
            } else {
                ""
            };

            if args.is_empty() {
                format!("{}{}\n", cmd_prefix, tool_path.display())
            } else {
                format!("{}{} {}\n", cmd_prefix, tool_path.display(), args.join(" "))
            }
        };
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(500));
            if let Ok(mut w) = writer_clone.lock() {
                let _ = w.write_all(cli_cmd.as_bytes());
                let _ = w.flush();
            }
        });

        // Flag to track whether any output has been received (for startup timeout)
        let has_output = Arc::new(AtomicBool::new(false));

        // Startup timeout thread: if no output received within 30 seconds, emit pty-error
        {
            let app_timeout = app.clone();
            let session_id_timeout = session_id.clone();
            let has_output_clone = has_output.clone();
            thread::spawn(move || {
                thread::sleep(std::time::Duration::from_secs(30));
                if !has_output_clone.load(Ordering::SeqCst) {
                    let _ = app_timeout.emit(
                        "pty-error",
                        serde_json::json!({
                            "id": session_id_timeout,
                            "error": "Startup timeout: no output received within 30 seconds. The backend process may be stuck."
                        }),
                    );
                }
            });
        }

        let app_clone = app.clone();
        let has_output_reader = has_output.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut remainder: Vec<u8> = Vec::new();
            let mut prompt_tail = String::new();
            let mut awaiting_confirmation = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // Flush any remaining bytes
                        if !remainder.is_empty() {
                            let data = String::from_utf8_lossy(&remainder).to_string();
                            let normalized = normalize_terminal_text(&data);
                            append_tail(
                                &mut prompt_tail,
                                &normalized,
                                CONFIRMATION_TAIL_MAX_CHARS,
                            );
                            let detected = is_confirmation_prompt(&prompt_tail);
                            if detected != awaiting_confirmation {
                                awaiting_confirmation = detected;
                                let _ = app_clone.emit(
                                    "pty-awaiting-confirmation",
                                    serde_json::json!({"id": &session_id, "waiting": detected}),
                                );
                            }
                            let _ = app_clone.emit(
                                "pty-output",
                                serde_json::json!({"id": &session_id, "data": data}),
                            );
                        }
                        if awaiting_confirmation {
                            let _ = app_clone.emit(
                                "pty-awaiting-confirmation",
                                serde_json::json!({"id": &session_id, "waiting": false}),
                            );
                        }
                        let _ = app_clone
                            .emit("pty-exit", serde_json::json!({"id": &session_id}));
                        break;
                    }
                    Ok(n) => {
                        // Mark that we received output (cancels startup timeout)
                        has_output_reader.store(true, Ordering::SeqCst);

                        // Combine leftover bytes from previous read with new data
                        let mut combined = std::mem::take(&mut remainder);
                        combined.extend_from_slice(&buf[..n]);

                        // Find the last valid UTF-8 boundary
                        let valid_up_to = find_utf8_boundary(&combined);

                        // Save incomplete bytes for next read
                        if valid_up_to < combined.len() {
                            remainder = combined[valid_up_to..].to_vec();
                        }

                        if valid_up_to > 0 {
                            // Safe: we verified this is valid UTF-8 up to this point
                            let data = String::from_utf8_lossy(&combined[..valid_up_to]).to_string();
                            let normalized = normalize_terminal_text(&data);
                            append_tail(
                                &mut prompt_tail,
                                &normalized,
                                CONFIRMATION_TAIL_MAX_CHARS,
                            );
                            let detected = is_confirmation_prompt(&prompt_tail);
                            if detected != awaiting_confirmation {
                                awaiting_confirmation = detected;
                                let _ = app_clone.emit(
                                    "pty-awaiting-confirmation",
                                    serde_json::json!({"id": &session_id, "waiting": detected}),
                                );
                            }
                            let _ = app_clone.emit(
                                "pty-output",
                                serde_json::json!({"id": &session_id, "data": data}),
                            );
                        }
                    }
                    Err(e) => {
                        // Emit detailed error event before exit
                        if awaiting_confirmation {
                            let _ = app_clone.emit(
                                "pty-awaiting-confirmation",
                                serde_json::json!({"id": &session_id, "waiting": false}),
                            );
                        }
                        let _ = app_clone.emit(
                            "pty-error",
                            serde_json::json!({
                                "id": &session_id,
                                "error": format!("PTY read error: {}", e)
                            }),
                        );
                        let _ = app_clone
                            .emit("pty-exit", serde_json::json!({"id": &session_id}));
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
