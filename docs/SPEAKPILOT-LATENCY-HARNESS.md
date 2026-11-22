# SpeakPilot 延迟实测脚手架

`docs/SPEAKPILOT-CONVERSATION-PLAN.md` §g 的 Phase 0 门禁是"没有实测表就不进入 P1，禁止用估计值代替"。
这份脚手架就是那条门禁的执行工具：它不实现任何对话功能，只负责把三个可测环节的数字变成表，并把测不了的部分明确标成 `blocked`。

## 三条命令

```bash
pnpm bench:latency                     # 三段全跑，默认样本数（asr 1 · llm 20 · tts 20）
pnpm bench:latency --segments tts      # 只跑一段
pnpm bench:latency:template            # 只生成 Phase 0 空白表
```

常用参数：`--route built-in|wired|bluetooth`（路由标签，由操作者声明）、`--tts-samples N`、`--llm-model /path/to.gguf`、`--tts-text "..."`。

## 三段测什么、前提是什么

| 段 | 测的量 | 前提 | 缺前提时的行为 |
|---|---|---|---|
| `asr` | `provider.transcribe` 墙钟：WAV 写入 + CLI 启动 + 模型加载 + 推理 + 解析（`bench/fixtures/zh-4s.wav`） | `models/runtime/.../transcribe-cli` 与 ASR 模型已就位（`pnpm setup:asr`） | `blocked`，写明缺哪个文件 |
| `llm` | `POST /v1/chat/completions` `stream:true` → 首个 `delta.content` 帧；另测一次非流式完成时间 | `resources/llm/llama-server` + 一个 `.gguf`（安装包不内置模型，需应用首次运行时下载，或 `--llm-model` 指定） | `blocked`；若服务端不返回 SSE，则记 `stream 未验证` 并只报非流式数字 |
| `tts` | `speechSynthesis.speak()` → `utterance.onstart`（首个语音单元），并把第一个 `boundary` 回调单独记录 | Electron、有声卡、语音已加载 | `blocked`，写明是超时、无回调还是 `voices=0` |

## 一个真实踩到的坑：`voices=0` 会伪造出很漂亮的数字

第一次在本机跑（锁屏、无语音加载）时，探针确实拿到了回调，样本是 `[478, 155, 1]` ms，P50 看起来是 155 ms —— 比规划文档里 570–820 ms 的旧记录还好，足以让人误以为"TTS 首包达标了"。

实际是 `speechSynthesis.getVoices()` 返回空数组，引擎根本没有出声，`onstart` 只是一个立即触发的空回调。

所以 `classifyTtsProbe()` 现在有两条硬拦截：`voiceCount === 0` 直接作废；P50 低于 20 ms 视为"疑似无声"作废。**这条拦截是这份脚手架最重要的部分**，它挡住的是"为了让数字好看而自欺"。

## 输出约定

- `bench/results/<YYYY-MM-DD>-<commit>-<route>.json`：无内容，只有时间戳、样本毫秒数与设备名（不存任何转写文本）
- `bench/reports/<YYYY-MM-DD>-speakpilot-latency-<route>.md`：本次读数 + 与 §f.1 预算的对照 + §f.3 降级规则的机械判读
- `bench/reports/phase0-latency-template.md`：20 段 × 3 路由 = 60 行空白表，等真人素材

## 素材到位后怎么用

1. 采集 20 段双人对话（只本机处理，不外传），每条路由各跑一遍：`pnpm bench:latency --route wired`。
2. 把每段的端点、ASR 终稿、LLM 首 token、TTS 首包填进 `phase0-latency-template.md`。
3. M1（停说→出声）必须用真人听感校准后填，不能用三段相加冒充。
4. 结果回填到 `SPEAKPILOT-CONVERSATION-PLAN.md` §f.1，并在 §g Phase 0 的验收行打勾——**只有到这一步，才允许谈进入 P1**。

## 边界

- 不改听写链路、不接流式 ASR、不新增 TTS 引擎、不出现"实时对话"字样。
- 测不到就写 `blocked` 并写明原因；任何格子都不许填估计值。
- 路由标签是操作者声明的，脚手架只能记录默认输出设备名，证明不了音频真的从那条路由出去。
- M4 回声误触发率、M6 打断后重述率、多轮记忆这三项不在这里测，它们需要真人和听感，不能靠计时器。
