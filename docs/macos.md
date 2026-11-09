# macOS 实验移植：1.4.6-macos.1

本分支基于上游 `7989640e340f0fd79e2de9874880d5197546e755`，只适配 **DSH 原生插件**。这是可构建、经过隔离回归的首轮源码移植，不是已完成真实抖音与 DSH Desktop 联调的稳定发行版。Windows 独立 Electron 应用、签名/公证、自动更新与可选本地音频不在本轮范围内。

## 已实现

- 包允许 `darwin` / `win32`，版本标为实验预发布；未发布到 npm。
- Mac 通过标准 `/Applications/Microsoft Edge.app` 检测 Edge；用系统 `plutil` 读取版本，不为诊断启动浏览器。
- 实际运行仍使用 Playwright 的 `msedge` channel、独立持久 profile、本机 loopback CDP 与原有归属核验。不会自动切到 Chrome 或 Ego，也不会自动安装浏览器。
- Playwright 延迟到真实宿主启动时加载，便于无浏览器诊断及注入测试。
- Mac 新安装的可写状态和媒体配置移到用户目录，不随插件包替换而消失；发现源码目录旧数据时要求明确选择，绝不静默搬迁、合并或重置。详见 [路径与升级](macos-runtime.md)。
- 新安装好友互动默认关闭，包括发送侧的缺省许可检查；自动观看、公开评论和音频沿用默认关闭。已有明确保存的开关保持原值，因此旧安装升级后须先核对，而非假定所有功能已被关闭。
- 源码 pnpm 安装不自动拉取另一套 DSH：宿主提供 optional peer。保留原锁定 Playwright 版本和完整性校验。

## Ego Lite 的角色

已通过 Ego Lite 的真实 CLI，在合成 data 页面验证 `evaluate` 读取媒体属性、canvas JPEG 生成和页面 CDP 调用；没有打开抖音或读取日常登录。该实验只证明基础操作通路，不证明播放、插件兼容或后台运行。

首版不替换运行后端：Ego 的任务空间在同一 profile 下共享 Cookie/cache；它的 Page、控制权、事件、截图及进程生命周期也不同于 Playwright。AI 友好不等于可直接替代长期运行的浏览器控制器。详见 [接口与安全评估](ego-lite-evaluation.md)。未来独立 Ego profile + 只读适配器应作为单独项目验证，不迁移个人浏览器凭据。

## 本地构建

要求独立 Node.js **22.13+**，以及 pnpm。当前验证环境为 macOS arm64、Node 22.22.2、pnpm 11.1.1；Windows 路径分支仅做模拟回归。

```sh
git clone --branch feat/macos-port https://github.com/dnvyrn/dsh-douyin-agent.git
cd dsh-douyin-agent
pnpm install --frozen-lockfile --ignore-scripts
pnpm run test:macos
pnpm run test:macos-safety
npm pack --ignore-scripts
```

安装依赖不会安装 Edge、下载 Playwright 浏览器或启动用户网站。锁文件仍固定上游的 `1.64.0-alpha-1790635538000`，真实 Edge 兼容性必须另验；不要仅凭包安装成功宣称可播放。不要直接执行完整 `pnpm test` 来“安全自检”：上游有启动真实 Edge、媒体子进程和环境配置访问的集成测试。

## 安装与实机验收（待执行）

1. 先确认愿意使用 Edge，并自行安装官方 macOS Edge 到标准 Applications 目录；非标准安装与 Chrome 尚不在支持范围。若希望改用 Ego，先确认独立 profile 与后端范围，不把个人 profile 直接接入自动化。
2. 备份已有数据，按 [路径与升级](macos-runtime.md) 检查旧安装。关闭旧插件/API，避免两套进程争用同一状态和 CDP 端口。
3. 使用 **当前 DSH Desktop profile 的插件安装入口**，选择本分支打包的本地 `.tgz` 路径。不要填上游 `@1.4.6` npm 包，不要运行 Windows PowerShell 安装器，也不要从另一 CLI profile 再注册同名插件。本轮没有自动安装/激活插件。
4. 完全退出再打开同一 DSH，核对插件加载、自检、模型选项及设置读写；尚未验证当前 DSH `0.2.2-rc.1` 的端到端加载。
5. 保持自动观看、好友互动、评论、音频关闭；点击打开抖音，在独立 Edge 中本人完成登录和验证码。确认只使用专用 profile，不访问日常 Edge/Chrome/Ego 登录。
6. 先手动验证一条视频的作品 ID、实际播放进度、截图证据、换片后的 ID 回读；核对停止/取消与额度状态。仅观察封面不能算播放成功。
7. 最后在本人同意下做有界自动观看，验证静音、最小化后真实播放、前台切换、睡眠恢复与异常停止。窗口不能核实归属时不最小化。公开评论、私信和分享需另外明确授权后单独验收。

**未验收：** 真实 Edge 启动与登录、抖音 DOM/反自动化变化、最小化持续播放/睡眠恢复、完整 DSH 设置链路、真实模型图片请求、私信/分享/评论、本地或云端音频、Windows 全套回归。没有用合成测试冒充这些结果。

## 可重复的隔离验证

`test:macos` 运行 63 项路径、版本检测、故障分类、好友互动安全开关与宿主就绪测试，以及 9 项注入式焦点/生命周期测试，共 72 项；不启动真实 Edge，不使用真实用户数据。焦点测试用名称过滤排除文件里的实机用例。

`test:macos-safety` 运行 24 个文件中的 322 项合成聊天/分享回归，使用临时 HOME、状态、记忆及媒体路径，并通过预加载阻止 Playwright 启动浏览器或连接 CDP。明确排除 10 项真实 Edge 用例；另外两个含真实浏览器钩子的测试文件仅检查语法。两组测试重叠 4 项许可守卫用例，不能把 72 + 322 当成不重复总数。

完整上游测试未运行。Ego 的单次合成页面烟雾测试也不计入 Node 单测数。过程中的失败、修正和验收边界见 [验证记录](verification/macos-preview.md)。
