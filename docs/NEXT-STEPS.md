# JustSpeak 下一步产品规划

- 日期：2026-11-18
- 基线：`main` @ `23c6bdd`（工作树除既有未跟踪目录 `.explain-clearly/` 外干净）
- 本文性质：只读盘点 + 候选方案。**不含实现代码**，也没有创建任何 OpenSpec 活跃 change。
- 合规声明：本次未修改 `src/`、`.github/workflows/`、版本号；未打 tag、未触发 Release；
  未创建 `openspec/changes/<name>/`。下文出现的 change 名全部是草案，owner 拍板后才建目录。

---

## 0. 本次实测基线

以下数字是 2026-11-18 在本机实跑得到的，不是引用旧文档：

| 检查 | 结果 | 说明 |
|---|---|---|
| `pnpm test` | **900 passed / 4 skipped**（904） | 67 个文件通过、1 个文件跳过；耗时 10.07 s |
| 跳过项 | 4 个，全部是 `tests/real-cli.smoke.test.ts` | 由 `JUSTSPEAK_REAL_ASR=1` 控制（`tests/real-cli.smoke.test.ts:16-17`、`:83`） |
| `pnpm typecheck` | 通过（exit 0） | `package.json:14` |
| `pnpm build` | 通过 | `package.json:12` |
| `openspec validate --specs --strict` | **17/17 passed** | 实际输出 |
| `openspec list` | `No active changes found` | 实际输出 |
| `npx playwright test tests/e2e/undo.spec.ts` | **11/11 passed**，51.4 s | 隔离运行，假 `osascript` |
| `npx playwright test` 第 1 次 | **30 passed / 1 failed**，1.7 m | 失败：`tests/e2e/undo.spec.ts:580`（`:606` 报 target closed，`:619` `undo.ok` 为 false） |
| `npx playwright test` 第 2 次 | **31/31 passed**，1.6 m | 同一套件复跑 |
| `pgrep` 检查 | 无遗留 Electron / Playwright 进程 | 测试窗口已随进程关闭 |

**结论：**单元与契约层是绿的；Electron E2E 整体可用，但最新、最危险的撤销路径已经出现过一次
全量运行失败。CI 不跑 E2E（`.github/workflows/ci.yml:10-12`），所以这条证据只在本地成立。

旧交接文档的数字已经落后于现实，引用时必须校正：

| 项目 | `docs/AI-HANDOFF.md` 写的 | 本次实测 |
|---|---|---|
| `main` | `9fe4809`（`docs/AI-HANDOFF.md:4`） | `23c6bdd` |
| `pnpm test` | 774 passed / 4 skipped（`docs/AI-HANDOFF.md:31`） | 900 passed / 4 skipped |
| `openspec validate` | 14/14（`docs/AI-HANDOFF.md:34`） | 17/17 |
| 权威 spec 数 | 15 个（`docs/AI-HANDOFF.md:101`） | 17 个目录（`openspec/specs/`） |
| 最近交付表 | 最新到 PR #39（`docs/AI-HANDOFF.md:70-82`） | 已合并到 #46（`5e419cc`） |

---

## 1. 当前状态实测：已验证 / 有代码未验证 / 未做

判定口径只有三种：**有自动化测试且本次真跑**、**有实现但测试没有覆盖真实路径**、
**文档承诺或规划里写了但没有实现**。不做“看起来应该有”的推断。

### 1.1 已验证（自动化证据在本轮真实执行）

