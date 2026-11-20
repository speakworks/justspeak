# SpeakPilot 对话式产品规划：把"像打电话"做成可验收的工程目标

- 文档状态：**规划稿，未开工**。本轮只产出本文件，不写任何产品代码、不建分支、不改版本号。
- 编写日期：2026-11-20
- 基线：`main = ddf5b52`，`v0.1.0-demo.2` 已发布；测试基线 1024 passed / 4 skipped。
- 适用约束：`docs/ADR-0001-core-boundary.md`、`docs/V0.2-SPEAKPILOT.md`（本文不改变这两份文档的结论）。

## 证据等级约定

本文所有事实分四级，正文用标记区分：

| 标记 | 含义 |
|---|---|
| 【已核实】 | 有可点击来源，或本机实测 + 仓库 `文件:行号` |
| 【部分核实】 | 多源一致但未逐页打开原文，或来源为聚合站 |
| 【待核实】 | 没有可用证据，只作为待验证假设 |
| 【设计判断】 | 本文给出的工程取舍，不是外部事实 |

---

## a) 产品定义与范围

### a.1 一句话定义

SpeakPilot 是 JustSpeak 的第二个产品面：**把"按键说话 → 出文字"变成"持续对话 → 出声音"**，让交互接近打电话的节奏，而不是接近语音输入框。

### a.2 三级体验定义

三级不是"以后再说的高级版"，而是三份**各自可验收、可独立叫停**的契约。任何一级不达标，就停在那级，不向上宣称。

#### L1 · 快速轮转半双工（"对讲机+"）

**可感知描述**：你说完一句，系统在半秒到两秒内开口；它说话时麦克风不采集，你插不进话；它说完，你再说下一句。整体像对讲机，但轮转足够快，不像在听录音。

- 回合所有权：VAD 判停 → 系统独占话筒直到说完。
- 双工性：无。TTS 播放期间不采集（或仅监听停止键）。
- 首响：用户停说 → 系统第一个可听音，目标 P50 ≤ 2.0 s。
- 可打断性：只能通过显式手段（Esc / 热键 / menubar"挂断" / 停止词）。

#### L2 · 自动打断（barge-in）

**可感知描述**：系统正在说话，你直接开口，它会**在 300 ms 内闭嘴**，并且不会把你打断的第一个字吃掉；它不会因为自己的声音、咳嗽或旁人说话而误停。

- 回合所有权：VAD 判停 + "打断监听"并行。
- 双工性：声学上仍是半双工（同一时刻只有一个方向在"主说"），但**交互上用户可以随时抢话**。
- 首响：目标 P50 ≤ 1.2 s。
- 可打断性：自动；打断后保留预录缓冲，不丢第一个字。

#### L3 · 全双工含 backchannel

**可感知描述**：你说话时系统可以用"嗯""对"这类短反馈回应，双方可以轻微重叠；系统不会把你的 backchannel 当成打断，也不会把自己的声音当成你的话。

- 回合所有权：双方同时持有话筒，用语义与声学双重判据区分"插话 / 附和 / 噪声"。
- 本期**只定义、不承诺**：它要求可靠的 AEC 与能识别 backchannel 的判据，见 §h 与 §e。

### a.3 本期非目标（non-goals）

| 非目标 | 理由 |
|---|---|
| 唤醒词常听（always-on listening） | `docs/V0.2-SPEAKPILOT.md` 明确列为非目标；对话必须由显式动作进入 |
| 真·双方同时说话（L3 主干） | 需要 AEC + 双工模型；本期只做 L1/L2，L3 留定义 |
| 电话/短信通道（PSTN、SIP） | 与"桌面语音助手"不是同一个产品面 |
| 多用户/多方通话 | 无需求证据，且会把 VAD 与说话人分离全部拉满 |
| 语音克隆音色 | 涉及肖像/声音权与许可，见 §e、§i-5 |
| 端到端云端 speech-to-speech 作为默认路径 | 与"本地优先、不得静默上云"冲突；只作为显式 opt-in 的备选 |
| 移动端 / 手机当麦克风 | v0.1 已明确 out of scope |
| 对话历史跨设备同步 | 本地优先；本期只做本机持久化 |

### a.4 与现有听写的关系

**不是替代，是并存**。听写（快捷键 → 注入文字）仍是主路径；对话是第二个入口。两者共享 `src/core` 的音频、ASR provider 契约与偏好存储，但各自持有独立的会话状态机。

依据：
- 依赖方向 `app/shell → src/agent → src/core`，core 不得 import UI/平台 API（`docs/ADR-0001-core-boundary.md:23-24`，`docs/V0.2-SPEAKPILOT.md:446-447`）。
- ADR 的四条拆库条件（独立发版节奏 / 外部贡献者需独立权限 / 安全边界 / 仓库体积与维护负担）**当前一条都不成立**，所以本轮不建 `apps/`、不建 `packages/core`，对话代码将来直接落在 `src/` 下新增目录（`docs/ADR-0001-core-boundary.md:25-28`；`docs/V0.2-SPEAKPILOT.md:468-475,507-513`）。

---

## b) 体验量化门槛

每个指标给"可用线 / 不可用线"，并说明依据。**低于可用线即视为该级体验不成立，不得对外描述为该级。**

### b.1 指标表

| # | 指标 | 定义 | 可用线 | 不可用线 | 依据 |
|---|---|---|---|---|---|
| M1 | 停说→出声 | 用户最后一个字结束 → 系统第一个可听音（P50 / P95） | L1：P50 ≤ 2.0 s，P95 ≤ 3.0 s；L2：P50 ≤ 1.2 s，P95 ≤ 2.0 s | L1：P50 > 3.0 s；L2：P50 > 1.8 s | 【设计判断】+ 现有听写目标（说完→final p50 ≤ 1.5 s、p95 ≤ 3 s，`docs/ARCHITECTURE.md`）+ 本机 TTS 首包实测 0.57–0.82 s（见 §f） |
| M2 | 首字延迟 | 用户开口 → 界面/链路拿到第一个 partial 或第一个稳定词 | ≤ 500 ms | > 1 000 ms | 【设计判断】；流式 ASR 的 80–160 ms 分块给出理论下界【部分核实】 |
| M3 | 打断响应 | 用户开始说话 → TTS 音频真正停止 | ≤ 300 ms | > 600 ms | 【设计判断】；业界工程默认"<200 ms 语音事件不触发打断"形成 200–300 ms 的窗口【已核实】 |
| M4 | 回声误触发率 | TTS 播放期间，被判为"用户说话"但其实是回放/噪声的比例 | ≤ 5% | > 15% | 【已核实】能量 VAD 在 30 小时人工标注对话语料上对 backchannel/非语音噪声误触发 45%（闲聊场景 52%），故纯能量不可用于 barge-in；5% 是加入回声参考后的设计目标 |
| M5 | 连续轮数不失忆 | 连续对话中出现"忘了上一轮说过什么"的轮次之前，能撑多少轮 | ≥ 10 轮 | < 3 轮 | 【设计判断】；现有 sidecar context 2048（`src/main/llm/sidecar.ts:72,153-154`），必须显式管理上下文预算 |
| M6 | 打断后重述率 | 打断后系统要求用户"再说一遍"的比例 | ≤ 10% | > 25% | 【设计判断】；预录缓冲是主要手段（见 §c） |
| M7 | 回声残留 | TTS 播放时录到的自身残留（未消除部分）相对音量 | 不影响 ASR 在朗读期间识别用户短词 | 朗读期间用户短词完全不可识别 | 【设计判断】；取决于 AEC 质量，见 §c.4 |

### b.2 为什么门槛定在这里

1. **电话的真实节奏不是"同时说话"，是"低延迟轮转 + 随时可插话"**。人类对话的轮转间隔远小于 1 秒，助手做到 1–2 秒已经能产生"在对话"的感觉；把目标定到 300 ms 会把架构逼到云端或强 AEC，与本地优先冲突。
2. **L1 的 2.0 s 可用线下界来自实测**：本机 `AVSpeechSynthesizer` 首个语音单元回调 570–820 ms【已核实·本机实测】，现有 batch ASR 终稿在几十毫秒到一秒量级，端点判停 250–350 ms，三项相加已接近 2 s。定成 1.5 s 会让 L1 一开始就不可能达标。
3. **M4 若按纯能量 VAD 去做，必然失败**：45% 的公开误触发数据意味着每两次打断就停错一次。这条数据直接否决了"用现有 VAD 门限直接做 barge-in"的方案。

