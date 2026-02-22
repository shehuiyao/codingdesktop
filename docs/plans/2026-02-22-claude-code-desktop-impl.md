# Claude Code Desktop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Mac desktop GUI wrapper for Claude Code CLI using Tauri 2 + React, with PTY-based real-time chat and JSONL-based history management.

**Architecture:** Tauri 2 app with Rust backend managing PTY subprocess (claude CLI) and JSONL file parsing, React frontend with terminal-styled UI (dark theme, monospace font, sidebar + chat + terminal panels).

**Tech Stack:** Tauri 2, React 18, TypeScript, Rust, portable-pty (Rust PTY crate), xterm.js, react-markdown, tailwindcss

---

## Task 1: Scaffold Tauri 2 + React Project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`
- Create: `src/main.tsx`, `src/App.tsx`
- Create: `tailwind.config.js`, `postcss.config.js`

**Step 1: Create Tauri 2 project with React template**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
npm create tauri-app@latest . -- --template react-ts --manager npm
```

If the directory is not empty, clear it first or use the interactive flow. Expected: scaffolded project with `src-tauri/` and `src/` directories.

**Step 2: Install frontend dependencies**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
npm install
npm install tailwindcss @tailwindcss/vite react-markdown remark-gfm xterm @xterm/addon-fit @xterm/addon-web-links
```

**Step 3: Configure Tailwind CSS**

Update `vite.config.ts` to include Tailwind plugin. Create `src/styles/global.css` with Tailwind directives and terminal theme variables:

```css
@import "tailwindcss";

:root {
  --bg-primary: #1a1b26;
  --bg-secondary: #24283b;
  --bg-tertiary: #2f3346;
  --text-primary: #a9b1d6;
  --text-secondary: #565f89;
  --accent-green: #9ece6a;
  --accent-blue: #7aa2f7;
  --accent-red: #f7768e;
  --border-color: #3b3f54;
}

body {
  margin: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}
```

**Step 4: Add Rust PTY dependency**

Add to `src-tauri/Cargo.toml`:
```toml
[dependencies]
portable-pty = "0.8"
serde_json = "1"
serde = { version = "1", features = ["derive"] }
dirs = "6"
```

**Step 5: Verify project builds**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
npm run tauri dev
```
Expected: Tauri window opens showing default React page. Close it.

**Step 6: Initialize git and commit**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
git init
git add -A
git commit -m "feat: scaffold Tauri 2 + React project with dependencies"
```

---

## Task 2: Rust Backend — JSONL History Parser

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Create history data types**

Create `src-tauri/src/history.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub display: Option<String>,
    pub timestamp: Option<String>,
    pub project: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionMessage {
    pub role: Option<String>,
    pub content: Option<serde_json::Value>,
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
}

/// Get the Claude config directory path
fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

/// Read the global history index from ~/.claude/history.jsonl
pub fn read_history() -> Result<Vec<HistoryEntry>, String> {
    let path = claude_dir()
        .ok_or("Cannot find home directory")?
        .join("history.jsonl");

    if !path.exists() {
        return Ok(vec![]);
    }

    let file = fs::File::open(&path).map_err(|e| format!("Failed to open history: {}", e))?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<HistoryEntry>(trimmed) {
            Ok(entry) => entries.push(entry),
            Err(_) => continue, // Skip malformed lines
        }
    }

    Ok(entries)
}

/// Read a specific session's messages from ~/.claude/projects/<slug>/<session>.jsonl
pub fn read_session(project_slug: &str, session_id: &str) -> Result<Vec<SessionMessage>, String> {
    let path = claude_dir()
        .ok_or("Cannot find home directory")?
        .join("projects")
        .join(project_slug)
        .join(format!("{}.jsonl", session_id));

    if !path.exists() {
        return Err(format!("Session file not found: {:?}", path));
    }

    let file = fs::File::open(&path).map_err(|e| format!("Failed to open session: {}", e))?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<SessionMessage>(trimmed) {
            Ok(msg) => messages.push(msg),
            Err(_) => continue,
        }
    }

    Ok(messages)
}

/// List all project slugs (subdirectories under ~/.claude/projects/)
pub fn list_projects() -> Result<Vec<String>, String> {
    let path = claude_dir()
        .ok_or("Cannot find home directory")?
        .join("projects");

    if !path.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read projects: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        if entry.path().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                projects.push(name.to_string());
            }
        }
    }

    Ok(projects)
}
```

