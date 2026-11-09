import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAgentBrowserTool, AGENT_BROWSER_TOOL } from '../browser/tool.mjs';
import { BACKEND_CODES } from '../browser/contract.mjs';
import { TOOL_DEFINITIONS, validateToolArguments } from '../tool-definitions.mjs';

const ID = '7579432563794584933';
const definition = () => TOOL_DEFINITIONS.find(tool => tool.name === AGENT_BROWSER_TOOL);

function fakeSession(calls) {
  return {
    async status() { calls.push('status'); return { pageKind: 'video', video: { id: ID } }; },
    async open({ url }) { calls.push(['open', url]); return { url: url ?? 'https://www.douyin.com/', elapsedMs: 5, state: { pageKind: 'video' } }; },
    async observe({ seconds, maxFrames }) { calls.push(['observe', seconds, maxFrames]); return { videoId: ID, frames: [{ mimeType: 'image/jpeg', data: 'eA==', videoId: ID, time: 1 }] }; },
    async next({ expectedVideoId }) { calls.push(['next', expectedVideoId]); return { changed: true }; },
    async search({ query }) { calls.push(['search', query]); return { query, results: [] }; },
    async close() { calls.push('close'); },
  };
}

test('工具只在前端显式切到 agent-browser 时执行，否则失败关闭', async () => {
  const calls = [];
  await assert.rejects(executeAgentBrowserTool({ action: 'status' }, { env: {}, create: () => fakeSession(calls) }),
    error => error.code === BACKEND_CODES.NOT_IMPLEMENTED && /DOUYIN_BROWSER_BACKEND/.test(error.message));
  assert.equal(calls.length, 0);
  const env = { DOUYIN_BROWSER_BACKEND: 'agent-browser' };
  assert.equal((await executeAgentBrowserTool({ action: 'status' }, { env, create: () => fakeSession(calls) })).video.id, ID);
  assert.deepEqual(calls, ['status']);
});

test('动作映射到领域方法，观察不会顺手关闭浏览器', async () => {
  const calls = [], env = { DOUYIN_BROWSER_BACKEND: 'agent-browser' };
  const create = () => fakeSession(calls);
  await executeAgentBrowserTool({ action: 'observe' }, { env, create });
  await executeAgentBrowserTool({ action: 'observe', seconds: 5, frames: 2 }, { env, create });
  await executeAgentBrowserTool({ action: 'next', expect: ID }, { env, create });
  await executeAgentBrowserTool({ action: 'search', query: '科普' }, { env, create });
  await executeAgentBrowserTool({ action: 'open' }, { env, create });
  assert.deepEqual(calls, [['observe', 3, 3], ['observe', 5, 2], ['next', ID], ['search', '科普'], ['open', undefined]]);
  assert.equal(calls.includes('close'), false);
});

test('只有 close 动作才关闭浏览器窗口', async () => {
  const calls = [];
  const result = await executeAgentBrowserTool({ action: 'close' }, { env: { DOUYIN_BROWSER_BACKEND: 'agent-browser' }, create: () => fakeSession(calls) });
  assert.deepEqual(result, { closed: true });
  assert.deepEqual(calls, ['close']);
});

test('工具目录里的定义与执行器同名，参数校验拒绝越界动作', () => {
  assert.equal(definition().name, AGENT_BROWSER_TOOL);
  assert.equal(definition().parameters.required.includes('action'), true);
  assert.throws(() => validateToolArguments(definition(), {}), /缺少参数：action/);
  assert.throws(() => validateToolArguments(definition(), { action: 'delete' }), /动作无效/);
  assert.throws(() => validateToolArguments(definition(), { action: 'search', query: '  ' }), /非空关键词/);
  assert.throws(() => validateToolArguments(definition(), { action: 'open', url: 'https://example.com/' }), /抖音/);
  assert.throws(() => validateToolArguments(definition(), { action: 'observe', seconds: 11 }), /1 到 10/);
  assert.throws(() => validateToolArguments(definition(), { action: 'observe', frames: 0 }), /1 到 6/);
  assert.doesNotThrow(() => validateToolArguments(definition(), { action: 'status' }));
});

test('未知动作在领域层同样被拒绝', async () => {
  await assert.rejects(executeAgentBrowserTool({ action: 'statusx' }, { env: { DOUYIN_BROWSER_BACKEND: 'agent-browser' }, create: () => fakeSession([]) }), error => error.code === BACKEND_CODES.INVALID_INPUT);
});

test('原生插件工具表注册该工具，未开启后端时经真实插件路径失败关闭', async () => {
  const { createNativeToolDefinitions } = await import('../dsh-plugin.mjs');
  const definitions = createNativeToolDefinitions({ ctx: {}, getController: async () => ({ execute: async () => { throw new Error('不应回落到现有控制器'); } }) });
  const tool = definitions.find(item => item.name === AGENT_BROWSER_TOOL);
  assert.ok(tool, '工具应出现在原生工具表');
  assert.equal(tool.parameters.additionalProperties, false);
  await assert.rejects(tool.execute({ action: 'status' }, {}), error => /DOUYIN_BROWSER_BACKEND/.test(error.message));
});
