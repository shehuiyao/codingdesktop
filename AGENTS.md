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
- 前端调用后端命令统一使用 `invoke` (`@tauri-apps/api/core`)
- 更新功能使用 `@tauri-apps/plugin-updater` 的 `check()` + `downloadAndInstall()` + `relaunch()`
- 新增 Rust 命令后必须在 `lib.rs` 的 `tauri::generate_handler![]` 中注册

### 版本更新
- 使用 Tauri Plugin Updater v2 标准方案，零自定义 Rust 代码
- 前端通过 `check()` 检查更新，`downloadAndInstall()` 下载安装，`relaunch()` 重启
- 依赖 GitHub Release 中的 `latest.json` 文件（发版时必须上传）
- 构建时必须带签名私钥环境变量，生成 `.app.tar.gz` + `.sig` 签名文件

### 代码风格
- React 组件使用函数式组件 + hooks
- 状态管理用 useState/useCallback/useRef，不引入额外状态库
- CSS 使用 Tailwind + CSS 变量 (var(--xxx)) 支持主题切换

### 设计规范
- 涉及可见 UI、交互层级、组件样式时，必须先阅读 `docs/design-spec.md`
- 优先复用现有暗色工作台风格、圆角、描边、CSS 变量和 Tailwind 结构
- 不要为单个页面单独创造一套新的视觉语言

### Launchpad 启动规范
- 涉及项目启动命令、前后端启动卡片、conda/py 环境时，必须先阅读 `docs/launchpad-startup.md`
- 后端启动优先使用 `conda run` 或 Python 绝对路径，避免长期停留在 `source activate` 后的 shell 环境

### Git Commit 规范
- **统一用中文**，不混用英文
- **一个 commit 只做一件事**，不要把多个功能塞进一个 commit
- **版本号不写进 commit message**，版本信息靠 git tag 管理
- **标题说清目的**，不只描述操作，要说明为什么
- 标题控制在 50 字以内，需要详细说明时用 body

格式：
```
<type>: <简要描述，说清做了什么和为什么>

可选的详细说明（空一行后写）
```

type 取值：
- `feat`: 新功能
- `fix`: 修复 bug
- `chore`: 构建、依赖、配置等杂务
- `docs`: 文档变更
- `refactor`: 重构（不改功能）
- `style`: 样式调整（不影响逻辑）

好的示例：
```
feat: 技能面板支持按分类展开收起
fix: 终端切换标签时文字被挤压，添加 resize 防抖
chore: 构建产物同时生成 DMG 安装镜像
```

不好的示例：
```
fix: 更新签名公钥                    ← 没说为什么要更新
feat: v0.6.2 - 技能面板三分类、展开描述、项目级开关  ← 版本号不该在这、做了太多事
chore: bump version                   ← 英文、太模糊
```

## 版本发布流程

当用户要求发布新版本、发版、release、版本升级时，**必须先使用 `xy-release` 技能**。这里不再维护一份完整的手工发版步骤，避免项目文档和技能流程不一致。

### 项目发版差异
- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `"version"`
- `src/components/StatusBar.tsx` → `APP_VERSION`

> 说明：软件展示名、内部包名、Bundle Identifier 和数据目录当前统一沿用 `Claude Desktop` / `claude-desktop` / `~/.claude-desktop`。如果未来改名，必须同步评估数据迁移和自动更新兼容。

### 构建环境变量
```bash
GITHUB_FEEDBACK_TOKEN="$(cat ~/.claude-desktop/.github_token)" \
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/key.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="tauri" \
npm run tauri build
```
- `GITHUB_FEEDBACK_TOKEN`：用户提交反馈时自动创建 GitHub Issue（不带则反馈仅保存本地）
- Token 存放在 `~/.claude-desktop/.github_token`，需 fine-grained PAT，仅需 Issues 写权限

### 构建产物
- 构建产物目录：`src-tauri/target/release/bundle/`
  - `macos/Claude Desktop.app`（应用本体）
  - `macos/Claude Desktop.app.tar.gz`（更新包）
  - `macos/Claude Desktop.app.tar.gz.sig`（签名文件）
  - `dmg/Claude Desktop_X.Y.Z_aarch64.dmg`（安装镜像，可直接分发）

### 发版注意事项
- 以 `xy-release` 技能流程为准：确认版本号 → 更新版本 → 构建 → 检查 DMG → 提交 → 打 tag 并推送 → 生成 `latest.json` → 创建 GitHub Release → 验证。
- `latest.json` 的下载 URL 和上传文件名必须读取真实构建产物，不要手写猜测文件名。尤其注意 `Claude Desktop.app.tar.gz` 文件名里有空格，不要误写成 `Claude.Desktop.app.tar.gz`。
- GitHub Release 必须上传 DMG、`.app.tar.gz` 更新包和 `latest.json`，三者缺一都会影响安装或自动更新。
- 发版过程中遇到的新坑、修正后的命令、产物命名变化，都要同步回本项目文档；流程规则写入本文件和 `CLAUDE.md`，具体坑点写入 `docs/release-known-issues.md`。

### 首次设置签名密钥
如果还没有签名密钥，先生成：
```bash
npx tauri signer generate -w ~/.tauri/key.key
```
将输出的公钥（以 `dW50cnVzdGVkIGNvbW1lbnQ` 开头的 base64 字符串）填入 `tauri.conf.json` 的 `plugins.updater.pubkey`。
