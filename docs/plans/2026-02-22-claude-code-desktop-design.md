# Claude Code Desktop - Mac 桌面客户端设计文档

## 1. 项目概述

- **名称**：Claude Code Desktop
- **定位**：Claude Code CLI 的 Mac 桌面 GUI 包装器，极简终端风格
- **技术栈**：Tauri 2 + React + TypeScript + Rust 后端
- **核心策略**：PTY 包装 CLI 做实时对话 + 直接读取 JSONL 做历史管理

## 2. 调研结论

### Codex CLI 参考功能
- 全屏终端 UI，对话式工作流
- 会话恢复（`codex resume`）
- 三级审批模式（Suggest / Auto-edit / Full-auto）
- ChatGPT 账户 / API Key 双重登录
- 本地 JSONL 历史记录存储

### Claude Code 本地数据结构
- `~/.claude/history.jsonl` — 全局历史索引（display, timestamp, project, sessionId）
- `~/.claude/projects/<folder-slug>/<session-id>.jsonl` — 会话完整对话记录
- `~/.claude/settings.json` — 全局配置
- 认证凭据存储在 macOS Keychain

### 已有类似项目
- **Opcode**（Tauri 2 + React + Rust）— 验证了技术可行性
- **1Code**（Cursor 风格 UI）— 多 agent 并行
- **Claude Desktop**（官方）— 偏聊天，非编码代理

### 关键限制
- Anthropic 禁止第三方使用 OAuth token，必须用 API Key 或复用 CLI 认证
- Claude Agent SDK 仍在快速迭代

## 3. 技术方案：混合方案

- **实时对话**：通过 Rust PTY 启动 `claude` CLI 子进程，捕获 stdin/stdout
- **历史管理**：直接读取 `~/.claude/` 下的 JSONL 文件
- **认证**：复用 CLI 已有的 Keychain 凭据，无需单独登录

## 4. 架构

```
┌─────────────────────────────────────────────┐
│              React Frontend                  │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │ 会话列表  │  │  对话区域  │  │  终端面板  │ │
│  │ (sidebar) │  │ (main)    │  │ (bottom)  │ │
│  └──────────┘  └───────────┘  └───────────┘ │
├─────────────────────────────────────────────┤
│              Tauri IPC Bridge                │
├─────────────────────────────────────────────┤
│              Rust Backend                    │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │ PTY 管理  │  │ JSONL 读取│  │ Keychain  │ │
│  │ (claude   │  │ (history  │  │ (auth     │ │
│  │  进程)    │  │  parser)  │  │  check)   │ │
│  └──────────┘  └───────────┘  └───────────┘ │
└─────────────────────────────────────────────┘
         │              │
    ┌────┘              └────┐
    ▼                        ▼
  claude CLI              ~/.claude/
  (子进程)              (JSONL files)
```

## 5. UI 布局（极简终端风格）

```
┌─────────────────────────────────────────────────┐
│ ● ● ●  Claude Code Desktop          ─  □  ✕    │
├────────────┬────────────────────────────────────┤
│            │                                    │
│  会话列表   │  > 你: 帮我重构这个函数             │
│            │                                    │
│  ─────     │  Claude: 好的，我来分析一下...       │
│  今天       │  ```rust                           │
│  ◉ 重构xx   │  fn refactored() {                 │
│  ○ 修复bug  │      // improved                   │
│             │  }                                 │
│  ─────     │  ```                               │
│  昨天       │  ✓ 文件已修改: src/main.rs          │
│  ○ 新功能   │                                    │
│  ○ 代码审查  │                                    │
│            │                                    │
│            ├────────────────────────────────────┤
│  [+ 新会话] │  ❯ 输入消息...              [发送]  │
├────────────┴────────────────────────────────────┤
│  状态栏: claude connected │ model: opus │ $/cost │
└─────────────────────────────────────────────────┘
```

**设计原则**：
- 暗色主题为主，终端风格配色（黑底绿/白字）
- 等宽字体（JetBrains Mono / Fira Code）
- Markdown 渲染对话内容，代码块语法高亮
- 左侧窄侧边栏仅显示会话列表，可折叠
- 底部状态栏显示连接状态和 token 用量

## 6. 核心功能模块

| 模块 | 描述 | 实现方式 |
|------|------|----------|
| **实时对话** | 发送消息、接收流式回复 | PTY 子进程与 `claude` CLI 通信 |
| **历史记录** | 浏览、搜索、按项目/日期分组 | 读取 `~/.claude/history.jsonl` + `projects/` |
| **会话恢复** | 点击历史会话恢复上下文 | 调用 `claude --resume <session-id>` |
| **认证状态** | 检测是否已登录，提示登录 | 检查 Keychain + 尝试启动 CLI |
| **终端输出** | 显示 CLI 原始输出（可选面板） | xterm.js 渲染 PTY 输出 |
| **新建会话** | 选择工作目录开始新对话 | 文件对话框选目录 + 新 PTY 进程 |

## 7. 数据流

**实时对话流**：
```
用户输入 → React → Tauri IPC → Rust PTY write → claude CLI
claude CLI → Rust PTY read → Tauri event → React 渲染
```

**历史记录流**：
```
启动时 → Rust 读取 ~/.claude/history.jsonl → 解析 → Tauri IPC → React 侧边栏
点击会话 → Rust 读取 projects/<slug>/<session>.jsonl → 解析 → React 对话区
```

## 8. 项目文件结构

```
claudedesktop/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Tauri 入口
│   │   ├── pty.rs           # PTY 进程管理
│   │   ├── history.rs       # JSONL 历史读取
│   │   └── commands.rs      # Tauri IPC 命令
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── App.tsx              # 主布局
│   ├── components/
│   │   ├── Sidebar.tsx      # 会话列表侧边栏
│   │   ├── ChatArea.tsx     # 对话区域
│   │   ├── MessageBubble.tsx # 消息气泡
│   │   ├── Terminal.tsx     # 终端面板
│   │   ├── StatusBar.tsx    # 状态栏
│   │   └── InputBar.tsx     # 输入栏
│   ├── hooks/
│   │   ├── useSession.ts    # 会话管理
│   │   └── useHistory.ts    # 历史记录
│   └── styles/
│       └── terminal-theme.css
├── package.json
└── tsconfig.json
```

## 9. MVP 范围

MVP 版本包含：
1. 基础对话界面（发送消息、流式回复渲染）
2. 历史记录侧边栏（按日期分组、点击恢复）
3. 认证状态检测（复用 CLI 登录）
4. 内嵌终端面板（xterm.js 渲染 CLI 原始输出）

不包含（后续迭代）：
- 文件树浏览器
- 代码编辑器
- 多 agent 并行
- 自定义 agent 模板
- 设置界面

## 10. 风险与注意事项

1. **CLI 依赖**：用户必须已安装 Claude Code CLI
2. **PTY 解析**：ANSI escape codes 解析有复杂度，可借助 xterm.js
3. **JSONL 格式**：可能随 CLI 版本变化，需做容错
4. **OAuth 政策**：不可路由 OAuth token，仅复用 CLI 自身的认证
5. **竞品**：官方 Claude Desktop 持续迭代，需找差异化（更轻量、终端风格、更好的历史管理）
