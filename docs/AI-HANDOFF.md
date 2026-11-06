# AI 交接说明

- 交接日期：2026-11-07
- 当前 `main`：`4c3f712`（PR #31 已合并；PR #32 关闭了本文档的 P1 #3/#4/#6）
- 当前 active OpenSpec change：无
- 目的：让接手的 AI 在最少上下文下安全地继续工作，而不是重新摸索一遍

> 先读 [AGENTS.md](../AGENTS.md)，再读这份。`AGENTS.md` 是工作流门控的第一来源；
> 本文记录的是“现在做到哪、下一步做什么、哪些地方不要踩”。

## 0. 五分钟启动

```bash
git switch main
git pull --ff-only

pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
openspec validate --specs --strict
openspec list
```

预期结果（2026-11-06 的基线）：

| 检查 | 预期 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 757 passed / 4 skipped |
| `pnpm build` | 通过 |
| `pnpm exec playwright test` | 13 passed |
| `openspec validate --specs --strict` | 14/14 |
| `openspec list` | `No active changes found` |

要真正听写，还需要本机模型：

```bash
pnpm setup:asr          # 构建 transcribe.cpp runtime 并下载/校验模型
pnpm dev                # 开发模式；或 pnpm start 跑已构建产物
JUSTSPEAK_ASR=fake pnpm dev   # 不依赖模型、确定性的测试流程
```

## 1. 项目是什么

JustSpeak 是一个 macOS 优先的本地听写应用：按全局快捷键说话，文本出现在光标处。

- Electron 45 + React 19 + TypeScript + electron-vite 6 + Vitest + Playwright `_electron`
- 产品逻辑在 `src/core`，Electron/Node 适配在 `src/main`，渲染进程是沙箱化的 React
- 默认离线；云端 ASR/LLM 只能是显式 opt-in，不能静默回退
- 当前版本 `0.1.0-demo.0`；v0.2 的 SpeakPilot 仍是规划

## 2. 当前已经能用的能力

- **本地 ASR**：SenseVoice Small 默认，Qwen3-ASR 0.6B 可在设置里切换；`auto` 分段。
- **全局快捷键**：设置页点击后直接按组合键录制；录制期间临时注销听写键并忽略应用菜单快捷键，15 秒安全恢复。
- **投递**：`insert`（本应用窗口）/ `paste`（剪贴板 + Cmd+V）/ 复制面板三选一。
- **历史**：本地 `entries.jsonl` + WAV，可回放、复制、删除。
- **词汇表**：本地替换/保护规则。
- **可选智能清理**：默认关闭；本地 Qwen2.5-1.5B sidecar 或 OpenAI 兼容端点；规则候选 + 封闭动作 + 护栏 + 800 ms 回退。
- **诊断导出**：用户主动导出本地 zip，不自动上传；crash dump 可能含内存中的敏感信息，已披露。
- **打包**：`pnpm package:mac` 产出未签名 `.app`；DMG/ZIP 也可构建。签名/公证被凭证阻塞；自动更新尚未实现（没有 updater 依赖，`publish: null`）。

## 3. 最近交付（按时间倒序）

| PR | 内容 | 关键点 |
|---|---|---|
| #33 | 侧边栏去掉模型芯片 | footer 只留设置入口；provider row 仍是唯一显示/切换点；E2E 加了 footer 结构守卫 |
| #32 | 契约与文档一致性清理 | 设置页拥有模型选择器（settings-surface + app-shell spec 同步）、provider 提示文案、`hotkeyChangeRefusal` 状态门禁 + 单测、TECH-DECISIONS/ASR-RESEARCH/CHANGELOG 校准 |
| #29 | 快捷键录制 | `HotkeyRecorder`、`HotkeyCaptureController`、菜单快捷键抑制、15 s 安全恢复、权威 spec 已同步 |
| #30 | ASR 模型选择进设置 | 设置页拥有选择器；header 不再有 picker |
| #28 | sidecar 鉴权 | 每次启动随机 key、`--api-key-file`、0600/0700、启动后删除、失败即关闭 |
| #27 | 诊断导出 | 本地 zip、脱敏日志、崩溃转储、无上传 |
| #26 | LLM 清理 | 默认 off；规则候选 + 封闭动作 + 护栏；本地 sidecar 与端点；评测脚本 |

