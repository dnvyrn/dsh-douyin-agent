# 从零选型：agent-browser 是否适合作为 macOS DSH 抖音浏览底座

> 调研日期：2026-11-09。范围：官方文档与官方仓库的静态研究；未安装软件、启动浏览器、访问抖音登录态或执行性能测试。本文不修改产品源码。
>
> 版本边界：agent-browser 官方 main 在本次读取时为 `4b0e9f01fa8d214d39bbfe5391257640634fb9a0`，包版本 `0.41.2`；下列 agent-browser 仓库链接固定到该提交。Playwright、Chrome DevTools MCP 引用其官方 main 文档，不代表本机安装版已具备全部能力。[A1][A2]

## 结论先行

**值得把 agent-browser 原生 Rust + DSH 常驻 TypeScript 领域运行时列为从零选型的首要验证方案，但没有证据宣布它比直接 Playwright/CDP 更快。** 它的主要现成优势是紧凑 snapshot、refs、daemon、会话管理、增量输出和带背压的画面流，不是已经证明的抖音视频端到端性能优势。

建议的职责划分：

- **agent-browser：低频控制平面**，管理独立 Chrome 会话，完成导航、快照、异常恢复和需要语义定位的操作。
- **TS 领域运行时：先简单，再按测量升级**。第一阶段以合并 `eval`、batch 和低频控制完成结构化观测；只有持续事件或帧新鲜度确有需求，才接入常驻 observer，用官方 stream WebSocket 或浏览器 CDP 接收事件、选择关键帧。不逐帧调用 shell 或 LLM。
- **DSH/LLM：唯一的稀疏决策层**，每条视频的新证据、状态异常或需要判断时才介入；不再嵌套另一套自主 agent/LLM 循环。单一动作所有者负责写操作，避免多个工具同时控制一个标签页。
- **直接 Playwright/CDP：同等严肃的候选/回退**，尤其当需求核心是自定义持续事件循环，而非现成 agent CLI。选择它可以基于公开库接口与控制精度，不能只因为已经安装。
- **Chrome DevTools MCP：诊断与性能分析工具优先**，也具备自动化、截图、JS、快照和录像能力；不能把它描述成“不能视频”或未经测量断言它更慢。[A3][A6][A8][P1][C1][C2]

这是架构推断，不是测试排名。具体推荐必须经过本文末尾的 spike 验收。

## 1. 证据等级与性能口径

本文区分三类信息：

1. **官方事实/声称**：文档、代码或发布记录确实这样描述；性能数字仍是项目方声称。
2. **本次实测**：**无**。没有 agent-browser、Playwright、Chrome DevTools MCP 同机对照；也没有实际抖音解码、硬件加速、首帧或稳定性结果。
3. **工程推断**：根据进程、传输和事件路径提出的设计，标明边界并要求验证。

主会话另做的 Ego 合成页面测试不属于本文的官方文献研究，也不能推出 agent-browser 相对速度。合成 canvas 视频不等于真实视频解码、网络加载或 LLM 往返。

### 官方数字究竟比较了什么

| 官方声称 | 原始比较对象 | 可以支持的结论 | 不能推出的结论 |
|---|---|---|---|
| daemon 内存 `143 MB → 8 MB`，约 18 倍减少 | 旧 agent-browser Node.js daemon 与新 Rust daemon | 控制进程本身更轻的历史声称 | 整个 Chrome/renderer/GPU/视频解码只用 8 MB；比直接 Playwright 省 18 倍 |
| 冷启动 `1002 ms → 617 ms`，约 1.6 倍快 | 同一工具旧 Node 与新 Rust 路径 | 历史冷启动改善声称 | 所有热命令、视频首帧、LLM 闭环均快 1.6 倍 |
| 安装体积 `710 MB → 7 MB`，约 99 倍缩小 | 移除旧 Node 依赖树 | 工具分发依赖缩小的声称 | 连 Chrome 下载、缓存、用户数据在内总共 7 MB |
| ref 文本约 `200–400 tokens`，完整 DOM 约 `3000–5000` | 官方介绍页的输出形态示例 | 精简上下文可能有明显收益 | 对任意页面、tokenizer 或抖音内容都成立的固定比值 |
| 原生 CLI 参数解析 sub-millisecond | 原生 CLI 解析环节 | 解析启动路径轻量的声称 | 一次截图/点击/IPC/进程启动整体低于 1 ms |

