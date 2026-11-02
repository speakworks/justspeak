# 语音识别文本纠错方案调研

- 日期：2026-11-03
- 决策人：FD2008
- 调研方式：DeepSeek 网页版 4 轮深聊（深度思考 + 智能搜索）＋ 一手论文/官方文档核查 ＋ 本机 Ollama 实测
- 相关设计：[LLM-POSTPROCESSING.md](LLM-POSTPROCESSING.md)（2026-10-26 已接受的设计基线）
- 结论状态：**建议方案，待决策人拍板**；本轮不写实现代码

## 0. 结论摘要

1. **不要用通用 LLM 替换全部后处理。** 规则仍负责确定性的填充词、重复、标点、词库保护；LLM 只处理规则做不好的语义级纠错（口语自纠、断句歧义、同音字）。
2. **不要直接让 1.5B/3B 级模型自由重写整句。** 本机实测 `qwen2.5:1.5b` 把“下午三点”改成“两点”、把“下周”改成“下下周”、把英文 “this plan” 翻译成中文；`qwen2.5:3b` 仍会凭空补“了，然后”、翻译英文、漏清填充词。1.5B 短句延迟可达标；3B 的 0.9s 样本超 800ms、0.5s 样本在预算内、85 字样本 1.86s 超 1.5s 硬超时；语义错误与延迟都不可接受。
3. **可行方向是“规则标记候选 + LLM 在受限动作空间内决策 + 确定性护栏 + 回退”。** 这既满足“用 LLM 纠错”，又把输出限制在可验证范围内。
4. **正式产品内置运行时，模型按需下载；Ollama 只作开发/高级选项。** 默认候选是 **Qwen2.5-1.5B-Instruct（Apache-2.0）**；**Qwen2.5-3B 是 Qwen Research License（仅非商业）**，不能作为商业默认，且长句延迟超预算。自由改写需要更强模型或云端，并接受更高风险。默认关闭。
5. **专用中文纠错小模型（CSC/GEC）值得保留为可选增强，但不能替代自纠错。** 公开模型主要修拼写/语法，不覆盖“他说……不对，走了”这类口语自纠；专门面向中文 ASR 自纠的公开可下载模型没有找到。
6. **Apple Foundation Models 是 macOS 26+ 的备选，不是默认。** 它离线、免下载、隐私好，但需要 Swift helper 接入、4096 token 上下文、依赖 Apple Intelligence 开关，且中文纠错质量缺少公开证据。
7. **先建 100–300 条真实录音评测集，再决定默认开关。** 公开数据无法回答“JustSpeak 上能提升多少”，本机小样本已证明模型会改坏数字和语义。
8. **先做热词/词库 + 评测集，LLM 以“受限决策”形态进入 v1.1。** 第 4 轮 DeepSeek 在实测证据前修正了建议：不支持 v1 直接上 1.5B 自由改写；LLM 只做封闭动作空间内的删/留决策，窗口外由规则拼接。若产品诉求是“AI 重写/润色”，需要许可证允许且实测达标的更强模型，或云端模型，并接受更高风险——这是产品定位问题，需要决策人明确。

## 1. 问题边界

JustSpeak 的现状：本地 ASR（SenseVoice / Qwen3-ASR）输出最终文本，规则式后处理负责标点、填充词、重复、个人词库；自纠错规则（`不对` / `我是说` / `no wait` / `I mean`）已决定**完全删除**，因为它对省略号、引述、否定语境的误判率高。

需要 LLM 补的能力，按优先级：

| 能力 | 规则能否胜任 | LLM 价值 | 风险 |
|---|---|---|---|
| 同音字/近音字（在/再、做/作） | 词表覆盖有限 | 高 | 改错专名、数字 |
| 标点/断句（长句、歧义） | 基础标点可以 | 中 | 改变语义边界 |
| 口语自纠（不对/我是说/改成） | 启发式误删率高 | 高 | 删掉不该删的内容 |
| 专名/术语一致性 | 热词/词库更可靠 | 低 | 过度改写 |
| 语气词（嗯/啊/那个） | 规则足够 | 低 | 误删指示代词“那个” |

## 2. 方案对比

