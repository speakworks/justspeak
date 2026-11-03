# LLM sidecar 技术原型（spike）

- 日期：2026-11-04
- 状态：**技术可行性验证，未接入产品**（没有设置项、没有默认行为、没有 UI）
- 背景：[ASR-CORRECTION-RESEARCH.md](ASR-CORRECTION-RESEARCH.md)
- 目标：回答“内置 llama.cpp sidecar + 1.5B 模型在 macOS 上能不能稳定、够快、可打包”，而不是交付功能

## 结论摘要

| 问题 | 结果 |
|---|---|
| 可打包/可重定位 | **可以**。llama-server + 9 个 dylib 共 24 MB，`@loader_path` + ad-hoc 签名后从 `resources/llm` 直接运行 |
| 冷启动 | **9.3 s**（1.5B Q4 首次加载）；模型页缓存热启动约 **1.25 s**；必须懒加载/预热，不能每次听写重建 |
| 常驻内存 | **~1.07 GB RSS**（llama-server 进程，不含 Electron） |
| 受限决策延迟 | 10 次请求：P50 **227 ms**、P95 **495 ms**、最大 495 ms、0 次 800ms 超时 |
| 崩溃隔离 | **通过**：SIGKILL sidecar 后主进程存活，`decide()` 回退 `defer_to_human` |
| 决策质量 | **不够**：5 个样例中约 2–3 个动作合理；省略号案例和“这个不对。”仍误判，需要规则先验 |
| 结论 | sidecar 形态可行；1.5B 只能做受限决策且必须加规则先验；不建议直接产品化 |

## 构建

- 源码：`llama.cpp` **v0.8.0**，commit `8642541b255bfb5dc39cd351a178be09013a55d6`
- 构建目录：`models/runtime/llama.cpp/build`（gitignored）
- CMake：

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_METAL=ON -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF
cmake --build build --target llama-server -j 8
```

`LLAMA_OPENSSL=OFF` 很关键：默认构建会链接 Homebrew 的 `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib`，绝对路径不可随包分发；关闭后只剩 `@rpath` 和系统库。

## 打包

`scripts/package-llm-runtime.ts` 做了和 ASR runtime 一样的事：

- 从 `build/bin/llama-server` 递归收集 `@rpath` 依赖，按 soname 拍平到 `resources/llm/`
- 删除构建机绝对 `LC_RPATH`，改为 `@loader_path`
- 每个文件 `codesign --force --sign -`（`install_name_tool` 会使签名失效）
- 复制 `llama.cpp-LICENSE`、`jsonhpp-LICENSE`、`cpp-httplib-LICENSE`
- `--check` 重新验证链接闭包、rpath、签名、许可证

结果：

```text
24M  resources/llm
llama-server --version: 0.8.0-dev (commit 8642541)
otool -l llama-server: path @loader_path
codesign: Signature=adhoc
```

## 模型

原型使用本机 Ollama 已下载的 **Qwen2.5-1.5B-Instruct** GGUF blob（940 MB）作为模型文件：

```text
/Users/fuyg/.ollama/models/blobs/sha256-183715c435899236895da3869489cc30ac241476b4971a20285b1a462818a5b4
```

这只是为了不重复下载；正式产品应走 `userData/models/llm/` 的 catalog 下载 + SHA-256 校验。**注意：Qwen2.5-3B 是 Qwen Research License（非商业），本原型不用它做默认。**

## 测量

命令：

```bash
pnpm package:llm
pnpm llm:probe -- --binary resources/llm/llama-server \
  --model /path/to/Qwen2.5-1.5B-Instruct-Q4.gguf --runs 2
