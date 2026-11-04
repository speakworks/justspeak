# LLM 纠错合成冒烟结果（2026-11-05）

- 状态：**合成冒烟，不是 Go/No-Go 数据集**。TTS 音频不能替代真人口语。
- 目的：验证 ASR → 规则候选 → 受限 LLM → 护栏 → 指标报告的完整链路，并提前暴露召回问题。

## 设置

- 机器：macOS arm64（Apple Silicon）。
- 数据：`pnpm llm:eval:smoke` 用 macOS `say -v Tingting` 生成 10 条，`afconvert` 转 16 kHz 单声道 PCM16；覆盖自纠、省略号、语义否定、中英混排、专名、数字、承诺和无标记句。
- ASR：SenseVoice（默认）与 Qwen3-ASR 0.6B。
- LLM：llama.cpp `0.8.0-dev` + 本机 Ollama 的 Qwen2.5-1.5B-Instruct GGUF（940 MB，非 catalog 的 HF Q4_K_M；评测脚本接受任意 GGUF）。
- 纠错与护栏与产品代码完全一致。

```bash
pnpm llm:eval:smoke
JUSTSPEAK_LLM_EVAL_DIR=bench/llm/smoke \
  JUSTSPEAK_LLM_MODEL=/path/to/qwen2.5-1.5b.gguf pnpm llm:eval
JUSTSPEAK_ASR=qwen3 JUSTSPEAK_LLM_EVAL_DIR=bench/llm/smoke \
  JUSTSPEAK_LLM_MODEL=/path/to/qwen2.5-1.5b.gguf pnpm llm:eval
```

## 结果

| ASR | 样本 | `no_candidate` | `applied` | 回退 | CER: ASR / 规则 / LLM |
|---|---|---|---|---|---|
| SenseVoice | 10 | 10 | 0 | 0 | 1.50 / 1.50 / 1.50 |
| Qwen3-ASR 0.6B | 10 | 7 | 3 | 0 | 1.39 / 1.39 / 0.83 |

Qwen3 实际纠正的 3 条（全部正确）：

| 输入（ASR） | 输出 |
|---|---|
| 我不会签，不对，我会签。 | 我会签。 |
| 用Just Speak记一下。No wait，用Notion记一下。 | 用Notion记一下。 |
| 找张伟，不对，找张威。 | 找张威。 |

## 关键发现

1. **链路本身正常**：模型就绪、封闭 action 解析、护栏、报告字段（`decision` / `noCandidate` / `fallback` / CER）都按预期工作；0 次超时、0 次回退。
2. **候选召回是瓶颈，不是模型质量**。SenseVoice 的 ASR 文本大多没有在「不对」前输出标点（如「周一发不对，周二发。」），规则要求的左边界不成立，10/10 未进入 LLM。Qwen3 也只触发 3/10；「我是说」等标记常缺少右侧标点。
3. **CER 参考是“最终意图”**，因此未纠正的样本 CER 会大于 1；这是预期口径，不是指标错误。
4. **数字指标为空**：合成参考用中文数字（「四点」），而 `numbersPreserved` 只比较 `\p{Nd}` 十进制数字；真实数据中应加入阿拉伯数字/金额样本，并单独人工检查否定与专名。

## 对产品决策的含义

- 合成数据不能决定是否默认开启；真实录音评测必须同时报告**候选触发率**（`noCandidateRate`）和回退率，否则会把“规则没触发”误读成“模型没改对”。
- 若真实数据同样显示低触发率，下一步应研究**左边界策略**（强/弱标记分级、利用 ASR 停顿或时间戳），而不是放宽长度/数字护栏。
- 当前默认 `off` 的决策不变。