| 方案 | 解决什么 | 不解决什么 | 延迟/成本 | 证据与判断 |
|---|---|---|---|---|
| 规则式后处理 | 填充词、重复、基础标点、词库保护 | 同音字、语义自纠、断句歧义 | <5ms，确定性 | 现有实现；[事实] |
| 专用 CSC/GEC 小模型 | 中文拼写/语法纠错，可离线、可控 | 口语自纠、丢字/重复、跨句语义 | 低–中 | [事实] ChineseErrorCorrector3-4B 在 SIGHAN/NaCGEC 报告 SOTA；[推断] 4B 在 1.5s 预算偏紧，且不覆盖自纠 |
| 专用 ASR 纠错 seq2seq | 受控域内的 ASR 错误，参数少、幻觉低 | 开放域语义、口语自纠 | 低 | [事实] arXiv 2405.15216：比 LLM 少 15× 参数，LibriSpeech test-clean/other WER 1.5%/3.3%，作者明确指出 LLM 有延迟与幻觉问题 |
| 通用本地 LLM | 语义纠错、自纠、断句、术语一致性 | 确定性、零幻觉、低配机型低延迟 | 中–高 | [事实] 本机实测见第 4 节；[推断] 自由改写 1.5B 不可靠，3B 仍会幻觉且许可证/延迟受限；受限决策更现实 |
| 云端 LLM（BYOK） | 最高质量，可带上下文 | 隐私、离线、成本、网络抖动 | 中（网络） | [事实] arXiv 2505.24347：GPT-4o 三阶段 + 推理验证，AISHELL-1/2、LibriSpeech 相对 CER/WER 降 21%/11%/9%/11.4%；[推断] 不适合默认路径 |
| N-best/约束解码 | 解码期降低专名/术语错误 | 语义自纠；需要 ASR 暴露 N-best | 低 | [事实] arXiv 2409.09554 用 N-best/格约束 LLM 纠错；本机 transcribe.cpp 只给 1-best，暂不可用 |
| 上下文热词/偏置 | 专名、产品名、人名 | 自纠、语法、同音字 | 低 | [事实] arXiv 2410.18363（Whisper 上下文偏置）；[推断] 对 JustSpeak 是高 ROI 的独立项 |
| Apple Foundation Models | 离线、免下载、隐私好 | 跨平台、中文质量证据、Electron 直接调用 | 低（本机） | [事实] macOS 26+，on-device ~3B，4096 token，offline，Swift API + Python SDK；macOS 27 有 `fm` CLI；不支持 OpenAI 兼容端点；[推断] 需要 Swift helper，且受 Apple Intelligence 资格/开关限制 |

## 3. DeepSeek 三轮深聊的共识与分歧

### 3.1 共识区（DeepSeek 与一手资料一致）

- LLM 纠错在受控基准上能降 CER/WER（9%–21% 相对值），但不能外推到 JustSpeak 场景；必须自建评测。
- 幻觉/过度改写是真实风险；需要长度比、实体/数字/否定词保留、语言一致、diff 上限和失败回退。
- 专用小模型在受控错误类型上性价比更高、幻觉更低；但它不覆盖口语自纠。
- 热词/上下文偏置对专名最有效，和 LLM 纠错是互补关系。
- 中文 ASR 自纠没有公开权威评测集/可下载专用模型；需要自采标注。
- 不建议把 Apple Foundation Models 作为中文纠错默认方案（质量证据缺失、接入复杂）。

### 3.2 分歧区

| 项 | DeepSeek 主张 | 本机实测/一手资料 | 处置 |
|---|---|---|---|
| 1.5B 能否直接自由改写 | 【推断】Qwen3-1.7B 非思考模式 0.5–1.5s，可做 v1 | 实测 `qwen2.5:1.5b` 延迟达标（0.3–0.6s），但把“三点”改成“两点”、“下周”改成“下下周”、翻译英文，语义错误 | **不采信“1.5B 自由改写可上默认”**；1.5B 只能做受限决策，或换许可证允许且实测达标的更强模型/云端 |
| v1 路线 | 第 3 轮：先做本地非推理 LLM + 规则候选标记 + 护栏；第 4 轮看到实测后改口：先热词/词库 + 评测集，LLM 受限决策进 v1.1 | 受限决策的 1.5B 仍把“这个不对。”判成 delete_before，把省略号案例判成删前句 | 采纳第 4 轮：v1 不直接上自由改写；LLM 以受限决策形态排在评测集之后 |
| Apple Foundation Models | 不建议默认 | 官方文档确认可用，但需 Swift helper、4096 token、Apple Intelligence 开关；`fm` CLI 需 `sudo fm license` | 作为可选后端候选，非 v1 默认 |
| 延迟数字 | 1.7B Q4 首 token 100–300ms、整段 0.8s 可行 | 本机首请求 2.1s（加载），热态 0.3–0.6s；50–150 字区间仅有一条 85 字样本 | 延迟按实测 P50/P95 决策，不采信单点推断 |

