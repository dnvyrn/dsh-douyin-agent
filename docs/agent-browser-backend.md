# agent-browser 只读后端（第一阶段实现）

2026-11-10。这是[技术栈选型](<ai-native-stack-selection.md>)的第一阶段落地：**只读观察 + 确定性换片/搜索**，用 agent-browser 作为浏览器执行层，TypeScript 负责领域规则。

**未在真实浏览器/抖音账号上验收。** 本机未安装 agent-browser；以下 37 项自动化测试使用合成替身，验证的是命令构造、超时/中止、JSON 契约、作品身份校验与画面裁剪，不是抖音兼容性。

## 做了什么

| 文件 | 作用 |
| --- | --- |
| [page-state.mjs](<../page-state.mjs>) | 从 `core.mjs` 抽出的只读页面状态脚本；Playwright 与 agent-browser 共用，避免两套选择器语义漂移。 |
| [browser/contract.mjs](<../browser/contract.mjs>) | 错误码、字段白名单、边界收敛、不可观察原因优先级。 |
| [browser/agent-browser-cli.mjs](<../browser/agent-browser-cli.mjs>) | 进程执行层：固定全局参数、环境白名单、超时/中止、输出上限、JSON 解包、批量 stdin。 |
| [browser/frame-crop.mjs](<../browser/frame-crop.mjs>) | 把整屏截图裁到播放器区域（复用仓库已附许可的 jpeg-js），丢弃不可用帧。 |
| [browser/douyin-session.mjs](<../browser/douyin-session.mjs>) | 领域层：`status` / `observe` / `next` / `search`，单写者互斥。 |
| [browser/index.mjs](<../browser/index.mjs>) | 后端选择与工厂；未知后端失败关闭。 |
| [browser/cli.mjs](<../browser/cli.mjs>) | 手动试用的命令行入口。 |

关键行为：

- **不逐帧调用模型**：一次观察只在单次 CLI 进程内做有限次状态读取与截图，返回有界证据。
- **画面只取播放器区域**：整屏截图先裁到 `video` 的可见矩形；裁剪失败就丢帧，不用整屏兜底，避免把私信区域带进证据。
- **换片必须核对身份**：给了 `expectedVideoId` 而当前不符时，不发任何点击。换片后要看到作品 ID 真实变化且 `readyState ≥ 2`；未确认只报错，不重试。
- **未知结果不重试**：换片命令超时归为 `SWITCH_RESULT_UNKNOWN`，要求先人工核对。
- **默认不动作**：不自动播放、不点赞、不评论、不关注、不发布；登录与验证一律交给本人。
- **单写者**：同一会话并发写操作直接拒绝（`BROWSER_BUSY`），不排队堆积。

## 已接入 DSH 工具表

工具名：**`douyin_agent_browser`**，一个工具带 `action`，避免和现有 `douyin_observe`/`douyin_next`/`douyin_search` 语义重复：

| action | 行为 |
| --- | --- |
| `status` | 读当前页面与播放状态（不需要有播放器） |
| `open` | 打开抖音页面，默认推荐流；等到播放器/搜索页/登录提示才返回 |
| `observe` | 采样 1–6 帧、1–10 秒，画面裁到播放器区域并降到 720 宽 |
| `next` | 换片；可带 `expect` 做前置身份核对 |
| `search` | 搜索并返回真实结果卡片 |
| `close` | 关闭窗口（登录态留在 profile 里） |

开关与边界：

- 默认**关闭**：`DOUYIN_BROWSER_BACKEND` 未设置时仍是现有 Playwright 控制器；设成 `agent-browser` 才启用本工具。
- 未安装 agent-browser 时调用会明确报“未找到可执行文件”，不会自动下载浏览器。
- 只有 `close` 会关窗口；`observe`/`status` 不会在调用结束时关掉浏览器。
- API 小工具默认名单不含它，避免绕过开关。
- 工具执行仍走现有画面管线：登录/验证画面不会送进模型。

```bash
export DOUYIN_BROWSER_BACKEND=agent-browser
export DOUYIN_AGENT_BROWSER_BIN=/path/to/agent-browser
export DOUYIN_AGENT_BROWSER_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

```text
douyin_agent_browser { "action": "observe", "seconds": 3, "frames": 3 }
douyin_agent_browser { "action": "next", "expect": "7673095578359696683" }
```

## 怎么试（需要本人同意安装）

```bash
# 1) 本人确认后安装（会下载 Chrome for Testing，约数百 MB）
npm install -g agent-browser
agent-browser install

# 2) 有头窗口打开，手动登录抖音
node browser/cli.mjs status

# 3) 只读观察 3 秒、最多 4 帧
node browser/cli.mjs observe --seconds 3 --frames 4 --out /tmp/douyin-frames

# 4) 换片（可给预期作品 ID 做前置核对）
node browser/cli.mjs next --expect 7579432563794584933

# 5) 搜索
node browser/cli.mjs search --query "科普"
```

数据目录：`~/.dsh/douyin-browser/agent-browser/{profile,frames}`，与 Playwright 的 `cli-profile` 分开。可用 `DOUYIN_BROWSER_BACKEND=agent-browser|playwright` 选择；`playwright` 仍由现有 `BrowserController` 提供，本只读模块不冒充它。

## 测试

```bash
pnpm run test:agent-browser   # 37 项，合成替身，无浏览器
pnpm run test:macos           # 63 + 9 项
pnpm run test:macos-safety    # 322 项
```

`tests/fixtures/fake-agent-browser.mjs` 模拟 CLI 契约，并断言宿主环境变量（如凭据）不会进入子进程。

## 还没验证

- 真实 agent-browser 的 JSON 字段是否与本文假设一致（当前按官方文档 `--json` + `data.result` 解包，替身测试覆盖两种形状）。
- 抖音真实 DOM：选择器、虚拟滚动、播放器区域、后台播放、音频策略。
- `screenshot` 在 headed Retina 下的像素比假设（已按 `pageViewport` 换算，但未实测）。
- 长期运行的内存/句柄/daemon 重启，以及多标签页/多入口竞争。
- 与 DSH 工具表接线：本阶段是独立模块 + CLI，**尚未**替换 `BrowserController`，也未改动现有 14 个工具的行为。

通过上面第 4 份文档里的同条件基准与实际视频验收后，再接 DSH 工具与自动观看循环。
