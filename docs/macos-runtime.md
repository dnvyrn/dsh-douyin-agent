# macOS 用户数据路径与升级

本说明只涉及 DSH 插件的运行路径；不表示独立 Electron 应用、浏览器登录或可选音频已完成 macOS 实机验收。

## 新安装默认值

macOS（`darwin`）在没有显式配置、没有旧版源码目录用户数据时，使用当前用户主目录下的 `~/.dsh/douyin-browser`。这与 DSH profile 的 `DSH_HOME` 无关，同一用户的插件/API 使用同一套状态。更换插件包目录不会改变这些默认路径。

| 内容 | 相对于用户数据根目录的路径 |
| --- | --- |
| 位置记录 | `runtime-location.json` |
| 时限、许可、收据等状态 | `state/` |
| 媒体采集 | `state/media-captures/` |
| 媒体环境配置（可能包含明文密钥） | `media/.env` |
| 媒体设置 | `media/settings.local.json` |
| 媒体运行时 / 模型 | `media/` / `media/.models/` |
| 共享记忆 | `memory/shared.sqlite` |
| 专用浏览器 profile / 控制记录 | `cli-profile/` / `control/` |

解析路径不会创建目录、读取媒体密钥、复制数据库、安装运行时或启用音频。Python 脚本等只读源码资源仍留在插件包内；路径调整本身不代表音频依赖已适配或模型已下载。Windows 与 Linux 的原有源码目录默认值不变；浏览器及共享记忆的原有选择规则也不变。

## 已有安装：不静默切换，不自动搬迁

如果 macOS 未明确指定某字段，而源码目录里存在对应的旧数据，解析会停止并提示指定位置，不会悄悄创建另一套状态。检查对象为：

- `state/`（即使是空目录，也保守地视为已有状态）。
- `media/.env`、`media/settings.local.json`。
- `media/.venv/`、`media/.models/`。

只检查文件系统元数据，不读取内容。断开的符号链接也视为已有位置；权限错误不会被当成“新安装”。包内正常的 `media/` 源码和 `.env.example` 不触发此检查。即使用户目录已经有数据，只要还存在未明确选择的旧位置，也不猜测哪套更新、不自动合并。

**处理顺序：**

1. 先停止使用这些路径的插件、API 与其他进程，备份旧数据；在替换/删除旧插件包之前处理迁移。
2. 可以暂时用环境变量或位置记录明确保留旧位置；此时仍有包更新覆盖数据的风险。
3. 要迁入用户目录，请先人工确认并复制状态、媒体配置和需要的模型，再写入指向已核对位置的记录。不要自动合并两套时钟/许可/收据。Python 虚拟环境通常不可直接搬迁，应在明确授权后重建，或明确保留原运行时位置。
4. 重启后核对时限、许可、收据、媒体开关与记忆连续性，再决定是否清理备份。解析器不会代替用户做上述写入和清理。

只读解析器无法发现已被删除的旧包目录，也不会跨多个历史安装位置扫描；因此必须在升级替换旧包前保留数据或登记旧位置。这里选择“显式处理升级”，而不是无提示延用可被更新替换的包目录或冒险在线搬迁数据库。

## 显式选择与优先级

各字段优先级保持为：环境变量 > 版本 1 位置记录 > 默认值。路径必须是绝对路径，JSON 中的 `~` 不会自动展开。损坏或不支持的记录仍会阻止启动，不会回落到新状态。

环境变量对应关系：

- `DOUYIN_RUNTIME_LOCATION_FILE`：指定位置记录文件；默认仍在用户数据根目录。
- `DOUYIN_STATE_DIR`：状态目录。
- `DOUYIN_MEDIA_ENV_FILE`、`DOUYIN_MEDIA_SETTINGS_FILE`：媒体环境配置和设置文件。
- `DOUYIN_MEDIA_RUNTIME_ROOT`、`DOUYIN_MEDIA_MODELS_DIR`：媒体运行时和模型目录。
- `DEEPSEEK_SHARED_MEMORY_DB`：共享记忆数据库文件。

例如，人工迁移并核对后的位置记录可以是以下结构（`/Users/you` 只是占位符，必须替换）：

```json
{
  "version": 1,
  "stateDir": "/Users/you/.dsh/douyin-browser/state",
  "mediaEnvFile": "/Users/you/.dsh/douyin-browser/media/.env",
  "mediaSettingsFile": "/Users/you/.dsh/douyin-browser/media/settings.local.json",
  "mediaRuntimeRoot": "/Users/you/.dsh/douyin-browser/media",
  "mediaModelsDir": "/Users/you/.dsh/douyin-browser/media/.models",
  "memoryDbPath": "/Users/you/.dsh/douyin-browser/memory/shared.sqlite"
}
```

`stateDir` 是版本 1 记录的必填字段，其余字段可以省略；未指定字段仍遵循上述默认与旧数据检查。显式指定媒体运行时后，未单独指定的模型目录继续跟随该运行时的 `.models`，不会另选源码模型目录；媒体环境配置和设置文件不会因此自动跟随。这保持了原有字段覆盖合同。

共享记忆仍按显式 `DEEPSEEK_SHARED_MEMORY_DB`、记录中的 `memoryDbPath` / `memoryDir`、已存在且可识别的旧共享数据库、用户默认目录的顺序选择；不读取或转换数据库内容，也不重命名自定义数据库文件。

## 隔离测试

```sh
node --test tests/macos-paths.test.mjs
```

该测试只导入 Node 内置模块与路径解析器，用临时目录注入 `home`、`sourceRoot`、环境和旧库位置；不导入 Playwright、不读取真实 HOME 配置或凭据、不启动浏览器、不安装依赖。覆盖 macOS 新安装、包更新路径稳定性、旧数据拒绝静默切换、显式覆盖、损坏记录、权限错误、断链和共享记忆优先级；`win32`/`linux` 是默认选择逻辑的模拟回归，不是原生 Windows 实机验收。