---

## c) 技术架构

### c.1 分层与依赖方向

```
renderer (React UI)
   │  IPC
main (Electron 主进程：窗口/热键/麦克风所有权/设备)
   │
src/agent（对话编排：回合、上下文、工具）        ← 新增
   │
src/core（纯逻辑：会话状态机、端点策略、上下文预算、端口定义）  ← 新增端口
```

规则：
- `src/core` 只定义**端口**（interface）与纯状态机，不 import Electron / DOM / AVFoundation。
- 平台实现放在 `main`（macOS 原生 TTS、AVAudioEngine、SystemSpeech）或 `renderer`（Web Audio 采集）。
- 现有 ASR 的 `AsrProvider`（`id / capabilities / prepare / transcribe / dispose / health`，`src/core/asr/types.ts:103-110`）**不修改**，新增流式端口与它并列，避免动听写契约。

### c.2 新端口草案（TypeScript 形状，本轮不落地）

```ts
// src/core/conversation/ports.ts —— 草案，仅示意
export type AsrEvent =
  | { type: 'partial'; text: string }
  | { type: 'endpoint'; silenceMs: number }
  | { type: 'final'; text: string; startMs: number; endMs: number }

export interface StreamingAsrSession {
  feed(chunk: Int16Array): void
  finish(): Promise<void>
  cancel(): void
  readonly events: AsyncIterable<AsrEvent>
}

export interface StreamingAsrPort {
  readonly capabilities: {
    languages: readonly string[]
    partials: boolean
    maxSessionMs: number
  }
  open(options: { language: string }): Promise<StreamingAsrSession>
}

export type ChatDelta =
  | { type: 'token'; text: string }
  | { type: 'done'; finishReason: 'stop' | 'length' | 'aborted' }

export interface ChatStreamPort {
  stream(
    messages: readonly ChatMessage[],
    options: { maxTokens: number; signal: AbortSignal }
  ): AsyncIterable<ChatDelta>
}

export type SpeechEvent =
  | { type: 'started' }
  | { type: 'boundary'; charRange: { location: number; length: number } }
  | { type: 'finished' }
  | { type: 'stopped' }

export interface SpeechHandle {
  readonly events: AsyncIterable<SpeechEvent>
  stop(): void
}

export interface SpeechSynthesisPort {
  readonly voices: readonly { id: string; language: string; quality: 'compact' | 'enhanced' | 'premium' }[]
  speak(text: string, options: { voiceId?: string; rate?: number }): SpeechHandle
}

export interface EchoProfileReport {
  requested: unknown
  effective: unknown          // getSettings() 回读值，不是请求值
  warning?: string
}

export interface EchoControlPort {
  requestProfile(profile: 'dictation' | 'conversation'): Promise<EchoProfileReport>
}
```

设计要点：
1. **端口只描述能力，不描述实现**。`StreamingAsrPort` 可以由 Apple Speech、R2T2 或分块包装的现有 provider 实现。
2. **`SpeechHandle` 必须可取消**，且 `boundary` 事件给的是字符范围（`AVSpeechSynthesizerDelegate` 的 `willSpeakRangeOfSpeechString` 给 `NSRange`，不是音频时间戳）【已核实】——这足以做"打断后裁剪 LLM 历史"。
3. **`EchoProfileReport.effective` 必须回读**：Chromium 在 macOS 上请求 `echoCancellation: "all"` 缺系统权限时，`getSettings()` 仍可能回报 `"all"` 而实际失效（Chromium issue 479234114）【已核实】。请求值 ≠ 生效值，这是硬性设计约束。

### c.3 两套采集 profile 如何共存

| 维度 | 听写 profile（A） | 对话 profile（B） |
|---|---|---|
| `echoCancellation` | `false`（现状，`src/renderer/src/App.tsx:79`） | 请求 `"all"` 或关闭并改用原生 VPIO |
| `noiseSuppression` / `autoGainControl` | `false` | 视实测；默认 `false`，避免改变 ASR 输入分布 |
| 采样率 | 16 kHz（`AudioContext` 强制，`capture-controller.ts:110-113`） | 16 kHz（ASR 输入需求） |
| 所有权 | 快捷键按下 → 独占 | 进入对话模式 → 独占 |
| 帧长 | 20 ms（`pcm-batcher.ts:3`） | 20 ms 采集 + 独立 10 ms 打断分析窗口 |

**为什么必须是两套**：听写要保住 ASR 质量，AEC/NS/AGC 会改变输入谱形；对话要能听见自己说话时的用户，必须依赖回声参考。把它们混成一个 profile，两条路径会互相拖累。

### c.4 回声控制的现实约束（必须先知道，再选方案）

1. **Chromium 的 AEC 不等于系统 AEC**：它的参考信号只覆盖自己通过 `RTCPeerConnection` 播放的远端媒体，不覆盖普通 `<audio>` / AudioContext 播放，也不覆盖其他 app【已核实】。本产品的 TTS 如果是自己播放的音频，旧版 Chromium 的 `echoCancellation: true` **不会**把它当参考。
2. **Chrome 141 起新增 `echoCancellation: "all"`**：以整个系统播放为参考，但 macOS 上需要"屏幕与系统音频录制"权限，缺权限时可能 AEC 失效甚至轨道静音（Chromium issue 479234114）【已核实】。Electron 的能力取决于内置 Chromium 版本。
3. **原生方案是 `AVAudioEngine` 的 voice processing（VPIO）**：它在输入侧减去设备正在播放的音频；限制是只能用于真实输出设备、不支持 manual rendering、且必须在 engine 停止时启用，不能动态开关【已核实】。这意味着切换 profile 要重建 engine，不能"热开"。
4. **结论（设计判断）**：L1 不需要 AEC（麦克风关闭），L2 的最低成本路径是"播放感知 VAD + 预录缓冲 + 高门限"，**不以"打开 AEC 就能双工"为前提**；真 AEC（`"all"` 或 VPIO）留作 L2 达标后的增强项，且必须三种路由（内置扬声器 / 有线耳机 / 蓝牙）分别实测。

### c.5 麦克风抢占与切换规则

1. **单一所有权**：任一时刻只有一个 capture owner（听写 / 对话），所有权由 `main` 统一裁决，renderer 不得自行切换。
2. **听写优先级更高**：对话进行中按下听写热键 → 对话立即挂断（有可见提示），听写开始；不允许两条链路同时持麦。
3. **对话模式内**：
   - L1：TTS 播放期间释放麦克风；播放结束重新申请。
   - L2：TTS 播放期间保持"打断监听"（可能用较低采样率的旁路），但同一时刻只有一个 MediaStream。
4. **设备变化**：默认输入/输出设备切换 → 重建 profile 并重新读取 `effective` 回声状态；重建失败则降级到 L1 并提示。
5. **系统音频权限缺失**：请求 `"all"` 但 `effective` 不符 → 降级到 L1，并在对话界面常驻一行"当前为半双工模式"。

---

## d) 选型对比

> 以下三张表均为 **6 维度 × ≥3 方案**。数据来源见每格标注；无来源的数字不写。

### d.1 流式 ASR