| 能力 | 证据 |
|---|---|
| 核心/契约单元测试 | `pnpm test` 900 passed；撤销、删除、锁、偏好、后处理、历史、更新策略都在其中 |
| 撤销守卫纯逻辑 | `tests/injection-undo.test.ts` 29 个 `it`；`tests/injection-undo-lock.test.ts` 7 个；`tests/injection-delete.test.ts` 10 个；全部通过 |
| 撤销 E2E（隔离、假 osascript） | `tests/e2e/undo.spec.ts` 11/11；用例覆盖 B1 撤销、B2 re-say、B3 面板重插入、并发与锁 |
| 开机自启决策与适配器 | `tests/login-item.test.ts` 24 个用例；Electron 被 `vi.mock` 替换（`:10-15`），覆盖读回、拒绝、`requires-approval`、首次运行播种 |
| 后处理已知坏例 | 直接跑 `postprocess` 得到：`他说．．`、`他说……不对，走了`、`他，JustSpeak行。` 均保持原样；对应断言在 `tests/postprocess.test.ts:189-190`、`:277-279` |
| LLM 清理链路（合成） | `docs/LLM-EVAL-SMOKE.md:39` 记录 0 次超时、0 次回退；10 条合成样本跑通 ASR→规则→LLM→护栏→报告 |
| 历史 / 诊断 / 菜单栏 / 更新 / 壳 | 全量 E2E 两轮中除 `tests/e2e/undo.spec.ts:580` 外全部通过；对应单测在 `tests/history*.test.ts`、`tests/diagnostics-*.test.ts`、`tests/menubar-menu.test.ts`、`tests/update-*.test.ts` |
| 未签名更新诚实拒绝 | `src/main/update.ts:24-25`、`:141-143`；`tests/update-view.test.ts:27-30` 断言不发网络请求 |
| CI 合并门禁 | `typecheck`/`test`/`build`/`openspec` 在 `.github/workflows/ci.yml:52`、`:69` 执行；E2E 明确不跑（`:10-12`） |

### 1.2 有代码但未验证（实现存在，证据没有覆盖真实路径）

| 能力 | 实现位置 | 缺口与证据 |
|---|---|---|
| 真实 AppleScript 删除 | `src/main/injection.ts:127-145` | E2E 把系统 `osascript` 换成 Node shim；见 `tests/e2e/undo.spec.ts:47` 的注释与 `:67` 的 `const shim`。真实脚本从未在测试中执行 |
| 撤销前把目标 App 拉到前台 | `src/main/injection.ts:91-108` | `grep -rn "activateRunningApp" tests` 无命中；只有 `src/main/index.ts:570` 调用。真实 `open -b` 行为未验证 |
| 撤销 E2E 的全量稳定性 | `tests/e2e/undo.spec.ts:580-619` | 3 次运行（隔离、全量第 1 次、全量第 2 次）中，全量第 1 次失败：`:606` `waitForEvent` target closed，`:619` `undo.ok` 为 false；隔离 11/11、全量第 2 次 31/31 |
| 登录项真实写入 | `src/main/login-item.ts:83-90` | 测试替换了 Electron（`tests/login-item.test.ts:10-15`），没有对真实 `app.setLoginItemSettings` 的读回；代码自己承认未签名/未放 `/Applications` 可能不生效（`src/core/preferences/autostart.ts:13-18`） |
| OS 级快捷键行为 | 录制/回退逻辑在 `src/core/hotkey/` | `docs/AI-HANDOFF.md:199-201` 明说：真机 `Cmd+Q`/`Cmd+R` 菜单抑制、`Command+'` 是否被 `globalShortcut` 接受都未验证；E2E 用 Playwright 合成事件，不经过原生菜单 |
| 真实 ASR CLI | `tests/real-cli.smoke.test.ts` | 默认跳过（`:16-17`、`:83`），本轮 4 个 skipped 全在这里 |
| 真实语音准确率 | `scripts/bench-real.ts` 就绪 | `bench/real/` 不存在；`docs/PRODUCT-FEEDBACK.md:364-369` 明说“没有任何真实录音，准确率没有数字” |
| LLM 真人口语质量 | `scripts/llm-eval.ts` 就绪 | `bench/llm/real/` 不存在；`docs/LLM-EVAL-SOP.md:63` 明说合成音频不能用于 Go/No-Go |
| 签名 / 公证 | `scripts/package-mac-signed.ts` | 只走到环境变量检查；`docs/PRODUCT-FEEDBACK.md:172-179` 记录“没有 Developer ID 证书或 notarytool 凭证” |
| 签名版自动更新 | `src/core/update/` | 未签名构建会诚实拒绝（已测）；真正的下载/安装从未在签名构建上跑过 |

### 1.3 文档承诺 / 规划里写了，但没有做

