# 发版已知问题记录

这个文件记录 Coding Desktop 发版时遇到过的坑点。它的作用像设计稿里的标注层：不代替主流程，但把容易误读、容易点错的地方固定下来，避免后面重复踩坑。

## 流程入口

- 发版必须使用 `xy-release` 技能，不直接照抄旧的手工步骤执行。
- `AGENTS.md` 和 `CLAUDE.md` 只保留本项目差异，例如版本号同步位置、构建环境变量、产物位置和项目特殊注意事项。

## 产物命名

- Tauri 构建出来的自动更新包真实文件名是 `Coding Desktop.app.tar.gz`，中间是空格。
- 生成 `latest.json` 前必须先读取 `src-tauri/target/release/bundle/` 下的真实 `.app.tar.gz` 和 `.sig` 文件，签名必须来自真实 `.sig`。
- GitHub Release 资产名可以按稳定格式改成无空格版本，例如把构建产物复制为 `/tmp/Coding.Desktop.app.tar.gz` 后上传。
- `latest.json` 里的 URL 必须和最终上传到 GitHub Release 的资产名一致。上传的是 `Coding.Desktop.app.tar.gz`，URL 就写 `https://github.com/shehuiyao/codingdesktop/releases/download/vX.Y.Z/Coding.Desktop.app.tar.gz`；上传的是带空格文件名，URL 才需要写 `Coding%20Desktop.app.tar.gz`。
- 不要只靠模板猜文件名。文件名像设计稿里的导出切片名，实际上传什么，自动更新入口就必须指向什么。

## Release 上传文件

- GitHub Release 必须同时上传 DMG、`.app.tar.gz` 更新包、`latest.json`。
- DMG 方便用户手动安装，`.app.tar.gz` 和 `latest.json` 是 Tauri 自动更新需要的文件。
- Release 使用的是本机 `gh` 登录态，不使用 `~/.coding-desktop/.github_token`。后者只是应用内反馈创建 GitHub Issue 的 token。
- 遇到上传问题时先跑 `gh auth status`。如果显示 keyring 登录且 token scope 包含 `repo`，说明基础权限通常够用。
- 如果 `gh release create` 或 `gh release upload` 上传大文件时长时间无输出，先用 `gh release view vX.Y.Z --json assets,isDraft` 查 Release 状态，不要重复创建。
- 如果只看到 `latest.json` 上传成功，而 DMG / `.app.tar.gz` 一直不出现，优先判断为 `gh` 上传链路卡住。可以改用 GitHub 上传 API 直传：
  ```bash
  env -u http_proxy -u https_proxy -u all_proxy curl --noproxy '*' \
    --fail-with-body -L --max-time 180 -X POST \
    -H "Authorization: Bearer $(gh auth token)" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/gzip" \
    --data-binary @/tmp/Coding.Desktop.app.tar.gz \
    "https://uploads.github.com/repos/shehuiyao/codingdesktop/releases/<release_id>/assets?name=Coding.Desktop.app.tar.gz"
  ```
- DMG 同理把 `Content-Type` 改成 `application/x-apple-diskimage`，文件路径和 `name` 改成 DMG 文件名。
- 直传成功后，再用 `gh release edit vX.Y.Z --draft=false` 发布草稿。
- 如果 Release 还是草稿，资产下载 URL 可能暂时显示 `untagged-...`。发布为正式版后，URL 会变成 `/releases/download/vX.Y.Z/...`，需要再查一次确认。

## 构建环境

- 在 Codex 沙箱内运行 `npm run tauri build` 时，前端和 Rust release 编译可以成功，但 DMG 阶段可能在 `bundle_dmg.sh` 失败。
- 这个问题通常是 macOS `hdiutil` 打包 DMG 需要挂载/卸载磁盘镜像，沙箱权限不够。
- 遇到这种情况，用同一条带签名环境变量的构建命令申请沙箱外执行；成功后继续检查 DMG、`.app.tar.gz`、`.sig` 三个真实产物。
- 本机可能配置 `http_proxy` / `https_proxy` / `all_proxy` 指向 `127.0.0.1:7897`。沙箱内访问这个代理可能被拦，表现为 `operation not permitted`、`curl` exit code 6/7，或 `gh` 请求卡住。
- 小文件 `latest.json` 能上传，不代表 DMG / `.app.tar.gz` 大文件也会顺利。大文件卡住时，优先用上面的 `curl --data-binary` 直传方式确认。
- 如果 `curl` 验证 `latest.json` 失败，先区分是链接问题还是当前网络问题；沙箱内默认代理可能失败，可以用沙箱外直连验证：
  ```bash
  env -u http_proxy -u https_proxy -u all_proxy curl --noproxy '*' -sL \
    https://github.com/shehuiyao/codingdesktop/releases/latest/download/latest.json
  ```