前三项出自 **0.20.0 changelog**，不是本次测量；token 和解析数字也仅为官方描述。[A4][A5][A16]

### 官方 benchmark 的关键陷阱

官方 benchmark 在 **Vercel Sandbox microVM** 中比较两套 agent-browser 构建；不是 macOS 或抖音专项实验。包含 navigate、snapshot、screenshot、evaluate、click、fill、agent-loop、full-workflow，默认 1 次 warmup、10 次测量并报告标准差；分开统计 daemon RSS、browser RSS、CPU、体积等。当前代码的冷启动计时包住第一次 `open about:blank`，包含 daemon/browser 启动路径。[A5]

更重要的是，当前 README 已明确警告：第一阶段安装**未固定版本的 npm latest**，第二阶段编译一个 Rust 分支，**如今默认运行其实会比较 Rust 与 Rust**。函数名 `installNodeDaemon` 和旧日志并不证明第一阶段真是 Node。README 说 `0.23.0` 起 Rust-only，changelog 则在 `0.20.0` 就记录删除整个 Node/Playwright daemon，两处版本阈值不一致。重现历史对照必须选定并核实真实旧实现，不能照抄默认脚本便宣称复现历史数字。[A4][A5]

该 benchmark README 自己也提醒：命令延迟主要受 CDP 往返影响，daemon 间单命令差异通常较小；应看标准差。它没有给出直接 Playwright 或 Chrome DevTools MCP 的公平横向结果。[A5]

## 2. agent-browser 当前架构，不再是“Rust 外壳 + Node 后端”

官方当前架构为：

```text
短生命周期原生 Rust CLI
  → 会话 daemon（Rust，首次命令自动启动）
    → 持续的 CDP 连接
      → Chrome / Chrome for Testing
```

- Node.js/Playwright daemon 已移除；浏览器在 CLI 命令之间保持打开。每个独立 `--session` 通常拥有自己的 daemon 和浏览器。[A3][A4]
- macOS ARM64 和 x64 都有原生二进制；可经 npm/Homebrew 分发。npm 安装脚本、JS launcher 或构建工具仍可能涉及 Node，**“运行时浏览器控制后端是 Rust”不等于“安装/构建链条从此没有 Node”**。源码构建文档要求 Node、pnpm 和 Rust。[A2][A3][A16]
- 默认浏览器是 Chrome for Testing；也支持连接现有 Chrome。当前安装器在 macOS 13 以下停止自动下载并给出提示，实际部署需核对系统版本和浏览器路径。[A3][A16]
- 默认 headless 会话无命令/交互一小时后退出；有配置的恢复状态会保存。仅指定 session 不会自动获得跨重启持久化。持续“看”视频不应未经验证地依赖所有只读观测都重置 idle timer。[A6][A8]

**工程含义：**常驻浏览器能摊销冷启动，但每个 shell 调用仍有 CLI、IPC、序列化和输出成本；不能把“daemon 常驻”误写为“外部程序已在同一进程中直接调用所有 API”。

## 3. 持久编程接口：哪些是公开能力，哪些不能直接依赖

| 接入方式 | 核实状态 | 设计限制 |
|---|---|---|
| CLI `--json`、`batch` | 官方公开；batch 在一次调用中执行多条命令 | 适合合并已知步骤，仍非持续事件订阅；需要读 snapshot 再决定 ref 时不能盲目预编排 |
| `agent-browser mcp` stdio | 官方公开的持久 NDJSON JSON-RPC 服务 | **持久 MCP ≠ 没有子进程**：源码 `run_cli` 用 `Command::new(current_exe())` 执行 CLI 工具 |
| stream WebSocket | 官方公开的持续帧/状态/URL流和输入通道 | 能持续预览/采样；不是所有 CLI 语义命令的通用 WS RPC |
| `get cdp-url` + 外部 CDP 客户端 | 官方公开取已有浏览器 CDP URL；不会为了此命令启动浏览器 | TS observer 可直连浏览器，但生命周期、标签页归属、权限与双写冲突必须自己管理 |
| daemon 内部 socket | 源码存在；Unix 路径用 UnixStream，单命令连接并交换一行请求/一行回复 | 未找到作为稳定外部 SDK 的兼容性承诺；不要把私有 IPC 当长期公共 API |
| `import { BrowserManager } from 'agent-browser'` | streaming 文档仍有该 TypeScript 示例 | 当前包清单无 `main`/`exports` 库入口，分发清单主要为 bin/scripts/skills，且已移除旧 Node 后端；**文档与包结构不一致，未验证可用，不能据此承诺现成 TS SDK** |

