## Why

应用现在只有一个手动下载的未签名 `.app`：CI 不产包、不发布，发一个带 bug 的版本
之后用户只能重新下载整个 DMG。`docs/PACKAGING-RELEASE.md` 已冻结技术选型
（electron-updater + GitHub Releases feed），但代码里没有 updater、没有 feed 配置、
没有发布流水线 —— 选型停在纸面。

有两类终端用户目前拿不到安全补丁：拿未签名构建自用的 owner，和 Release 页下载
未签名包的试用者。前者的应用会在后台存着，后者每次都手动下载。

## What Changes

- **Release 流水线**：push `v*` tag 触发 CI 从源码构建两个原生 runtime
  （transcribe.cpp v0.4.1、llama.cpp v0.8.0，均按 catalog/文档 pin 的 commit）、
  打包未签名的 DMG + ZIP + `latest-mac.yml`，自动发布 GitHub Release。
  发布用仓库内置 `GITHUB_TOKEN`，不需要 secrets。
- **运行时更新客户端**（electron-updater）：
  - 更新检查由用户策略控制：默认**手动**（设置页「检查更新」按钮），
    可显式开启「自动检查」（启动 + 每 24h，最多一次）。
  - Feed URL 固定为 `https://github.com/speakworks/justspeak/releases`，
    不可用户配置；更新检查只发送版本号与架构，不发送任何内容或标识符。
  - 检测到新版本时**询问**而非静默下载安装。
  - **未签名构建如实提示**：检测到非 Developer ID 签名（本地 ad-hoc/unsigned）
    时，「检查更新」返回明确信息「自动更新需要正式签名版」，自动检查不运行。
    机制代码全部就位，签名凭证到位后自动生效，不需要再改代码。
- **隐私边界不变**：更新检查是新的网络目的地，在 README/诊断文档中披露；
  它只出现在设置页的说明里，与「默认无网络」原则并存（显式 opt-in）。

## Capabilities

### New Capabilities

- `app-update`: 更新检查策略、feed 隐私约束、未签名状态的如实提示，
  以及（签名版上线后）下载安装行为的合同。
