import { BACKEND_CODES, fail } from './contract.mjs';
import { AgentBrowserCli } from './agent-browser-cli.mjs';
import { DouyinSession } from './douyin-session.mjs';
import { resolveRuntimePaths } from '../runtime-paths.mjs';

// 只读观察器的后端选择。默认不再强绑单一浏览器；未知取值失败关闭，不静默回退。
export const READ_ONLY_BACKENDS = Object.freeze(['agent-browser']);

export function resolveBackend(env = process.env) {
  const raw = env?.DOUYIN_BROWSER_BACKEND;
  // 产品默认仍是现有 Playwright 控制器；独立浏览器需显式开启。
  if (raw === undefined || String(raw).trim() === '') return 'playwright';
  const value = String(raw).trim().toLowerCase();
  if (value === 'agent-browser' || value === 'playwright') return value;
  fail(BACKEND_CODES.INVALID_INPUT, 'DOUYIN_BROWSER_BACKEND 只能为 agent-browser 或 playwright。');
}

// 浏览器程序与 agent-browser 本体都可显式固定；未设置时由 CLI 自己选择。
export function resolveLaunch({ env = process.env } = {}) {
  return {
    binary: env.DOUYIN_AGENT_BROWSER_BIN?.trim() || 'agent-browser',
    executablePath: env.DOUYIN_AGENT_BROWSER_CHROME?.trim() || null,
  };
}

export function createReadOnlyObserver({ env = process.env, paths, backend = 'agent-browser', binary, executablePath, session = 'dsh-douyin', profileDir, workDir, headed = true, spawnImpl, now, sleep, switchTimeoutMs, pollMs, frameQuality } = {}) {
  if (!READ_ONLY_BACKENDS.includes(backend)) {
    fail(BACKEND_CODES.NOT_IMPLEMENTED, backend === 'playwright'
      ? 'Playwright 执行层仍由现有 BrowserController 提供；只读观察器目前只实现 agent-browser。'
      : '未知的浏览器执行层。');
  }
  const resolved = paths ?? resolveRuntimePaths({ env });
  const launch = resolveLaunch({ env });
  const transport = new AgentBrowserCli({ binary: binary ?? launch.binary, executablePath: executablePath === undefined ? launch.executablePath : executablePath, session, profileDir: profileDir ?? resolved.agentBrowserProfileDir, env, spawnImpl, headed });
  return new DouyinSession({ cli: transport, workDir: workDir ?? resolved.agentBrowserWorkDir, now, sleep, switchTimeoutMs, pollMs, frameQuality });
}

export { DouyinSession, AgentBrowserCli };
export * from './contract.mjs';