证据：CLI/MCP 命令文档、streaming 文档、包清单，以及当前 transport 源码。[A2][A7][A8][A12][A13]

**建议：**低频命令通过官方 CLI/持久 MCP；高频观测走公开 stream 或直接 CDP。若未来为极限性能直连内部 socket，应钉版本并自建契约测试，明确承担内部接口升级风险。不要仅因为存在 Rust daemon 就省略这项验证。

## 4. AI 原生交互：节省 token，但快照不是视频内容

### Snapshot / refs

- `snapshot` 输出紧凑 accessibility tree；`-i` 仅交互元素，**会过滤非交互正文**。需要标题、状态、字幕等可见文本时不能一律只用 `-i`；`-c` 保留可见/状态文本与直接祖先，也可限定深度 `-d` 和范围 `-s`。[A9]
- `@eN` 在 DOM 节点存活时可跨快照保持；节点替换、页面/iframe 导航会失效，不回收旧 ID。虚拟 accessibility 节点的 ref 仅在对应 snapshot 内有效。替换后仅在 role/name 唯一匹配等条件下回退；有歧义则失败。[A9]
- 交互后应观察新状态，导航后必须新 snapshot。无限 feed 可能复用节点：**稳定 ref 只能说明同一个 DOM 节点，不代表还是同一条视频**；领域层需要单独维护 `video identity + URL + observation timestamp`。此项为工程推断。
- `snapshot --delta` 有 full/unchanged/incremental 三类结果，按 tab 与选项集维护基线；URL 变化/大差异回全量，`--full` 重置基线。结构变化和 ref metadata 都要按 revision 应用，不只是拼接一段文字。[A7]

### 截图、JS 和事件

- 有普通/标注截图、JPEG 质量配置、`screenshot --if-changed` 与阈值；这些机制可以减少不变输出，但不能承诺免除截屏/像素比较成本。[A7][A9]
- `eval` 可执行页面 JS；启动时 `--init-script` 能安装可信观察脚本。可据此在页面内维护媒体状态、MutationObserver 或事件汇总；脚本可靠性与站点适配仍是实现工作。[A7][A10]
- 文本快照不包含视频画面语义；同样，截图不包含音频。推荐将标题/作者/页面可见字幕、播放器状态与稀疏视觉证据分开获取，不把 accessibility snapshot 当作“已看完视频”。
- 高频逻辑应在本地事件循环合并：`loadedmetadata`、`playing`、`waiting`、`ended`、页面/视频切换等事件触发更新；不为每个时间进度事件唤醒 LLM。以上是方案设计，不声称工具已内建抖音理解。

## 5. 连续画面、录像与实际视频播放的边界

### 官方 streaming 的可用性能机制

每会话自动有本地 WebSocket stream server（OS 分配端口，也能显式设置），连接客户端后交付画面。实时流使用 JPEG/base64，有捕获时间戳与单调 `seq`，支持 URL/status 等消息及鼠标、键盘、触摸输入。[A8]

已核实的背压语义：

- **latest-first 单槽**：发送时读取最新帧，中间帧被覆盖，不在应用层无限排队。
- 默认 **push** 仍可能在底层 socket/kernel 堆积，不能宣称默认链路“永不积压”。
- **ack pacing**：至多一帧 in-flight，客户端处理完回传 `seq` 后再交付最新帧；代价是吞吐受传输加 ack 往返限制。经代理时要透传最终消费者 ack，不能提前代确认。
- **每客户端 `maxFps`**：限制该客户端收到的帧数，可与 ack 组合；这是下游发送速率，不等于让 Chrome 视频解码/上游采集成本按同样比例降低。
- 输入处理独立于帧发送，慢客户端写帧不必阻塞输入任务。console/status 等通道不是无限持久日志，落后过多仍可能丢消息。[A8]