PR 链接：`https://github.com/speakworks/justspeak/pull/<number>`。

## 4. 代码地图

| 路径 | 职责 | 注意 |
|---|---|---|
| `src/core` | 框架无关的产品逻辑 | 新纯逻辑优先放这里，并配单测 |
| `src/core/hotkey` | accelerator 解析、注册回退、按键捕获、捕获生命周期 | `capture-controller.ts` 有注入时钟/source 的单测 |
| `src/core/session` | 会话状态机 | `idle → recording → transcribing → pasting → idle` |
| `src/core/llm` | 纠正动作、决策、模型 catalog | 护栏与回退在这里 |
| `src/core/diagnostics` | 脱敏与 summary | 不允许把密钥/转写写进 summary |
| `src/main/index.ts` | Electron 装配、IPC、启动/退出 | 大文件；改之前先看现有 handler 的 trusted-sender 模式 |
| `src/main/hotkey-source.ts` | `globalShortcut` 适配 | `unregisterAll` 也会清掉复制面板的 Escape |
| `src/main/result-panel.ts` | 复制面板 | `suspendResultPanelEscape` / `refreshResultPanelEscape` 成对使用 |
| `src/main/llm` | sidecar、corrector、manager | 启动、崩溃、鉴权、退出都在这里 |
| `src/preload/index.ts` | 类型化 bridge | 只暴露 `JustSpeakApi`，不要加宽 |
| `src/renderer/src` | React UI | `HotkeyRecorder.tsx`、`SettingsPanel.tsx`、`App.tsx` |
| `src/shared/ipc.ts` | 主/渲染共享契约 | 新 IPC 同时改 preload 和类型 |
| `openspec/specs` | 14 个权威行为 spec | 当前无 active change |
| `tests/` | Vitest | `tests/e2e/` 是 Playwright，`pnpm test` 不跑它 |
| `scripts/` | 评测、打包、模型下载 | `llm-eval.ts`、`verify-mac-app.ts` 等 |

边界规则：`app → core`，不能反向；Electron/DOM API 只留在 `main`/`preload`/`renderer`；
`core` 不 import Electron。

## 5. 运行、测试与环境变量

### 常用命令

```bash
pnpm dev                 # Electron + HMR
pnpm start               # 跑 out/ 里的构建产物
pnpm test                # Vitest，不需要模型/Electron
pnpm e2e                 # pnpm build + Playwright（需要 GUI）
pnpm llm:eval            # 真实录音评测（需要模型 + bench/llm/real/）
pnpm llm:eval:smoke      # 合成冒烟，不能用于 Go/No-Go
pnpm package:mac         # 未签名 .app
pnpm package:mac:artifacts
pnpm verify:mac          # 检查打包后的 runtime/LLM/catalog
```

### 关键环境变量

| 变量 | 作用 |
|---|---|
| `JUSTSPEAK_ASR=sensevoice\|qwen3\|fake` | 覆盖本次运行的 provider；未知值报错，不会静默回退 |
| `JUSTSPEAK_TRANSCRIBE_CLI` | 覆盖 transcribe-cli 路径 |
| `JUSTSPEAK_QWEN3_MODEL` / `JUSTSPEAK_SENSEVOICE_MODEL` | 覆盖模型路径 |
| `JUSTSPEAK_SEGMENTED=auto\|single\|vad` | 分段策略 |
| `JUSTSPEAK_LLM_MODEL` | 评测使用的 GGUF 路径 |
| `JUSTSPEAK_LLM_EVAL_DIR` | 评测样本目录（默认 `bench/llm/real/`） |
| `JUSTSPEAK_E2E=0` | 跳过 Electron E2E |
| `JUSTSPEAK_E2E=1` + `JUSTSPEAK_HOTKEY_CAPTURE_TIMEOUT_MS` | 仅测试用：缩短快捷键录制安全超时 |
| `JUSTSPEAK_REAL_ASR=1` | 打开真实 CLI smoke |
| `JUSTSPEAK_DEVTOOLS=1` | 启动时打开 DevTools |

