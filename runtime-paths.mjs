import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SOURCE_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const LEGACY_SHARED_MEMORY_DB_PATH = 'D:/codex分局/大肥鱼/memory/shared.sqlite';
const FIELDS = {
  stateDir: 'DOUYIN_STATE_DIR',
  mediaEnvFile: 'DOUYIN_MEDIA_ENV_FILE',
  mediaSettingsFile: 'DOUYIN_MEDIA_SETTINGS_FILE',
  mediaRuntimeRoot: 'DOUYIN_MEDIA_RUNTIME_ROOT',
  mediaModelsDir: 'DOUYIN_MEDIA_MODELS_DIR',
};

function absolute(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value) || !path.isAbsolute(value)) throw new Error(`${label} 必须是绝对路径。`);
  return path.normalize(value);
}

// 此处只读可信启动器写入的位置记录，不创建目录，也不迁移已有状态。
export function resolveRuntimePaths({ env = process.env, home = homedir(), sourceRoot = SOURCE_ROOT, platform = process.platform, legacyMemoryDbPath = LEGACY_SHARED_MEMORY_DB_PATH } = {}) {
  const userRoot = path.join(home, '.dsh', 'douyin-browser');
  const locationFile = absolute(env.DOUYIN_RUNTIME_LOCATION_FILE || path.join(userRoot, 'runtime-location.json'), '运行位置记录');
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(locationFile, 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || stored.version !== 1 || typeof stored.stateDir !== 'string') throw new Error();
    for (const field of Object.keys(FIELDS)) if (stored[field] !== undefined) absolute(stored[field], `运行位置 ${field}`);
    if (stored.memoryDir !== undefined) absolute(stored.memoryDir, '运行位置 memoryDir');
    if (stored.memoryDbPath !== undefined) absolute(stored.memoryDbPath, '运行位置 memoryDbPath');
    if (stored.memoryDbPath !== undefined && stored.memoryDir !== undefined && path.dirname(path.normalize(stored.memoryDbPath)) !== path.normalize(stored.memoryDir)) throw new Error();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('运行位置记录无法读取或格式错误；未切换到另一套状态。');
  }
  const legacyMediaRoot = path.join(sourceRoot, 'media');
  const mediaRoot = platform === 'darwin' ? path.join(userRoot, 'media') : legacyMediaRoot;
  const configured = field => env[FIELDS[field]] || stored[field];
  const selected = (field, fallback, legacyPaths = []) => {
    const explicit = configured(field);
    if (explicit) return absolute(explicit, field);
    // Mac 新安装使用用户目录；旧状态必须由用户明确保留或迁移，不能悄悄重置。
    // 只检查元数据，不打开凭据/状态，不复制仍可能被另一进程使用的数据库。
    if (platform === 'darwin') for (const legacy of legacyPaths) {
      try {
        fs.lstatSync(legacy); // 包括断开的链接；权限错误不能被当成“新安装”。
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw new Error(`无法检查旧版 ${field}；未切换到另一套状态。请检查权限并通过运行位置记录或 ${FIELDS[field]} 明确指定位置。`);
      }
      throw new Error(`检测到源码目录中的旧版 ${field}；未切换到另一套状态。请先备份，再通过运行位置记录或 ${FIELDS[field]} 明确保留原位置或迁移到用户目录。`);
    }
    return absolute(fallback, field);
  };
  const legacyStateDir = path.join(sourceRoot, 'state');
  const stateDir = selected('stateDir', platform === 'darwin' ? path.join(userRoot, 'state') : legacyStateDir, [legacyStateDir]);
  const mediaRuntimeRoot = selected('mediaRuntimeRoot', mediaRoot, [path.join(legacyMediaRoot, '.venv')]);
  let memoryDbPath;
  if (env.DEEPSEEK_SHARED_MEMORY_DB?.trim()) memoryDbPath = absolute(env.DEEPSEEK_SHARED_MEMORY_DB, '共享记忆数据库');
  else if (stored.memoryDbPath !== undefined) memoryDbPath = absolute(stored.memoryDbPath, '运行位置 memoryDbPath');
  else if (stored.memoryDir !== undefined) memoryDbPath = path.join(absolute(stored.memoryDir, '运行位置 memoryDir'), 'shared.sqlite');
  else if (path.isAbsolute(legacyMemoryDbPath) && fs.existsSync(legacyMemoryDbPath)) {
    if (!fs.statSync(legacyMemoryDbPath).isFile()) throw new Error('已有共享记忆路径不是文件；未创建另一套数据库。');
    memoryDbPath = path.normalize(legacyMemoryDbPath);
  } else memoryDbPath = path.join(userRoot, 'memory', 'shared.sqlite');
  return {
    locationFile, stateDir, memoryDir: path.dirname(memoryDbPath), memoryDbPath,
    mediaEnvFile: selected('mediaEnvFile', path.join(mediaRoot, '.env'), [path.join(legacyMediaRoot, '.env')]),
    mediaSettingsFile: selected('mediaSettingsFile', path.join(mediaRoot, 'settings.local.json'), [path.join(legacyMediaRoot, 'settings.local.json')]),
    mediaRuntimeRoot,
    // 明确指定 runtime root 时，保留模型默认跟随它的原有合同。
    mediaModelsDir: selected('mediaModelsDir', path.join(mediaRuntimeRoot, '.models'), configured('mediaRuntimeRoot') ? [] : [path.join(legacyMediaRoot, '.models')]),
    mediaCaptureDir: path.join(stateDir, 'media-captures'),
    browserProfileDir: path.join(userRoot, 'cli-profile'),
    browserControlDir: path.join(userRoot, 'control'),
  };
}