### 3.3 DeepSeek 的独有洞察

- “规则只做候选标记，LLM 只在候选窗口内决定删/留/保留”能显著压缩输出空间，是降低幻觉的关键。
- 自纠错需要比二元删除更细的动作空间（删前留后 / 只删标记 / 全部保留），否则省略号+引述场景仍会误删。
- 护栏阈值要按场景分层：普通清理 diff ≤15%，自纠场景可放宽到 30%，长度比下限可到 0.6。

## 4. 本机实测（Apple Silicon，macOS 27.2，Ollama）

### 4.1 推理模型不可用于实时纠错

`deepseek-r1:1.5b`，输入「他说……不对，走了」：

- 热态总耗时 **9.6s**，其中 reasoning 8.6s；输出「他说……走了」。
- 原因：R1-Distill 默认生成思维链；`think:false` 在该模型上未生效。
- 结论：推理模型不适合 1.5s 预算。

### 4.2 非推理 1.5B 自由改写：延迟达标，质量不达标

`qwen2.5:1.5b`，温度 0，`num_predict=200`：

| 输入 | 输出 | 耗时 |
|---|---|---|
| 他说……不对，走了 | 他说走了。 | 2.17s（首请求，含加载） |
| 嗯，那个，我们明天下午三点开会，不对，是四点，记得带上 JustSpeak 的测试报告。 | 我们明天下午**两点**开会，记得带上 JustSpeak 的测试报告。 | 0.56s |
| 他，JustSpeak行。 | 他，JustSpeak行。 | 0.29s |
| 我觉得 this this plan 可以，no wait，还是下周吧。 | 我觉得**这个计划**可以，**不用等了**，还是**下下周**吧。 | 0.51s |

失败类型：数字篡改、语义改写、翻译、丢省略号。这些错误中，数字变化可以被护栏抓到；但“下周→下下周”“不用等了”这类语义变化，确定性护栏抓不到。

### 4.3 受限 JSON 决策：快，但 1.5B 判断力不足

同一模型，只输出 `delete_before` / `keep_all` / `delete_marker`：

| 输入 | 模型判断 | 期望 |
|---|---|---|
| 他说……不对，走了 | delete_before | 更合理是“只删标记”（他说……走了） |
| 周一发，不对，周二发。 | delete_before | 正确 |
| 这个不对。 | delete_before | 不应触发（keep_all） |
| 我们明天下午三点开会，不对，是四点。 | delete_before | 正确 |
| 我觉得这个方案可以，no wait，还是下周吧。 | delete_before | 正确 |

耗时 0.3–0.7s。结论：动作空间约束能提速并降风险，但 1.5B 对“是否构成自纠”和省略号边界的判断不够可靠，需要更大模型或更强的规则先验。

### 4.4 Qwen2.5-3B 对照（2026-11-03 补测）

`qwen2.5:3b` Q4，温度 0，`num_predict=220`：

| 输入 | 输出 | 耗时 |
|---|---|---|
| 他说……不对，走了 | 他说了，然后走了（凭空补“了，然后”） | 4.8s（首请求） |
| 嗯，那个，我们明天下午三点开会，不对，是四点，记得带上 JustSpeak 的测试报告。 | 我们明天下午**四点**开会，记得带上JustSpeak的测试报告。（数字正确，空格丢失） | 0.9s |
| 我觉得 this this plan 可以，no wait，还是下周吧。 | 我觉得**这个计划**可以，不过还是下周吧。（仍翻译英文） | 0.5s |
| 85 字长句（含“嗯，那个”和“三点→四点”） | 数字修正正确，但**“嗯，那个”未被清理** | 1.86s |

受限 JSON 决策（3B）：省略号案例正确选 `delete_marker`；但 `周一发，不对，周二发。` 也选 `delete_marker`（应为 `delete_before`），`这个不对。` 仍误判为 `delete_before`。耗时 0.35–0.67s。