| 项目 | 证据 | 说明 |
|---|---|---|
| 撤销的光标限制 | `openspec/specs/injection-undo/spec.md:331-350` | spec 自己写明：用户在同一输入框移动光标后，固定长度删除会从新光标位置删；当前删除期望只有 app/bundle/role/identity（`src/core/injection/delete.ts:15-20`），没有范围校验 |
| 延迟 P50/P95 聚合 | `src/main/history-store.ts:105` 写入 `latencyMs`；`src/core/history/index.ts:51` 解析；`src/renderer/src/HistoryPane.tsx:211-212` 只显示时长 | App 内没有任何 percentile；唯一的 P50/P95 在离线脚本 `scripts/bench-real.ts:363-364`，而它没有真实录音可跑 |
| 真实评测样本 | `bench/llm/` 只有 `fixtures/reports/results`；`bench/real/` 不存在 | `docs/PRODUCT-FEEDBACK.md:364-369`、`docs/LLM-EVAL-SOP.md:24` 要求 20–30 条真人 WAV + TXT |
| 云端 ASR | `docs/ROADMAP.md:6` 把“optional cloud ASR”写进 v0.1 | 实际 provider 工厂只有 `qwen3` 与 `sensevoice`（`src/main/asr/providers.ts:45-51`），没有云端 provider；`docs/PRIVACY.md:28-35` 也没有云端 ASR 目的地 |
| 流式 ASR | `src/core/asr/sensevoice-provider.ts:40`、`src/core/asr/qwen3-provider.ts:17`、`src/core/asr/fake-provider.ts:14` 全部 `streaming: false` | 只有分段批处理；`docs/ROADMAP.md` 没有把流式列为 v0.1 承诺 |
| Windows / Linux | `docs/AI-HANDOFF.md:209`；`docs/PRODUCT-FEEDBACK.md:371-373` | 只有设计文档，macOS arm64 是唯一交付平台 |
| v0.2 SpeakPilot | `docs/ROADMAP.md:10-15`；`docs/AI-HANDOFF.md:210` | 规划态，没有实现 |
| 隐私文档 | `docs/PRIVACY.md:1-4` | 仍是 “pre-release placeholder”，要求首次公开发布前补完 |
| AI 交接文档 | `docs/AI-HANDOFF.md:4`、`:31`、`:34`、`:101`、`:70-82` | main、测试数、spec 数、最近交付表都落后；撤销（#46）没有写进 §7 |
| 托盘/菜单 Minor | `docs/AI-HANDOFF.md:204` | 工具提示仍是原始 accelerator；应用菜单没有 `role:'close'`，`Cmd+W` 不关窗 |
| 分段 UI | `docs/PRODUCT-FEEDBACK.md:371-375` | 静音分段只能通过环境变量配置，没有 UI |
| sidecar Unix socket | `docs/AI-HANDOFF.md:208` | 当前是 localhost + 每次启动 API key，Unix socket 未做 |

**一句话总结：**“撤销、历史、菜单栏、更新、诊断、自启”这些主链路在测试域里是成立的；
真正缺证据的是**真实 macOS Accessibility/键盘**这一层，以及**真实语音/真实 LLM 质量**这一层。
前者是工程可关闭的，后者需要 owner 提供录音。

---

## 2. 候选方案（3 条）

### 候选 1（推荐）：真机 OS 交互验证收口

- **正式 change 名草案：**`os-level-verification`
- **解决什么真实痛点：**
  - 交接文档把“补 OS 级验证”列为 P1：`Cmd+Q`/`Cmd+R` 在录制期间是否真的被菜单抑制、`Command+'` 是否真的被
    `globalShortcut` 接受，E2E 的合成事件都证明不了（`docs/AI-HANDOFF.md:199-201`）。
  - 撤销路径比快捷键更危险：它会在**别人的窗口里**按 Backspace；守卫注释自己写明“错误的 Backspace
    会删掉别人窗口里的文本”（`src/core/injection/undo.ts:8-10`）。
  - 这条路径的唯一端到端证据是假 `osascript`（`tests/e2e/undo.spec.ts:47`、`:67`），真实脚本在
    `src/main/injection.ts:127-145` 从未执行；全量 E2E 首轮还在 `tests/e2e/undo.spec.ts:580` 失败过一次。