| 方案 | 延迟 | 质量 | 成本 | 许可 | 离线能力 | 落地难度 | 结论 |
|---|---|---|---|---|---|---|---|
| **现状 batch**（SenseVoice / Qwen3，CLI 一次性） | 无 partial；终稿取决于句长，现有目标 p50 ≤ 1.5 s（`docs/ARCHITECTURE.md`）【已核实】 | 现有听写主力，中文与专名表现已被产品验证 | 零增量 | 现有许可 | 完全离线 | 零改动 | **Phase 1–2 的基线**，不作为长期终点 |
| **Apple SFSpeechRecognizer** | 可拿 partial（`shouldReportPartialResults` 默认 true）【已核实】；公开实测 en-US 离线 p50 80 ms，中文首字无公开数据【部分核实】 | 系统模型，中文普通话可离线；专名/中英混说与热词控制不如现有 ASR【设计判断】 | 零成本 | 系统 API，无模型分发问题 | 本机实测 zh-CN `supportsOnDevice=true`、zh-TW `false`（macOS 27.2.1 / M1 Max）【已核实】 | 中：需 macOS 原生桥接（Swift/ObjC）+ `NSSpeechRecognitionUsageDescription`；且单任务 1 分钟上限【已核实】 | **P3 首选流式候选**；用在"短轮次、低延迟"，长句仍可回落 batch |
| **Qwen3-ASR 分块流式** | 官方流式仅 vLLM 后端【已核实】；分块可到 80–160 ms | 与现有 Qwen3 同源，中文强 | 零模型费用 | Apache-2.0【已核实】 | 有官方 GGUF（0.6B / 1.7B），llama.cpp 已合并 qwen3-asr 音频支持（PR #19441）【已核实】 | 高：与现有 `llama-server` 架构不同，需引入 vLLM；Apple Silicon 上 vLLM 不是主流路径 | **暂不采用**（与本地运行时栈冲突） |
| **有道 Confucius4-R2T2** | 真流式，80 ms–2 s 分块；论文给"回溯发射延迟 < 0.5 s"，**不含服务与排队**【部分核实】 | 2.04B，Qwen3-ASR-1.7B 后训练，160 ms 分块错误率 5.76% vs 基线 21.01%【部分核实】 | 零模型费用 | **权重非 Apache**：网易有道模型许可，1 亿 MAU / 10 亿元营收阈值，禁止用于改进其他 AI 模型【已核实】 | 官方 GGUF 存在（Q4_K_M ≈ 1.0–1.4 GB）【部分核实】 | 高：llama.cpp 主线无支持，C++ 侧走第三方 `audio.cpp`；官方仓库最后 push 2026-09-24、无 release【部分核实】 | **备选（需许可拍板）**，不作为 Phase 3 默认 |

**推荐**：Phase 1–2 不动 ASR，先把端点与轮转做对；Phase 3 引入 **SFSpeechRecognizer 作为可选流式 provider**（短轮次），长句与专名场景回落现有 batch。R2T2 只有在 §i-4 的许可问题拍板后才进入评估。

### d.2 TTS

| 方案 | 延迟 | 质量 | 成本 | 许可 | 离线能力 | 落地难度 | 结论 |
|---|---|---|---|---|---|---|---|
| **AVSpeechSynthesizer** | 本机实测 `didStart` 8.5–23.4 ms，**首个语音单元回调 570–820 ms**【已核实·本机】；真实可听起点待核实 | 系统中文语音，premium 档（本机已装 Linfei zh-CN premium）可用；自然度低于神经 TTS【设计判断】 | 零成本 | 系统 API | 语音为本地资源包；严格断网 A/B 未做【待核实】 | 低：原生桥接即可；支持 pause/stop、逐词 `NSRange` 回调【已核实】 | **Phase 1 首选**；570–820 ms 的首包是 M1 的主要成本，必须在 Phase 0 实测确认 |
| **Kokoro-82M** | 无 macOS CPU 实测 RTF【待核实】；社区称 M1 近实时【部分核实】 | 82M，中文需 `misaki[zh]`；自然度中等 | 零成本 | Apache-2.0【已核实】 | ONNX，q8 约 160 MB、int8 约 92 MB【部分核实】 | 中：需 ONNX Runtime 原生模块 | **L2 备选**（首包不够时替换） |
| **Confucius4-TTS（有道）** | 官方仅 CUDA；CPU 约 17× 慢于实时（二手）【待核实】；Apple Silicon 仅社区 MLX【部分核实】 | 1.3B，零样本克隆，14 语种 | 零模型费用 | HF 卡片 Apache-2.0，GitHub 元数据 NOASSERTION【部分核实】 | 无官方 GGUF；权重 3–5 GB | 高：无 macOS 官方路径 | **暂不接入**（见 §e） |
| **云 TTS**（Azure / 阿里 / OpenAI） | 第三方整段口径 363–2049 ms，非严格 TTFB【待核实】 | 自然度最好 | Azure Neural $15/1M 字符；阿里 CosyVoice ¥0.8–2/万字符【已核实】 | 商业条款 | 必须联网 | 低（HTTP） | **仅作显式 opt-in**，不能做默认 |

**推荐**：Phase 1 用 `AVSpeechSynthesizer`；若 Phase 0 实测首包 > 700 ms 且短句切分仍达不到 M1，则 L2 前替换为 Kokoro-82M 或原生 TTS 的更低延迟路径。云 TTS 只在用户显式开启"云端声音"时使用。

### d.3 LLM

| 方案 | 延迟 | 质量 | 成本 | 许可 | 离线能力 | 落地难度 | 结论 |
|---|---|---|---|---|---|---|---|
| **现有 llama-server 流式** | 已支持 `stream: true`（SSE）【已核实】；M4 Pro 上 Qwen3-0.6B decode 297 tok/s、3B 约 102 tok/s【已核实】；M1 Max 未实测【待核实】 | 现用 Qwen2.5-1.5B-Instruct Q4_K_M（`resources/llm-models.json:4-16`）【已核实】；对话质量明显弱于云端 | 零边际成本 | 依模型 | 完全离线 | 低：现有 sidecar 改 `stream:false → true` + 上下文管理 | **首选**（Phase 1–3） |
| **云端 API** | 网络 RTT 主导；公开 TTFT 未核【待核实】 | 最好 | 按 token 计费 | 商业条款 | 必须联网 | 低 | **显式 opt-in**；不作为默认 |

**推荐**：保留本地 sidecar 作为默认对话引擎，先把流式打开、把 2048 上下文管好；云端模型作为用户可选的"更强回答"，并沿用现有"不得静默上云"的约束。

---

## e) 有道开源模型整合评估

### e.0 先纠正三个预设（**与原始任务描述不符，必须写明**）

| 任务里的说法 | 实际事实 | 影响 |
|---|---|---|
| R2T2 是"语音识别/语音翻译"（原文模糊） | 是**真流式 ASR**（Real Real-Time Transcription），不是翻译【已核实】 | 落点明确：对应"流式 ASR"环节 |
| T3PO 是语音克隆/语音后训练 | 是**文本到文本的流式同声传译（SiMT）**，14.77B，基座 Qwen2.5-14B-Instruct【已核实】 | **与本产品没有直接落点** |
| "Confucius4" 是一个模型 | 至少三个不同模型共用前缀（R2T2 / T3PO / TTS），另有一个 27B 数学推理模型【部分核实】 | 引用时必须带完整后缀，不能统称 |

### e.1 逐模型判断

| 模型 | 对应本产品哪一环 | 判断 | 许可风险 | 运行时可行性 |
|---|---|---|---|---|
| **Confucius4-R2T2** | 流式 ASR（L2 的"首字"环节） | **并存为可选 provider，但需先拍板许可**（不进 Phase 3 默认） | 代码 Apache-2.0，**权重是网易有道模型使用协议**：上一自然月 MAU > 1 亿或上一自然年营收 > 10 亿元人民币须另行取得书面商业许可；**禁止用其或其衍生作品改进任何其他 AI 模型**（例外仅限自身衍生的非商业模型）【已核实·MODEL_LICENSE】 | 2.04B；官方 GGUF Q4_K_M ≈1.0–1.4 GB、Q8_0 ≈1.7–2.5 GB（各仓口径不一）【部分核实】；llama.cpp **主线无支持**，C++ 侧依赖第三方 `audio.cpp`；仓库最后 push 2026-09-24、无 release【部分核实】；M 系列实时性无公开数据【待核实】 |
| **Confucius4-TTS** | TTS（L1/L2 的出声环节） | **暂不接入** | HF 卡片标 Apache-2.0、无阈值条款，但 GitHub 元数据为 NOASSERTION、权重许可未单独声明【部分核实】；另涉及"语音克隆"的声音权问题 | 1.3B；官方要求 Python 3.10 + CUDA 12.6；**无官方 GGUF**，社区 GGUF 只服务 CrispASR/audio.cpp 专用后端；CPU 推理约 17× 慢于实时（二手）【待核实】；Apple Silicon 仅社区 MLX 移植【部分核实】；磁盘 3–5 GB（不含厂商口径的 54 GB 资源包）【部分核实】 |
| **Confucius4-T3PO** | **无对应环节**（它是文本同传） | **暂不接入** | Apache-2.0（代码与权重），无阈值；但需同时遵守 Qwen2.5 基座许可【部分核实】 | 14.77B；官方 GGUF F16 29.5 GB / Q6_K 12.1 GB / Q5_K_M 10.5 GB；llama.cpp 可跑（架构 `qwen2`）【部分核实】；必须按其 `<STREAMING_HISTORY>` 协议输入 | 

