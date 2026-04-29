# 发版已知问题记录

这个文件记录 Claude Desktop 发版时遇到过的坑点。它的作用像设计稿里的标注层：不代替主流程，但把容易误读、容易点错的地方固定下来，避免后面重复踩坑。

## 流程入口

- 发版必须使用 `xy-release` 技能，不直接照抄旧的手工步骤执行。
- `AGENTS.md` 和 `CLAUDE.md` 只保留本项目差异，例如版本号同步位置、构建环境变量、产物位置和项目特殊注意事项。

## 产物命名

- 自动更新包真实文件名是 `Claude Desktop.app.tar.gz`，中间是空格。
- 不要把 URL 或文件名写成 `Claude.Desktop.app.tar.gz`。这个点会导致 `latest.json` 指向不存在的资源，用户侧自动更新会失败。
- 生成 `latest.json` 前必须先读取 `src-tauri/target/release/bundle/` 下的真实 `.app.tar.gz` 和 `.sig` 文件。

## Release 上传文件

- GitHub Release 必须同时上传 DMG、`.app.tar.gz` 更新包、`latest.json`。
- DMG 方便用户手动安装，`.app.tar.gz` 和 `latest.json` 是 Tauri 自动更新需要的文件。

## 构建环境

- 在 Codex 沙箱内运行 `npm run tauri build` 时，前端和 Rust release 编译可以成功，但 DMG 阶段可能在 `bundle_dmg.sh` 失败。
- 这个问题通常是 macOS `hdiutil` 打包 DMG 需要挂载/卸载磁盘镜像，沙箱权限不够。
- 遇到这种情况，用同一条带签名环境变量的构建命令申请沙箱外执行；成功后继续检查 DMG、`.app.tar.gz`、`.sig` 三个真实产物。

## 后续同步规则

- 发版时遇到的新问题，要同步写回这个文件。
- 如果问题改变了发版顺序或强制规则，要同时更新 `AGENTS.md` 和 `CLAUDE.md`。
- 如果只是一次性的排查记录，可以写清楚现象、影响、最终采用的命令或结论。
