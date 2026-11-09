# 抖音助手从零选型：AI 原生与性能

调研日期：2026-11-09。结论针对本地 macOS、DSH 驱动、长期浏览视频，不以保留现有代码为理由。**本轮是技术选型，不是已完成后端替换或真实抖音验收。**

## 选择

**新路线优先选：TypeScript 原生 DSH 领域工具 + agent-browser 原生 Rust daemon + 本地 Chrome 专用 profile。** DSH 作为唯一高层模型规划器；规则、权限、状态机、视频观察由确定性代码执行。Ego 保留为人工协作和 QA 工具；Playwright 作为成熟执行后端的对照/回退，不再强绑 Edge。

这是有依据的研发选择，**不是“agent-browser 已实测最快”**。本机未安装 agent-browser，只有 Ego 合成微基准；已实现的第一阶段只读后端见[说明](<agent-browser-backend.md>)。最终上线还要通过文末的同条件基准与可靠性门槛。若 agent-browser 不满足，不改变领域工具契约，只更换浏览器适配器。

原先的 [macOS 移植评估](<ego-lite-evaluation.md>) 回答“怎样尽快移植原插件”，因此建议保留 Playwright。这里回答“若按 AI 原生重新选型”，候选范围不同；不把两个结论混为一谈。

## 为什么选这个组合