官方示例称繁忙页面 1280×720、quality 80 约 54 KB/帧；quality 20 约 25 KB；640×360、quality 20 约 9 KB。这只是官方例值，不是本机测量，也不是所有视频压缩率。配置 knobs 为 `AGENT_BROWSER_STREAM_QUALITY`、`AGENT_BROWSER_STREAM_MAX_WIDTH`、`AGENT_BROWSER_STREAM_MAX_HEIGHT`。[A8]

**建议初始方案（非实测最优值）：**预览和分析分开，低分辨率 JPEG + ack/maxFps 防积压；本地按时间/状态变化挑关键帧。视频持续运动会令全帧 `--if-changed` 总有变化，因此还需要视频身份、ROI 或时间窗口门控，不能仅靠“截图有变化就调用模型”。

### 录像不等于媒体理解

`record start` 在当前页原地记录，不另起 context/tab；只有录像需要 ffmpeg。当前文档支持 WebM VP8/libvpx、MP4 H.264/libx264，默认 30 fps，可选 1–60 fps；实际独立画面受页面重绘速度限制，记录文件可能保持上一帧以维持墙钟时长。[A11]

这些能力只能证明能够捕获 viewport，不能证明：

- 抖音的具体编码、DRM、自动播放、音频、GPU 或 macOS headless 路径必然兼容；
- 网页录像捕获了原视频音轨，或模型“看懂了”全段内容；
- 输出文件 30 fps 就有 30 张独立的新视频帧。

对于真实视频站，先选择完整 Chrome 路径。Lightpanda 虽有官方速度/内存宣传，但 agent-browser 文档明确其截图依赖 CDP 支持，且缺少 persistent profiles/state；这些证据不足以支持用它替代抖音视频播放所需的完整浏览器能力。[A17]

## 6. 会话隔离与持久化

三种概念应分开：[A6]

1. **活会话复用**：同一 `--session` 复用 daemon/browser；独立本地 session 有独立 cookies、storage、history/auth。
2. **跨重启恢复**：`--restore` 配合稳定 session 保存/恢复相关状态；默认有周期保存与退出保存。session ID 本身不是持久化开关。
3. **完整 profile 路径**：`--profile <专用目录>` 持久保留 cookies/localStorage、IndexedDB、service workers、cache 等。建议给 DSH 专用目录，避免操作日常个人 profile。

文档还支持按名字复制个人 Chrome profile 到临时快照。这不是本项目应自动执行的默认方案；涉及个人登录态，必须单独授权，本次完全未读取或复制。[A6]

连接共享 Chrome 时，`--session` 不会神奇地隔离同一浏览器 profile。`--pin-tab` 能严格绑定 target，标签页消失返回 `tab_gone`、不静默切换，但它是标签页归属保护，不等于独立登录态。[A14]

**工程要求：**一个 profile 一个明确所有者；重连后校验 target/video 身份；CDP 仅本机可达。不要把 cookies、CDP URL、页面敏感正文或录像无筛选地写入模型上下文。公共 CLI 策略与 profile/restore 等选项的组合有约束，必须针对最终配置验证，不把文档中的每个安全开关随意拼接。[A6][A7]

## 7. 与直接 Playwright、Chrome DevTools MCP 的公平比较

| 维度 | agent-browser 当前原生版 | 直接 Playwright 库 | Chrome DevTools MCP |
|---|---|---|---|
| 主要运行方式 | Rust CLI + Rust daemon + CDP | 应用常驻进程调用库；可经 CDPSession 下沉 | Node MCP/CLI，使用 Puppeteer 做 Chrome 操作 |
| AI 友好现成接口 | 紧凑 AX/ref、delta、CLI/JSON、MCP | 需自行设计领域工具和输出压缩；不是没有能力 | MCP 工具、snapshot UID、截图、JS，已有 CLI |
| 连续事件 | stream WS；JS instrumentation；可外接 CDP | `CDPSession.send`/`.on` 公开接口直接持续订阅 | 工具适合诊断/离散操作；不能据此认定后端无法连续观测 |
| 视频/画面 | live stream、截图、viewport record | 截图/录制；当前 main 有 Screencast onFrame | `screencast_start/stop` 录制 MP4、截图 |
| 状态 | session、restore、专用 profile | persistent context 专用目录、普通 contexts | 默认独立持久 profile，也可 `--isolated` 临时 |
| 从零的工程优势 | 少写 agent-facing 控制/快照/会话代码 | 热路径精确可控；公开库与事件接口 | 现成 trace、网络、console、调试/性能分析 |
| 未证明部分 | 本机相对速度、真实抖音播放、TS SDK可用性 | 本机相对速度、具体版本/API、真实站点鲁棒性 | 本机相对速度、长期业务闭环效率 |