逐项对比：3B 在“省略号案例”和“三点→四点”上更好；1.5B 在“周一发→周二发”上正确，3B 反而错；两者都误判“这个不对。”；3B 仍翻译英文、漏清“嗯，那个”。**“3B 更好”只在部分案例成立，不是全面结论。**

许可证：`Qwen2.5-3B-Instruct` 的上游元数据是 `license: other` / `license_name: qwen-research`，本机 `ollama show qwen2.5:3b --license` 也是 **Qwen Research License Agreement（仅非商业）**；`Qwen2.5-1.5B-Instruct` 和 `Qwen3-1.7B` 是 Apache-2.0。3B 不能作为商业默认分发，需先取得商业授权。

延迟：3B 的 0.9s 样本超过 800ms p50 预算、0.5s 样本在预算内，85 字 1.86s 超过 1.5s 硬超时；受限 JSON 决策 0.35–0.67s 在预算内，自由改写只有 0.5s 短样本在预算内。

85 字样本原文（总字符数）：`嗯，那个，我们下周三下午三点在新会议室跟产品、设计和后端一起过一遍这个季度的上线计划，不对，是周四下午四点，记得提前把 JustSpeak 的测试报告和风险清单发给大家。`

### 4.5 未能验证的项

- `qwen3:1.7b` 无法在稳定版 Ollama 上测试。2026-11-03 检查时 Ollama 最新稳定版为 **0.40.13**（本机已是），执行 `ollama pull qwen3:1.7b` 返回 412「requires a newer version of Ollama」；这不是 manifest 端点本身的响应，也不是本机升级失败，而是该 tag 超出了当前稳定版客户端能力。
- 50–150 字长文本只有单条 85 字样本（3B 1.86s），P50/P95 仍需在评测阶段用目标机型补测。

## 5. 推荐方案

### 5.1 架构

```
ASR 最终文本
  → Normalizer（现有规则：填充词/重复/标点/词库保护；删除自纠错规则；<5ms，始终开）
  → SelfRepairCandidateMarker（规则：只标记“不对/我是说/改成/no wait/I mean”候选窗口，不删除）
  → [可选] LocalLlmCorrector（默认关；内置 llama.cpp sidecar + 首次下载的 1.5B 模型）
     或 CloudLlmCorrector（可选；BYOK OpenAI 兼容端点）
  → Guard（长度比/数字/专名/否定词保留/语言一致/diff 上限；失败回退 Normalizer）
  → 输出
可选旁路：CSC 小模型（默认关）；Apple Foundation Models 适配器（后续）
高级选项：自定义 OpenAI 兼容端点（Ollama / LM Studio / 云端），不是安装前提
```

### 5.2 接口与开关

- 新增 `LlmCorrector` 端口：`correct(text, candidates, context) -> { text, changed, confidence }`；核心不碰 Electron/网络，主进程持有 sidecar 或 fetch，并负责超时/取消。
- 设置项：启用开关（默认关）、后端类型（本地模型 / Apple 智能 / 自定义端点）、本地模型下载状态、自定义端点的 base URL/模型名/API key（可选，存 Keychain）、超时（默认 800ms）、失败回退提示。
- 隐私：本地模型与 Apple 智能显示“文本不离开设备”；云端端点首次启用必须弹窗说明“转写文本将发送到你配置的服务”，不做静默回退到云端。
- 失败策略：超时、非 2xx、JSON 解析失败、sidecar 崩溃、护栏不通过 → 一律使用 Normalizer 结果；连续失败 3 次自动关闭本次会话的 LLM 并提示。

### 5.3 模型与默认值

- **默认候选：Qwen2.5-1.5B-Instruct（Apache-2.0，Q4 约 1 GB）**，只用于受限决策；评测通过前不默认启用。
- **许可证红线**：`Qwen2.5-3B-Instruct` 是 **Qwen Research License（仅非商业）**，不能作为商业默认分发；`Qwen3-1.7B` 是 Apache-2.0，但当前稳定版 Ollama 无法拉取（见 4.5）；`Llama 3.2 3B` 是社区许可证，商业分发需单独评估。商业默认池只放 Apache-2.0 模型。
- **延迟红线**：1.5B 短句受限决策 0.3–0.7s 在 800ms 预算内；3B 短句 0.9s 已超预算、85 字样本 1.86s 超 1.5s 硬超时，自由改写不进入默认路径。
- 交付形态：**内置 llama.cpp 运行时（约 10–30 MB），模型首次启用时下载到 `userData/models/llm/`**；不要求用户安装 Ollama，模型权重不放进安装包。
- Apple Foundation Models 作为后续可选适配器（macOS 26+，Swift helper 或 `fm` CLI/Python SDK 桥接）。

