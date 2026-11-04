# LLM 纠错评测 SOP

- 目的：用真实录音回答“规则 + 受限 LLM 是否值得默认开启”，而不是用合成样例或模型自评。
- 工具：`pnpm llm:eval`
- 前置：本机已构建 ASR 运行时与模型；已下载 Qwen2.5-1.5B-Instruct GGUF 并设置 `JUSTSPEAK_LLM_MODEL`。

## 1. 录制

在 `bench/llm/real/` 下放 WAV + 同名 TXT：

```text
bench/llm/real/
  self-correction-01.wav
  self-correction-01.txt
  names-01.wav
  names-01.txt
  ...
```

要求：

- WAV：16 kHz、单声道、PCM16。用系统录音或 `ffmpeg` 转码均可；其他采样率/位深会直接报错，不会按错误格式计分。
- 每段 3–15 秒，自然说话，不要刻意放慢。
- 20–30 条，至少覆盖：

| 类别 | 条数 | 示例 |
|---|---|---|
| 口语自纠 | 6–8 | “周一发，不对，周二发” |
| 专名/产品名 | 5–6 | JustSpeak、Qwen3、同事姓名 |
| 数字/日期/金额 | 5–6 | “三点”“四点”“200 块” |
| 中英混排 | 3–4 | “用 JustSpeak 记一下” |
| 长句/多从句 | 3–4 | 一段完整工作交代 |
| 否定/承诺 | 3–4 | “我不会签”“不要发给他” |

- TXT 是**参考转写**，不是 ASR 输出：按“最小必要修正”写，保留说话人最终想表达的内容。
- 不要为了让 LLM 好看而删除说话人的重复；评测的是纠错，不是重新创作。

## 2. 运行

```bash
# 默认用 SenseVoice；也可 JUSTSPEAK_ASR=qwen3
JUSTSPEAK_LLM_MODEL=/path/to/qwen2.5-1.5b-instruct-q4_k_m.gguf pnpm llm:eval
```

脚本会先等待本地 sidecar 真正就绪；运行时或模型缺失时直接退出 1，不会把“模型没启动”误记成“模型没有改动”。

输出：

- `bench/llm/reports/<date>.json`（gitignored）
- 每条的 `cerAsr` / `cerRule` / `cerLlm`、`decision`（`applied` / `keep_all` / `deferred` / `guard_rejected` / `no_candidate`）、数字是否与人工参考一致、ASR/LLM 延迟
- 汇总的 `cerAsr` / `cerRule` / `cerLlm`、`fallback` / `fallbackRate`（`deferred` 占样本比例，含超时与无效输出）、`numbersPreserved` / `samplesWithNumbers`

## 3. Go / No-Go

建议阈值（来自调研文档）：

- **Go**：自纠/填充词类错误占样本 ≥20%，且危险样本（数字/否定/专名）保留 100%，盲评偏好 ≥55%。
- **No-Go**：自纠类 <10%，或 `fallbackRate` >25%，或危险样本保留不达标。
- 升级更强模型：受限决策 CER 降幅 <5% 且用户明确反馈“改得不够”。

注意：CER 只衡量字面差异，不衡量“意思有没有变”。数字/否定/专名必须单独看，必要时人工盲评。

## 4. 隐私

- 录音和报告都在本地 `bench/llm/`，已 gitignore，不会提交。
- 评测使用本机模型，不联网；如果改用云端端点，先确认录音内容不包含敏感信息。
