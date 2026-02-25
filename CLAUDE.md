# Claude Desktop - 项目规则

## 语言
- 始终使用中文与用户交流，包括代码注释中的说明性文字

## 技术栈
- Tauri v2 + React + TypeScript
- 后端: Rust (src-tauri/)
- 前端: React + Tailwind CSS (src/)
- 包管理: npm

## 开发规范

### 前后端通信
- 前端调用后端命令统一使用 `invoke` (`@tauri-apps/api/core`)，不要直接使用 Tauri 插件的高级封装（如 `@tauri-apps/plugin-updater` 的 `check()`），除非确认插件所需的基础设施已完备
- 新增 Rust 命令后必须在 `lib.rs` 的 `tauri::generate_handler![]` 中注册

### 版本更新
- 更新检查通过 Rust 后端 `check_for_update` 命令，走 GitHub API
- 不使用 Tauri updater plugin 的前端 `check()` — 它依赖 Release 中的 `latest.json`，当前发布流程未包含该文件
- 下载更新通过 `download_and_install_update` 命令，下载 DMG 后自动打开

### 代码风格
- React 组件使用函数式组件 + hooks
- 状态管理用 useState/useCallback/useRef，不引入额外状态库
- CSS 使用 Tailwind + CSS 变量 (var(--xxx)) 支持主题切换