**Step 2: Register history module and Tauri commands in main.rs**

Update `src-tauri/src/main.rs`:

```rust
mod history;

use history::{HistoryEntry, SessionMessage};

#[tauri::command]
fn get_history() -> Result<Vec<HistoryEntry>, String> {
    history::read_history()
}

#[tauri::command]
fn get_session(project_slug: String, session_id: String) -> Result<Vec<SessionMessage>, String> {
    history::read_session(&project_slug, &session_id)
}

#[tauri::command]
fn get_projects() -> Result<Vec<String>, String> {
    history::list_projects()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_history,
            get_session,
            get_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 3: Verify it compiles**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop/src-tauri
cargo check
```
Expected: compiles without errors.

**Step 4: Commit**

```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
git add src-tauri/src/history.rs src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat: add JSONL history parser for Claude Code sessions"
```

---

## Task 3: Rust Backend — PTY Process Manager

**Files:**
- Create: `src-tauri/src/pty_manager.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Create PTY manager module**

Create `src-tauri/src/pty_manager.rs`:

```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl PtySession {
    /// Spawn a claude CLI process in a PTY, stream output to frontend via Tauri events
    pub fn spawn(
        app: AppHandle,
        working_dir: String,
        args: Vec<String>,
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

        let mut cmd = CommandBuilder::new("claude");
        for arg in &args {
            cmd.arg(arg);
        }
        cmd.cwd(&working_dir);

        // Inherit environment
        for (key, value) in std::env::vars() {
            cmd.env(key, value);
        }

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let writer = Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| {
            format!("Failed to get PTY writer: {}", e)
        })?));

        // Read PTY output in background thread, emit to frontend
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
                        let _ = app_clone.emit("pty-exit", ());
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_clone.emit("pty-output", &data);
                    }
                    Err(_) => {
                        let _ = app_clone.emit("pty-exit", ());
                        break;
                    }
                }
            }
        });

        Ok(PtySession { writer })
    }

    /// Write user input to the PTY
    pub fn write(&self, data: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| format!("Lock error: {}", e))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }
}
```

**Step 2: Add PTY Tauri commands to main.rs**

Add to `src-tauri/src/main.rs`:

```rust
mod pty_manager;

use pty_manager::PtySession;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    session: Mutex<Option<PtySession>>,
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
```

Update the `main()` function to register state and new commands:

```rust
fn main() {
    tauri::Builder::default()
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
```

**Step 3: Add `which` crate to Cargo.toml**

Add to `[dependencies]`:
```toml
which = "7"
```

**Step 4: Verify it compiles**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop/src-tauri
cargo check
```
Expected: compiles without errors.

**Step 5: Commit**

```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
git add src-tauri/
git commit -m "feat: add PTY process manager for Claude CLI subprocess"
```

---

## Task 4: React Frontend — App Layout Shell

**Files:**
- Create: `src/App.tsx`
- Create: `src/styles/global.css`
- Modify: `src/main.tsx`

**Step 1: Set up global styles**

Create `src/styles/global.css` with terminal dark theme (CSS shown in Task 1 Step 3).

**Step 2: Build main App layout**

Overwrite `src/App.tsx`:

```tsx
import { useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import StatusBar from "./components/StatusBar";

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            activeSessionId={activeSessionId}
            onSelectSession={(projectSlug, sessionId) => {
              setActiveProject(projectSlug);
              setActiveSessionId(sessionId);
            }}
            onNewSession={() => {
              setActiveSessionId(null);
              setActiveProject(null);
            }}
          />
        )}
        <ChatArea
          sessionId={activeSessionId}
          projectSlug={activeProject}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
```

**Step 3: Update main.tsx to import global styles**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Step 4: Create placeholder components**

Create minimal placeholder files so the app compiles:

- `src/components/Sidebar.tsx` — empty sidebar div
- `src/components/ChatArea.tsx` — empty main area div
- `src/components/StatusBar.tsx` — status bar with "Claude Code Desktop" text

Each component should accept the props defined in App.tsx and render a minimal placeholder.

**Step 5: Verify it renders**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
npm run tauri dev
```
Expected: Window shows dark layout with sidebar and main area placeholders.

**Step 6: Commit**

```bash
git add src/
git commit -m "feat: add App layout shell with dark terminal theme"
```

---

## Task 5: React Frontend — Sidebar (History List)

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Create: `src/hooks/useHistory.ts`

**Step 1: Create useHistory hook**

Create `src/hooks/useHistory.ts`:

```tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface HistoryEntry {
  display: string | null;
  timestamp: string | null;
  project: string | null;
  sessionId: string | null;
}

interface GroupedHistory {
  label: string;
  entries: HistoryEntry[];
}

function groupByDate(entries: HistoryEntry[]): GroupedHistory[] {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();

  const groups: Record<string, HistoryEntry[]> = {};

  for (const entry of entries) {
    if (!entry.timestamp) continue;
    const date = new Date(entry.timestamp);
    const dateStr = date.toDateString();
    let label: string;
    if (dateStr === today) label = "Today";
    else if (dateStr === yesterday) label = "Yesterday";
    else label = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });

    if (!groups[label]) groups[label] = [];
    groups[label].push(entry);
  }

  return Object.entries(groups).map(([label, entries]) => ({ label, entries }));
}