- **证据：**
  - `docs/AI-HANDOFF.md:195-204`：P1 里只剩 #5（OS 级验证）和 #8（托盘 Minor）没做；#3/#4/#6/#7 都已划掉。
  - `tests/e2e/undo.spec.ts:47`：注释明确说这是“A fake `osascript`”；`:67` 起是 shim。
  - 本次实测：隔离 11/11；全量第 1 次 30/31（`:580` 失败）；全量第 2 次 31/31。
  - `src/main/injection.ts:91-108` 的 `activateRunningApp` 没有任何测试引用。
- **工作量估计：2–3 人天**（估算）
  - 新增 `tests/e2e/undo-real-ax.spec.ts`（opt-in `JUSTSPEAK_REAL_AX=1`）：1 天
  - 新增 `tests/e2e/hotkey-real-keys.spec.ts`（opt-in `JUSTSPEAK_REAL_KEYS=1`）：0.5–1 天
  - 把全量 E2E 的 flake 定位并修掉（先判断是测试竞态还是产品竞态）：0.5–1 天
  - `docs/REAL-MACHINE-CHECKS.md` 记录 macOS 版本、日期、结果：0.5 天
  - 涉及文件：上述新 spec、`tests/e2e/undo.spec.ts`、`package.json`（新增脚本）、文档；**不改 `src/`**，
    除非真机验证发现缺陷，那要另建修复 change。
- **风险与不可逆点：**
  - **权限**：跑真实 AX/键盘需要测试运行时（终端或 Playwright 宿主）已获辅助功能权限；这不是产品新增权限，
    但必须在结果里写明“没有权限时测试失败，不得算通过”。
  - **副作用**：会临时打开 TextEdit 并发送按键，必须使用临时文档、结束后关闭；不得碰用户自己打开的窗口。
    `Cmd+Q` 测试必须用独立测试实例并断言进程仍存活，不能对用户正在用的 JustSpeak 发。
  - **不可逆性**：无。只新增测试与文档，不写用户数据、不改偏好、不改数据格式。
  - **锁死风险**：低。真机测试绑定 macOS Accessibility，但产品本来就是 macOS-only；将来若做 Windows 移植，
    这套测试不迁移即可。
- **验收标准（可测试/可门禁）：**
  - `JUSTSPEAK_REAL_AX=1 npx playwright test tests/e2e/undo-real-ax.spec.ts` → 3/3 通过：
    1. TextEdit 中插入后撤销，文本精确减少记录的 grapheme 数；
    2. 撤销前切到另一个应用，断言不发送删除；
    3. 目标 App 已退出，断言拒绝并把文本放进结果面板。
  - `JUSTSPEAK_REAL_KEYS=1 npx playwright test tests/e2e/hotkey-real-keys.spec.ts` → 2/2 通过：
    1. `Command+'` 经系统按键能启动录制；
    2. 录制中 `Cmd+Q` 不退出，并出现“被 macOS 占用”的提示。
  - `npx playwright test` 全量 **连续两次 31/31**（把 `tests/e2e/undo.spec.ts:580` 的 flake 钉住）。
  - `docs/REAL-MACHINE-CHECKS.md` 有本次 macOS 版本、日期、逐项 pass/fail；不得有 skipped 冒充 pass。
  - `pnpm typecheck`、`pnpm test` 仍绿。

---

### 候选 2：撤销光标范围守卫

- **正式 change 名草案：**`undo-caret-guard`
- **解决什么真实痛点：**
  - 这是 spec 自己承认的已知数据风险，不是推测：撤销假设光标还在插入文本末尾；用户在同一个输入框里移动
    光标后，固定长度删除会从**新光标位置**删，而不是删除原来那段
    （`openspec/specs/injection-undo/spec.md:331-350`）。
  - 当前删除期望只有 app/bundle/role/identity，没有范围字段（`src/core/injection/delete.ts:15-20`），
    所以这条风险没有任何代码拦截。
  - 对用户来说，后果是“删掉了没打算删的文字”，而且发生在别的应用里，无法从 JustSpeak 恢复原状
    （只能在历史/面板里找回刚插入的文本，找不回被误删的上下文）。