来源：[A3][A6–A13][P1–P3][C1–C3]。不按“AI-native”标签或是否预装给性能分数。

### 直接 Playwright 的重要补充

- `CDPSession.send()` 调用协议方法、`.on()` 订阅事件，是官方接口；可以在一个长期运行进程中处理事件，不必每个动作走一次 LLM/MCP/shell。[P1]
- 当前 main 的 `Screencast` 标记自 1.59 起有 JPEG `onFrame` callback、时间戳、质量/尺寸和录像；`fps` 自 1.64 起只控制录像输出。必须核对实际安装版，不能直接假设旧版已有。[P2]
- `launchPersistentContext(userDataDir)` 提供持久状态，官方禁止同目录多实例，并警告不要使用日常 Chrome 默认用户目录。`connectOverCDP` 官方注明比 Playwright 原生协议连接 fidelity 低；共享外部浏览器不是零风险方案。[P3]
- 官方浏览器文档建议需要专有媒体 codecs 时考虑 stock Chrome/Edge。不能把任意 Chromium build 的播放结果直接推广给 Chrome。[P3]

### Chrome DevTools MCP 的重要补充

- 当前同时提供 MCP 和 CLI；基于 Puppeteer 的等待/操作，不是 Playwright 套壳；官方支持 Chrome/Chrome for Testing。[C1]
- 当前工具含 AX snapshot、evaluate、截图、network/console、性能 trace 和 screencast。screencast 工具文档描述的是录制 MP4，不应直接等同 agent-browser 的公开实时 WS 帧协议。[C2]
- 默认专用持久 profile 在 `$HOME/.cache/chrome-devtools-mcp/chrome-profile`，同 profile 不能多实例；`--isolated` 临时化。当前 `pageId` 路由支持共享服务器会话，不能简单说“多会话都争全局选中页”。[C2][C3]
- 使用统计默认开启，可用 `--no-usage-statistics` 关闭；性能分析可能发送 trace URL 给 CrUX，`--no-performance-crux` 可禁用。抖音登录态/私人内容场景应显式配置。[C1]

## 8. 推荐的 DSH 运行模型

先用低频 `eval`/batch 建立可用闭环，不预先叠加常开帧流或第二套自治 agent。下图是持续观测确有测量需求时的升级形态；否则保留简单的领域工具适配器即可。

```text
完整 Chrome：专用 profile + 单一写操作所有者
  ├─ 控制：agent-browser CLI / MCP，导航、snapshot、恢复
  ├─ 观测：持久 stream WS 或直接 CDP + 页面内媒体/DOM hooks
  │    → 最新帧槽 + 有界事件缓冲 + 视频身份/状态机
  │    → 文本优先、按需关键帧，形成小型 observation bundle
  └─ DSH 领域工具：observeCurrentVideo / sampleEvidence / nextVideo
       → LLM 仅在视频切换、证据足够、异常或需判断时运行
```

以上为建议接口名，不是已实现工具。

- 工具返回内容应包括 observation 时间、video identity、播放状态、来源/证据片段与少量关键帧，而不是每次完整 DOM 或全尺寸 PNG。
- `nextVideo` 是带前置身份校验与后置状态验证的确定性操作；切换后等待实际播放器/身份变化，不依赖固定 sleep 或持续连接页面的 `networkidle`。
- 文本足以筛选时不调用视觉模型；需要理解视觉内容时才取稀疏关键帧。需要听懂讲话则是另一个有授权/资源预算的音频或字幕路径，不能假装截图覆盖了它。
- 长视频的周期采样由本地定时器/事件循环处理；LLM 不承担逐帧控制。分别监测浏览器解码、观测采集、传输、工具调用、模型推理的成本。
- 限时/限量、可停止、错误熔断、登录/验证码人工接管；不自动评论、点赞、关注、发布或跨账号操作。页面文字视为不可信数据，不允许其改变任务权限。
- 如 observer 已直接 CDP 接管所有高频操作，需评估 agent-browser 是否仍提供值得保留的控制面价值；没有必要为了“AI 原生”称号叠加无用层。

