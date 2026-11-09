# agent-browser 只读验收记录

2026-11-10，Asia/Singapore。本机：Apple M5 Max / macOS arm64 / Chrome 156.0.8078.80。

结论：**传输层、安全闸与只读领域层已在真实抖音页面跑通**；换片、搜索、观察均成功。仍未验证后台/最小化播放、长时间运行与音频。

## 环境

- agent-browser **0.41.2**，装在仓库内 `.agent-browser-runtime/`（`--ignore-scripts`，未全局安装、未入库）。
- 使用官方包自带的 `agent-browser-darwin-arm64` 原生二进制；**未下载 Chrome for Testing**，用 `--executable-path` 复用本机 Chrome。
- 启动器要求 Node ≥ 24，本机 Volta 默认 22.22.2；用 `/opt/homebrew/bin/node`（v26.7.0）跑启动器，业务代码仍在 Node 22。
- 专用 profile：`~/.dsh/douyin-browser/agent-browser/profile`，与 Playwright 的 `cli-profile` 分开；登录由本人手动完成。

## 实测结果

| 操作 | 结果 | 耗时 |
| --- | --- | --- |
| 启动 + 打开推荐流 | 成功，等到播放器挂载 | 3.7–8.7 s（含 Chrome 冷启动） |
| 读取当前作品 | 拿到真实 ID、标题、作者、进度、播放器矩形 | ~0.3 s |
| 观察 3 秒 / 3 帧 | 3 帧，视频时间 1.12→3.77 s，覆盖 2.65 s | 3.17 s |
| 换片（带预期 ID 核对） | ID 从 `7673095578359696683` 变为 `7705918256107801856` | 0.43 s |
| 搜索「科普」 | 10 条真实结果（含作品 ID 与标题） | 2.4 s |
| 画面尺寸 | 裁到播放器区域后降采样至 720×744，单帧 35–48 KB | 3 帧共 140 KB |

对比未降采样时单帧 2136×2206、约 200 KB（3 帧 642 KB）；720 宽仍能读清字幕与标题。

## 真机暴露并已修的缺陷

1. **`--allowed-domains` 与 `--profile` 互斥**：官方禁止该组合（Chrome 可能在限制生效前恢复旧页面）。持久登录必须用 profile，域名约束改由本层强制（只导航抖音 https、读状态校验 origin、离开即拒绝）。
2. **错误说明写在 stdout**：初次只读 stderr，导致失败退化成“退出码 1”；现在提取 stdout 的 `error` 字段。
3. **命令行入口每条命令都关闭浏览器**：导致登录窗口一闪就关。改为默认保留窗口，另设 `close` 命令。
4. **直播预览被误认成上一条作品**：滚轮落到右侧直播卡片时，页面实际播放直播（无时长），但作品 ID 来自链接/地址栏。现按“无时长且 ID 不来自播放器”判为身份不可信，返回 `VIDEO_IDENTITY_CONFLICT`，不采集。
5. **搜索结果提前返回空**：SPA 在 `documentReadyState=complete` 之后才渲染卡片；改为等结果或超时，并在超时时明确“不把空列表当成没有作品”。
6. **`open` 返回过早**：`complete` 时播放器尚未挂载；改为等到播放器/搜索页/登录提示。
7. **短视频循环时覆盖算成 0**：末帧时间回绕导致；改为按时间区间跨度计算并标记 `looped`。
8. **搜索页 `status` 报“没有作品”**：状态读取不该要求一定有播放器；拆出 `assertReadable` 与 `assertObservable`。

## DSH 工具接线（已跑通）

`douyin_agent_browser` 已注册进原生工具表，经真实插件路径验证：

- `open` → 推荐流，读到作品 `7701620404201125618`；
- `observe` 1 秒 1 帧 → 31 KB 画面；
- 裸测试环境没有图片附件服务时，工具降级为“只回状态与字节数”，不报错；
- `close` 正常关窗，登录态保留在 profile。

默认后端仍是 Playwright；只有 `DOUYIN_BROWSER_BACKEND=agent-browser` 时该工具生效，否则失败关闭。

## 尚未验证

- 后台/最小化播放、音频策略、长时间（30 分钟以上）运行与内存。
- Retina 下非整数像素比、窗口缩放后的裁剪精度。
- 抖音改版导致的选择器失效；本层按“读不到就报错”失败关闭。
- 与现有 `BrowserController` 的并发共存：目前是独立模块，**没有**替换 14 个现有工具。

## 复现

```bash
npm install --prefix .agent-browser-runtime agent-browser@0.41.2 --ignore-scripts
# 启动器需 Node ≥ 24；包装脚本见 .agent-browser-runtime/agent-browser（未入库）
export DOUYIN_AGENT_BROWSER_BIN="$PWD/.agent-browser-runtime/agent-browser"
export DOUYIN_AGENT_BROWSER_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
node browser/cli.mjs open --url "https://www.douyin.com/?recommend=1&from_nav=1"
node browser/cli.mjs observe --seconds 3 --frames 3 --out /tmp/douyin-frames
node browser/cli.mjs search --query "科普"
node browser/cli.mjs close
```