function isIndependentNode(candidate, env, executable, versions) {
  if (versions.electron && path.resolve(candidate).toLowerCase() === path.resolve(executable).toLowerCase()) return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    const probeEnv = { ...process.env, ...env };
    for (const key of Object.keys(probeEnv)) if (['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())) delete probeEnv[key];
    // 误指向 Electron 时也只执行探针并拒绝，不打开另一个桌面窗口。
    probeEnv.ELECTRON_RUN_AS_NODE = '1';
    const result = JSON.parse(execFileSync(candidate, ['-e', 'process.stdout.write(JSON.stringify({node:process.versions.node,electron:process.versions.electron||null}))'], {
      env: probeEnv, timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 2048,
    }));
    const [major, minor] = String(result.node).split('.').map(Number);
    return !result.electron && (major > 22 || major === 22 && minor >= 13);
  } catch { return false; }
}

export function resolveNodeExecutable({ env = process.env, executable = process.execPath, versions = process.versions, sourceRoot = SOURCE_ROOT, resourcesPath = process.resourcesPath } = {}) {
  if (env.DOUYIN_NODE_EXECUTABLE) {
    const explicit = absolute(env.DOUYIN_NODE_EXECUTABLE, 'Node 运行程序');
    if (!isIndependentNode(explicit, env, executable, versions)) throw new Error('DOUYIN_NODE_EXECUTABLE 未指向可用的独立 Node.js 22.13 或更高版本，请检查配置。');
    return explicit;
  }
  if (!versions.electron) return executable;
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const searchPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  const candidates = [
    ...(resourcesPath && path.isAbsolute(resourcesPath) ? [
      path.join(resourcesPath, 'runtime', 'node', nodeName),
      path.join(resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', nodeName),
    ] : []),
    path.join(sourceRoot, 'desktop', '.cache', 'generated', 'node', nodeName),
    ...searchPath.split(path.delimiter).map(directory => directory.trim().replace(/^"(.*)"$/, '$1')).filter(directory => path.isAbsolute(directory)).map(directory => path.join(directory, nodeName)),
  ];
  for (const candidate of new Set(candidates)) if (isIndependentNode(candidate, env, executable, versions)) return candidate;
  throw new Error('未找到独立 Node.js 22.13 或更高版本。请安装 Node.js，或将 DOUYIN_NODE_EXECUTABLE 设置为现有独立 Node 可执行文件的绝对路径后重试。');
}
