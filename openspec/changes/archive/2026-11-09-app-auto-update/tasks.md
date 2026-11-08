# app-auto-update Tasks

## 1. 依赖与基础

- [x] 1.1 安装 `electron-updater` 运行时依赖（main 进程使用）
- [x] 1.2 `electron-builder.yml`：配置 `publish: { provider: github, owner: speakworks, repo: justspeak }`，
      使打包产出 `latest-mac.yml` 更新元数据（`publish: null` 改为固定 feed —— 仅 CI/tag 构建发布；
      本地打包不受影响，electron-builder publish 配置只影响元数据产出与 `--publish` 显式调用）

## 2. 纯逻辑（src/core/update）

- [x] 2.1 `src/core/update/signature.ts`：纯函数 `isDeveloperIdSigned(codesignOutput: string): boolean`
- [x] 2.2 `src/core/update/policy.ts`：自动检查调度逻辑（启动延迟 + 24h 间隔，最多一次/天）、
      纯函数 `shouldAutoCheck({ enabled, lastCheckAtMs, nowMs })`
- [x] 2.3 `src/core/update/version.ts`: 纯函数 `isNewerVersion(current, candidate)` 语义化版本比较，
      需要处理 prerelease 标签（如 `0.1.0-demo.0`）
- [x] 2.4 单元测试覆盖 2.1–2.3（`tests/update-core.test.ts`）

## 3. main 接线

- [x] 3.1 `src/main/update.ts`：electron-updater 封装 —— feed 常量（只写死 URL）、
      `checkForUpdates()`、`downloadAndInstall()`、自动调度、
      `setAutoCheckEnabled(bool)`、`isProbablySigned()`（codesign 检查）
- [x] 3.2 `src/main/index.ts`：IPC `update:check`（invoke）+ `update:setAutoCheck`（invoke）+
      `update:download`（invoke）+ `update:onEvent`（push，下载进度 / 找到新版本 / 已是最新 / 失败）；
      启动时按策略注入 schedule —— 仅当偏好为 on 且构建为已签名构建时才调度
      （必须与现有 trusted-sender 模式一致）
- [x] 3.3 偏好持久化：`preferences.json` 新增 `updateAutoCheck: boolean`（默认 false），
      复用现有 mergePreferences 管理（纯逻辑 tests 已覆盖 WRITABLE_KEYS 扩展 + 校验）

## 4. renderer 设置页

- [x] 4.1 `SettingsPanel.tsx` 新增「检查更新」按钮 + 「自动检查更新」开关 +
      更新状态行（检查中 / 已是最新 / 发现新版本 vX.Y.Z [下载并安装] [稍后] /
      下载 X% / 安装后重启 / 自动更新需要正式签名版）
- [x] 4.2 `src/preload` + `src/shared/ipc.ts`：新增 API 类型
      （`checkForUpdate`, `setUpdateAutoCheck`, `downloadUpdate`, `onUpdateEvent`）

## 5. CI release workflow

- [x] 5.1 新建 `.github/workflows/release.yml`：`on: push: tags: ['v*']` +
      `workflow_dispatch`；jobs：check 源码构建 `transcribe.cpp`（cmake, `-j4`）→
      `llama-server`（cmake）→ `pnpm package:mac:artifacts` → `pnpm verify:mac`（信息性）→
      `electron-builder --publish always`（GITHUB_TOKEN）
- [x] 5.2 permissions: `contents: write`（release 发布需要），只在 release.yml 放开

## 6. 文档

- [x] 6.1 README：更新检查作为网络目的地的披露段落
- [x] 6.2 `docs/AI-HANDOFF.md`: 签名阻塞段落刷新（现在有 updater/feed/CI 流水线），
      P0 段落重排 —— 只剩「凭证 → 签名 + notarize」一项
- [x] 6.3 `docs/PACKAGING-RELEASE.md`: 记录实际实现与文档选型的对应关系
- [x] 6.4 CHANGELOG.md 新增 Unreleased 段

## 7. 验证

- [x] 7.1 本机跑通全链路：`setup-asr` runtime 编译 → `package:llm` → `package:mac:artifacts` →
      启动打包产物 → 设置页「检查更新」（未签名提示路径）+ 一条真实网络请求确认（自动关）→
      `verify:mac` 信息性通过
- [x] 7.2 push tag 前用本地 act 或干跑验证 workflow（若不可行，在 PR 里注明人工触发验证步骤）
- [x] 7.3 全量门禁：typecheck / test / build / openspec validate --specs --strict / openspec list