### 数据位置

- 模型/runtime：仓库根 `models/`（gitignored，绝不提交）
- 应用 userData：`preferences.json`、`asr-preference.json`、`history/`、`vocabulary.json`、下载的 LLM 模型、`llm-key.bin`（端点 key 的加密存储）
- 日志：Electron `app.getPath('logs')`，1 MB × 2 轮转
- 评测数据：`bench/llm/`（LLM 录音与报告）、`bench/real/`（真人语音录音）、`bench/results/*-real.json` 与 `bench/reports/*-real.md`（真实语音评测报告）；全部 gitignored
- 本地架构解说（未提交）：`.explain-clearly/`；内容早于 PR #29/#30，快捷键/设置章节已过时

## 6. 工作流铁律

### OpenSpec

- 每个行为变更先建 `openspec/changes/<name>/`，写 proposal / tasks / spec delta。
- 合并前必须归档（`openspec archive <name> --yes`），同步 `openspec/specs/`；Part A 会拦截未归档的 active change。
- 当前没有 active change。下一步如果要改行为，先 `openspec new change <name>` 或按现有 change 格式手工建。

### 合并门控（merge-discipline）

顺序：**A（OpenSpec archive）→ B（rebase/冲突）→ C（覆盖率）→ R（PR code review）→ D（squash 决策 + tip pinning）→ merge**。

- `coverage-gate: never`（`AGENTS.md`）：不跑覆盖率分析器，PR 里留痕。
- `pr-review-gate` 未设置 ≡ `auto`：按改动面 + 规模/风险选 `light`/`full`；本仓库的独立 review 要求 ≥80 的 Critical/Important 为 0 才 PASS。
- **冲突直接 rebase，不要再问**（`AGENTS.md` 的 Git workflow）：功能分支 rebase 到目标分支、就地解决冲突、`--force-with-lease` 推送；永远不要重写 `main`/`release/*`。
- 保护分支只通过 PR 合并；单提交→no-squash，多提交按“原子提交保留 / 琐碎堆积 squash”判断，且必须让用户选。
- 合并必须 pin tip：`gh pr merge <id> --merge --match-head-commit <sha>`；合并后做 ancestor check：`git merge-base --is-ancestor <sha> origin/main`。
- 合并后切回 `main` 并 `git pull --ff-only`，清理已合并的功能分支。

### 不要做的事

- 不要提交模型权重、录音、历史、评测报告或个人语音数据。
- 不要在真实评测前把 LLM 清理默认打开。
- 不要把 Qwen2.5-3B 放进商业默认（Qwen Research License，仅非商业；见 `docs/ASR-CORRECTION-RESEARCH.md`）。
- 不要静默把云端当 fallback；端点只在显式启用时发送文本。
- 不要用 `test.skip`、stub、TODO 占位来宣称完成。
- 不要直接 push `main`。

## 7. 未完成工作（按优先级）

### P0：需要 owner 输入/凭证，AI 无法独自完成

1. **LLM 清理是否默认开启**
   - 需要 20–30 条真人口语 WAV + 同名 TXT，放在 `bench/llm/real/`（16 kHz 单声道 PCM16，3–15 秒）。
   - 运行：`JUSTSPEAK_LLM_MODEL=/path/to/model.gguf pnpm llm:eval`。
   - 必看 `noCandidateRate` / `fallbackRate` / 危险样本保留；合成冒烟显示**候选召回**是瓶颈，不是模型质量。
   - 在数据出来前，默认保持 `off`；不要放宽护栏来“改善”指标。
   - 详细 SOP：`docs/LLM-EVAL-SOP.md`；合成基线：`docs/LLM-EVAL-SMOKE.md`。