**若未来做"实时翻译通话"**，T3PO 才成为候选；当前产品定义里没有这一环，写进 §j 之外的产品路线即可，不进本期。

### e.2 许可风险的具体含义（不要把它简化成"能不能商用"）

1. **阈值条款不影响当前规模**：1 亿 MAU / 10 亿元营收对当前项目是远期风险，不是当下阻塞项。但一旦商业化成功，需要重新谈判——这是**成功之后的成本**，要提前记在案。
2. **"禁止改进其他模型"才是真正的雷**：如果用 R2T2 的输出做数据、去微调纠错模型或训练热词模型，就落入该条款。这意味着**不能把 R2T2 当成"数据源"**，只能当推理 provider 用。
3. **代码与权重不同许可**：可以在 Apache-2.0 代码上做集成，但分发权重（或打包进 app）要遵守网易协议，且必须保留声明并约束下游。**本产品如果把权重打进 DMG，就是再分发**，必须做合规审查。
4. **Confucius4-TTS 的元数据不一致**（HF Apache-2.0 vs GitHub NOASSERTION）本身就是风险信号：在拿到明确的权重许可文本前，不打包分发。

### e.3 运行时可行性结论

- **能跑 ≠ 能实时**：R2T2 的 2.04B + GGUF 在内存上没问题（Q4_K_M 1–1.4 GB），但 llama.cpp 主线不支持，第三方 `audio.cpp` 的维护活跃度与 M 系列性能都没有公开证据。
- **TTS 在 macOS 上没有官方路径**，CPU 实时无证据；这是"暂不接入"的决定性理由，而不是许可。
- **T3PO 的 14.77B 在 32 GB 机器上 Q5_K_M + 8k 上下文约 13–15 GB 常驻**，对桌面 app 是不可接受的常驻成本。

---

## f) 延迟预算表

### f.1 预算（目标 L2：P50 ≤ 1.2 s）

| 环节 | 预算 | 现有手段 | 来源 / 依据 | 是否硬瓶颈 |
|---|---|---|---|---|
| 端点检测（判停） | 250 ms | VAD `minSilenceMs` 现为 400 ms（`src/core/audio/vad.ts:36-44`），可下调到 250–350 | 仓库代码【已核实】 | 否（可调） |
| ASR 首字（partial） | 300 ms | 现有 provider `streaming:false`，**做不到** | `sensevoice-provider.ts:40`、`qwen3-provider.ts:18`【已核实】 | **是（前提缺失）** |
| ASR 终稿确认 | 150 ms | 现有为一次性 CLI spawn，每次写临时 WAV 再跑（`cli-runner.ts:286`） | 仓库代码【已核实】 | **是** |
| LLM 首 token | 150 ms | llama-server 已支持 SSE；0.6B 级 decode 数百 tok/s、512 token prefill 约 100 ms（M4 Pro） | 【已核实】 | 否（可达成） |
| TTS 首包 | 250 ms | `AVSpeechSynthesizer` 本机实测首单元回调 **570–820 ms** | 本机实测【已核实】 | **是（实测超标 2–3 倍）** |
| 播放启动 | 50 ms | AudioWorklet 128 帧（44.1 kHz ≈2.9 ms） | 【已核实】 | 否 |
| **合计** | **1 150 ms** | | | |

### f.2 硬瓶颈判定

1. **TTS 首包（570–820 ms，实测）** 是最大单项，且它不在我们完全可控的范围（系统 TTS 的调度与句首处理）。
2. **ASR 终稿**：现有链路是"一次性 CLI + 临时 WAV"，无法贡献 partial；这是架构性成本，不是参数问题。
3. 端点检测可以调，但**每一毫秒都在和"把用户换气当成说完"对赌**——`minSilenceMs` 从 400 降到 250 会显著提高"抢话"概率（见附录 A 路径 1 失败模式 1）。

**结论**：在**不改 ASR 运行时、不换 TTS**的前提下，L1 的 P50 现实区间是 **1.6–2.2 s**，可以宣布"对讲机级可用"，但**不能宣布"电话级"**。L2 的 1.2 s 必须先解决 ASR 首字（流式）与 TTS 首包（换引擎或短句切分）。

### f.3 降级决策规则（硬规则，写进验收）

| 条件 | 决策 |
|---|---|
| `端点 + ASR 终稿` 实测 P50 > 1.0 s | 只交付 L1，界面不得出现"实时对话"字样 |
| TTS 首包实测 > 500 ms 且短句切分后仍 > 400 ms | L2 前替换 TTS（Kokoro/原生低延迟路径），否则停在 L1 |
| barge-in 误触发率实测 > 10% | **关闭自动打断**，退回"停止词 + 热键"，对外只宣称 L1 |
| 打断后重述率 > 25% | 检查预录缓冲与队列裁剪；仍超标则退 L1 |
| 连续 10 轮出现上下文断裂 | 引入滚动摘要，并把"不间断"改为"每 6 轮摘要一次" |
| 三种音频路由中任一路由回声误触发 > 20% | 该路由强制 L1（界面提示"此设备为半双工"） |

---

## g) 分阶段交付

每阶段都有：工期、验收数字、可回退点、门禁。**门禁不过，不进入下一阶段。**

### Phase 0 · 延迟实测（只测不改代码）｜1 周

- 内容：用 20 段真实双人对话录音跑"端点 → ASR 终稿 → LLM 首 token → TTS 首包 → 播放"；三种路由（内置扬声器 / 有线耳机 / 蓝牙）各测一遍；记录 P50 / P95。
- 验收：产出一张实测表，字段与 §f.1 一致；至少 20 段 × 3 路由。
- 回退点：无代码改动，无回退成本。
- 门禁：**没有实测表就不进入 P1**。禁止用"估计值"代替。

### P1 · 半双工（L1）｜2–3 周

- 内容：`ConversationController`（core 纯状态机）+ `SpeechSynthesisPort`（AVSpeechSynthesizer 实现）+ 现有 ASR / sidecar；对话入口与"挂断"。
- 验收：M1 满足 L1 可用线（P50 ≤ 2.0 s、P95 ≤ 3.0 s）；10 轮不崩溃；听写与对话互不抢麦。
- 回退点：功能开关关闭后完全回到现有听写体验（新代码不进入现有 session 状态机）。
- 门禁：M1 不达标 → 不进入 P2（先做 TTS 替换或端点优化）。

### P2 · 自动打断（L2）｜2–3 周

- 内容：播放感知 VAD + 300 ms 预录缓冲 + 可取消 TTS 队列 + `INTERRUPT_CANDIDATE` 状态。
- 验收：M3 ≤ 300 ms；M4 ≤ 10%（先按宽松线）；外放/耳机各 50 次打断测试；M6 ≤ 10%。
- 回退点：打断策略做成偏好项，默认自动、可切"仅停止词"；关闭后等价 P1。
- 门禁：M4 > 10% 或外放路由出现自激 → 停在 P1，不发布 L2。

### P3 · 连续多轮与记忆｜3–4 周

- 内容：上下文预算（现有 2048）、滚动摘要、打断后历史裁剪、可选流式 ASR（SFSpeechRecognizer）。
- 验收：M5 ≥ 10 轮；M2 ≤ 500 ms（若引入流式）；长对话 30 分钟无内存持续增长。
- 回退点：上下文策略做成"每 N 轮摘要"的可配置项；关闭摘要回到短会话。
- 门禁：出现"忘了上一轮"的可见案例 ≥ 2 次 → 不宣称连续对话。

### P4 · 接 agent 能力｜4 周+

