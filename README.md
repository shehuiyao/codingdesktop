# Claude Code Desktop

一个为 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 和 [Gemini CLI](https://github.com/google-gemini/gemini-cli) 打造的桌面 GUI 客户端，基于 Tauri v2 + React + TypeScript 构建。

![Version](https://img.shields.io/badge/version-0.6.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-v2-orange)

## 功能特性

- **多标签终端** — 同时打开多个项目终端，支持拖拽排序
- **多模式启动** — Normal / YOLO / Gemini 三种模式，按需选择
- **终端 + 聊天双视图** — 终端模式直接操作 CLI，聊天模式提供对话式交互
- **文件浏览器** — 侧边栏文件树，右键可在访达中定位文件
- **Git 集成** — 实时显示分支信息和改动统计，支持分支切换、提交历史查看
- **会话历史** — 浏览过往 Claude Code 会话记录
- **应用内更新** — 通过 GitHub Releases 检查并下载新版本
- **亮色/暗色主题** — 支持跟随系统或手动切换
- **键盘快捷键** — `⌘T` 新标签、`⌘W` 关闭、`⌘B` 侧边栏、`⌘E` 文件树、`⌘1-9` 切换标签

## 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.70
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) （已安装并可通过终端访问）
- macOS 10.13+

## 快速开始

```bash
# 克隆项目
git clone https://github.com/shehuiyao/claudedesktop.git
cd claudedesktop

# 安装依赖
npm install

# 启动开发模式
npm run tauri dev
```

## 构建

```bash
# 构建生产版本（输出 .dmg 安装包）
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 项目结构

```
claudedesktop/
├── src/                    # React 前端
│   ├── App.tsx             # 主应用组件
│   ├── components/
│   │   ├── LiveTerminal.tsx   # xterm.js 终端
│   │   ├── TabBar.tsx         # 标签栏（拖拽排序、状态指示）
│   │   ├── FileTree.tsx       # 文件浏览器
│   │   ├── ChatView.tsx       # 聊天视图
│   │   ├── Sidebar.tsx        # 侧边栏（会话历史）
│   │   ├── StatusBar.tsx      # 底部状态栏
│   │   ├── BranchSwitcher.tsx # Git 分支切换
│   │   └── CommitHistory.tsx  # 提交历史
│   └── hooks/
│       ├── useTheme.ts        # 主题管理
│       ├── useSession.ts      # 会话管理
│       └── useHistory.ts      # 历史记录
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── lib.rs             # 命令注册与核心逻辑
│   │   ├── message_runner.rs  # PTY 会话管理
│   │   ├── chat_runner.rs     # 聊天进程管理
│   │   └── history.rs         # 历史记录读取
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Tauri v2 |
| 前端 | React 18 + TypeScript |
| 样式 | Tailwind CSS 4 + CSS 变量 |
| 终端 | xterm.js 6 (WebGL 渲染) |
| 后端 | Rust + portable-pty |
| 包管理 | npm |

## License

MIT