2. **签名、公证、自动更新**
   - 签名/公证需要 Developer ID Application 证书、team ID、notarytool 凭证。
   - 自动更新尚未实现：代码里没有 electron-updater/autoUpdater，`publish: null`；需要更新客户端 + 发布 feed + 凭证，不只是打开一个开关。
   - 当前打包能出未签名 `.app`，不能发正式版。
   - 见 `docs/PACKAGING-RELEASE.md`。

### P1：工程上应尽快做

3. ~~修 spec 漂移~~ — 已由 PR #32 完成：`settings-surface` 与 `app-shell` 都改为“设置页拥有可编辑选择器、header 不再有 picker”。
4. ~~修文档漂移~~ — 已由 PR #32 完成：`TECH-DECISIONS.md` 与 `ASR-RESEARCH.md` 记录 SenseVoice Small 为已交付默认，`CHANGELOG.md` 补上已交付能力。
5. **补 OS 级验证**：
   - 真机按键验证录制中 `Cmd+Q` / `Cmd+R` 被菜单抑制并显示“被 macOS 占用”，而不是退出/重载。E2E 用的是 Playwright 合成事件，不经过原生菜单。
   - 验证 Electron `globalShortcut` 是否接受 `Command+'`（解析/捕获已通过，OS 接受度未验证）。
6. ~~补一个测试~~ — 已由 PR #32 完成：`hotkeyChangeRefusal(state)` 落在 `src/core/hotkey`，状态表由单测覆盖，capture 与应用两条路径共用同一判断。

### P2：未来硬化 / 产品规划

7. sidecar 的 Unix socket transport，以及同用户进程抓包保护（当前是 localhost + 每次启动 API key）。
8. Windows 移植（`docs/WINDOWS-PORT.md`，未开始）。
9. v0.2 SpeakPilot（`docs/V0.2-SPEAKPILOT.md`，规划）。

## 8. 关键设计约束（不要轻易推翻）

- **本地优先**：默认路径无网络、无内容上传；云端是显式开关。
- **LLM 清理默认 off**：任何默认值变更都要有真实评测证据。
- **规则拥有候选**：LLM 只能在规则标出的候选上选封闭动作；不允许自由重写整句。
- **模型许可**：Qwen3-ASR / Qwen2.5-1.5B 是 Apache-2.0；Qwen2.5-3B 是非商业，不能做商业默认；SenseVoice 是 FunASR-Model-License-1.1。
- **诊断隐私**：zip 不含转写/音频/历史/词汇/密钥/端点；crash dump 例外，已在 README 与导出 README 中披露。
- **sidecar 鉴权**：每次启动生成 key，0600 文件放 0700 临时目录，`--api-key-file` 传入，启动后删除；运行时忽略 key 就 fail closed。
- **信任边界**：所有 IPC 先校验 trusted sender；渲染进程 sandbox + contextIsolation。

## 9. 接手验收清单

- [ ] `git switch main && git pull --ff-only`，确认 `git log -1` 是 `72fe036` 之后的提交
- [ ] `pnpm install`
- [ ] `pnpm typecheck && pnpm test && pnpm build`
- [ ] `pnpm exec playwright test`（需要 GUI；`JUSTSPEAK_E2E=0` 可跳过）
- [ ] `openspec validate --specs --strict` 14/14；`openspec list` 为空
- [ ] `pnpm dev` 后用设置页录制一个新快捷键，确认取消/超时后旧键仍可用
- [ ] 读一遍 `AGENTS.md` 的 Git workflow 与 merge gates
- [ ] 如果要改行为，先建 OpenSpec change；如果只改文档，走 docs PR
