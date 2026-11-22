# SpeakPilot Phase 0 延迟实测表（空白模板）

每段素材 × 每条路由一行，共 20 × 3 = 60 行。
**空格子必须由实测填充；测不到的写 `blocked` 并注明原因，不许写估计值。**

列定义对齐 `docs/SPEAKPILOT-CONVERSATION-PLAN.md` §f.1：

- 端点: 用户停说 → VAD 判定说完（当前实现 `minSilenceMs` 400 ms）
- ASR 终稿: 说完 → 拿到 final 文本
- LLM 首 token: 请求发出 → 第一个 token 到达
- TTS 首包: 调用 speak → 第一个语音单元回调
- M1 停说→出声: 用户最后一个字结束 → 第一个可听音（三个环节之和，用真人听感校准）

| 素材 | 路由 | 端点 (ms) | ASR 终稿 (ms) | LLM 首 token (ms) | TTS 首包 (ms) | M1 停说→出声 (ms) |
|---|---|---|---:|---:|---:|---:|---:|
| rec-01 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-01 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-01 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-02 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-02 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-02 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-03 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-03 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-03 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-04 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-04 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-04 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-05 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-05 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-05 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-06 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-06 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-06 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-07 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-07 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-07 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-08 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-08 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-08 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-09 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-09 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-09 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-10 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-10 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-10 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-11 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-11 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-11 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-12 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-12 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-12 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-13 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-13 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-13 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-14 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-14 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-14 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-15 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-15 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-15 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-16 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-16 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-16 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-17 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-17 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-17 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-18 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-18 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-18 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-19 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-19 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-19 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-20 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-20 | wired | 待填 | 待填 | 待填 | 待填 | 待填 |
| rec-20 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |

回填后把这张表的数据抄进 `docs/SPEAKPILOT-CONVERSATION-PLAN.md` §f.1 的"现有手段"列旁边的新增实测列，并在 §g Phase 0 的验收行打勾。