export function useHistory() {
  const [history, setHistory] = useState<GroupedHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<HistoryEntry[]>("get_history")
      .then((entries) => {
        const sorted = entries
          .filter((e) => e.display && e.sessionId)
          .sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
          });
        setHistory(groupByDate(sorted));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { history, loading };
}
```

**Step 2: Build Sidebar component**

Update `src/components/Sidebar.tsx`:

```tsx
import { useHistory } from "../hooks/useHistory";

interface SidebarProps {
  activeSessionId: string | null;
  onSelectSession: (projectSlug: string, sessionId: string) => void;
  onNewSession: () => void;
}

export default function Sidebar({ activeSessionId, onSelectSession, onNewSession }: SidebarProps) {
  const { history, loading } = useHistory();

  // Derive project slug from project path
  const toSlug = (project: string | null) => {
    if (!project) return "";
    return project.replace(/\//g, "-").replace(/^-/, "");
  };

  return (
    <div className="w-60 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)] overflow-hidden">
      <div className="p-3 border-b border-[var(--border-color)]">
        <button
          onClick={onNewSession}
          className="w-full py-2 px-3 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--accent-blue)] hover:text-white rounded transition-colors cursor-pointer"
        >
          + New Session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-[var(--text-secondary)] text-sm p-2">Loading...</div>
        ) : (
          history.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase px-2 py-1">
                {group.label}
              </div>
              {group.entries.map((entry) => (
                <button
                  key={entry.sessionId}
                  onClick={() => onSelectSession(toSlug(entry.project), entry.sessionId!)}
                  className={`w-full text-left px-2 py-1.5 text-sm rounded truncate cursor-pointer transition-colors ${
                    activeSessionId === entry.sessionId
                      ? "bg-[var(--accent-blue)] text-white"
                      : "hover:bg-[var(--bg-tertiary)]"
                  }`}
                >
                  {entry.display || "Untitled"}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 3: Verify sidebar renders with real data**

Run:
```bash
npm run tauri dev
```
Expected: Sidebar shows grouped history entries from `~/.claude/history.jsonl`.

**Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/hooks/useHistory.ts
git commit -m "feat: add sidebar with grouped history list from JSONL"
```

---

## Task 6: React Frontend — Chat Area + Input Bar

**Files:**
- Modify: `src/components/ChatArea.tsx`
- Create: `src/components/InputBar.tsx`
- Create: `src/components/MessageBubble.tsx`
- Create: `src/hooks/useSession.ts`

**Step 1: Create useSession hook**

Create `src/hooks/useSession.ts`:

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Message {
  role: string;
  content: string;
}

export function useSession(projectSlug: string | null, sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const bufferRef = useRef("");

  // Load saved session messages
  useEffect(() => {
    if (!projectSlug || !sessionId) {
      setMessages([]);
      return;
    }
    invoke<any[]>("get_session", {
      projectSlug,
      sessionId,
    })
      .then((msgs) => {
        const parsed: Message[] = msgs
          .filter((m) => m.role && m.content)
          .map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          }));
        setMessages(parsed);
      })
      .catch(console.error);
  }, [projectSlug, sessionId]);

  // Listen for PTY output
  useEffect(() => {
    const unlisten = listen<string>("pty-output", (event) => {
      bufferRef.current += event.payload;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + event.payload },
          ];
        }
        return [...prev, { role: "assistant", content: event.payload }];
      });
      setStreaming(true);
    });

    const unlistenExit = listen("pty-exit", () => {
      setStreaming(false);
      setConnected(false);
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenExit.then((fn) => fn());
    };
  }, []);

  const startSession = useCallback(async (workingDir: string, args: string[] = []) => {
    await invoke("start_session", { workingDir, args });
    setConnected(true);
    setMessages([]);
    bufferRef.current = "";
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    await invoke("send_input", { data: text + "\n" });
  }, []);

  return { messages, streaming, connected, startSession, sendMessage };
}
```

**Step 2: Create MessageBubble component**

Create `src/components/MessageBubble.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  role: string;
  content: string;
}

export default function MessageBubble({ role, content }: Props) {
  const isUser = role === "user" || role === "human";

  return (
    <div className={`mb-4 ${isUser ? "flex justify-end" : ""}`}>
      <div className={`max-w-[85%] ${isUser ? "text-right" : ""}`}>
        <div className="text-xs text-[var(--text-secondary)] mb-1">
          {isUser ? "> you" : "claude"}
        </div>
        <div
          className={`text-sm leading-relaxed ${
            isUser
              ? "text-[var(--accent-green)]"
              : "text-[var(--text-primary)]"
          }`}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const isInline = !className;
                return isInline ? (
                  <code className="bg-[var(--bg-tertiary)] px-1 py-0.5 rounded text-[var(--accent-blue)]" {...props}>
                    {children}
                  </code>
                ) : (
                  <pre className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded p-3 my-2 overflow-x-auto">
                    <code className={className} {...props}>{children}</code>
                  </pre>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Create InputBar component**

Create `src/components/InputBar.tsx`:

```tsx
import { useState, KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export default function InputBar({ onSend, disabled }: Props) {
  const [text, setText] = useState("");

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-[var(--border-color)] p-3 bg-[var(--bg-secondary)]">
      <div className="flex items-center gap-2">
        <span className="text-[var(--accent-green)]">&#10095;</span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled}
          className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)]"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="text-xs px-3 py-1 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--accent-blue)] hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

**Step 4: Build ChatArea component**

Update `src/components/ChatArea.tsx`:

```tsx
import { useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import MessageBubble from "./MessageBubble";
import InputBar from "./InputBar";
import { useSession } from "../hooks/useSession";

interface Props {
  sessionId: string | null;
  projectSlug: string | null;
  onToggleSidebar: () => void;
}

export default function ChatArea({ sessionId, projectSlug, onToggleSidebar }: Props) {
  const { messages, streaming, connected, startSession, sendMessage } = useSession(
    projectSlug,
    sessionId
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const handleNewChat = async () => {
    // Use Tauri dialog to pick working directory
    const dir = await open({ directory: true, title: "Select working directory" });
    if (dir) {
      await startSession(dir as string);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <button
          onClick={onToggleSidebar}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
        >
          [=]
        </button>
        <span className="text-xs text-[var(--text-secondary)]">
          {connected ? "session active" : sessionId ? "viewing history" : "no session"}
        </span>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !connected ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)]">
            <div className="text-lg mb-2">Claude Code Desktop</div>
            <div className="text-sm mb-4">Start a new session to begin</div>
            <button
              onClick={handleNewChat}
              className="px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--accent-blue)] hover:text-white rounded transition-colors cursor-pointer text-sm"
            >
              Start New Session
            </button>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={i} role={msg.role} content={msg.content} />
          ))
        )}
        {streaming && (
          <div className="text-xs text-[var(--text-secondary)] animate-pulse">
            claude is thinking...
          </div>
        )}
      </div>

      {/* Input bar */}
      <InputBar onSend={sendMessage} disabled={!connected} />
    </div>
  );
}
```

**Step 5: Install dialog plugin**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
npm install @tauri-apps/plugin-dialog
```

Add to `src-tauri/Cargo.toml` under `[dependencies]`:
```toml
tauri-plugin-dialog = "2"
```

Register the plugin in `main.rs`:
```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // ... rest
}
```

**Step 6: Verify chat area renders**

Run: `npm run tauri dev`
Expected: Main area shows welcome screen with "Start New Session" button.

**Step 7: Commit**

```bash
git add src/
git commit -m "feat: add chat area with message rendering and input bar"
```

---

## Task 7: React Frontend — Status Bar

**Files:**
- Modify: `src/components/StatusBar.tsx`

**Step 1: Build StatusBar component**

Update `src/components/StatusBar.tsx`:

```tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function StatusBar() {
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("check_claude_installed")
      .then(setClaudeInstalled)
      .catch(() => setClaudeInstalled(false));
  }, []);

  return (
    <div className="flex items-center justify-between px-3 py-1 text-xs border-t border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
      <div className="flex items-center gap-3">
        <span>
          {claudeInstalled === null
            ? "checking..."
            : claudeInstalled
              ? "claude: installed"
              : "claude: not found"}
        </span>
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            claudeInstalled ? "bg-[var(--accent-green)]" : "bg-[var(--accent-red)]"
          }`}
        />
      </div>
      <div>Claude Code Desktop v0.1.0</div>
    </div>
  );
}
```

**Step 2: Verify status bar renders**

Run: `npm run tauri dev`
Expected: Bottom bar shows "claude: installed" with green dot.

**Step 3: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat: add status bar with CLI detection"
```

---

## Task 8: Integration — Wire Up Full Flow

**Files:**
- Modify: `src-tauri/tauri.conf.json` (window config)
- Modify: `src/App.tsx` (minor tweaks)

**Step 1: Configure Tauri window**

Update `src-tauri/tauri.conf.json` window settings:

```json
{
  "app": {
    "windows": [
      {
        "title": "Claude Code Desktop",
        "width": 1000,
        "height": 700,
        "minWidth": 600,
        "minHeight": 400,
        "decorations": true,
        "transparent": false
      }
    ]
  }
}
```

**Step 2: Add Tauri permissions**

Ensure `src-tauri/capabilities/default.json` includes necessary permissions:
- `core:default`
- `dialog:default` (for directory picker)
- `event:default` (for PTY events)

**Step 3: End-to-end test**

Run: `npm run tauri dev`

Test flow:
1. App opens with dark theme
2. Sidebar shows history entries from `~/.claude/history.jsonl`
3. Click "+ New Session" → file dialog opens
4. Select a directory → claude CLI starts in PTY
5. Type a message → sent to CLI → response streams back
6. Status bar shows "claude: installed"

**Step 4: Commit**

```bash
git add .
git commit -m "feat: wire up full integration and configure Tauri window"
```

---

## Task 9: Polish — Terminal Panel (xterm.js)

**Files:**
- Create: `src/components/Terminal.tsx`
- Modify: `src/App.tsx` (add terminal toggle)

**Step 1: Create Terminal component**

Create `src/components/Terminal.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";

export default function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#9ece6a",
      },
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    const unlisten = listen<string>("pty-output", (event) => {
      term.write(event.payload);
    });

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    return () => {
      unlisten.then((fn) => fn());
      observer.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-48 border-t border-[var(--border-color)]"
    />
  );
}
```

**Step 2: Add terminal toggle to App.tsx**

Add a state `showTerminal` and conditionally render `<TerminalPanel />` below the ChatArea.

**Step 3: Verify terminal renders**

Run: `npm run tauri dev`
Expected: Terminal panel at bottom shows raw CLI output when a session is active.

**Step 4: Commit**

```bash
git add src/components/Terminal.tsx src/App.tsx
git commit -m "feat: add xterm.js terminal panel for raw CLI output"
```

---

## Task 10: Build & Package

**Step 1: Build the production app**

Run:
```bash
cd /Users/senguoyun/Desktop/demotry/claudedesktop
npm run tauri build
```
Expected: `.dmg` or `.app` bundle created in `src-tauri/target/release/bundle/`.

**Step 2: Test the built app**

Open the generated `.app` file and verify all features work.

**Step 3: Final commit**

```bash
git add .
git commit -m "chore: finalize MVP build configuration"
```

---

## Summary

| Task | Description | Est. Complexity |
|------|-------------|----------------|
| 1 | Scaffold Tauri 2 + React project | Low |
| 2 | Rust JSONL history parser | Medium |
| 3 | Rust PTY process manager | Medium |
| 4 | App layout shell | Low |
| 5 | Sidebar with history | Medium |
| 6 | Chat area + input + messages | High |
| 7 | Status bar | Low |
| 8 | Integration wiring | Medium |
| 9 | Terminal panel (xterm.js) | Medium |
| 10 | Build & package | Low |
