# agent-browser 只读验收记录（进行中）

2026-11-10，Asia/Singapore。本机：Apple M5 Max / macOS arm64 / Chrome 156.0.8078.80。

## 环境

- agent-browser **0.41.2**，从私有镜像安装到仓库内 `.agent-browser-runtime/`（`--ignore-scripts`，未全局安装，未提交）。
- 官方包自带 `agent-browser-darwin-arm64` 原生二进制（约 16 MB）；**未下载 Chrome for Testing**，用 `--executable-path` 复用本机 Chrome。
- 启动器要求 Node ≥ 24；本机 Volta 默认 Node 22.22.2，因此用 `/opt/homebrew/bin/node`（v26.7.0）跑启动器，业务代码仍在 Node 22。
- 专用 profile：`~/.dsh/douyin-browser/agent-browser/profile`，与 Playwright 的 `cli-profile` 分开。

## 已通过

- `agent-browser --version` → `agent-browser 0.41.2`。
- `agent-browser doctor`：10 pass / 0 warn / 0 fail，headless 启动 3.48s。
- `node browser/cli.mjs open --url https://www.douyin.com/`：**成功**，8.4s 内完成 Chrome 启动与导航，落到 `https://www.douyin.com/jingxuan`，`documentReadyState=complete`，视口 1200×1218。
- 登录弹层被正确识别：`loginRequired=true`，`video=null`，`pageKind=unknown`。观察接口因此拒绝采集并提示由本人登录，**没有绕过登录、没有读取账号内容**。

## 真机发现的两个契约问题（已修）

1. **`--allowed-domains` 与 `--profile` 互斥**。官方报错：Chrome 可能在网络限制生效前恢复旧页面。持久登录必须用 profile，因此域名约束改由本层强制：只允许导航抖音 https 域，读状态前校验 origin，离开抖音即拒绝。
2. **失败说明写在 stdout 的 JSON 里**，初次实现只读 stderr，导致错误退化成“退出码 1”。现在会从 stdout 提取 `error` 字段。

另外，首次尝试留下了一个记录了冲突参数的会话守护进程，导致修复后仍报旧错；用 `agent-browser close --session dsh-douyin --namespace dsh-douyin` 清理后恢复正常。部署时应注意：**同一会话名复用旧 daemon 会继承旧启动参数**。

## 尚未完成

- 本人手动登录后，`observe` / `next` / `search` 的真实成功率、耗时与 Retina 截图裁剪。
- 后台/最小化播放、音频策略、长时间运行。
- 因此当前结论仅到“传输层与安全闸可用”，**不是**“抖音观察已验收”。