- 内容：工具调用、任务型动作、与 V0.2 的 typed/hold 确认对齐。
- 验收：**高风险动作必须保留 typed/hold 确认**（见 §h）；语音只用于低风险确认。
- 回退点：agent 能力独立开关。
- 门禁：任一高风险动作可以绕过 typed/hold → 阻塞发布。

---

## h) 风险与安全

### h.1 常驻麦克风的可见性与"挂断"

| 要求 | 落地方式 |
|---|---|
| 常驻状态可见 | menubar 图标 + 对话窗口常驻"正在听"指示；**不得只靠语音提示** |
| 一键挂断 | **Esc**（对话窗口聚焦时）、**全局热键**、**menubar 菜单项**三种中至少实现两种；Esc 必须可用 |
| 超时 | 静默 N 分钟后自动挂断（N 可配置，默认 5 分钟） |
| 权限 | 首次进入对话模式时申请麦克风；`NSSpeechRecognitionUsageDescription` 等缺失会导致直接崩溃（Apple 文档）【已核实】，必须在打包阶段验证 |

### h.2 语音确认的边界

- **语音确认不得用于高风险动作**（转账、删除、发送对外消息、安装/执行命令等）。
- V0.2 设计的 typed/hold 确认**必须保留**。**注意：该机制在当前代码中尚不存在**，只存在于设计文档（`docs/V0.2-SPEAKPILOT.md:431,573,943,1005`）；实现 P4 之前，任何"语音 agent 能执行动作"的能力都不得上线。
- 语音识别的幻觉（ASR 把背景音转成文本）会直接变成"用户说了某句话"，这是对话产品的独有风险：**任何由语音触发的动作都要二次确认或可撤销**。

### h.3 本地优先与云端开关

- 默认全本地：ASR、LLM、TTS 均不出设备。
- 云端能力必须**逐项显式开启**（不是全局一个开关），并在界面上持续显示当前链路（"本地 / 云端"）。
- 切换云端的提示必须写明"音频将离开本设备"。
- 不得静默回退：云端失败 → 明确提示并询问是否切回本地，而不是悄悄切。

### h.4 模型体积与内存

| 项 | 量级 | 依据 |
|---|---|---|
| 现有 ASR 模型 | 已在用 | 仓库 |
| 对话 LLM（1.5B Q4_K_M） | 约 1 GB 级 | `resources/llm-models.json` |
| 若引入 R2T2 Q4_K_M | +1.0–1.4 GB | 【部分核实】 |
| 若引入 Confucius4-TTS | +3–5 GB | 【部分核实】 |
| 若引入 T3PO Q5_K_M | +10.5 GB（且常驻 13–15 GB） | 【部分核实】 |

**结论**：任何"再加一个 1B 以上模型"的决定都要先算常驻内存；一台 16 GB 的 Mac 不应同时常驻 ASR + 对话 LLM + 1.3B TTS。

### h.5 与听写模式抢麦

- 复用现有采集链路时，两条 profile 的切换必须由 `main` 裁决（§c.5）；renderer 不得自行 `getUserMedia`。
- 蓝牙耳机路由切换会导致采集流中断：必须监听 `devicechange` 并重建，且 UI 要显示"正在恢复"。
- 现有听写的快捷键行为**不得改变**（这是已发布能力）。

### h.6 真机与 E2E 验证缺口

- 现有 E2E 为 Playwright Electron；真机 AX/热键用例默认跳过，需显式环境变量（`docs/REAL-MACHINE-CHECKS.md:4-5,7`）。
- **2026-11-19 的记录是 5 项真机检查全部 blocked、无一执行**（`docs/REAL-MACHINE-CHECKS.md:18,22-36`）。
- 因此本规划的 P1–P2 验收**必须包含真机项**（AEC/回声/打断只能在真机、真扬声器上测），不能只用 fake provider 的单测证明。这是本规划最大的验证风险。

---

## i) 待用户拍板清单

> 每条给选项与代价，附推荐；**不替用户决定**。

1. **"像打电话"的定义是否接受为"低延迟轮转 + 随时可打断"？**
   - A. 接受（L1/L2 为目标，L3 只定义）｜代价：承认做不到"双方同时说话"
   - B. 必须真全双工｜代价：需要 AEC + 双工模型，工期与风险大幅上升，可能逼向云端
   - 推荐：A

2. **对话模式如何进入？**
   - A. 显式热键/按钮进入，退出即释放麦克风｜代价：多一步操作
   - B. 常驻监听 + 唤醒词｜代价：与 V0.2 非目标冲突，隐私风险
   - C. 进入即常驻，靠超时挂断｜代价：麦克风长期占用
   - 推荐：A

3. **是否引入云端 phone mode（显式 opt-in）？**
   - A. 不引入｜代价：自然度与打断能力上限低
   - B. 引入，逐项开关 + 常显链路状态｜代价：隐私承诺复杂化、成本
   - 推荐：A（先不做，留接口）

4. **是否接受 R2T2 的权重许可？**
   - A. 接受（当前规模未触发阈值）｜代价：禁止用其输出改进其他模型；商业化后需重谈；打包即再分发
   - B. 不接受，只用 Apache-2.0 模型｜代价：放弃最贴合中文实时流的候选
   - C. 只做本地实验，不分发权重｜代价：无法进产品
   - 推荐：C 或 B（不建议直接 A 打包分发）

5. **TTS 音色：系统音色 vs 语音克隆？**
   - A. 系统音色（AVSpeechSynthesizer premium）｜代价：自然度一般
   - B. 自托管克隆（Confucius4-TTS）｜代价：macOS 无官方路径、许可元数据不一致、声音权风险
   - 推荐：A

6. **对话 LLM 用本地还是云端？**
   - A. 本地 1.5B 流式（默认）｜代价：回答质量有限
   - B. 云端（opt-in）｜代价：联网、计费、隐私
   - 推荐：A + B 可选

7. **打断默认策略？**
   - A. 自动打断（L2）｜代价：误触发风险
   - B. 仅停止词/热键（L1+）｜代价：打断不够自然
   - 推荐：A，但保留 B 作为一键降级

8. **对话历史留存多久？**
   - A. 仅内存，挂断即弃｜代价：无法回看
   - B. 本地持久化 N 天｜代价：隐私面扩大
   - C. 全程持久化｜代价：磁盘与隐私
   - 推荐：B（默认 7 天，可一键清除）

9. **是否接受新增原生模块（Swift/ObjC 桥）？**
   - A. 接受（SFSpeechRecognizer / AVSpeechSynthesizer / VPIO 都需要）｜代价：打包与签名复杂度上升
   - B. 只用 Web API｜代价：拿不到系统 TTS 与 VPIO，L2 基本不可行
   - 推荐：A

10. **Phase 0 的 20 段录音从哪来？**
    - A. 用现有历史录音拼接｜代价：不一定覆盖双人对话
    - B. 重新采集（需要真人配合，涉及隐私授权）｜代价：时间与授权
    - 推荐：B（明确授权后采集，且只在本机处理）

11. **是否允许"对话模式"改变默认听写行为？**
    - A. 完全不影响｜代价：两套 profile 的维护成本
    - B. 对话模式临时改变听写参数（如更短端点）｜代价：行为不一致
    - 推荐：A

12. **`docs/LLM-POSTPROCESSING.md` 等三处文档与代码不一致，先修文档还是先做产品？**
    - A. 先修文档（小）｜代价：占用半天
    - B. 并行，由产品改动顺带修｜代价：新读者仍会踩坑
    - 推荐：A

---

## i.1 决策记录（2026-11-20 用户拍板）

以下 12 条为 2026-11-20 用户逐条拍板的结果，编号与上一节原清单一致，照原样记录，不再改写或重新解读。