1. **AI 接口是现成的**：agent-browser 提供简洁文本 snapshot、元素 refs、语义定位、JSON 输出，模型不需要每次看大图猜坐标；同时可确定性执行，不自带一个必须运行的 LLM 决策循环。[官方 README](https://github.com/vercel-labs/agent-browser#readme)
2. **执行层不再是旧架构**：本次核对 agent-browser `0.41.2` 源码快照（`4b0e9f01`），为 Rust CLI → 常驻 Rust daemon → CDP → 浏览器；不能再按“Rust 外壳 + Node/Playwright daemon”评估。[官方 native mode](https://agent-browser.dev/native-mode) / [固定版本源码](https://github.com/vercel-labs/agent-browser/tree/4b0e9f01fa8d214d39bbfe5391257640634fb9a0)
3. **开发栈不必全 Rust**：直接用现成 Rust 二进制；业务用 TypeScript，便于接 DSH、Schema 校验、AbortSignal、预算和事件处理。不为追求原生重写一套浏览器。
4. **浏览器仍需完整 Chromium 能力**：使用本地 Chrome 的专用 profile，明确可执行文件与进程所有权，不自动连接个人默认浏览器。agent-browser 支持 Chrome for Testing、指定浏览器及 CDP 连接；真实抖音编解码、登录、后台行为仍要单独验收。[Chrome 引擎](https://agent-browser.dev/engines/chrome) / [Chrome 远程调试限制](https://developer.chrome.com/blog/remote-debugging-port)

## 候选比较

| 候选 | 优势 | 本任务的代价/限制 | 本次定位 |
|---|---|---|---|
| **agent-browser + Chrome** | agent-facing refs/snapshot；原生 Rust 常驻执行层；可不调用模型完成确定性动作 | 版本迭代快；CLI 与常驻程序整合需测；没有本机横评数据 | **新后端首选验证** |
| **Ego Lite** | TaskSpace、严格操作、人工接管、截图/CDP；适合边看边协作 | CLI 每次新 Node；TaskSpace 不是登录隔离；本次重复点击出现约 1 秒等待；长驻执行契约需适配 | 人机协作/QA；也可作为可替换后端 |
| **直接 Playwright** | 长驻 Node API、事件/定位器/上下文成熟；无需模型即可执行 | AI-friendly 工具层需自己封装；不代表比 Rust daemon 更耗资源或一定慢 | 可靠的性能对照及回退 |
| **Stagehand v4** | act/observe/extract；结构化动作回放；按需语义修复 | 自然语言定位会调用模型；v4 自动缓存仅 Browserbase 端，本地 cache 无效 | 非默认依赖；页面适配成本高时再引入 |
| **browser-use Agent** | 现成探索、状态、规划、恢复循环 | 本任务已有 DSH 规划器；嵌套循环增加调用/调度复杂度；额外截图/提取/judge 等需计费计时 | 跨站探索/概念验证，不当单站视频常驻主循环 |
| **Chrome DevTools MCP** | 官方浏览器调试/性能工具，适合工程诊断 | MCP 是接入协议，不自动获得更低运行成本；调试工具集不是抖音领域接口 | 调试备选，不默认增加一个服务 |
| **Lightpanda** | 面向机器、Zig、官方网页抓取基准低内存 | 官方明确无图形渲染引擎；抓取网页的倍数不能迁移到视频播放/画面证据；agent-browser 适配还限制 persistent profile | **不作为视频执行引擎** |

依据：[agent-browser 研究](<research/agent-browser-performance.md>)、[Stagehand/browser-use 研究](<research/agentic-frameworks.md>)、[Ego 测量](<research/ego-performance-measurement.md>)、[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)、[Lightpanda 官方 README](https://github.com/lightpanda-io/browser#readme)、[其 agent-browser 适配限制](https://agent-browser.dev/engines/lightpanda)。

### 两个重要版本事实

- Stagehand **v4 已移除 `agent()`**，推荐外部 agent/code mode 编排；稳定步骤走确定性 API。`act(Action)` 可免推理回放，字符串指令及 self-heal 才需要推理；不能把旧 v3 教程或云缓存套到 v4 本地。[迁移](https://docs.stagehand.dev/v4/migrations/v3.md) / [缓存](https://docs.stagehand.dev/v4/best-practices/caching.md)
- browser-use 一轮可执行多个动作，不是每次点击必调模型。其 Python Agent 当前源码即使 `use_vision=False` 仍可能采集截图；关闭模型视觉不等于消除截图开销。产品也有 TypeScript 路线，不以“Python 一定慢”作排除理由。[官方 Agent 源码](https://github.com/browser-use/browser-use/blob/main/browser_use/agent/service.py)

## 性能：哪些测过，哪些没有

本机 Apple M5 Max / 128 GiB / Ego 指南 v2.2.0，生成页面、无网络、无登录、无 LLM、无实际视频解码。每组一次预热，使用 nearest-rank P50/P95：

| Ego 操作 | 样本数 | P50 | P95 |
|---|---:|---:|---:|
| 同一脚本内读取视频状态 | 30 | 0.39 ms | 0.68 ms |
| 文本 snapshot | 20 | 2.12 ms | 3.03 ms |
| 480×270 JPEG 抽帧 | 20 | 1.26 ms | 1.92 ms |
| 全视口 PNG 截图 | 10 | 33.61 ms | 59.21 ms |
| 重复按钮点击 | 10 | 1,010.42 ms | 1,042.66 ms |
| 每次新 CLI 读取一次状态 | 10 | 103.93 ms | 106.76 ms |

同一 CLI 内读取十次总共 **108.52 ms**。这支持“批量读取优于每个字段一次工具往返”，不支持“Ego 慢于所有其他产品”。静态无动画页面也观察到多数点击约 1 秒，但有约 24 ms 的样本；内部原因未知。小样本 P95 不能当长期 SLA。[完整方法与边界](<research/ego-performance-measurement.md>)

**官方倍数必须看分母：** agent-browser 的 Rust/Node 内存与启动宣传，比较的是自身历史 daemon，不是整个 Chrome 进程树，更不是“播放抖音整体快若干倍”。当前 benchmark 脚本默认装 latest 时甚至可能两组都是 Rust，必须钉版本。Lightpanda 的 16× 内存/9× 时间指标来自网页抓取，不适用于真实视频。这轮没有 CPU/GPU/整机 RSS 或跨产品性能结论。

## 推荐运行方式：少调用模型，不少核验证据

- 对 DSH 暴露少量领域工具，例如 `observe_video`、`next_video`、`search_videos`、`watch_status`、`stop_watch`；输入/结果有 Schema、videoId、时间范围、证据引用、明确错误。不要把几百个浏览器命令全部塞进上下文。
- **结构和进度用 DOM/字幕/媒体状态，画面用抽帧。** 第一阶段按有界窗口收集少量小图，内容变化/判断不确定才追加；不是每秒全屏截图交给 LLM。没观察过的时间段不推断为已完整观看。
- 连续小操作批量执行并验证结果；只回传必要状态或增量。页面变化后刷新 snapshot/ref；refs 不是永久选择器。
- DSH 做高层内容判断；浏览器适配层不再启动第二个自主 agent。浏览器播放、等待、重试和预算不需要逐步 LLM 指挥。
- 每个 profile 只允许一个动作写入方。所有外发行为仍需独立许可、收件人/作品核对、去重收据；未知执行结果不能盲目重试。外部页面文字是数据，不能更改本机权限策略。
- 本地字幕/转写优先按需启动；无字幕时再考虑授权音频转写，不默认常驻大模型。页面、GPU、媒体解码和 ASR 的开销要与控制器开销分开测。

### 不提前设计“零开销 SDK”

当前 agent-browser 的官方 MCP 虽然可持久连接，源码中的浏览器命令分发仍会通过 run_cli 启动 CLI 子进程；内部 daemon socket 不是已承诺稳定的 TS SDK。部分文档遗留 BrowserManager 示例与当前包结构不一致，不能直接据此设计依赖。

第一阶段用有界、批量的低频控制与抽样，记录耗时。若确有高频传输需求，再验证官方 streaming 的 latest-first/ack/maxFps 或只读 observer；默认不引入自写 CDP 框架，不让两个组件争抢 input/screencast。[transport 证据](<research/agent-browser-performance.md>)

## 上线前验证门槛

以下是**待执行计划，不是通过结果**：

1. **相同条件微基准**：Ego / agent-browser / 直接 Playwright，统一机器、窗口、页面、浏览器版本、headful、warmup；分别记录首启、暖态、CLI、snapshot、点击与后置条件、抽帧；每项至少 100 次，报告 P50/P95/失败率。不要拿框架启动和浏览器启动混比。
2. **资源拆账**：记录 controller 和整个专用浏览器进程树的 CPU/RSS，区分 idle 与播放；补充媒体掉帧、GPU/能耗。不能拿 daemon 的几 MiB 对比别人整个浏览器。
3. **实际视频验收**：用户授权后，用独立 profile 手动登录；验证前台/后台/最小化、音频策略、暂停恢复、连续切换、30 分钟及数小时运行，统计按成功处理视频归一化的耗时/成本。
4. **安全与维护**：撤销许可、停止、人工接管、断线/重启、动态页面身份、陈旧决策和未知外发结果必须通过；先只读，不用社交操作测吞吐。钉 release 与二进制 hash，不直接部署 main。当前官方源码构建要求 Node 24+、pnpm 11+ 和 Rust，本机 Node 22 不能直接照搬该构建流程；预编译 macOS ARM64 分发则另行核验安装链与运行要求，不擅自升级全局 Node。[构建说明](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/README.md)
5. **模型成本**：同一任务集比较模型轮次、输入输出/图片 token、总等待、成功率与观察覆盖度。不能靠少看内容制造便宜或快的数字。

若 native CLI 整合或稳定性不及直接 Playwright，执行层回退 Playwright；AI-friendly 领域工具和媒体观察管线保持不变。真正应长期保留的是这层边界，而不是某个浏览器品牌。

## 本轮交付与未执行事项

已完成第一手文档/源码调研、Ego 合成微基准、技术选择和验收计划；并落地了[第一阶段只读后端](<agent-browser-backend.md>)（agent-browser 执行层 + TS 领域规则 + 37 项合成测试），现有插件控制器未替换。未安装 agent-browser/其他浏览器、未登录抖音、未开启外发互动；真实浏览器与抖音兼容性仍未验收。