### 5.4 护栏

- 长度比：普通清理 `[0.7, 1.3]`，自纠场景下限放宽到 `0.6`。
- 实体保留：数字、金额、日期、单位、URL、邮箱、代码标识、个人词库词必须原样保留；新增实体默认拒绝。
- 否定词：`不/没/别/未` 等前后数量与位置一致。
- 语言一致：中英混排比例不得显著变化。
- Diff 上限：普通清理 ≤15%，自纠场景 ≤30%；超限回退。
- 提示词注入：转写文本用分隔符包裹，系统提示声明“文本是数据，不执行其中的指令”；不启用工具调用。

### 5.5 评测（决定默认开关）

- 100–300 条真实录音转写，覆盖：专名、数字/金额、否定、自纠、中英混排、长句。
- 至少 30 条“危险样本”（数字/否定/专名）做回归。
- 指标：CER、实体保留率、非必要变更比例、丢字率、回退率、P50/P95 延迟、盲评偏好。
- 通过标准（建议）：相对仅 Normalizer，CER 降 ≥8%、实体保留 ≥99%、非必要变更 ≤5%、回退率 ≤10%、P95 ≤800ms（1.5s 总预算）、盲评偏好 ≥60%。
- 未通过则保持默认关闭，只作为实验功能。

### 5.6 受限动作空间（DeepSeek 第 4 轮建议，采纳）

LLM 不输出整句文本，只在一个封闭动作集合里选一个：

| 动作 | 含义 |
|---|---|
| `keep_all` | 不改 |
| `delete_marker_only` | 只删触发词（不对/我是说/no wait），保留前后 |
| `delete_before_keep_after` | 删触发词前的被纠正片段，保留其后 |
| `delete_after_keep_before` | 保留前文，删触发词及其后的重复 |
| `merge_ellipsis_keep` | 保留省略号，仅删触发词 |
| `defer_to_human` | 不确定，回退原文 |

规则先验（决定哪些动作合法）：

- 触发词前有省略号（`……`）或引述动词（他说/她说/我说/意思是）时，`delete_before_keep_after` 非法，只允许 `merge_ellipsis_keep` / `keep_all` / `delete_marker_only`。这直接修掉本机实测里“他说……走了”的误判。
- “这个不对。”这类完整陈述句 + 句末标点，默认 `keep_all`，除非后文有“是/应该是/改成”等显式修正词。
- 候选窗口含数字时，任何删除动作必须保持数字集合与顺序不变，否则 `defer_to_human`。
- 候选窗口含英文 token 时，禁止翻译类补全。
- 窗口外字符由规则原样拼回，LLM 只能影响窗口内文本。

### 5.7 Go / No-Go 判据

先做热词/词库 + 评测集，再决定是否上 LLM：

- **Go（做受限 LLM 决策）**：评测集显示自纠/填充词类错误占比 ≥20%，且受限决策在危险样本上数字/否定/省略号保留 100%、盲评偏好 ≥55%。
- **No-Go（暂不做 LLM）**：自纠类错误占比 <10%，或受限决策回退率 >25%，或危险样本保留率不达标——此时规则 + 热词已经足够。
- **升级到许可证允许的更强模型/云端**：受限决策在评测集上 CER 降幅 <5% 且用户明确反馈“改得不够”，再考虑更大模型 + 更重的护栏。3B 需先解决 Qwen Research License 与长句超时，不能直接升级。
- **产品文案**：v1 若采用受限决策，应叫“智能清理”，不要叫“AI 重写”；如果决策人要的是真正的 LLM 润色/重写，需要单独立项并接受更高风险。

### 5.8 正式产品的模型集成路径

结论：**Ollama 只作为开发期/高级用户选项，不能作为正式产品的安装前提。**

