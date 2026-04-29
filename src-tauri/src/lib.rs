mod chat_runner;
mod codex_usage;
mod history;
mod message_runner;

use chat_runner::ChatProcess;
use message_runner::PtySession;
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[derive(serde::Deserialize)]
struct LaunchpadProjectProbe {
    id: String,
    name: String,
    working_dir: String,
}

#[derive(serde::Serialize)]
struct RunningLaunchpadProject {
    project_id: String,
    name: String,
    working_dir: String,
    pid: u32,
    command: String,
    port: Option<String>,
    ports: Vec<String>,
}

#[derive(Default)]
struct ListeningProcess {
    pid: u32,
    command: String,
    ports: Vec<String>,
}

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
    tool: Option<String>,
    resume_session_id: Option<String>,
    startup_command: Option<String>,
) -> Result<String, String> {
    let mut next = state
        .next_id
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let id = format!("session-{}", *next);
    *next += 1;
    drop(next);

    let tool_name = tool.unwrap_or_else(|| "claude".to_string());
    let session = PtySession::spawn(
        app,
        working_dir,
        id.clone(),
        yolo.unwrap_or(false),
        tool_name,
        resume_session_id,
        startup_command,
    )?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    sessions.insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
fn send_input(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    match sessions.get(&session_id) {
        Some(session) => {
            let result = session.write(&data);
            // Only clear waiting confirmation on submitted input (Enter).
            // Focus/blur control sequences can also arrive as input and should not clear waiting.
            if result.is_ok() && (data.contains('\r') || data.contains('\n')) {
                let _ = app.emit(
                    "pty-awaiting-confirmation",
                    serde_json::json!({ "id": &session_id, "waiting": false }),
                );
            }
            result
        }
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

fn normalize_path(path: &str) -> String {
    path.trim().trim_end_matches('/').to_string()
}

fn path_contains(parent: &str, child: &str) -> bool {
    let parent = normalize_path(parent);
    let child = normalize_path(child);
    !parent.is_empty() && (child == parent || child.starts_with(&format!("{}/", parent)))
}

fn paths_related(first: &str, second: &str) -> bool {
    path_contains(first, second) || path_contains(second, first)
}

fn parse_port(address: &str) -> Option<String> {
    let last = address.rsplit(':').next()?.trim();
    if !last.is_empty() && last.chars().all(|item| item.is_ascii_digit()) {
        Some(last.to_string())
    } else {
        None
    }
}

fn process_cwd(pid: u32) -> Option<String> {
    let output = Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(|value| value.to_string()))
}

#[tauri::command]
fn detect_running_launchpad_projects(
    projects: Vec<LaunchpadProjectProbe>,
) -> Result<Vec<RunningLaunchpadProject>, String> {
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])
        .output()
        .map_err(|e| format!("无法执行 lsof: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut processes: Vec<ListeningProcess> = Vec::new();
    let mut current: Option<ListeningProcess> = None;

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(pid) = line.strip_prefix('p').and_then(|value| value.parse::<u32>().ok()) {
            if let Some(process) = current.take() {
                processes.push(process);
            }
            current = Some(ListeningProcess {
                pid,
                ..Default::default()
            });
        } else if let Some(command) = line.strip_prefix('c') {
            if let Some(process) = current.as_mut() {
                process.command = command.to_string();
            }
        } else if let Some(address) = line.strip_prefix('n') {
            if let (Some(process), Some(port)) = (current.as_mut(), parse_port(address)) {
                if !process.ports.contains(&port) {
                    process.ports.push(port);
                }
            }
        }
    }

    if let Some(process) = current.take() {
        processes.push(process);
    }

    let mut cwd_cache: HashMap<u32, Option<String>> = HashMap::new();
    let mut matches = Vec::new();

    for process in processes {
        let cwd = cwd_cache
            .entry(process.pid)
            .or_insert_with(|| process_cwd(process.pid));
        let Some(cwd) = cwd.as_deref() else {
            continue;
        };

        for project in &projects {
            if project.working_dir.trim().is_empty() {
                continue;
            }
            if paths_related(&project.working_dir, cwd) {
                matches.push(RunningLaunchpadProject {
                    project_id: project.id.clone(),
                    name: if project.name.trim().is_empty() {
                        project.working_dir.clone()
                    } else {
                        project.name.clone()
                    },
                    working_dir: project.working_dir.clone(),
                    pid: process.pid,
                    command: process.command.clone(),
                    port: process.ports.first().cloned(),
                    ports: process.ports.clone(),
                });
            }
        }
    }

    Ok(matches)
}

#[tauri::command]
fn stop_detected_launchpad_process(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    unsafe {
        let pid = pid as i32;
        if libc::kill(pid, libc::SIGTERM) != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }

    #[cfg(not(unix))]
    {
        return Err("当前平台暂不支持关闭检测到的进程".to_string());
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

#[derive(serde::Serialize)]
struct RuleFile {
    name: String,
    path: String,
    /// 规则来源："project" 表示项目根目录，"local" 表示 .claude/ 目录
    source: String,
}

#[tauri::command]
fn list_rule_files(project_path: String) -> Result<Vec<RuleFile>, String> {
    let root = std::path::Path::new(&project_path);
    let mut rules = Vec::new();

    // 项目根目录的 CLAUDE.md
    let claude_md = root.join("CLAUDE.md");
    if claude_md.exists() {
        rules.push(RuleFile {
            name: "CLAUDE.md".to_string(),
            path: claude_md.to_string_lossy().to_string(),
            source: "project".to_string(),
        });
    }

    // .claude/ 目录下的配置文件
    let claude_dir = root.join(".claude");
    if claude_dir.exists() && claude_dir.is_dir() {
        // settings.json
        let settings = claude_dir.join("settings.json");
        if settings.exists() {
            rules.push(RuleFile {
                name: ".claude/settings.json".to_string(),
                path: settings.to_string_lossy().to_string(),
                source: "local".to_string(),
            });
        }
        // settings.local.json
        let settings_local = claude_dir.join("settings.local.json");
        if settings_local.exists() {
            rules.push(RuleFile {
                name: ".claude/settings.local.json".to_string(),
                path: settings_local.to_string_lossy().to_string(),
                source: "local".to_string(),
            });
        }
        // .claude/commands/ 目录下的 md 文件
        let commands_dir = claude_dir.join("commands");
        if commands_dir.exists() && commands_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&commands_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.ends_with(".md") {
                        rules.push(RuleFile {
                            name: format!(".claude/commands/{}", name),
                            path: entry.path().to_string_lossy().to_string(),
                            source: "local".to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(rules)
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
    Ok(message_runner::resolve_tool_path("claude").is_ok())
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

    let mut additions: i64 = 0;
    let mut deletions: i64 = 0;

    // 解析 git diff --numstat 输出，累加到 additions/deletions
    let accumulate_numstat = |output: &[u8], add: &mut i64, del: &mut i64| {
        for line in String::from_utf8_lossy(output).lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                if let Ok(a) = parts[0].parse::<i64>() { *add += a; }
                if let Ok(d) = parts[1].parse::<i64>() { *del += d; }
            }
        }
    };

    // 不在默认分支时，统计分支上的已提交改动
    if branch != "main" && branch != "master" {
        let has_origin_main = Command::new("git")
            .args(["rev-parse", "--verify", "origin/main"])
            .current_dir(&path)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        let default_branch = if has_origin_main { "origin/main" } else { "origin/master" };

        if let Ok(output) = Command::new("git")
            .args(["diff", "--numstat", &format!("{}...HEAD", default_branch)])
            .current_dir(&path)
            .output()
        {
            if output.status.success() {
                accumulate_numstat(&output.stdout, &mut additions, &mut deletions);
            }
        }
    }

    // 未提交的改动（staged + unstaged）
    if let Ok(output) = Command::new("git")
        .args(["diff", "--numstat", "HEAD"])
        .current_dir(&path)
        .output()
    {
        if output.status.success() {
            accumulate_numstat(&output.stdout, &mut additions, &mut deletions);
        }
    } else {
        // HEAD 不存在（新仓库无 commit）
        for args in &[vec!["diff", "--cached", "--numstat"], vec!["diff", "--numstat"]] {
            if let Ok(output) = Command::new("git").args(args).current_dir(&path).output() {
                accumulate_numstat(&output.stdout, &mut additions, &mut deletions);
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


// ─── Bug Tracker 数据结构 ───

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct BugEntry {
    id: String,
    title: String,
    description: String,
    reporter: String,
    priority: String,
    status: String,
    images: Vec<String>,
    fix_commit: Option<String>,
    created: String,
    updated: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct BugsData {
    project: String,
    branch: String,
    created: String,
    bugs: Vec<BugEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    project_root: Option<String>,
}

#[derive(serde::Serialize)]
struct SkillInfo {
    name: String,
    source: String,
    description: String,
    category: String,
    path: String,
}

/// 从 SKILL.md frontmatter 中提取 description
fn parse_skill_description(skill_dir: &std::path::Path) -> String {
    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.exists() {
        return String::new();
    }
    let content = match std::fs::read_to_string(&skill_md) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    // 解析 frontmatter: --- ... description: xxx ... ---
    if !content.starts_with("---") {
        return String::new();
    }
    if let Some(end) = content[3..].find("---") {
        let front = &content[3..3 + end];
        for line in front.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("description:") {
                let desc = rest.trim().trim_matches('"').trim_matches('\'');
                // 处理多行 description（以 | 开头的 YAML 多行）
                if desc.is_empty() || desc == "|" {
                    // 取下一行非空内容
                    for next_line in front.lines().skip_while(|l| !l.trim().starts_with("description:")).skip(1) {
                        let next = next_line.trim();
                        if !next.is_empty() && !next.contains(':') {
                            return next.to_string();
                        }
                        break;
                    }
                    return String::new();
                }
                return desc.to_string();
            }
        }
    }
    String::new()
}

/// 根据技能名称判断分类
fn categorize_skill(name: &str, source: &str) -> String {
    if source == "plugin" {
        return "official".to_string();
    }
    let senguo_prefixes = [
        "common-", "publish-", "merge-", "testing-", "senguo", "peon-ping",
    ];
    let lower = name.to_lowercase();
    for prefix in &senguo_prefixes {
        if lower.starts_with(prefix) {
            return "senguo".to_string();
        }
    }
    "personal".to_string()
}

#[tauri::command]
fn list_skills() -> Result<Vec<SkillInfo>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let claude_dir = home.join(".claude");
    let mut skills = Vec::new();

    // 自定义技能
    let skills_dir = claude_dir.join("skills");
    if skills_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        let description = parse_skill_description(&path);
                        let category = categorize_skill(name, "custom");
                        skills.push(SkillInfo {
                            name: name.to_string(),
                            source: "custom".to_string(),
                            description,
                            category,
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    // 插件技能：读取每个插件下的 skills/ 子目录
    let plugins_file = claude_dir.join("plugins").join("installed_plugins.json");
    if plugins_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&plugins_file) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(plugins) = json.get("plugins").and_then(|p| p.as_object()) {
                    for (_key, val) in plugins {
                        if let Some(arr) = val.as_array() {
                            if let Some(first) = arr.first() {
                                if let Some(install_path) = first.get("installPath").and_then(|p| p.as_str()) {
                                    let skills_path = std::path::Path::new(install_path).join("skills");
                                    if skills_path.exists() {
                                        if let Ok(entries) = std::fs::read_dir(&skills_path) {
                                            for entry in entries.flatten() {
                                                let path = entry.path();
                                                if path.is_dir() {
                                                    if let Some(name) = entry.file_name().to_str() {
                                                        let description = parse_skill_description(&path);
                                                        skills.push(SkillInfo {
                                                            name: name.to_string(),
                                                            source: "plugin".to_string(),
                                                            description,
                                                            category: "official".to_string(),
                                                            path: path.to_string_lossy().to_string(),
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

#[tauri::command]
fn get_disabled_skills(project_path: String) -> Result<Vec<String>, String> {
    let settings_path = std::path::Path::new(&project_path)
        .join(".claude")
        .join("settings.local.json");
    if !settings_path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("读取配置失败: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置失败: {}", e))?;
    let mut disabled = Vec::new();
    if let Some(deny) = json.get("permissions").and_then(|p| p.get("deny")).and_then(|d| d.as_array()) {
        for item in deny {
            if let Some(s) = item.as_str() {
                // 匹配 "Skill(xxx)" 格式
                if let Some(name) = s.strip_prefix("Skill(").and_then(|r| r.strip_suffix(')')) {
                    disabled.push(name.to_string());
                }
            }
        }
    }
    Ok(disabled)
}

#[tauri::command]
fn toggle_skill_for_project(project_path: String, skill_name: String, enabled: bool) -> Result<(), String> {
    let claude_dir = std::path::Path::new(&project_path).join(".claude");
    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir)
            .map_err(|e| format!("创建 .claude 目录失败: {}", e))?;
    }
    let settings_path = claude_dir.join("settings.local.json");
    let mut json: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("读取配置失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let skill_entry = format!("Skill({})", skill_name);

    // 确保 permissions.deny 数组存在
    if json.get("permissions").is_none() {
        json["permissions"] = serde_json::json!({});
    }
    if json["permissions"].get("deny").is_none() {
        json["permissions"]["deny"] = serde_json::json!([]);
    }

    let deny = json["permissions"]["deny"].as_array_mut()
        .ok_or("deny 字段类型异常")?;

    if enabled {
        // 启用：从 deny 列表中移除
        deny.retain(|v| v.as_str() != Some(&skill_entry));
    } else {
        // 禁用：添加到 deny 列表（去重）
        if !deny.iter().any(|v| v.as_str() == Some(&skill_entry)) {
            deny.push(serde_json::Value::String(skill_entry));
        }
    }

    // 如果 deny 为空，清理空结构
    if deny.is_empty() {
        if let Some(perms) = json.get_mut("permissions").and_then(|p| p.as_object_mut()) {
            perms.remove("deny");
            if perms.is_empty() {
                json.as_object_mut().unwrap().remove("permissions");
            }
        }
    }

    let output = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&settings_path, output)
        .map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

// ---- 全局技能开关 ----

#[tauri::command]
fn get_global_disabled_skills() -> Result<Vec<String>, String> {
    let settings_path = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join(".claude")
        .join("settings.json");
    if !settings_path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("读取全局配置失败: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析全局配置失败: {}", e))?;
    let mut disabled = Vec::new();
    if let Some(deny) = json.get("permissions").and_then(|p| p.get("deny")).and_then(|d| d.as_array()) {
        for item in deny {
            if let Some(s) = item.as_str() {
                if let Some(name) = s.strip_prefix("Skill(").and_then(|r| r.strip_suffix(')')) {
                    disabled.push(name.to_string());
                }
            }
        }
    }
    Ok(disabled)
}

#[tauri::command]
fn toggle_global_skill(skill_name: String, enabled: bool) -> Result<(), String> {
    let claude_dir = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join(".claude");
    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir)
            .map_err(|e| format!("创建 .claude 目录失败: {}", e))?;
    }
    let settings_path = claude_dir.join("settings.json");
    let mut json: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("读取全局配置失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let skill_entry = format!("Skill({})", skill_name);

    if json.get("permissions").is_none() {
        json["permissions"] = serde_json::json!({});
    }
    if json["permissions"].get("deny").is_none() {
        json["permissions"]["deny"] = serde_json::json!([]);
    }

    let deny = json["permissions"]["deny"].as_array_mut()
        .ok_or("deny 字段类型异常")?;

    if enabled {
        deny.retain(|v| v.as_str() != Some(&skill_entry));
    } else {
        if !deny.iter().any(|v| v.as_str() == Some(&skill_entry)) {
            deny.push(serde_json::Value::String(skill_entry));
        }
    }

    if deny.is_empty() {
        if let Some(perms) = json.get_mut("permissions").and_then(|p| p.as_object_mut()) {
            perms.remove("deny");
            if perms.is_empty() {
                json.as_object_mut().unwrap().remove("permissions");
            }
        }
    }

    let output = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&settings_path, output)
        .map_err(|e| format!("写入全局配置失败: {}", e))?;
    Ok(())
}

// ---- 反馈系统 ----

#[derive(serde::Serialize, serde::Deserialize)]
struct FeedbackEntry {
    id: String,
    content: String,
    timestamp: String,
}

/// 提交反馈，保存到本地并创建 GitHub Issue
#[tauri::command]
fn submit_feedback(content: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let data_dir = home.join(".claude-desktop");
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let feedback_file = data_dir.join("feedback.json");
    let mut feedbacks: Vec<FeedbackEntry> = if feedback_file.exists() {
        let c = std::fs::read_to_string(&feedback_file).unwrap_or_default();
        serde_json::from_str(&c).unwrap_or_default()
    } else {
        Vec::new()
    };

    let now = chrono::Utc::now();
    feedbacks.push(FeedbackEntry {
        id: format!("fb-{}", now.timestamp_millis()),
        content: content.clone(),
        timestamp: now.to_rfc3339(),
    });

    let output = serde_json::to_string_pretty(&feedbacks)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&feedback_file, output)
        .map_err(|e| format!("写入失败: {}", e))?;

    // 同步创建 GitHub Issue（构建时注入 token）
    if let Some(token) = option_env!("GITHUB_FEEDBACK_TOKEN") {
        let title = if content.len() > 50 {
            format!("[用户反馈] {}...", &content[..content.char_indices().nth(50).map(|(i,_)|i).unwrap_or(content.len())])
        } else {
            format!("[用户反馈] {}", &content)
        };
        let body = format!("## 用户反馈\n\n{}\n\n---\n*提交时间: {}*", content, now.to_rfc3339());
        let _ = reqwest::blocking::Client::new()
            .post("https://api.github.com/repos/shehuiyao/claudedesktop/issues")
            .header("Authorization", format!("Bearer {}", token))
            .header("User-Agent", "claude-desktop")
            .header("Accept", "application/vnd.github+json")
            .json(&serde_json::json!({
                "title": title,
                "body": body,
                "labels": ["feedback"]
            }))
            .send();
    }

    Ok(())
}

/// 获取所有反馈
#[tauri::command]
fn get_feedbacks() -> Result<Vec<FeedbackEntry>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let feedback_file = home.join(".claude-desktop").join("feedback.json");
    if !feedback_file.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&feedback_file)
        .map_err(|e| format!("读取失败: {}", e))?;
    let feedbacks: Vec<FeedbackEntry> = serde_json::from_str(&content).unwrap_or_default();
    Ok(feedbacks)
}

// ---- 技能使用次数统计 ----

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct SkillUsageMap {
    counts: HashMap<String, u32>,
}

/// 记录技能使用一次
#[tauri::command]
fn record_skill_usage(skill_name: String) -> Result<u32, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let data_dir = home.join(".claude-desktop");
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let usage_file = data_dir.join("skill_usage.json");
    let mut usage: SkillUsageMap = if usage_file.exists() {
        let content = std::fs::read_to_string(&usage_file).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        SkillUsageMap::default()
    };

    let count = usage.counts.entry(skill_name).or_insert(0);
    *count += 1;
    let new_count = *count;

    let output = serde_json::to_string_pretty(&usage)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&usage_file, output)
        .map_err(|e| format!("写入失败: {}", e))?;
    Ok(new_count)
}

/// 获取所有技能的使用次数
#[tauri::command]
fn get_skill_usage() -> Result<HashMap<String, u32>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let usage_file = home.join(".claude-desktop").join("skill_usage.json");
    if !usage_file.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&usage_file)
        .map_err(|e| format!("读取失败: {}", e))?;
    let usage: SkillUsageMap = serde_json::from_str(&content).unwrap_or_default();
    Ok(usage.counts)
}

// ---- Claude Code 使用统计 ----

#[derive(serde::Serialize, Default)]
struct UsageStats {
    /// 今日消息数
    today_messages: u64,
    /// 今日会话数
    today_sessions: u64,
    /// 今日工具调用数
    today_tool_calls: u64,
}

#[tauri::command]
fn get_usage_stats() -> Result<UsageStats, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let stats_file = home.join(".claude").join("stats-cache.json");
    if !stats_file.exists() {
        return Ok(UsageStats::default());
    }
    let content = std::fs::read_to_string(&stats_file)
        .map_err(|e| format!("读取统计失败: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析统计失败: {}", e))?;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut stats = UsageStats::default();

    if let Some(daily) = json.get("dailyActivity").and_then(|d| d.as_array()) {
        for entry in daily {
            if entry.get("date").and_then(|d| d.as_str()) == Some(&today) {
                stats.today_messages = entry.get("messageCount").and_then(|v| v.as_u64()).unwrap_or(0);
                stats.today_sessions = entry.get("sessionCount").and_then(|v| v.as_u64()).unwrap_or(0);
                stats.today_tool_calls = entry.get("toolCallCount").and_then(|v| v.as_u64()).unwrap_or(0);
                break;
            }
        }
    }

    Ok(stats)
}

#[tauri::command]
fn get_codex_usage() -> Result<codex_usage::CodexUsageReport, String> {
    codex_usage::collect_codex_usage()
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    use std::process::Command;
    let mut child = Command::new("open")
        .args(["-a", "Terminal", &path])
        .spawn()
        .map_err(|e| format!("Failed to open Terminal: {}", e))?;
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    use std::process::Command;
    let mut child = Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

#[tauri::command]
fn confirm_close(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| format!("Failed to close: {}", e))
}

// ─── Bug Tracker 命令 ───

/// 获取 git 项目根目录
fn get_git_toplevel(working_dir: &str) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(working_dir)
        .output()
        .map_err(|e| format!("无法执行 git 命令: {}", e))?;
    let toplevel = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if toplevel.is_empty() {
        return Err("无法获取 git 项目根目录".to_string());
    }
    Ok(toplevel)
}

/// 根据工作目录的 git 分支名，定位 bugs.json 路径
/// 生成 {项目名}-{分支名} 格式的目录路径，放在项目父目录下
fn make_branch_directory_path(project_path: &str, branch: &str) -> std::path::PathBuf {
    let project_dir = std::path::Path::new(project_path);
    let project_name = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");
    // 分支名中的 / 替换为 - 作为目录名
    let safe_branch = branch.replace('/', "-");
    // 如果项目已经是根目录，则在自身下创建（这种情况很少见）
    project_dir
        .parent()
        .unwrap_or(project_dir)
        .join(format!("{}-{}", project_name, safe_branch))
}

fn get_bugs_json_path(working_dir: &str) -> Result<std::path::PathBuf, String> {
    let output = std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(working_dir)
        .output()
        .map_err(|e| format!("无法执行 git 命令: {}", e))?;

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        return Err("无法获取当前 git 分支名".to_string());
    }

    // bugs 目录在项目上一层的 Task/{PROJECT_NAME}-{BRANCH}/bugs/ 下
    let branch_dir = make_branch_directory_path(working_dir, &branch);
    let bugs_json = branch_dir
        .parent()
        .ok_or("无法获取分支目录上级")?
        .join("Task")
        .join(branch_dir.file_name().unwrap())
        .join("bugs")
        .join("bugs.json");

    Ok(bugs_json)
}

#[tauri::command]
fn list_bugs(working_dir: String) -> Result<BugsData, String> {
    let bugs_path = get_bugs_json_path(&working_dir)?;

    let empty = BugsData {
        project: String::new(),
        branch: String::new(),
        created: String::new(),
        bugs: vec![],
        project_root: None,
    };

    if !bugs_path.exists() {
        return Ok(empty);
    }

    let content = std::fs::read_to_string(&bugs_path)
        .map_err(|e| format!("读取 bugs.json 失败: {}", e))?;

    let data: BugsData = serde_json::from_str(&content)
        .map_err(|e| format!("解析 bugs.json 失败: {}", e))?;

    // 校验项目归属：如果 bugs.json 记录了 project_root，则只在匹配时返回数据
    if let Some(ref stored_root) = data.project_root {
        if let Ok(current_root) = get_git_toplevel(&working_dir) {
            if stored_root != &current_root {
                return Ok(empty);
            }
        }
    }

    Ok(data)
}

#[tauri::command]
fn update_bug_status(working_dir: String, bug_id: String, new_status: String) -> Result<BugEntry, String> {
    let bugs_path = get_bugs_json_path(&working_dir)?;

    if !bugs_path.exists() {
        return Err("bugs.json 不存在".to_string());
    }

    let content = std::fs::read_to_string(&bugs_path)
        .map_err(|e| format!("读取失败: {}", e))?;

    let mut data: BugsData = serde_json::from_str(&content)
        .map_err(|e| format!("解析失败: {}", e))?;

    let bug = data.bugs.iter_mut()
        .find(|b| b.id == bug_id)
        .ok_or(format!("未找到 Bug: {}", bug_id))?;

    match new_status.as_str() {
        "pending" | "fixing" | "fixed" | "shelved" => {}
        _ => return Err(format!("无效状态: {}", new_status)),
    }

    bug.status = new_status;
    bug.updated = chrono::Local::now().format("%Y-%m-%d").to_string();

    let updated_bug = bug.clone();

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&bugs_path, json)
        .map_err(|e| format!("写入失败: {}", e))?;

    Ok(updated_bug)
}

#[tauri::command]
fn update_bug_priority(working_dir: String, bug_id: String, new_priority: String) -> Result<BugEntry, String> {
    let bugs_path = get_bugs_json_path(&working_dir)?;

    if !bugs_path.exists() {
        return Err("bugs.json 不存在".to_string());
    }

    let content = std::fs::read_to_string(&bugs_path)
        .map_err(|e| format!("读取失败: {}", e))?;

    let mut data: BugsData = serde_json::from_str(&content)
        .map_err(|e| format!("解析失败: {}", e))?;

    let bug = data.bugs.iter_mut()
        .find(|b| b.id == bug_id)
        .ok_or(format!("未找到 Bug: {}", bug_id))?;

    match new_priority.as_str() {
        "P0" | "P1" | "P2" | "P3" => {}
        _ => return Err(format!("无效优先级: {}", new_priority)),
    }

    bug.priority = new_priority;
    bug.updated = chrono::Local::now().format("%Y-%m-%d").to_string();

    let updated_bug = bug.clone();

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&bugs_path, json)
        .map_err(|e| format!("写入失败: {}", e))?;

    Ok(updated_bug)
}

/// 读取 bug 截图文件，返回 base64 编码的 data URI
#[tauri::command]
fn get_bug_image(working_dir: String, image_path: String) -> Result<String, String> {
    let bugs_path = get_bugs_json_path(&working_dir)?;
    let bugs_dir = bugs_path.parent()
        .ok_or("无法获取 bugs 目录")?;

    let full_path = bugs_dir.join(&image_path);

    if !full_path.exists() {
        return Err(format!("图片不存在: {}", image_path));
    }

    let bytes = std::fs::read(&full_path)
        .map_err(|e| format!("读取图片失败: {}", e))?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let ext = full_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };

    Ok(format!("data:{};base64,{}", mime, b64))
}

// ─── Quick Actions 命令 ───

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct QuickAction {
    label: String,
    command: String,
    icon: String,
    description: String,
    color: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct QuickActionsConfig {
    actions: Vec<QuickAction>,
}

fn default_quick_actions() -> Vec<QuickAction> {
    vec![
        QuickAction { label: "录入 Bug".into(), command: "/xy-bug-track".into(), icon: "\u{1f41b}".into(), description: "录入 bug 反馈".into(), color: "red".into() },
        QuickAction { label: "修 Bug".into(), command: "/xy-bug-fix".into(), icon: "\u{1f527}".into(), description: "从 bug 列表选择并修复".into(), color: "orange".into() },
        QuickAction { label: "发布测试服".into(), command: "发布测试服".into(), icon: "\u{1f680}".into(), description: "推送并发布到测试环境".into(), color: "cyan".into() },
        QuickAction { label: "提交代码".into(), command: "帮我提交".into(), icon: "\u{1f4dd}".into(), description: "AI 分析变更并生成 commit".into(), color: "green".into() },
        QuickAction { label: "创建分支".into(), command: "/branch".into(), icon: "\u{1f33f}".into(), description: "新建 Git 分支".into(), color: "purple".into() },
        QuickAction { label: "创建 PR".into(), command: "/create-pr".into(), icon: "\u{1f4ec}".into(), description: "质量检查后创建合并请求".into(), color: "blue".into() },
    ]
}

#[tauri::command]
fn load_quick_actions(working_dir: String) -> Result<Vec<QuickAction>, String> {
    let config_path = std::path::Path::new(&working_dir)
        .join(".claude")
        .join("quick-actions.json");

    if !config_path.exists() {
        return Ok(default_quick_actions());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置失败: {}", e))?;
    let config: QuickActionsConfig = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置失败: {}", e))?;

    Ok(config.actions)
}

#[tauri::command]
fn reveal_quick_actions_config(working_dir: String) -> Result<(), String> {
    let claude_dir = std::path::Path::new(&working_dir).join(".claude");
    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir)
            .map_err(|e| format!("创建 .claude 目录失败: {}", e))?;
    }

    let config_path = claude_dir.join("quick-actions.json");

    // 如果配置文件不存在，写入默认配置
    if !config_path.exists() {
        let default_config = QuickActionsConfig {
            actions: default_quick_actions(),
        };
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("序列化失败: {}", e))?;
        std::fs::write(&config_path, json)
            .map_err(|e| format!("写入配置失败: {}", e))?;
    }

    // 用 Finder 打开文件
    std::process::Command::new("open")
        .args(["-R", &config_path.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("打开 Finder 失败: {}", e))?;

    Ok(())
}

#[derive(Debug, serde::Serialize, Clone)]
struct WorktreeResult {
    path: String,
    branch: String,
}

#[tauri::command]
fn create_worktree(path: String, branch: String) -> Result<WorktreeResult, String> {
    let worktree_dir = make_branch_directory_path(&path, &branch);

    // 直接让 git 处理错误，不提前检查存在性（避免 TOCTOU 竞态条件）
    let output = std::process::Command::new("git")
        .args(["worktree", "add", &worktree_dir.to_string_lossy(), &branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("执行 git worktree add 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 如果目录已存在 git 会报错，此时直接返回已有路径给调用方
        if stderr.contains("already exists") {
            return Ok(WorktreeResult {
                path: worktree_dir.to_string_lossy().to_string(),
                branch,
            });
        }
        return Err(format!("创建 worktree 失败: {}", stderr.trim()));
    }

    Ok(WorktreeResult {
        path: worktree_dir.to_string_lossy().to_string(),
        branch,
    })
}

#[tauri::command]
fn remove_worktree(path: String, worktree_path: String) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["worktree", "remove", &worktree_path, "--force"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("执行 git worktree remove 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("删除 worktree 失败: {}", stderr.trim()));
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            detect_running_launchpad_projects,
            stop_detected_launchpad_process,
            check_claude_installed,
            list_directory,
            list_rule_files,
            list_skills,
            get_disabled_skills,
            toggle_skill_for_project,
            get_global_disabled_skills,
            toggle_global_skill,
            get_git_info,
            chat_send,
            chat_stop,
            chat_test,
            list_branches,
            switch_branch,
            get_commit_history,
            reveal_in_finder,
            open_terminal,
            confirm_close,
            submit_feedback,
            get_feedbacks,
            record_skill_usage,
            get_skill_usage,
            get_usage_stats,
            get_codex_usage,
            list_bugs,
            update_bug_status,
            update_bug_priority,
            get_bug_image,
            load_quick_actions,
            reveal_quick_actions_config,
            create_worktree,
            remove_worktree,
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
