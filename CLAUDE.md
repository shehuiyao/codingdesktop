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

## 版本发布流程

当用户要求发布新版本时，按以下步骤执行：

### 1. 更新版本号（3 处同步）
- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src/components/StatusBar.tsx` → `APP_VERSION`

### 2. 提交并推送
```bash
git add -A
git commit -m "chore: vX.Y.Z - 简要描述"
git push
```

### 3. 构建（带签名）
```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/key.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password" \
npm run tauri build
```
- 构建产物目录：`src-tauri/target/release/bundle/macos/`
  - `Claude Desktop.app`（应用本体）
  - `Claude Desktop.app.tar.gz`（更新包）
  - `Claude Desktop.app.tar.gz.sig`（签名文件）

### 4. 生成 latest.json
```bash
cat > /tmp/latest.json << EOF
{
  "version": "X.Y.Z",
  "notes": "更新说明",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$(cat 'src-tauri/target/release/bundle/macos/Claude Desktop.app.tar.gz.sig')",
      "url": "https://github.com/shehuiyao/claudedesktop/releases/download/vX.Y.Z/Claude.Desktop.app.tar.gz"
    }
  }
}
EOF
```

### 5. 创建 GitHub Release
```bash
gh release create vX.Y.Z \
  "src-tauri/target/release/bundle/macos/Claude Desktop.app.tar.gz" \
  "/tmp/latest.json" \
  --title "vX.Y.Z" \
  --notes "更新内容..."
```

### 6. 验证
```bash
# 验证 latest.json 可访问
curl -sL https://github.com/shehuiyao/claudedesktop/releases/latest/download/latest.json | head
```
确认返回的 JSON 中 `version` 为新版本号。

### 首次设置签名密钥
如果还没有签名密钥，先生成：
```bash
npx tauri signer generate -w ~/.tauri/key.key
```
将输出的公钥（以 `dW50cnVzdGVkIGNvbW1lbnQ` 开头的 base64 字符串）填入 `tauri.conf.json` 的 `plugins.updater.pubkey`。