- **证据：**
  - `src/core/injection/undo.ts:120-142` 的 `buildInjectionRecord` 只记录文本、长度、目标身份、时间、方式；
    没有光标位置。
  - `src/main/focus-probe.ts:39` 读取了 `AXSelectedTextRange`，但 `:53` 的返回行只输出 `hasRange`
    的 0/1，没有把 location/length 传出来。
  - `src/core/injection/delete.ts:26-111` 的 AppleScript 只校验 app/bundle/role/identity，然后按固定 count
    按 Backspace。
- **工作量估计：3–4 人天**（估算）
  - `src/main/focus-probe.ts`：扩展探针输出 range location/length（0.5 天）
  - `src/core/injection/undo.ts`：记录 `caret`，纳入守卫（1 天）
  - `src/core/injection/delete.ts`：argv 增加期望范围，脚本内比对，新增 `caret-changed` 拒绝码（1 天）
  - `src/main/index.ts`：插入后捕获范围、撤销前传入（0.5 天）
  - 测试与 OpenSpec delta（`injection-undo`）：1 天
- **风险与不可逆点：**
  - **可用性下降**：如果要求“范围不可读就拒绝撤销”，部分应用可能无法撤销；但代码现有的哲学就是
    “不可读即拒绝，绝不猜”（`src/core/injection/undo.ts:9-10`），这与产品一致。建议安全优先：
    读不到范围就拒绝，并把文本放进面板。
  - **兼容性**：不同应用对 `AXSelectedTextRange` 的更新时机不同（粘贴后可能延迟）。需要短暂重试；
    重试后仍不可读则拒绝。
  - **残留风险**：本候选只能覆盖“能读到范围”的应用；对读不到的应用，spec 要保留限制说明，不能声称彻底修复。
  - **不可逆性**：无。撤销记录本来就不持久化（spec 第一条要求写明 “Nothing SHALL be persisted”），
    加字段不涉及迁移。
  - **锁死风险**：低。范围校验是附加拒绝条件，可回退；不会改变 history 或偏好格式。
- **验收标准：**
  - `pnpm test -- injection-undo injection-delete focus-probe` 通过，且新增：
    - `tests/injection-undo.test.ts` › `records the caret location confirmed after the paste`
    - `tests/injection-undo.test.ts` › `refuses when the caret moved inside the same field`
    - `tests/injection-delete.test.ts` › `aborts with caret-changed before pressing any key`
    - `tests/focus-probe.test.ts` › `parses the selected range location from the extended probe`
  - `npx playwright test tests/e2e/undo.spec.ts` 通过，且新增
    `B1: a moved caret is refused and the text is preserved`（假 osascript 即可覆盖逻辑）。
  - 真机项并入候选 1 的 `undo-real-ax.spec.ts`：移动光标后撤销，断言 TextEdit 文本不变且面板保留原文本。
  - `openspec validate --specs --strict` 通过；change 合并前归档（流程见 `docs/AI-HANDOFF.md:155-157`）。

---

### 候选 3：LLM 清理的候选召回

- **正式 change 名草案：**`llm-candidate-recall`
- **解决什么真实痛点：**
  - 交接文档把“LLM 清理是否默认开启”列为 P0，并明确指出瓶颈是**候选召回**，不是模型质量
    （`docs/AI-HANDOFF.md:183-188`，尤其 `:186`）。
  - 用户打开“智能清理”后，如果默认 SenseVoice 输出里规则找不到候选，功能看起来就是没生效：
    合成冒烟中 SenseVoice **10/10 `no_candidate`**，Qwen3 也只有 3/10 触发
    （`docs/LLM-EVAL-SMOKE.md:26-27`、`:40`）。
  - 产物文档也记录了“1.5B 质量边缘，默认开启必须等 Go/No-Go”
    （`docs/PRODUCT-FEEDBACK.md:126-140`）。