1. **选项 A** —— 接受"低延迟轮转 + 随时可打断"作为 L1/L2 的目标，L3 只定义不实现。
2. **选项 A** —— 对话模式由显式热键/按钮进入，退出即释放麦克风。
3. **选项 A** —— 本期不引入云端 phone mode，只保留接口。
4. **选项 C** —— R2T2 权重仅用于本地实验，不打包分发、不进产品。
5. **选项 A** —— TTS 使用系统音色（AVSpeechSynthesizer premium），不接语音克隆。
6. **选项 A（默认）+ B（可选）** —— 对话 LLM 默认本地 1.5B 流式，云端仅在用户显式开启时可用。
7. **选项 A** —— 默认自动打断（L2），并保留"仅停止词/热键"作为一键降级。
8. **选项 B** —— 对话历史本地持久化 7 天，可一键清除。
9. **选项 A** —— 接受新增 Swift/ObjC 原生模块（SFSpeechRecognizer / AVSpeechSynthesizer / VPIO）。
10. **选项 B** —— Phase 0 的 20 段对话录音需重新采集（真人配合、明确授权、只在本机处理）。
11. **选项 A** —— 对话模式完全不影响听写默认行为，两套采集 profile 各自独立。
12. **选项 A** —— 先修三处文档与代码不一致，再做产品。

---

## j) 与 demo.3（undo-caret-guard）的优先级关系

**建议：先做 demo.3，再做 SpeakPilot 的 Phase 0。**

理由：
1. **demo.3 保护的是已发布的主路径**。听写是当前唯一在用的能力，撤销/光标保护是可感知的正确性问题；对话是新增面，不修不影响现有用户。
2. **demo.3 规模小、验证路径确定**（可单测 + 真机），而 SpeakPilot 的 Phase 0 需要录音素材与真机音频实验，前置条件更多。
3. **两者不共享代码面**：demo.3 在 `src/core/injection/undo.ts` 一带，SpeakPilot 是新增会话层；串行不会造成返工。
4. 若确实要并行：demo.3 放在主线，SpeakPilot 只做 Phase 0（只测不改码），不进入 P1。这样不违反"同一时间只维护一条主链路"。

**不替用户决定**：如果你更看重"第二个产品的可见进展"，可以把 SpeakPilot Phase 0 提到 demo.3 之前——代价是撤销缺陷多存在一段时间。

---

## 已知不确定项

### 外部事实（未核到 / 只到二手）

1. SFSpeechRecognizer 的中文首次 partial 延迟（无公开实测，本机也未测）。
2. `requiresOnDeviceRecognition` 的默认值（Apple 文档未明写）。
3. 云 TTS 的官方首包延迟（只有第三方整段口径数据，363–2049 ms）。
4. OpenAI TTS 官方按字符价格（官方页 403）。
5. Kokoro / Piper 在 macOS arm64 CPU 上的具体 RTF。
6. Confucius4-TTS 在 Apple Silicon 上的实时性（无公开数据）。
7. R2T2 在 M 系列上的端到端服务延迟（论文只给音频时间轴发射延迟，不含服务与排队）。
8. llama.cpp 官方 TTFT 基准（只有 `timings` 字段与可换算的 prefill 吞吐）。
9. barge-in 的行业统一误触发率基线（各厂商口径不一）。
10. AVSpeechSynthesizer 严格断网可用性（未做断网 A/B）。
11. 有道三模型的精确发布日与 GitHub 活跃度（多源冲突破，且为聚合站快照）。
12. `ggml-org/llama.cpp` 主线是否存在 R2T2 的 PR/issue（未搜到，现有证据指向 `audio.cpp`）。

### 仓库事实（文档与代码不一致，未自行调和）

1. `docs/LLM-POSTPROCESSING.md`（2026-10-26）称"本地 LLM 推迟、不捆绑模型"（407-411,444-445,474），但代码已内置 llama-server + Qwen2.5-1.5B（`src/main/llm/sidecar.ts`、`resources/llm-models.json:4-16`）——**文档已过时**。
2. `docs/AUDIO-PIPELINE.md` 推荐 Silero VAD（32 ms 帧），代码实为能量 RMS VAD（20 ms 帧，`src/core/audio/vad.ts:1-6,36-44`）。
3. `docs/V0.2-SPEAKPILOT.md:17,1171` 称"docs-only、无应用代码"，与仓内现有 `src` 实现不符（时间性陈旧）。
4. V0.2 的 typed/hold 确认**只存在于设计文档**，代码中不存在（`src` 全局检索无确认 UI/门控）。

### 本机测量环境

macOS 27.2.1（Build 26B131），Apple M1 Max / 32 GB，2026-11-20。本机数字只代表该机型，不外推。

---

## 自检清单

- [x] a) 三级体验定义 + non-goals
- [x] b) 量化门槛（M1–M7，各给可用线/不可用线/依据）
- [x] c) 架构与 4 个端口草案 + 两套采集 profile + 抢麦规则
- [x] d) 三张选型表（ASR / TTS / LLM，6 维度）
- [x] e) 有道三模型逐条评估（含许可与运行时，外部事实带链接与检索日期）
- [x] f) 延迟预算表 + 硬瓶颈 + 降级规则
- [x] g) Phase 0–4（工期/验收/回退点/门禁）
- [x] h) 风险与安全（常驻麦克风、语音确认、本地优先、内存、抢麦、验证缺口）
- [x] i) 待拍板清单 12 条，带选项与代价与推荐
- [x] j) 与 demo.3 的优先级（给建议，不替决定）
- [x] 两张表齐备（§f.1 延迟预算表、§d.1–d.3 选型表）
- [x] 外部事实标来源与检索日期，未核到标"待核实"
- [x] 发散过程原样进附录 A
- [x] 未改任何代码（`git status` 仅新增本文件，见交付报告）

---

# 附录 A · 脑暴发散过程（原样保留）

> 本节由脑暴发散环节产出，保留全部发散痕迹、淘汰理由与冲突点，**不是结论摘要**。

## A.0 发散的输入：仓库事实基线

| 事实 | 证据 |
|---|---|
| 采集是 renderer Web Audio：16 kHz、20 ms Int16 批次，AEC/NS/AGC **显式关闭** | `src/renderer/src/App.tsx:79`、`src/core/capture/capture-controller.ts` |
| VAD 是能量阈值，**不是流式 endpointing**；默认 `minSilenceMs=400` | `src/core/audio/vad.ts` |
| ASR 是 CLI 一次性转写：写临时 WAV → 子进程 → final 文本；全部 `streaming: false`；SenseVoice 30 s 上限 | `src/main/asr/cli-runner.ts`、`src/core/asr/types.ts` |
| 会话是单次听写状态机：`idle/recording/transcribing/pasting/error` | `src/core/session/session-controller.ts` |
| LLM 是 llama-server，**只做封闭动作纠错**，单轮、无对话历史、context 2048 | `src/main/llm/sidecar.ts`、`src/core/llm/decision.ts` |
| 输出只有文本注入；**没有任何音频播放/TTS 路径** | `src/main/injection.ts` |
| 延迟目标：说完到 final p50 ≤ 1.5 s、p95 ≤ 3 s | `docs/ARCHITECTURE.md` |
| 产品约束：本地优先；v0.2 非目标含 always-on listening；不得静默上云 | `docs/V0.2-SPEAKPILOT.md` |

一句话：**现有仓库是"说完再转写"的单次管道，没有流、没有播放、没有回合、没有对话记忆。**

## A.1 发散方法

### A.1.1 把"像打电话"拆成四个可观测维度

1. **回合所有权**：谁在什么时候拥有话筒（按键 / VAD 判停 / 服务端 VAD / 持续双工）。
2. **双工性**：系统说话时，用户的声音还能不能被听见（不能 / 只能打断 / 完全同时）。
3. **首响延迟**：用户停止说话到系统第一个音（对讲机约 1–3 s，电话约 200–500 ms）。
4. **可打断性**：用户中途插话，系统多快停下、能不能接住第一个字。

关键判断：**电话不是"同时说话"，而是"极低延迟的轮转 + 随时可打断"。** 真正的同时说话（overlap）在助手场景里价值有限，却会把 AEC 和模型要求推到最高。

### A.1.2 枚举自由度

- 采集：renderer Web Audio（现状）/ Swift AVAudioEngine / WebRTC 云链路 — 3
- ASR：非流式 CLI / 本地流式 / 云端流式 / 端到端 S2S — 4
- TTS：无 / 系统 AVSpeechSynthesizer / 本地神经 TTS / 云端 TTS — 4
- 回合：按键 / VAD 判停半双工 / 保守双工 / 真全双工 — 4

理论组合 3×4×4×4 = 192。用四条硬约束剪枝：

