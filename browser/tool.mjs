import { createReadOnlyObserver, resolveBackend } from './index.mjs';
import { BACKEND_CODES, fail } from './contract.mjs';

export const AGENT_BROWSER_TOOL = 'douyin_agent_browser';

// DSH 工具入口：只在显式切到独立浏览器后端时工作，其余情况失败关闭，不悄悄改用 Playwright。
export async function executeAgentBrowserTool(args, { signal, env = process.env, create = createReadOnlyObserver } = {}) {
  if (resolveBackend(env) !== 'agent-browser') {
    fail(BACKEND_CODES.NOT_IMPLEMENTED, '独立浏览器后端未启用：请设置 DOUYIN_BROWSER_BACKEND=agent-browser 并安装 agent-browser 后重试。');
  }
  const session = create({ env });
  switch (args.action) {
    case 'status': return await session.status({ signal });
    case 'open': { const opened = await session.open({ url: args.url, signal }); return { url: opened.url, elapsedMs: opened.elapsedMs, state: opened.state }; }
    case 'observe': return await session.observe({ seconds: args.seconds ?? 3, maxFrames: args.frames ?? 3, signal });
    case 'next': return await session.next({ expectedVideoId: args.expect, signal });
    case 'search': return await session.search({ query: args.query, signal });
    case 'close': await session.close(); return { closed: true };
    default: fail(BACKEND_CODES.INVALID_INPUT, '未知的独立浏览器动作。');
  }
}