- 如果沙箱内验证慢，不代表发版失败。先以 `gh release view vX.Y.Z --json assets,isDraft` 为准确认 Release 状态，再单独验证 `latest.json`。
- 左下角自动更新下载慢时，不要只看 Release 包大小。Tauri updater 是 Rust 层下载器，系统代理打开不一定等于它会自动走代理；表现可能是浏览器或 `curl -x http://127.0.0.1:7897` 几秒能下载完，但 App 内仍然很慢。
- `@tauri-apps/plugin-updater` 的 `check()` 支持传入 `proxy` 参数，这个代理会继续绑定到后续 `downloadAndInstall()` 使用。左下角更新应优先读取系统 HTTP/HTTPS 代理并显式传入；没有系统代理或代理失败时，再回退到 updater 默认通道。macOS 上先读 `scutil --proxy`，如果返回空，再用 `networksetup` 读取各网络服务代理。`http://127.0.0.1:7897` 只是本次排查示例，不要写死成唯一代理。
- 2026-04-29 排查记录：`v0.9.17` 更新包约 `9.6MB`，直连 GitHub Release CDN 时 60 秒只下载约 `0.89MB`；强制 `curl -x http://127.0.0.1:7897` 后约 `6.43s` 下载完成。这个现象说明慢点在下载链路，不是包体突然变大，也不是 `latest.json` 或 Release 资产缺失。
- 2026-04-29 发版记录：`v0.9.19` 更新包资产名被 GitHub 规范化为 `Coding.Desktop.app.tar.gz`，`latest.json` 必须写这个真实资产名，不能写本地构建文件名 `Coding Desktop.app.tar.gz`。本次包大小 `11,169,773 bytes`，SHA256 为 `cb05704cd5b0e989e581d3e082faf88042d7235ce90f5c140f04a01f639e9ebc`。直连下载约 `8.26s`，系统代理 `http://127.0.0.1:7897` 下载约 `8.08s`，两者哈希一致。
- 2026-04-30 发版记录：`v0.9.20` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.20_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,084,514 bytes`，SHA256 为 `c8a2b5f058a1b4f9893757e267bad19e001b67f0e18adc63fc5dcb54be8cee6d`；DMG SHA256 为 `1d02c28069fa57c274831d356bef1404446cbc6c4c0d7a3ab38dfcd29792715b`。`latest.json` 通过 `releases/latest/download/latest.json` 访问返回 `0.9.20`，直连更新包下载约 `8.43s`，系统代理 `http://127.0.0.1:7897` 下载约 `8.38s`，两者哈希一致。
- 2026-04-30 发版记录：`v0.9.21` 的 `gh release create` 大文件上传卡住，Release 草稿只上传了 `latest.json`；本次改用 GitHub Upload API 直传 `Coding.Desktop.app.tar.gz` 和 `Coding.Desktop_0.9.21_aarch64.dmg` 后再发布草稿。更新包大小 `11,125,022 bytes`，SHA256 为 `9c1919d8d80a6ecb2416aa426e16fad15ecd57d67d3470347384db1dc149bead`；DMG SHA256 为 `ca20063ed97f3d75dba0dc420820e6b079213e3b4e789b35c76655aeb109f242`。`latest.json` 通过 `releases/latest/download/latest.json` 访问返回 `0.9.21`，直连更新包下载约 `16.46s`，系统代理 `http://127.0.0.1:7897` 下载约 `14.96s`，两者哈希一致。
- 2026-04-30 发版记录：`v0.9.22` 上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.22_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,125,528 bytes`，SHA256 为 `2cff0ba815a4d7e110bfa2c200725e4dc0cd7910ed070babb25842eb7790e573`；DMG SHA256 为 `d37d931fc4d5bc92a5cbe0992915a79d51582c21919ac7cf5bf08cd800488bcf`。`latest.json` 通过 `releases/latest/download/latest.json` 访问返回 `0.9.22`，直连更新包下载约 `14.26s`，系统代理 `http://127.0.0.1:7897` 下载约 `12.36s`，两者哈希一致。
- 2026-04-30 发版记录：`v0.9.23` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.23_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,145,870 bytes`，SHA256 为 `296f18cef25a6c8dd47f7502708a8fc9e226ff9b84f844af19af9931c00bf093`；DMG 大小 `12,420,997 bytes`，SHA256 为 `fa8af69f9ace574b8ad10a114382796847dce756bbca808bd39ca44217922160`。`latest.json` 通过 `releases/latest/download/latest.json` 访问返回 `0.9.23`，系统代理 `http://127.0.0.1:7897` 下载更新包约 `9s` 且哈希一致；直连 GitHub 本次 80 秒仅下载约 16%，中止验证，仍按代理链路作为可用下载链路。创建 Release 时 `~/.coding-desktop/.github_token` 对 Release API 返回 403，改用 `gh` keyring 登录态创建和发布。
- 2026-04-30 发版记录：`v0.9.24` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.24_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,140,427 bytes`，SHA256 为 `b3bfb8e09f53d72879a1dadf534daf3a2e97de423c8c48eaedf0ff112a632f7a`；DMG 大小 `12,418,315 bytes`，SHA256 为 `d0a67dd27a83de2a38227c6bc43ec695369127bf07a87fa56593a58581103b3f`。`latest.json` 通过 `releases/latest/download/latest.json` 访问返回 `0.9.24`，耗时约 `2.91s`；系统代理 `http://127.0.0.1:7897` 下载更新包约 `8.88s`，下载哈希和本地构建产物一致。`gh release create` 仍在上传大文件时卡住，Release 草稿只上传了 `latest.json`，继续使用 GitHub Upload API 直传 `.app.tar.gz` 和 DMG 后发布草稿。
- 2026-04-30 发版记录：`v0.9.25` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.25_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,142,630 bytes`，SHA256 为 `6c26b2ca2eb8ab26d5e993d201e718b4f764a36b424efbfc08468d55bd8eaded`；DMG 大小 `12,423,086 bytes`，SHA256 为 `bf7171430a33ea6d8da144b0b4c5cc471ae4e7dd609c77a2cfc076b0765bc174`。`latest.json` 通过 `releases/latest/download/latest.json` 访问返回 `0.9.25`，直连约 `2.88s`、系统代理约 `2.59s`；更新包发布后有数秒 CDN 生效延迟，过早验证会拿到 404。生效后 1MB range 下载直连约 `5.00s`、系统代理约 `5.47s`，完整更新包走系统代理约 `6.23s` 且哈希一致。上传链路仍不稳定：API 小请求约 `1.1s`，但上传 `.app.tar.gz` 约 `3m19s`，上传 DMG 走代理多次中断并留下 `starter` 半成品资产，删除半成品后改直连 HTTP/1.1 上传成功，约 `2m04s`。
- 如果用户反馈“之前几秒就下好了，现在左下角很慢”，优先确认当前已安装 App 是否已经包含显式 updater proxy 逻辑；源码改完不等于已安装版本生效，需要重新构建或发小版本。
- 2026-04-30 排查记录：用户在 `v0.9.23` 点击左下角更新时出现 `Update failed: error sending request for url (https://github.com/shehuiyao/...)`。同机验证 `latest.json` 和更新包都存在：直连 GitHub 20 秒超时，系统代理 `http://127.0.0.1:7897` 拉取 `latest.json` 约 `5.79s`，更新包 HEAD 也可通过代理返回。此类报错优先判断为 App 内 updater 请求链路没有成功走通代理，或代理失败后回退直连导致最终错误只显示直连失败。后续状态栏应保留“系统代理失败 + 直连失败”的组合错误，并适当放宽检查超时，避免只露出一条被截断的红字。
- 2026-05-08 发版记录：`v0.9.26` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.26_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,142,017 bytes`，SHA256 为 `5517c4572120a5972496762130bb22729db59c4fddea196492510ffffd681231`；DMG 大小 `12,426,220 bytes`，SHA256 为 `20fe54df832fa8646b1c02c3050b0183f0397967f5e9cc3cd9f83d1e6445b047`。草稿 Release 先上传 `.app.tar.gz`、再上传 DMG、最后上传 `latest.json`，均走直连 HTTP/1.1：更新包上传约 `18.06s`，DMG 上传约 `27.13s`，`latest.json` 上传约 `1.05s`。发布后 GitHub API 已显示 `v0.9.26` 为 latest，但 `releases/latest/download/latest.json` 一度命中 `v0.9.25` 旧缓存，重新标记 latest 并等待后恢复；最终 latest 入口约 `0.75s` 返回 `0.9.26`。更新包 1MB Range 下载约 `1.41s`，系统代理 `http://127.0.0.1:7897` 完整下载约 `1.95s` 且哈希一致；直连完整下载 120 秒超时，只下载 `9,874,256 bytes`，本机更新体验应优先依赖系统代理链路。
- 2026-05-08 发版记录：`v0.9.27` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.27_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,154,047 bytes`，SHA256 为 `f2116556f286fb1fd412d1bc1ad82d4cf32940aed377720af28f0ff86aeb3358`；DMG 大小 `12,436,796 bytes`，SHA256 为 `a85eb5d97d99b18643dc4f4df42f12be9eba0daada4355252fa4b43eed8aad42`。本次先创建 draft Release，草稿页面会暂时显示 `untagged-...` URL，但内部 `tag_name` 仍为 `v0.9.27`；发布正式版后资产 URL 恢复为 `/releases/download/v0.9.27/...`。三件套均走直连 HTTP/1.1 上传：更新包上传约 `15.08s`，DMG 上传约 `28.07s`，`latest.json` 上传约 `1.06s`。发布后 `releases/latest/download/latest.json` 约 `1.25s` 返回 `0.9.27`，签名长度 `416`；更新包直连 1MB Range 下载约 `7.59s`，系统代理 `http://127.0.0.1:7897` 完整下载约 `3.94s`，下载哈希和本地构建产物一致。
- 2026-05-09 发版记录：`v0.9.28` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.28_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,156,144 bytes`，SHA256 为 `579b8fde7b771c2ce6c95e4f2593d1482bcd83d4566cc5f0b4c7f80728a73e84`；DMG 大小 `12,431,158 bytes`，SHA256 为 `f7c932270f0e14458f23adf90914eb4eedbc5d36315010a4122012c96f4d902c`。本次先创建 draft Release，草稿页面暂时显示 `untagged-...` URL，发布正式版后资产 URL 恢复为 `/releases/download/v0.9.28/...`。三件套均走直连 HTTP/1.1 上传：更新包上传约 `8.08s`，DMG 上传约 `12.55s`，`latest.json` 上传约 `0.76s`。发布后 `releases/latest/download/latest.json` 约 `1.41s` 返回 `0.9.28`，签名长度 `416`；更新包直连 1MB Range 下载约 `1.28s`，系统代理 `http://127.0.0.1:7897` 完整下载约 `1.98s`，下载哈希和本地构建产物一致。
- 2026-05-09 发版记录：`v0.9.29` 继续上传无空格资产名 `Coding.Desktop.app.tar.gz`、`Coding.Desktop_0.9.29_aarch64.dmg` 和 `latest.json`。本次更新包大小 `11,174,867 bytes`，SHA256 为 `9be992ac6d9db2e5d5e01486ce258fa625c5200bd0f2531230ca62d0e604f009`；DMG 大小 `12,454,160 bytes`，SHA256 为 `f3a555745e12c1e09ec9b39d342458147f4df338923cf14b5f308ef75e200fe7`。本次先创建 draft Release，草稿页面暂时显示 `untagged-...` URL，发布正式版后资产 URL 恢复为 `/releases/download/v0.9.29/...`。三件套均走直连 HTTP/1.1 上传：更新包上传约 `8.21s`，DMG 上传约 `4.71s`，`latest.json` 上传约 `0.94s`。发布后 `releases/latest/download/latest.json` 约 `1.76s` 返回 `0.9.29`，签名长度 `416`；更新包直连 1MB Range 下载约 `1.52s`，系统代理 `http://127.0.0.1:7897` 完整下载约 `2.11s`，下载哈希和本地构建产物一致。

## 后续同步规则

- 发版时遇到的新问题，要同步写回这个文件。
- 如果问题改变了发版顺序或强制规则，要同时更新 `AGENTS.md` 和 `CLAUDE.md`。
- 如果只是一次性的排查记录，可以写清楚现象、影响、最终采用的命令或结论。
