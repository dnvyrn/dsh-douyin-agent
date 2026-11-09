# 从零选择 macOS DSH 抖音视频助手技术栈：Stagehand / browser-use

调研日期：2026-11-09。仅查阅官方文档及官方仓库；未安装或运行框架、未打开抖音/联系用户账号、未修改源码。本文是架构建议，不是抖音实测结果。**不以已有实现或沉没成本为依据。**

## 结论先行

**推荐：TypeScript 原生 DSH 领域工具 + 本地 Chromium 浏览器引擎 + 独立视频证据管线；不把另一个自主浏览器 agent 作为常驻主循环。**

- 浏览器执行层优先评估 **Playwright 管理的本地持久化 Chromium context**；只有接入既有、明确授权的 Chromium 实例时才用 CDP。把引擎藏在适配器后面，不把抖音逻辑绑死在底层选择器 API。
- **Stagehand 更适合可选的语义定位/页面变化修复层**：稳定路径不用模型；定位失效时才 `observe`，校验后回放 Action。也可评估直接用其本地 browser API，但没有本任务数据证明其引擎比 Playwright 快。
- **browser-use 更适合未知网站、多步骤探索、快速做概念验证或明确需要托管 agent 的场合**。对反复执行的单站视频阅读任务，其现成自主循环的便利，不等于更低的长期模型调用/截图/重试成本。
- “AI 友好”应优先解释为**模型容易调用、可验证、有明确错误和证据的工具契约**，不是“每个点击都必须让 AI 看截图”。此方向与 Stagehand v4 官方推荐的稳定步骤确定性执行、模型只处理必要判断相符。[S1][T1]

以上是基于机制的推荐，不是性能排名。若之后实测显示页面变化频繁到确定性适配器维护/修复成本超过自主 agent，应该允许推翻这个选择。

## 1. Stagehand：能力、版本与真实成本

### 当前版本不能套用旧教程

官方当前文档及仓库指向 **v4**；v4 已移除内置 `agent()`，保留 `act/observe/extract`，把控制流交给调用者。官方推荐 code mode：AI 生成脚本，稳定步骤用 `page.locator()` / `page.goto()`；需要判断时才调用模型方法。不要把 v3 的 `new Stagehand().init()`、`agent()`、`cacheDir` 与 v4 混用。[S1][S2]

| 能力 | 官方事实 | 对本任务的含义（判断） |
|---|---|---|
| `act(instruction)` | 单步自然语言动作；字符串输入需要模型推理寻找目标。[S3] | 容易写，但若每条视频每个按钮都这样调，会反复付出模型等待和输入输出成本。 |
| `observe(instruction)` | 返回带 selector / method / arguments 的结构化 Action，可先验证再执行。[S4] | 适合作为一次性发现或有预算的修复，不必每次滚动都重复发现。 |
| `act(Action)` | 官方明确为确定性回放、不做推理。[S3] | 可把观察结果缓存为动作；仍有浏览器执行/页面等待，不是零延迟。 |
| `extract(instruction, schema)` | TS 用 Zod 指定输出结构，返回前校验。[S5] | 对变化页面方便；结构合法不等于事实正确，不能替代视频证据，也不应代替已能稳定读出的标题/时长字段。 |
| `selfHeal` | selector 失效时重新推理并重试。[S3][S6] | 是有条件恢复，不是免维护或免模型费；旧选择器仍能点击但语义已错时，更需要结果校验。 |

### 缓存：必须区分版本和部署位置

- **v4 自动缓存是 Browserbase 管理的服务端缓存**，覆盖符合条件的 `act/observe/extract`；键涉及指令、页面内容及选项。命中可省推理与模型 token，但网络/浏览器工作不会因此全部消失。[S7]
- **v4 本地浏览器的 `cache` 选项没有效果**：官方明确没有 Browserbase session 就不能使用该服务端缓存。不能把“开启缓存后无 token”承诺给 macOS 本地方案。[S7]
- 本地可自行保存 `observe` 的 Action 并用 `act(Action)` 回放，但缓存命中条件、失效检测、页面身份和动作后置条件仍由应用负责。动态 feed 的内容/URL 在变化，不应预设高命中率。[S3][S4][S7]
- **v3 文档另外提供 Local Cache / `cacheDir`**。这是旧版能力证据，不是 v4 的可用配置；如果考虑锁 v3，需独立评估版本维护，不建议为了一个旧缓存功能直接锁旧版。[S8]

### 本地、CDP 与模型连接

