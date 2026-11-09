# Ego Lite 本机合成页面性能记录

2026-11-09，Asia/Singapore。**这是 Ego 单产品微基准，不是浏览器横评。** 没有安装 agent-browser，没有测 Playwright 的同条件数据，不能据此给它们排名。

## 环境与边界

- Apple M5 Max，128 GiB 内存，macOS arm64；Ego CLI 自带指南 `v2.2.0 (macos)`。
- 第一手接口依据：安装后的 `ego-browser skill`，Run browser scripts、Spaces/rounds/pages、Page JavaScript and CDP、User control and completion 各节。每次 CLI 启动新 Node，TaskSpace/页面保留；custom API 不等于 Playwright。
- 只创建一个本任务 TaskSpace，使用 `data:` 合成页面；视频为 canvas.captureStream(12) 生成的 640×360 动画，muted，无外部媒体 URL；完成后 `finish({keep:[]})` 关闭。
- 此视频没有实际压缩视频解码、CDN、广告、复杂业务 DOM 或登录，不代表抖音页面负载。未测后台最小化、GPU、浏览器总 RSS、能耗、真实点击成功率、模型推理或图像 token。
- 未读取/使用用户的登录网站、Cookie。测量中的截图已确认只包含生成页面。

## 暖态单次 Node 脚本内

每组一次 warmup 丢弃，随后串行调用；`performance.now()` 包围每个 await。P95 采用 nearest-rank，小样本时接近/等于最大值，不能当作生产 SLA。

| 操作 | n | P50 ms | P95 ms | 平均输出大小 |
|---|---:|---:|---:|---:|
| evaluate 读取视频状态 | 30 | 0.393 | 0.681 | 约 134 B JSON |
| viewport snapshot | 20 | 2.119 | 3.030 | 324 B 文本 |
| video → canvas 480×270 JPEG，quality=.65 | 20 | 1.258 | 1.921 | 约 5,149 B data URL |
| page.click 下一条按钮 | 10 | 1,010.423 | 1,042.662 | 空结果 |
| page.screenshot PNG | 10 | 33.615 | 59.214 | 约 24,013 B 文件，1512×811 |

截图时间计到返回文件路径；随后文件 stat 的耗时不算在截图指标内。简单图案极易压缩，真实视频 JPEG 字节数会不同。状态文本与截图承担的任务不同，不能用字节比直接换算模型 token 节省。

按钮最终从 Next 0 变为 Next 11（包括 warmup），验证操作有真实状态变化。随后同一页面导航到无视频、无动画的静态按钮页，按次检查 data-n 计数，再测五次：23.77、1017.83、1006.17、1016.71、1006.36 ms，P50 1006.36 ms。warmup 28.86 ms。**只能说本次重复点击经常约 1 秒；未定位内部原因，不声称 Ego 每次点击必定慢 1 秒，也不归因于动画。**

## 新 CLI 进程对已运行浏览器

用外部 Node `spawnSync('ego-browser', ['nodejs','-e',script])` 测墙钟时间，每个 script 只恢复同一 TaskSpace、读取一次视频状态。首次 119.12 ms 丢弃。

- 十次独立 CLI：102–107 ms 左右（最低 100.49），P50 **103.93 ms**，P95 **106.76 ms**。
- 同一 CLI 内连续读取十次：总计 **108.52 ms**。
- 这里包括 CLI/Node/连接与退出开销，**不是冷启动浏览器**；也不含模型和 DSH 调度耗时。

原始十次数据（ms）：106.117、102.770、103.142、103.972、105.166、100.493、106.763、103.928、101.325、104.427。

## 能据此决定什么

1. 高频状态读取应批量完成，不能每个字段都让模型发起一次独立 CLI 工具调用。
2. 分开页面结构、媒体状态和视频画面。截图有用，但不应以全屏 PNG 承担每次进度查询。
3. Ego 可胜任低频 AI 操作；无人值守视频主循环还需验证动作吞吐、接管/恢复及 profile 隔离。单次快 evaluate 不能证明整个运行器稳定。
4. 下一轮对 agent-browser、直接 Playwright 使用相同 fixture、分辨率、headed 状态、warmup/样本数和进程树资源指标再比较；本轮不提供虚构横向数据。