- **证据：**
  - `src/core/llm/correction.ts:12` 定义标记集合；`:72-73` 要求标记左侧必须是分隔符。
  - ASR 常省略标点，合成冒烟的原始形态就是 `周一发不对，周二发。`（`docs/LLM-EVAL-SMOKE.md:40`），
    左侧没有分隔符，于是直接 `no_candidate`。
  - `tests/llm-correction.test.ts:23-24` 明确把 `这个不对。` 判为无候选；`:28-29` 把多标记判为无候选。
    这两条是保守设计，不能为了召回随手删掉。
- **工作量估计：3–5 人天**（估算）+ owner 录音 1–2 小时
  - `src/core/llm/correction.ts` 分级左边界（强标记/弱标记）：1–2 天
  - `tests/llm-correction.test.ts` 增加 ASR 形态样本：1 天
  - `bench/llm/real/` 样本采集与 `pnpm llm:eval` 跑批：1–2 天（录音由 owner 做）
  - `docs/LLM-EVAL-SMOKE.md` / `LLM-EVAL-SOP.md` 更新：0.5 天
- **风险与不可逆点：**
  - **召回提高 = 删除动作变多**：护栏只检查长度比例和数字（`src/core/llm/correction.ts:110-122`），
    不理解语义；可能删掉从句。缓解：只放宽强标记；危险样本单独断言；默认保持 `off`。
  - **合成数据过拟合**：`docs/LLM-EVAL-SOP.md:63` 明确说合成音频不能用于默认开启决策。本候选可以在
    真实样本到位前改规则，但**不得**据此把默认值改成 on。
  - **不可逆性**：文本仍在历史与结果面板里；LLM 默认 off；没有新的网络目的地或权限。
  - **锁死风险**：中等。规则会变复杂；将来若有 ASR 停顿/时间戳，可能是更好的信号。把逻辑限制在
    `correction.ts` 一个模块内，便于替换。
- **验收标准：**
  - `pnpm test -- llm-correction` 通过，且新增：
    - `finds a marker with no punctuation on its left when the marker is strong`
    - `still rejects a marker inside a clause`（`这个不对。` 仍为 null）
    - `still defers when two markers are present`
    - `keeps every digit-bearing dangerous sample unchanged`
  - `JUSTSPEAK_LLM_EVAL_DIR=bench/llm/smoke JUSTSPEAK_LLM_MODEL=<gguf> pnpm llm:eval` 跑一轮：
    `no_candidate` 必须低于改动前基线（至少 1 条原来的候选缺失样本进入候选）；危险样本（数字/否定/专名）
    保留数不得下降；报告落盘并被引用。
  - 真实数据门禁：owner 提供 `bench/llm/real/` 的 20–30 条样本后，`pnpm llm:eval` 必须按
    `docs/LLM-EVAL-SOP.md:69-70` 的 Go/No-Go 判定；本候选**不**改默认值。
  - `pnpm typecheck`、`pnpm test` 全绿。

---

## 3. 排序与推荐

| 排名 | 候选 | 现在做的理由 | 依赖 |
|---|---|---|---|
| 1 | 真机 OS 交互验证收口 | 交接文档明确 P1；撤销是唯一会在别的应用里按删除键的功能；证据链目前只有假脚本，且全量 E2E 已出现 1 次失败 | 需要 owner 授权测试运行时辅助功能权限 |
| 2 | 撤销光标范围守卫 | spec 已承认的数据风险；修复后直接降低误删概率 | 需要候选 1 先确认真实 app 能否读到 range |
| 3 | LLM 候选召回 | P0 的前置工程；结构原因清楚 | 需要 owner 录 20–30 条真实样本才能做 Go/No-Go；默认保持 off |

**推荐：候选 1。**

理由：

1. **它是唯一“先证明再改”的动作。** 候选 2 是否可行，取决于真实 app 是否稳定暴露 `AXSelectedTextRange`
   的 location；候选 1 正好回答这个问题。先做候选 2 可能做出一个“到处拒绝”的守卫，或者修错地方。
2. **它针对的是本仓库当前最高等级的未验证安全风险。** `docs/AI-HANDOFF.md:199-201` 已经把
   “E2E 合成事件不等于真机”写成 P1；撤销把这个问题放大成了“在别人窗口里按 Backspace”
   （`src/core/injection/undo.ts:8-10`）。