```

结果（Apple Silicon，macOS 27.2；请求串行发送，`--parallel 1`）：

```json
{"startup_ms":9302,"rss_mb":1073,"threads":8,"requests":10,"p50_ms":227,"p95_ms":495,"max_ms":495,"timeouts":0,"deferrals":0}
```

（上面是早期冷启动运行；生命周期修复后复跑为 `startup_ms 1248`、`p50_ms 212`、`p95_ms 490`、`timeouts 0`，量级一致。）

冷启动 9.3s 是首次加载的单次观测；模型进入页缓存后重跑约 1.25s。P50/P95 是串行请求的边界，不覆盖并发调用（并发会排在单槽后面）。

质量（受限动作）：

| 输入 | 模型动作 | 评价 |
|---|---|---|
| 他说……不对，走了 | `delete_before_keep_after` | 错：会删掉“他说……”，应保留引述/省略号 |
| 周一发，不对，周二发。 | `delete_before_keep_after` | 对 |
| 这个不对。 | `delete_marker_only` | 错：不应触发，应 `keep_all` |
| 我们明天下午三点开会，不对，是四点。 | `delete_before_keep_after` | 动作方向对，但缺少规则窗口会把整句删成“是四点” |
| 我觉得这个方案可以，no wait，还是下周吧。 | `delete_before_keep_after` | 方向对，仍需规则窗口 |

没有规则先验时，1.5B 无法稳定区分“自纠”和“语义否定/引述”。这正是研究文档要求“规则标记候选 + 受限动作空间”的原因。

## 崩溃隔离

```bash
process.kill(sidecar.pid, 'SIGKILL')
sidecar.decide(...) // -> { action: 'defer_to_human', raw: 'fetch failed' }
```

主进程存活，调用方拿到回退动作。sidecar 独立进程的价值得到验证。

生命周期边界也有单元测试：二进制不存在（spawn ENOENT）与启动即退出都会让 `start()` 明确 reject，不会留下未处理的子进程错误；启动超时会清理子进程并允许重启；并发 `start()` 只启动一个实例；`stop()` 可重复调用。

## 已知限制

- **冷启动 9.3s**：产品需要懒加载 + 预热，或在录音开始时后台启动；不能阻塞听写。
- **RSS ~1.07 GB**：低配 Mac 需要降级策略（空闲卸载、只开受限决策、或改用云端/Apple FM）。
- **质量不足**：1.5B 需要规则先验；3B 许可证不允许商用默认，且长句延迟超预算。
- **模型来源**：原型用 Ollama blob，不是正式下载链路；正式实现要补 catalog、SHA、进度、删除/列举 API。
- **签名**：ad-hoc 仅限本地；正式发布需 Developer ID，并让 electron-builder 重签 sidecar。
- **本地端口暴露**：`llama-server` 监听 `127.0.0.1` 随机端口，任何本机进程都能调用；原型已加 `--no-webui`，正式实现应改用 Unix socket 或加 token 鉴权。
- **未接入应用**：没有 IPC、设置、UI、Guard；`src/main/llm/sidecar.ts` 只被探针脚本和生命周期测试使用。
- **提示注入**：当前只有系统提示声明“文本是数据”，`parseCorrectionDecision` 仍会接受模型输出里任意合法动作 JSON。动作空间是封闭的、原型不执行动作，所以影响有限；正式接入必须用规则标记的候选窗口限定合法动作，并加对抗样例。

## 下一步（需要决策）

1. 是否 un-defer 本地 LLM（原 v0.1 deferred）。
2. 是否接受 1.5B + 规则先验的“受限决策”路线，还是转向 Apple Foundation Models/云端。
3. 体积预算：LLM 模型 opt-in 单独计量，还是修订 2 GB 总预算。
4. 补 20–30 条真实录音评测，再决定是否进入产品实现。

## 复现

```bash
# 1. 构建 llama.cpp v0.8.0（见上）
# 2. 暂存可重定位运行时
pnpm package:llm
# 3. 运行探针（模型路径替换为本机 GGUF）
pnpm llm:probe -- --binary resources/llm/llama-server --model /path/to/model.gguf --runs 3
# 4. 单元测试（决策契约 + sidecar 生命周期）
pnpm test -- --run tests/llm-decision.test.ts tests/llm-sidecar.test.ts
```
