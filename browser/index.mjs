import { BACKEND_CODES, fail } from './contract.mjs';
import { AgentBrowserCli } from './agent-browser-cli.mjs';
import { DouyinSession } from './douyin-session.mjs';
import { resolveRuntimePaths } from '../runtime-paths.mjs';

// 只读观察器的后端选择。默认不再强绑单一浏览器；未知取值失败关闭，不静默回退。
export const READ_ONLY_BACKENDS = Object.freeze(['agent-browser']);

export function resolveBackend(env = process.env) {
  const raw = env?.DOUYIN_BROWSER_BACKEND;
  if (raw === undefined || String(raw).trim() === '') return 'agent-browser';
  const value = String(raw).trim().toLowerCase();
  if (value === 'agent-browser' || value === 'playwright') return value;
  fail(BACKEND_CODES.INVALID_INPUT, 'DOUYIN_BROWSER_BACKEND 只能为 agent-browser 或 playwright。');
}

export function createReadOnlyObserver({ env = process.env, paths, backend = resolveBackend(env), binary = 'agent-browser', session = 'dsh-douyin', profileDir, workDir, headed = true, spawnImpl, now, sleep, switchTimeoutMs, pollMs, frameQuality } = {}) {
  if (!READ_ONLY_BACKENDS.includes(backend)) {
    fail(BACKEND_CODES.NOT_IMPLEMENTED, backend === 'playwright'
      ? 'Playwright 执行层仍由现有 BrowserController 提供；只读观察器目前只实现 agent-browser。'
      : '未知的浏览器执行层。');
  }
  const resolved = paths ?? resolveRuntimePaths({ env });
  const transport = new AgentBrowserCli({ binary, session, profileDir: profileDir ?? resolved.agentBrowserProfileDir, env, spawnImpl, headed });
  return new DouyinSession({ cli: transport, workDir: workDir ?? resolved.agentBrowserWorkDir, now, sleep, switchTimeoutMs, pollMs, frameQuality });
}

export { DouyinSession, AgentBrowserCli };
export * from './contract.mjs';