3. **它不依赖 owner 的证书或录音。** 只需要一次测试机的辅助功能授权；候选 3 则被真实录音卡住
   （`docs/LLM-EVAL-SOP.md:24`、`:63`）。
4. **它能顺手把 E2E 的 flake 钉住。** 本次全量首轮 30/31，失败点就在撤销套件；一个会偶发红的
   安全关键套件不能当门禁。

**为什么不是候选 2：** 它是候选 1 的下游。没有真机范围数据，就无法决定“读不到范围时拒绝还是保持现状”；
先做会把一个设计选择建立在假设上。候选 1 先跑，候选 2 再按实测结果落地。

**为什么不是候选 3：** 它确实是 P0，但 P0 卡在 owner 的真实录音上；合成冒烟只能证明链路，不能证明质量
（`docs/LLM-EVAL-SOP.md:63`）。LLM 默认是 `off`，默认路径不会触发这个缺陷；而撤销误删是
“已经能发生”的风险。先关掉能发生的数据风险，再谈默认值。

---

## 4. 本次明确不做什么

| 不做的事 | 理由（含证据） |
|---|---|
| **v0.2 SpeakPilot / 桌面代理** | 规划态，见 `docs/ROADMAP.md:10-15`、`docs/AI-HANDOFF.md:210`；权限模型、仓库拆分、桌面动作都没有开始。v0.1 的真实语音与 OS 验证还没收口，现在开第二产品线只会分散证据 |
| **Windows / Linux 移植** | 当前是 macOS arm64 only（`docs/AI-HANDOFF.md:209`、`docs/PRODUCT-FEEDBACK.md:371-373`）；核心链路依赖 System Events、Accessibility、登录项，移植不是“换个打包目标”，而是重写注入层 |
| **云端 ASR** | `docs/ROADMAP.md:6` 写了 optional cloud ASR，但当前 provider 工厂只有本地 `qwen3`/`sensevoice`（`src/main/asr/providers.ts:45-51`），隐私文档的网络目的地也只有模型下载、清理端点、更新检查三处（`docs/PRIVACY.md:28-35`）。加云端 ASR 会新增目的地、同意流程和供应商契约，与“默认离线”冲突 |
| **流式 ASR 重构** | 三个 provider 都是 `streaming: false`（`src/core/asr/sensevoice-provider.ts:40`、`src/core/asr/qwen3-provider.ts:17`、`src/core/asr/fake-provider.ts:14`）；现有分段批处理已经能工作。流式会改会话/音频/ASR 三套契约，而目前连延迟 P50/P95 都没有，无法证明重构收益 |
| **签名 / 公证 / 任何证书或账号动作** | 需要 Developer ID 证书、team ID、notarytool 凭证（`docs/AI-HANDOFF.md:190-193`、`docs/PRODUCT-FEEDBACK.md:172-179`）；这些是 owner 资产，AI 不能代办，也不应在示例里伪造。本轮不打 tag、不触发 Release、不改 workflow |
| **把 LLM 清理默认打开** | 没有真实录音，合成冒烟不能做 Go/No-Go（`docs/LLM-EVAL-SOP.md:63`、`:69-70`）；默认保持 `off` |
| **改版本号 / 打 tag / 发布** | 明确不在本次范围；任何发布动作都需要 owner 单独决定 |
| **创建 OpenSpec 活跃 change 目录** | 会触发 CI 的 “No active OpenSpec change” 门禁（`.github/workflows/ci.yml` 的最后一个 step）；本文只给 change 名草案 |

---

## 5. 第二梯队候选池

| 候选 | 判断 | 一句理由 |
|---|---|---|
| ① 采集器自产评测样本 | **以后做（并入候选 3 的样本步骤）** | `docs/LLM-EVAL-SOP.md:24` 只要求 20–30 条 WAV+TXT，现有系统录音/`ffmpeg` 足够；为一次性需求加 App 内采集器会新增 UI 与隐私面，收益不成比例 |
| ② 延迟 P50/P95 聚合 + SLO 门禁 | **以后做（不纳入前三）** | 延迟已经逐条记录（`src/main/history-store.ts:105`），但 App 内没有聚合（`src/renderer/src/HistoryPane.tsx:211-212` 只显示时长）；当前没有未解决的延迟投诉——`docs/PRODUCT-FEEDBACK.md:207-209` 的等待抱怨讲的是波形动画，已在 `:210-216` 解决。先做完真机验证与 LLM 再投入 |
| ③ 签名 / 公证 | **不做（本轮）** | 被 owner 的证书/账号阻塞（`docs/AI-HANDOFF.md:190-193`）；没有凭证时任何“已验证”的声明都是假的。等凭证到位再单独立项 |