- **隐私/本地优先**：默认路径不得静默上云。
- **契约可渐进**：不能要求一次性换掉 ASR + TTS + LLM 三条契约。
- **macOS 平台能力**：AEC 可用但不可靠，不能作为默认前提。
- **单人可维护**：同一时间只能维护一条主链路。

### A.1.3 被淘汰的分支（发散痕迹，不删）

| 分支 | 淘汰理由 |
|---|---|
| 纯文本、不做 TTS | 违背"打电话"的核心：没有声音往返，只是语音输入框 |
| 唤醒词常听 | v0.2 明确 non-goal（always-on listening） |
| 第三方 voice agent 平台（Vapi/Retell 等） | 音频、上下文、计费全部外包，隐私冲突最大且供应商锁定；只在"最快验证市场"时考虑，不作架构 |
| 手机当麦克风 | v0.1 明确 out of scope |
| 真·全双工（双方同时说话） | 需要 AEC + 全双工模型；交互上也不是电话的真实模型；只作为路径 3 的子能力保留，不单列 |
| 只把 ASR 换快、TTS 仍整段朗读 | 首响变快，但"打断"体验没解决；归入路径 2 的中间态 |

保留下来的五条，形状彼此不同，不是同一路径的参数微调。

## A.2 五条路径

### 路径 1：快速轮转半双工

**一句话**：把"打电话"降级成"对讲机式的快速轮转"——VAD 判停 → 一次性 ASR → LLM → 整段 TTS，把回合间隙压到 1.5 s 内。

**关键机制**

| 环节 | 做法 |
|---|---|
| 采集 | 复用现有 renderer；TTS 播放期间不采集（半双工）；VAD 沿用能量 VAD，`minSilenceMs` 从 400 ms 调到 250–350 ms |
| ASR | 沿用 SenseVoice/Qwen3 CLI 整段转写；长句复用现有分段器；不引入 partial |
| TTS | 新增。第一版用 macOS `AVSpeechSynthesizer` 或 `say`；LLM 出完整句就送 TTS，不等整段回答 |
| 回合 | 显式状态机 `LISTENING → THINKING → SPEAKING → LISTENING`；SPEAKING 期间麦克风关闭或只监听停止键；不支持语音打断 |

**最坏情况**：用户听完一段 30 秒的长回答，中途想纠正，但麦克风在 TTS 期间是关的，只能等整段说完或找停止键；更糟的是用户换气停顿 500 ms 被 VAD 判停，系统抢答，用户后半句被当成新问题，两个回答互相矛盾。

**失败模式**

1. 用户换气停顿 500 ms 被判停，系统抢话；用户接着说，系统把后半句当新回合，前后回答矛盾。
2. 键盘/风扇/电视噪声越过 VAD 阈值，ASR 返回空文本或幻觉句，TTS 对幻觉内容朗读。
3. 长回答播放 20 s，用户想打断但麦克风关着，只能等结束，体验像听录音。
4. 用户说完等 2 s 没回应，以为没听到，重复一遍；系统把两遍都转写并回答两次。
5. 蓝牙耳机/默认设备切换，采集流中断，状态卡在 THINKING，用户不知道要重新按。
6. SenseVoice 30 s 上限截断长句，后半句静默丢失，UI 没有提示。

**侵入程度**：低–中。现有 ASR/采集契约不改；新增 TTS 播放、`ConversationController`、新 IPC 与会话状态。**纯新增 shell + 新增 core 模块，不改现有契约。**

**只能做一件事验证可行性**：端到端测"用户停止说话 → TTS 第一个音"的 p50/p95。用 20 段真实双人对话录音跑 VAD+ASR+LLM+TTS。

### 路径 2：本地流式 ASR + 流式 LLM + 流式 TTS 全流水线

**一句话**：把采集、ASR、LLM、TTS 全部改成流式，用 partial 和 token 流把首响压到 500 ms 内，回合管理从"等 final"变成"边听边想边说"。

**关键机制**

| 环节 | 做法 |
|---|---|
| 采集 | 保持 16 kHz，但增加 ring buffer 和 VAD 事件流；若要双工，还需 AEC 或回声参考 |
| ASR | 换流式 ASR（sherpa-onnx / FunASR / 系统 Speech），partial + endpoint 事件；final 只做一次确认 |
| TTS | 流式 TTS，按短语切分，边生成边播 |
| 回合 | 基于 partial 的"提前思考" + endpoint 的"提交"；TTS 可被 barge-in 中断 |

**最坏情况**：用户在嘈杂环境说"我想订明天下午三点的会议室"，流式 ASR 先出"我想定明天下午三点"，LLM 已开始生成"好的，帮你订明天下午三点"；用户接着说"不对，是后天"，此时错误回答已播出一半。同时 CPU 被 ASR+LLM+TTS 三路争用，TTS 断续。

**失败模式**

1. partial 抖动导致 LLM 基于错误意图提前生成；final 纠正后回答已出口，无法回收。
2. ASR/LLM/TTS 三路争用 GPU/CPU，音频 callback 饿死，TTS 爆音、ASR 丢帧。
3. 逐 token 送 TTS 导致韵律破碎；等整句再合成则首字延迟反而变大。
4. TTS 被 barge-in 停止后，已合成未播的队列与文本不同步，恢复时重复或跳句。
5. 流式 ASR 的 endpoint 不稳定：太晚则回合卡住，太早则半句 final。
6. 本地流式中文模型对专名/中英混说准确率低于 SenseVoice。

**侵入程度**：高。需换 ASR 契约、新增流式 TTS、新增对话 LLM 协议；采集链路可能需改为 Swift `AVAudioEngine`。

**只能做一件事验证可行性**：在目标 Mac 上同时跑 streaming ASR + llama-server + TTS，测 partial 稳定延迟、端到端首响、30 分钟连续运行的丢帧/爆音率。

### 路径 3：云端实时语音 API 为主（端到端 speech-to-speech）

**一句话**：把整条语音链路交给端到端 S2S API，本地只做采集、播放和 UI，用供应商的 server VAD 和 barge-in 直接买"电话感"。

**关键机制**

| 环节 | 做法 |
|---|---|
| 采集 | WebRTC 或 WebSocket 音频流；AEC 由 WebRTC/供应商处理 |
| ASR | 供应商内置（无独立 ASR） |
| TTS | 供应商内置（同一模型直接出音频） |
| 回合 | 供应商 server VAD + 客户端 barge-in |

**最坏情况**：用户在弱网里说了一句敏感内容，音频上行卡顿，模型只听到半句并给出错误回答；同时这段音频已经离开设备，而用户以为"本地优先"仍然成立。

**失败模式**

1. 网络抖动 200–500 ms，上行断句，回答答非所问。
2. 云端 VAD 把电视/旁人说话当用户。
3. 服务端 barge-in 延迟 300–800 ms，用户打断后模型还在说。
4. 断线重连丢上下文，模型问"我们刚才说到哪"。
5. 隐私承诺被破坏：音频离开设备。
6. 成本与配额：长通话按音频分钟计费，忘记挂断导致账单飙升。
7. 供应商区域/限流不可用，没有本地降级。

**侵入程度**：中–高。需新增 WebRTC/WS 音频链路、云端会话、计费/隐私控制；采集从"本地 PCM 批次"变成"实时音频轨道"。

**只能做一件事验证可行性**：同一网络下用 WebRTC 连测 50 轮，测"用户停止 → 首个音频包"与"打断 → 音频停止"的 p50/p95，再做 Wi-Fi/热点切换测试。

### 路径 4：混合——本地端点 + 云端或本地按网络与隐私切换

**一句话**：默认走本地快速轮转，网络好且用户允许时升级到云端实时 S2S；用同一个回合管理器和同一份会话上下文。

**关键机制**：两套采集、两套 ASR、两套 TTS、路由器、上下文同步、隐私指示器。

**最坏情况**：Wi-Fi 切到热点，音频断 2 秒；本地降级冷启动 3 秒，用户对着麦克风说了三句没人应；恢复后云端会话超时，上下文只剩一半。

**失败模式**

1. 网络切换瞬间音频断裂 1–2 s。
2. 本地/云端上下文不互通，切换后模型不记得上一轮。
3. 路由判定错误：隐私场景走了云。
4. 两套 TTS 音色不同，切换时声音突变。
5. 本地模型冷启动 2–5 s，切换时无人应答。
6. 云端失败静默回退本地，用户不知道音频去了哪。