| 方式 | 做法 | 安装包增量 | 首次使用 | 适用 |
|---|---|---|---|---|
| **内置运行时 + 按需下载模型（推荐）** | 把 `llama-server`/`llama-cli`（llama.cpp）作为 sidecar 放进 `Contents/Resources/llm/`；模型首次启用时下载到 `userData/models/llm/`，校验 SHA-256、进度、原子 rename | 10–30 MB | 1.5B 约 1 GB | 默认本地路径 |
| 安装包内置模型 | 权重也打进 DMG | 1–2 GB | 开箱即用 | 完全离线安装包 |
| Apple Foundation Models | Swift helper 封装 macOS 26+ 端侧模型 | ~0 | 无下载 | 零下载选项，受系统资格/语言限制 |
| 云端/BYOK | OpenAI 兼容端点或自有代理 | ~0 | 填 key | 低端机/高质量需求 |

工程要点（与现有 ASR 运行时同构）：

- **sidecar 而不是 Node 原生插件**：避免 Electron ABI 重建、签名、崩溃隔离问题；主进程持有子进程，renderer 不直接调用。
- **扩展现有模型管理**：catalog（id/version/URL/SHA-256/size/license/quantization）+ `ModelManager` + `userData/models` 已覆盖下载与校验，但 `ModelManager` 目前只有 `verify`/`download`，没有已安装模型的删除/列举 API；需要新增。LLM 条目建议放进同一 catalog，并扩展 `verify-mac-app.ts`、`notices.mjs` 与打包检查，否则 `verify:mac` 不会检查 LLM sidecar/模型，`THIRD_PARTY_NOTICES.md` 也不会列出它们。
- **许可证（红线）**：商业默认池只用 Apache-2.0：`Qwen2.5-1.5B-Instruct`、`Qwen3-1.7B`。`Qwen2.5-3B-Instruct` 是 **Qwen Research License（仅非商业）**，不能作为商业默认；`Llama 3.2 3B` 是社区许可证，商业分发需单独评估。模型和运行时都要进 `THIRD_PARTY_NOTICES.md` 与 `licenses/`。
- **签名/公证**：sidecar 与 ASR runtime 一样随 app 签名；`@loader_path` 依赖；但现有 `verify:mac` 只检查 `Contents/Resources/runtime` 与 ASR catalog，接入 LLM 后必须同步扩展。
- **资源策略**：模型懒加载 + 空闲卸载，或录音开始时预热；800ms 超时回退；内存上限和低配机降级。
- **设置项**：本地模型（推荐，显示下载大小/状态）、Apple 智能（macOS 26+）、自定义 OpenAI 兼容端点；默认关闭，首次启用弹隐私说明。
- **更新**：catalog 随应用打包，因此“只改 URL/SHA”仍需发版；若要做到不更新应用就换模型，需要额外的远程 catalog 机制（含签名/版本校验），当前设计没有该机制。
- **体积预算**：仓库冻结目标是“默认模型下载 ≤1 GB；已安装模型总计 ≤2 GB”（`docs/ASR-RESEARCH.md` R5）。现有 ASR 两个模型合计约 1.03 GiB；再加 1.5B LLM 约 1 GB，总计约 2 GB，已在边界。**LLM 模型应作为 opt-in 下载、单独计量，或由决策人显式修订 R5 预算**；不能默默突破。

推荐默认组合：**内置 llama.cpp sidecar + 首次下载 Qwen2.5-1.5B-Instruct Q4（Apache-2.0）+ 规则/热词/评测集先行**；Apple FM 与云端作为可选后端。1.5B 只用于受限决策；自由改写需要许可证允许且实测达标的更强模型（3B 不是默认，且长句超时）。

## 6. 待决策项

0. **是否 un-defer 本地 LLM？** 已接受设计把本地 LLM 运行时/模型列为 v0.1 deferred；5.8 提议重新开启（内置 sidecar + 按需模型）。这是决策变更，不是单纯交付方式选择，需要显式确认。
1. **v1 是否只做接口 + 评测，不默认开启 LLM？**（建议：是）
2. **本地模型如何交付？**（建议：内置 llama.cpp sidecar + 首次下载 **1.5B** 模型，不要求用户安装 Ollama；见 5.8）
3. **Apple Foundation Models 是否纳入 v1？**（建议：后续可选适配器）
4. **云端 BYOK 是否与本地同一端点抽象？**（建议：是，OpenAI 兼容一层覆盖）
5. **体积预算是否修订？** LLM 1.5B 约 1 GB，现有 ASR 两模型约 1.03 GiB，总计约 2 GB；建议 LLM 作为 opt-in 单独计量，或显式修订 `ASR-RESEARCH.md` R5。
6. **3B 是否排除在默认池之外？** Qwen2.5-3B 是 Qwen Research License（非商业），且长句 1.86s 超时；建议排除。若要商用，先取得商业授权并补测。