官方支持 `localBrowser.launch`、`localBrowser.connect({cdpUrl})` 和 Browserbase；仓库展示 `userDataDir` 持久化本地登录状态。**本地浏览器不等于本地模型**：v4 本地需显式 provider 凭证或自定义 LLM callback；Model Gateway 只适用于 Browserbase 浏览器。[S2][S9][S10]

对 DSH：可以保留 DSH 为唯一任务规划器，只在领域工具内部按需调用 Stagehand。模型 callback 提供集成入口，但不能据此假设 DSH 当前模型供应商、鉴权和结构化输出要求已自动兼容；这是后续适配验证项。不要形成“DSH 规划 → 子 agent 重新规划 → 每一步又做语义定位”的无界嵌套。

## 2. browser-use：自主循环的价值与开销

### Python agent 不是单纯的截图点击器

开源 Python 的 `Agent.step()` 源码是：准备浏览器状态/上下文 → 获取模型输出 → 执行动作 → 后处理；模型输出可以包含多个动作，受 `max_actions_per_step` 限制。因此**不能宣称每次点击必定单独调用一次 LLM**。它既利用 DOM 状态，也支持视觉；本次不把它歪曲成纯截图方案。[B1][B2]

便利来自现成的任务循环、动作注册、状态管理、历史、失败处理和完成判断。代价来自实际执行路径：

- 正常决策轮次调用模型；重试可能再调用。页面提取、启用后的历史压缩、judge 等还可能增加模型调用，不能只按浏览器动作数估计账单。[B1][B2]
- `use_vision`、`vision_detail_level`、`flash_mode`、`max_actions_per_step` 等可调。官方 fast-agent 示例从模型选择、页面等待和 agent 输出开销优化；这些是调节手段，**不证明抖音任务的成功率/耗时**。等待设得更激进，也需核验页面未就绪导致的重试。[B2][B3]
- **重要源码细节**：本次读取的 `main` 中，`_prepare_context()` 使用 `get_browser_state_summary(include_screenshot=True)`，然后按 `use_vision` 构造模型消息。也就是说，关闭模型视觉输入，不能直接等同于取消截图采集成本。此结论限定于本次源码快照，后续版本必须复查。[B1]
- 可用 `calculate_cost=True` 和 usage summary 记录模型成本。完整端到端性能还要在应用层统计浏览器、媒体与失败时间。[B4]

### Local / cloud / profiles

官方提供本地开源 agent，也提供云浏览器和托管 Agent API；这些不是同一个产品或同一个账单。BrowserProfile 源码包含 `cdp_url`、`use_cloud`、`user_data_dir`、`profile_directory`；本地有 macOS system Chrome/profile 自动发现文档。云 profile 保存 cookies、local storage、登录状态，以 profile ID 跨浏览器复用。[B5][B6][B7][B8]

- **本地**：保留本机账号状态，承担本机 Chromium/媒体解码资源；如果调用远端 LLM，页面内容或截图仍可能出机。
- **云端**：减少本机浏览器运维，不代表免浏览器费用/模型费用/网络费用；账号状态与内容交给额外服务方。是否比本机更快取决于浏览器、模型、站点的网络位置，不能从托管便利推导抖音访问表现。
- **profile 便利不应覆盖安全和兼容性**：建议独立专用 profile，由用户手动登录；不要默认复制/上传日常浏览器资料，不并发写同一 profile，不把 Cookie 回传给模型。[B6][B7][B8][C1]
- 当前官方 README 也提到 TypeScript 产品，云文档有 TS SDK。本文此节主要核对开源 Python Agent 实现，**不声称 browser-use 只支持 Python**。若选 Python，在 TS DSH 中多一个运行时/进程边界属于部署复杂性；没有数据证明语言本身是主要延迟。[B5][B8]

## 3. 为什么用结构化领域工具，而非通用截图 agent 做主路径

OpenAI 官方 function calling 支持 JSON Schema 工具；Anthropic 官方工具设计建议强调适当粒度、明确命名、有效上下文及 token 效率。这支持“把稳定低层步骤封装成模型友好的任务工具”，但不构成任何特定性能倍数的证据。[T1][T2]

建议契约（待设计，并非已实现 API）：

```text
douyin.search({query, cursor?, limit})
douyin.open_video({videoId})
douyin.read_metadata({videoId})
douyin.read_transcript({videoId})
douyin.sample_frames({videoId, timestamps?, budget})
douyin.read_comments({videoId, cursor?, limit})
```