**侵入程度**：最高。两套采集、两套 ASR、两套 TTS、路由器、上下文同步。

**只能做一件事验证可行性**：通话中强制把网络从 Wi-Fi 切到热点，测断裂时长、上下文恢复率、用户能否从 UI 判断当前链路。

### 路径 5：双工但保守——TTS 期间半静音 + 仅高置信度 barge-in

**一句话**：不追求"同时说话"，只追求"随时能打断"：TTS 播放时把麦克风降为"打断监听"模式，只有持续、近场、高于回声门限的语音才触发停止。

**关键机制**

| 环节 | 做法 |
|---|---|
| 采集 | 主路径仍是现有 renderer；新增"播放参考"分支，用播放感知 VAD + 自适应门限；可选软件回声消除 |
| ASR | 打断检测不需要转写，只用 VAD/能量/近场特征；确认打断后再对"预录 300 ms + 后续"做一次 final ASR |
| TTS | 可取消的短语队列；barge-in 候选时 duck 到 20–30%，确认后 100–200 ms 内硬停 |
| 回合 | 状态机 `LISTENING / USER_SPEAKING / THINKING / ASSISTANT_SPEAKING / INTERRUPT_CANDIDATE / INTERRUPTED`；TTS 期间不关麦，但提高判定门槛；打断后保留预录 |

**最坏情况**：用户用扬声器外放，TTS 声音被麦克风收进去，打断检测器把自己的声音当成用户，TTS 说半句就停，然后系统以为用户在说话，形成"自问自答"的死循环。

**失败模式**

1. 自激：TTS 被自己的声音触发，说半句就停；或 duck 后恢复，反复抖动。
2. 漏检：用户轻声/远场说"等一下"，阈值太高，打断无效。
3. 误检：用户咳嗽/键盘/旁人说话触发停止，冷场。
4. 预录没做好，用户打断的第一个字被 TTS 尾音盖住。
5. duck 后没恢复，后续回答一直很小声；或恢复时爆音。
6. 耳机/扬声器路由变化导致回声路径突变，自适应门限失效。
7. 用户在 TTS 最后一个字打断，TTS 已播完但状态仍是 SPEAKING，回合错位。

**侵入程度**：中。在路径 1 基础上新增 TTS 播放与取消、播放参考/回声门限、INTERRUPT 状态、预录缓冲；**需改 core 会话契约（新增会话状态机），采集链路小改，ASR/TTS 契约可复用**。

**只能做一件事验证可行性**：真实 Mac 扬声器外放、50 cm 距离，播放 TTS 的同时说"等一下"，各做 50 次，测漏检率与误检率；再用耳机重复一遍。

## A.3 收敛：1 条主线 + 1 条备选

### 主线：路径 5，第一阶段就是路径 1

**为什么是它**

1. 直接命中"像打电话"的可感知核心：**低延迟 + 可打断**，而不需要先解决 AEC。
2. 不破坏本地优先与隐私，不把网络变成产品前提。
3. 复用现有 ASR/采集契约，改动集中在新增会话层和 TTS 层。
4. 给路径 2 的流式升级留了同一个回合管理器。
5. 有一个清晰、便宜、可证伪的验证实验（barge-in 漏检/误检）。

**为什么不选路径 2 作主线**：流式解决的是"更快"，不是"可打断"；它不解决双工，且一次性换掉三条契约，风险太高。

**为什么不选路径 3/4 作主线**：它们是"电话感"最强的，但把隐私和网络依赖变成产品前提。

**放弃其他路径的代价**

- 放弃路径 2：首响可能停在 1.0–1.8 s，达不到真电话的 300–500 ms。缓解：第二阶段先换 streaming ASR。
- 放弃路径 3：失去供应商的端到端韵律与打断能力。缓解：保留 opt-in 的"云端电话模式"。
- 放弃路径 4：少一层双栈复杂度和隐私模糊；代价是无法覆盖"网络好时想要更自然"的用户。

### 备选：路径 4（混合），以路径 3 为 "phone mode"

**为什么是它**：如果实测发现本地 ASR/TTS 的首响和自然度就是达不到"电话"门槛，云端 S2S 是唯一能快速补齐的路径；混合架构让本地仍是默认、云端是显式 opt-in。

**代价**：双栈维护、上下文同步、路由判定、隐私指示器；任何一处做不好，体验比纯本地更差。

### 推荐演进顺序

1. **Phase 0 验证**：路径 5 的 barge-in 实验 + 路径 1 的端到端延迟实验。
2. **Phase 1 MVP**：路径 1 快速轮转 + 整段 TTS + 保守打断（只支持停止词/按键）。
3. **Phase 2**：自动 barge-in（播放感知 VAD + 预录）。
4. **Phase 3**：streaming ASR，回合管理器不变。
5. **Phase 4**：streaming TTS / streaming LLM；或按实测决定是否引入云端 phone mode。

## A.4 冲突点（原样保留，未做调和）

1. **"像打电话" ≠ 必须全双工。** 如果 owner 坚持"双方同时说话"，路径 1/5 不满足，必须走路径 2+硬件 AEC 或路径 3。
2. **macOS AEC 可用但不可靠，且与现有决定直接冲突。** 本仓库已显式关闭 AEC（`App.tsx:79`）以保 ASR 质量；不能假设"打开 AEC 就能全双工"。
3. **本地优先 vs 云端端到端 S2S。** 这是产品取舍，需要 owner 拍板。
4. **"不间断" vs 现有契约。** 当前是一次性听写；"不间断对话"属于新产品面，不是给 `SessionController` 加一个分支。

## A.5 如果整个项目只能做一件事

**路径 5 的 barge-in 漏检/误检实测**：外放 50 次 + 耳机 50 次，播放 TTS 的同时说"等一下"。

原因：它同时决定两件架构级的事——(a) "能不能像电话一样打断"是否成立；(b) 要不要为了双工去换采集链路。

---

# 附录 B · 外部事实来源汇总（检索日均为 2026-11-20）

**Apple 平台**
- https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition
- https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition
- https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/shouldreportpartialresults
- https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition
- https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer
- https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoicequality
- https://developer.apple.com/documentation/avfaudio/avspeechsynthesizerdelegate/speechSynthesizer(_:willspeakrangeofspeechstring:utterance:)
- https://developer.apple.com/documentation/avfaudio/avaudioengine
- https://developer.apple.com/videos/play/wwdc2019/510/

**音频工程**
- https://developer.chrome.com/release-notes/141
- https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
- https://issues.chromium.org/issues/479234114
- https://issues.chromium.org/issues/40213260
- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process
- https://deepgram.com/blog/backchannels-vs-interruptions-voice-agents
- https://www.twilio.com/en-us/blog/insights/ai-voice-agent-interruption-handling

**运行时与模型**
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- https://github.com/ggml-org/llama.cpp/pull/19441
- https://arxiv.org/html/2607.00501v1
- https://huggingface.co/Qwen/Qwen3-ASR-1.7B
- https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF

**有道三模型**
- https://huggingface.co/netease-youdao/Confucius4-R2T2
- https://huggingface.co/netease-youdao/Confucius4-R2T2-GGUF
- https://github.com/netease-youdao/Confucius4-R2T2
- https://raw.githubusercontent.com/netease-youdao/Confucius4-R2T2/master/MODEL_LICENSE
- https://arxiv.org/abs/2611.06043
- https://huggingface.co/netease-youdao/Confucius4-T3PO
- https://huggingface.co/netease-youdao/Confucius4-T3PO-GGUF
- https://github.com/netease-youdao/Confucius4-T3PO
- https://huggingface.co/netease-youdao/Confucius4-TTS
- https://github.com/netease-youdao/Confucius4-TTS
- https://arxiv.org/abs/2608.11650
- https://github.com/0xShug0/audio.cpp

**TTS 与云**
- https://huggingface.co/hexgrad/Kokoro-82M
- https://github.com/ohf-voice/piper1-gpl
- https://huggingface.co/rhasspy/piper-voices
- https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
- https://help.aliyun.com/zh/model-studio/model-pricing