> 说明：② 的数据采集已经存在，未来做时不需要重新设计埋点；复用
> `scripts/bench-real.ts:363-364` 的线性插值 percentile 即可。

---

## 6. 需要 owner 拍板的点

### 决定 1：是否授权真机 AX/键盘验证

- A. **授权**（推荐）：测试中临时打开 TextEdit/独立测试实例，授予测试运行时辅助功能权限；结束后关闭。
- B. 只做人工核对清单，不写自动化测试。
- C. 不做真机验证，直接进入功能开发。

倾向：**A**。这是候选 1 的前提；人工清单无法防回归，也无法区分“测试没跑”与“功能正常”。

### 决定 2：读不到光标范围时，撤销怎么处理

- A. 保持现状（继续用 identity 守卫），在 spec 写明残余风险。
- B. **拒绝撤销并把文本放进面板**（安全优先，推荐）。
- C. 不做光标范围校验。

倾向：**B**。与现有“不可读即拒绝，绝不猜”的守卫哲学一致（`src/core/injection/undo.ts:9-10`）；
代价是部分应用里撤销会不可用，但不会误删。

### 决定 3：LLM 真实评测样本由谁、何时录

- A. **owner 按 SOP 录 20–30 条**（推荐），再决定是否改召回/默认值。
- B. 先改召回，用合成数据验收，默认仍 `off`。
- C. 冻结 LLM 功能，不投入。

倾向：**A**。`docs/LLM-EVAL-SOP.md:24` 的样本量不大；没有它，候选 3 只能停在“链路正确”，
无法回答产品问题。B 可以作为 A 的并行预研，但不能替代 Go/No-Go。

### 决定 4：延迟 P50/P95 是否排进本轮

- A. **以后做**（推荐）：等真机验证与 LLM 样本之后。
- B. 现在做，排在前三之外但同轮完成。
- C. 不做。

倾向：**A**。理由见第 5 节；数据已在，晚做不会丢信息。

### 决定 5：是否顺手刷新交接/隐私文档

- A. **本轮顺手刷新**（推荐）：只改文档，不改行为；更新 `docs/AI-HANDOFF.md` 的 main/测试数/spec 数/最近交付表，
  并把 `docs/PRIVACY.md:1-4` 的 placeholder 补成与 `docs/PRIVACY-SECURITY.md` 一致的摘要。
- B. 下次交接前再刷新。
- C. 不刷新。

倾向：**A**。这是 0.5 天量级的文档工作，却能避免下一个接手者继续引用 774/14/15 这些旧数字。

---

## 附：给执行者的最短路径（若 owner 选候选 1）

1. owner 批准后，再建 `openspec/changes/os-level-verification/`（仅当需要记录验证任务；若仓库认为纯测试不需要 change，
   则直接走 docs/test PR，并在 PR 里引用本文）。
2. 先跑现有 `npx playwright test` 两轮，记录 flake 是否复现；定位 `tests/e2e/undo.spec.ts:580` 是测试竞态还是产品竞态。
3. 加 `JUSTSPEAK_REAL_AX=1` 的 TextEdit 用例；没有辅助功能权限时让测试失败并打印原因，不要 skip 成通过。
4. 加 `JUSTSPEAK_REAL_KEYS=1` 的 `Command+'` 与 `Cmd+Q` 用例。
5. 把结果写进 `docs/REAL-MACHINE-CHECKS.md`；全量 E2E 连续两次 31/31 后才算收口。
6. 若真机验证发现代码缺陷，停止并单独建修复 change（例如 `undo-caret-guard` 或更小的缺陷 change），
   不在验证 PR 里夹带行为修改。