工具返回短而稳定的结构：videoId、来源 URL、采集时间、证据引用、覆盖区间、缺失字段、是否截断、可恢复错误；不要把整页 DOM、全量评论或重复 base64 灌进对话。工具内部完成定位、等待、分页、去重与后置校验，DSH 决定“找什么、看哪段、是否值得进一步分析”。

通用浏览器/截图工具保留为显式 fallback：面对未知弹窗、页面改版或语义定位失败时，有限次探索；成功后把新路径收敛为可测试适配器。遇到登录、验证码或账号风控交给用户，不尝试绕过。网页文本、评论、字幕都是不可信数据，不能成为新指令。

如果将来支持点赞、关注、评论、私信，要与只读工具分离，明确授权和目标，发送前预览，发送后独立核验；不能因 self-heal 或重试重复产生副作用。这里的安全/工具形状是本项目设计建议，不是框架自动提供的保证。

## 4. 性能账：一次开发便利 vs 每次运行成本

以下是分解模型，不是测量结果；并行步骤应按关键路径计时，而非机械相加。

```text
端到端耗时 ≈ 页面/网络等待 + 浏览器操作/快照
            + 串行模型轮次 + 媒体获取/解码/转写 + 重试恢复
持续费用 ≈ 文本/图片输入与输出模型费 + 额外提取/判断调用
          + 云浏览器/网络（若使用）+ 本机 CPU/GPU/内存/存储
```

| 方案 | 节省的开发工作 | 重复运行时要付出的成本 |
|---|---|---|
| 原生领域工具 + 浏览器引擎 | 不自动解决站点适配，需要写定位、状态和证据契约 | 稳定浏览器步骤可无内部模型调用；仍有 DSH 的高层判断、站点加载和视频分析。 |
| Stagehand 按需语义动作 | 少写部分选择器、获得结构化提取/修复接口 | 冷路径/修复调用模型；Action 回放可免推理；v4 本地不可依赖云自动缓存。 |
| browser-use 自主 agent | 现成探索、计划和多步执行循环 | 按轮构建状态、模型决策，可能有图像输入、额外提取/judge、失败恢复；可调但不是免费。 |
| 通用截图 agent | 最少站点专用逻辑，能处理 DOM 不可表达的界面 | 需要截屏、视觉推理、坐标执行及验证；仍不能把 UI 截图当成完整视频理解。 |

**应减少不必要的串行模型轮次，而非先争论 TypeScript vs Python 的执行速度。**这是由上述调用结构推导的优化优先级，尚未证实它在每一台 Mac/每一种模型配置下都是最大瓶颈。[S1][S3][B1]

### 视频是独立的主要成本轴

`extract()` 读到网页文字，或 agent 看见播放器某一帧，**都不能证明理解了整条视频**。必须将页面操作、视频证据获取、内容推理拆开。

建议分级：元数据/已授权可取得的字幕 → 少量明确时间点的帧 → 按疑点补帧/音频转写。字幕只覆盖语言，画面只覆盖所采时刻；结论必须标记盲区。对可合法访问的媒体，可再评估专用媒体解码/抽帧组件；本调研没有确认抖音字幕、下载或 seek 的可用性。

图片模型输入有 token 成本，其计算依赖模型、图片尺寸/细节设置；不要用固定“每张多少钱”跨模型估算。批量送多帧可减少请求往返，**不等于免除这些帧的视觉输入成本**。[V1]

应按 videoId + 媒体版本/证据 hash 缓存元数据、转写和帧分析；同一页面反复截图不能代替内容去重。限制每视频采样预算和升级条件，避免对所有候选视频全量转写/密集抽帧。采样太稀可能漏掉关键动作，必须把完整性作为准确率指标，而不是只优化 token。

## 5. 本地浏览器边界与后续验证

- Chrome 官方从 **136** 起，默认用户资料目录不再接受 `--remote-debugging-port/pipe`，要求非默认 `--user-data-dir`；推荐自动化使用 Chrome for Testing。这也是独立 profile 的兼容性理由，不仅是偏好。[C1]
- Playwright 官方说明 `connectOverCDP` 仅支持 Chromium，且相较其原生连接保真度较低。因此从零构建优先自己管理浏览器；需要连接现有实例时才接受 CDP 兼容性权衡。[C2]
- 不以 headless、stealth、云代理宣传推导抖音可用性，也不承诺绕过反自动化。账号、播放、字幕、网页变化和媒体限制都未验证。

