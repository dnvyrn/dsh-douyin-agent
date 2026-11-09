# macOS 预览版验证记录

日期：2026-11-09。范围：`1.4.6-macos.1` 源码移植；未安装/激活到 DSH，未安装 Edge，未使用抖音登录或真实外发。

## 环境与成功结果

- macOS arm64，独立 Node.js 22.22.2，pnpm 11.1.1。
- `pnpm install --frozen-lockfile --ignore-scripts`：成功，4 个上游锁定包；未运行安装脚本、下载浏览器或另装 DSH。
- `pnpm run test:macos`：63 + 9 = **72 项通过**，0 失败、0 取消。覆盖路径、版本探测、宿主归属/就绪、注入式焦点重置、安全许可。
- `pnpm run test:macos-safety`：**322 项通过**，0 失败、0 取消，约 28 秒。父进程复跑已提交的 runner 得到相同结果。两组重叠 4 项 guard 测试。
- `node --check`：本轮修改的生产 MJS、测试与 runner 语法检查通过；`git diff --check` 通过。
- `npm pack --dry-run --ignore-scripts --json`：确认运行模块、Cordis 清单、客户端与 Mac 文档被包含；未包含状态目录、`.env`、数据库、浏览器 profile 或 `node_modules`。本地打包不等于 DSH 加载通过。
- Ego Lite CLI：仅在合成 data 页面验证标题/视频元素/静音属性读取、canvas JPEG 数据生成、`Runtime.getIsolateId` CDP 调用；任务空间已完成并关闭，不保留页面。没有验证视频真实播放或插件运行。

## 测试隔离与排除

[test:macos-safety runner](../../tests/run-macos-safety.mjs) 替换子进程环境，不继承 API Key 等变量；HOME、位置记录、状态、共享记忆、QQ 及媒体配置均指向临时根目录。每项测试有 20 秒界限，进程有 120 秒界限；清理前检查绝对父目录和临时前缀。

预加载给 Playwright `launch`、`launchPersistentContext`、`connectOverCDP`、`connect` 加抛错保护。正向 `--test-skip-pattern` 排除 10 项真实 Edge 测试，Node 将它们排除于注册/总数之外，故汇总 `skipped=0` **不表示它们执行成功**。聊天输出/内容一致性两个含真实浏览器钩子的测试文件仅检查语法，未执行。

23 处既有合成 fixture 改为显式写入允许互动的临时策略；不是恢复生产默认开启，也没有削弱撤销/损坏记录断言。缺失策略、开关撤销和坏记录另有专门回归。

## 过程中的失败及处理

1. 上游锁文件的 `autoInstallPeers` 与可选 DSH peer 不一致，初次 frozen install 失败；pnpm 11 不采用旧 `.npmrc` 的非 registry 设置，又触发一次配置不一致。源码增加 `.npmrc` / `pnpm-workspace.yaml`，锁文件同步禁用自动安装 peer 后成功。依赖版本和完整性校验未改变。
2. 第一轮 20 文件回归：270 项中 268 通过、2 取消，exit 1；单文件复查也出现取消。跨入口停止等待依靠 unref heartbeat，Node 报 pending Promise 时事件循环已结束。将该**测试**的等待加 5 秒有界、可失败的引用超时并 finally 清理；未改变生产 heartbeat、未弱化断言。未运行原始 baseline 对照，不能宣称证明是上游固有缺陷。
3. 一次负向 `--test-name-pattern` 误匹配文件/父级范围，10 项原拟排除的实机用例尝试启动 Edge，均因标准路径没有 msedge 而立即失败；同轮其他 52 项通过，exit 1。没有浏览器成功启动，也没有安装。随后改为明确正向 skip + 浏览器调用阻断；最终成功的是**合成测试选择**，不是修复了 Edge 或验证了实机功能。

## 尚未通过验收的范围

真实 Edge 启动、专用 profile 登录、抖音页面读取和视频证据、后台/最小化/睡眠播放、完整 DSH Desktop 插件加载/设置/模型请求、真实私信/分享/评论、音频及原生 Windows 完整回归均未验证。Edge 未安装是本轮实机验收的限制；本版本必须称实验移植，不应标成稳定可用发行版。

后续步骤见 [Mac 安装与验收清单](../macos.md)。