## 9. 决策前的 spike 门槛（本次均未执行）

1. **固定变量**：macOS/CPU、工具版本、Chrome build、headless/headed、viewport、profile、codec、GPU条件；冷启动与热路径分开统计。
2. **传输分层**：原生 CLI 单次、batch、常驻 MCP、stream、直接 CDP/Playwright 分别测 p50/p95；不能用 Node CLI 启动耗时代表底层 browser API。
3. **端到端媒体**：先合成页面验证 plumbing，再测获准的实际视频播放；记录首帧、playing/waiting、掉帧/停顿、frame age，不能把截图成功当播放成功。
4. **内存分层**：分别记录 CLI/daemon/observer、Chrome browser、renderer、GPU 与总进程树；不能引用 daemon-only 8 MB 作为系统容量规划。
5. **可靠性**：持续 feed 切换、节点复用、陈旧 ref、标签页关闭、daemon 重启、idle timeout、页面重连；只统计延迟会掩盖误操作与恢复成本。
6. **接口契约**：验证所选 agent-browser 版本的 MCP、stream、CDP URL与 profile 路径；不依赖未确认的 `BrowserManager` TS 导入。
7. **抢占/并发**：验证同页 stream/record/CDP 多消费者是否互相重设 screencast 配置；所有写操作串到单一执行器。
8. **模型成本**：单视频输入 token、视觉调用次数、工具往返数与最终判断质量一起看；先满足质量/安全，再优化耗时。

只有这些测试通过，才能把“agent-browser + TS 领域运行时”从候选变为正式底座。若常驻编程契约或真实视频路径不达标，直接 Playwright/CDP 是合理回退，不是因为惯性而保留旧栈。

## 官方来源索引

### agent-browser

- [A1：读取时的 main 提交](https://github.com/vercel-labs/agent-browser/commit/4b0e9f01fa8d214d39bbfe5391257640634fb9a0)
- [A2：package.json，版本、分发与入口](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/package.json)
- [A3：README，当前架构、平台与 MCP](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/README.md)
- [A4：CHANGELOG，0.20.0 原生迁移与性能声称](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/CHANGELOG.md)
- [A5：benchmark README，方法及默认 Rust/Rust 警告](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/benchmarks/README.md)；[计时代码](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/benchmarks/bench.ts#L562-L576)
- [A6：Sessions](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/docs/content/docs/sessions.mdx)
- [A7：Commands，batch、MCP、delta、JS、截图与 CDP URL](https://agent-browser.dev/commands)
- [A8：Streaming，协议、ack/maxFps及仍存在的 TS 示例](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/docs/content/docs/streaming.mdx)
- [A9：Snapshots，refs 生命周期与文本过滤](https://agent-browser.dev/snapshots)
- [A10：Init Scripts](https://agent-browser.dev/init-scripts)
- [A11：Video Recording](https://agent-browser.dev/recording)
- [A12：MCP 的 CLI 子进程实现](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/cli/src/mcp.rs#L4497-L4503)
- [A13：CLI/daemon 内部请求传输](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/cli/src/connection.rs#L1342-L1384)
- [A14：CDP Mode 与 tab pinning](https://agent-browser.dev/cdp-mode)
- [A15：Native Mode，确认删除旧 Node/Playwright daemon](https://agent-browser.dev/native-mode)
- [A16：Installation](https://agent-browser.dev/installation)；[介绍页的 token 示例](https://github.com/vercel-labs/agent-browser/blob/4b0e9f01fa8d214d39bbfe5391257640634fb9a0/docs/content/docs/index.mdx)
- [A17：Lightpanda 支持边界](https://agent-browser.dev/engines/lightpanda)

### Playwright

- [P1：官方 CDPSession API 源文](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-cdpsession.md)
- [P2：官方 Screencast API 源文](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-screencast.md)
- [P3：官方 BrowserType，persistent context、CDP fidelity 与媒体说明](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-browsertype.md)

### Chrome DevTools MCP

- [C1：官方 README，架构、CLI、支持范围、遥测](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/README.md)
- [C2：官方工具目录，pageId、snapshot、JS 与 screencast](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
- [C3：官方高级使用指南，profile 与并发会话](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)
