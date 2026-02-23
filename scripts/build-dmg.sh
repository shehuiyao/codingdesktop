#!/bin/bash
set -e

# Read version from tauri.conf.json
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
echo "Building Claude Desktop v${VERSION}..."

# Build the app (Tauri builds .app + .dmg)
npm run tauri build

APP_PATH="src-tauri/target/release/bundle/macos/Claude Desktop.app"
DMG_PATH="src-tauri/target/release/bundle/dmg/Claude Desktop_v${VERSION}.dmg"
STAGING="/tmp/claude-dmg-staging"

# Create staging directory
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$APP_PATH" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

# Create version changelog
cat > "$STAGING/v${VERSION}-更新说明.md" << EOF
# Claude Desktop v${VERSION}

## 更新内容

- 集成 xterm.js 终端：直接在应用内与 Claude Code 交互
- PTY 动态 resize：终端自动适配窗口大小
- Login shell 启动：认证环境与系统终端一致
- PTY 进程清理：关闭标签页/窗口时自动终止进程
- 历史会话浏览：修复 JSONL 解析、时间戳、去重
- 键盘快捷键：Cmd+T/W/B/E/1-9
- 内嵌 JetBrains Mono 字体
- UI 主题美化：Tokyo Night 暗色主题
- 多标签页会话支持
- 右侧文件树浏览器

## 安装方式

将 Claude Desktop 拖入 Applications 文件夹即可。

## 要求

- macOS 11+
- Claude Code CLI 已安装 (\`npm install -g @anthropic-ai/claude-code\`)
EOF

# Remove Tauri's auto-generated DMG and create custom one
rm -f "$DMG_PATH"
rm -f src-tauri/target/release/bundle/dmg/*.dmg

hdiutil create \
  -volname "Claude Desktop v${VERSION}" \
  -srcfolder "$STAGING" \
  -ov -format UDZO \
  "$DMG_PATH"

rm -rf "$STAGING"

echo ""
echo "Done! DMG: $DMG_PATH"