**经用户另外授权后才做的对比测试**：固定同一任务、模型、浏览器版本和视频样本，分别比较原生领域工具、Stagehand 冷/回放/修复路径、browser-use DOM/视觉配置；记录冷启动和热运行、成功率、p50/p95、LLM 实际调用/输入输出/图片用量、等待与重试、CPU/RSS、媒体时长/帧数、证据覆盖与错误恢复。失败请求也计入成本；Stagehand 文档注明抛异常前未返回结果的调用不计入其成功操作 metrics，需另补端到端账。[S6][B4]

**最终选择边界**：重复单站、低延迟、账号留本机 → 原生领域工具优先；已知流程偶尔变版 → 加 Stagehand 定点修复；跨站未知流程且愿意支付探索成本 → 再选 browser-use 或其他自主框架。没有本任务基准，不提供延迟、token 节约比例、吞吐或成功率数字。

## 官方来源

所有链接本次通过 web_fetch 查阅。文档和 GitHub `main` 可变化；本文不是固定版本锁文件，实施前应锁定依赖并复核 API。

- [S1 — Stagehand v3 → v4：移除 agent、code mode、稳定步骤不做推理](https://docs.stagehand.dev/v4/migrations/v3.md)
- [S2 — Stagehand 官方仓库：v4、TS、本地持久化示例](https://github.com/browserbase/stagehand)（读取 [raw README](https://raw.githubusercontent.com/browserbase/stagehand/main/README.md)）
- [S3 — Stagehand act：指令/Action、self-heal](https://docs.stagehand.dev/v4/basics/act.md)
- [S4 — Stagehand observe：结构化动作与回放](https://docs.stagehand.dev/v4/basics/observe.md)
- [S5 — Stagehand extract：Zod schema](https://docs.stagehand.dev/v4/basics/extract.md)
- [S6 — Stagehand API：selfHeal、usage、metrics 限制](https://docs.stagehand.dev/v4/reference/stagehand.md)
- [S7 — Stagehand v4 caching：云缓存、本地限制](https://docs.stagehand.dev/v4/best-practices/caching.md)
- [S8 — Stagehand v3 caching：Local Cache 与云缓存](https://docs.stagehand.dev/v3/best-practices/caching.md)
- [S9 — Stagehand browser：local launch / CDP / cloud](https://docs.stagehand.dev/v4/configuration/browser.md)
- [S10 — Stagehand models：Gateway / provider / callback](https://docs.stagehand.dev/v4/configuration/models.md)
- [B1 — browser-use Python Agent 源码：step、_prepare_context、get_model_output、judge](https://raw.githubusercontent.com/browser-use/browser-use/main/browser_use/agent/service.py)
- [B2 — browser-use AgentSettings 源码：视觉、动作、提取/压缩/判断配置](https://raw.githubusercontent.com/browser-use/browser-use/main/browser_use/agent/views.py)
- [B3 — browser-use 官方 fast-agent 示例](https://docs.browser-use.com/open-source/examples/templates/fast-agent.md)
- [B4 — browser-use 成本跟踪](https://docs.browser-use.com/open-source/development/monitoring/costs.md)
- [B5 — browser-use 官方 README：开源、本地/云、产品边界](https://raw.githubusercontent.com/browser-use/browser-use/main/README.md)
- [B6 — browser-use BrowserProfile 源码](https://raw.githubusercontent.com/browser-use/browser-use/main/browser_use/browser/profile.py)
- [B7 — browser-use system Chrome / macOS profiles](https://docs.browser-use.com/open-source/customize/browser/real-browser.md)
- [B8 — browser-use 云 profile：持久状态、TS/Python SDK](https://docs.browser-use.com/cloud/guides/authentication.md)
- [C1 — Chrome 官方：远程调试与非默认资料目录](https://developer.chrome.com/blog/remote-debugging-port)
- [C2 — Playwright 官方：BrowserType / connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)（另读取 [官方文档源码](https://raw.githubusercontent.com/microsoft/playwright/main/docs/src/api/class-browsertype.md)）
- [T1 — Anthropic 官方：有效工具、粒度与 token 效率](https://www.anthropic.com/research/writing-tools-for-agents)
- [T2 — OpenAI 官方：function calling / JSON Schema](https://developers.openai.com/api/docs/guides/function-calling.md)
- [V1 — OpenAI 官方：图像输入、detail、模型相关 token 计算与局限](https://developers.openai.com/api/docs/guides/images-vision.md)