## 7. 来源与可信度

### 实锤（一手论文/官方文档/本机实测）

- Ma et al., *ASR Error Correction using Large Language Models*, arXiv:2409.09554 — https://arxiv.org/abs/2409.09554
- *Fewer Hallucinations, More Verification: A Three-Stage LLM-Based ASR Error Correction Method*, arXiv:2505.24347 — https://arxiv.org/abs/2505.24347（GPT-4o 三阶段，相对 CER/WER 降 21%/11%/9%/11.4%）
- *Revisiting ASR Error Correction with Specialized Models*, arXiv:2405.15216 — https://arxiv.org/abs/2405.15216（专用 seq2seq，少 15× 参数，LibriSpeech 1.5%/3.3% WER）
- Tian & Zhou, *ChineseErrorCorrector3-4B*, arXiv:2511.17562 — https://arxiv.org/abs/2511.17562
- *Contextual Biasing to Improve Domain-specific Custom Vocabulary in Whisper*, arXiv:2410.18363 — https://arxiv.org/abs/2410.18363
- Apple Foundation Models — https://developer.apple.com/documentation/foundationmodels 与 https://developer.apple.com/foundation-models-framework/
- Apple Foundation Models Python SDK — https://apple.github.io/python-apple-fm-sdk/
- Superwhisper 模型列表（本地 llama.cpp 3B–8B、云端模型）— https://superwhisper.com/models
- Ollama 文档 — https://docs.ollama.com ；llama.cpp — https://github.com/ggerganov/llama.cpp
- 许可证核查（2026-11-03）：HuggingFace API `Qwen/Qwen2.5-3B-Instruct` → `license: other` / `license_name: qwen-research`；`Qwen/Qwen2.5-1.5B-Instruct` 与 `Qwen/Qwen3-1.7B` → `apache-2.0`；本机 `ollama show qwen2.5:3b --license` 显示 Qwen Research License Agreement。
- 本机实测：`deepseek-r1:1.5b`、`qwen2.5:1.5b`、`qwen2.5:3b`（Ollama，2026-11-03），原始输出见第 4 节。

### 高共识（DeepSeek 与上述资料方向一致，无单篇直接对应）

- 规则 + 热词/偏置 + 可选 LLM 的分层结构。
- 护栏必须包含实体/数字/否定词保留与回退。
- 中文 ASR 自纠缺少公开评测集。

### 推测（必须标注，不得直接当事实引用）

- DeepSeek 给出的 1.7B/3B 首 token 与整段延迟区间（未提供 M 系列实测）。
- “Qwen 中文强于 Llama 3.2”在纠错任务上的具体差距。
- Apple Foundation Models 中文纠错质量。
- 任何“JustSpeak 上线后可降 X% CER”的数字。

## 8. 实施状态（2026-11-03）

- 已按决策**完全删除**规则式自纠错（`self-correction` rule 与配置开关），文本中的
  `不对`/`我是说`/`no wait`/`I mean` 现在原样通过 `postprocess`。
- 同批修复两个确定性缺陷：`．`（U+FF0E）纳入标点 run；`dominantScript` 忽略掩码占位符，
  `他，JustSpeak行。` 不再被改成半角标点。
- LLM 纠错阶段**尚未实现**。下一步按第 5.7 节先做热词/词库与 100–300 条评测集，
  再决定是否以受限决策形态进入 v1.1。

## 9. 调研过程留痕

- DeepSeek 会话：https://chat.deepseek.com/a/chat/s/95261dd4-fa8b-4039-9f5d-663ddc991c29（4 轮，深度思考 + 智能搜索）
- 第 1 轮：8 维方案评估；第 2 轮：要求真实来源、评估三篇论文、Apple FM、延迟解释；第 3 轮：自纠错路线、可下载模型清单、约束提示词、最终建议；第 4 轮：用本机实测挑战“1.7B 自由改写”，DeepSeek 改口为“先热词/词库+评测集，LLM 受限决策进 v1.1”。
- DeepSeek 的回答为 AI 生成内容；本报告只把其中可被一手资料或本机实测验证的部分列为“实锤”，其余按“高共识/推测”分级。
