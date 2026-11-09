#!/usr/bin/env node
// 一次性验收脚本：把独立 Chrome 真正最小化，检查播放是否继续、抽帧是否仍可用。
// 不进入插件运行路径，只在验收时手动执行。
import { AgentBrowserCli } from '../browser/agent-browser-cli.mjs';
import { DouyinSession } from '../browser/douyin-session.mjs';
import { resolveRuntimePaths } from '../runtime-paths.mjs';

const paths = resolveRuntimePaths({});
const cli = new AgentBrowserCli({ binary: process.env.DOUYIN_AGENT_BROWSER_BIN || 'agent-browser', session: 'dsh-douyin', profileDir: paths.agentBrowserProfileDir, executablePath: process.env.DOUYIN_AGENT_BROWSER_CHROME || undefined });
const session = new DouyinSession({ cli, workDir: paths.agentBrowserWorkDir, switchTimeoutMs: 8_000 });

function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({
      send: (method, params = {}) => new Promise((done, failed) => { const next = ++id; pending.set(next, { resolve: done, reject: failed }); socket.send(JSON.stringify({ id: next, method, params })); }),
      close: () => socket.close(),
    }));
    socket.addEventListener('error', () => reject(new Error('CDP 连接失败。')));
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const samples = [];

try {
  const opened = await session.open({});
  // 最小化后 Chrome 不会再自动播放；先在前台恢复播放，再测“后台是否继续”。
  if (opened.state?.video?.paused) {
    await cli.eval("document.querySelector('video')?.play()");
    await sleep(1_000);
  }
  const wsUrl = (await cli.run(['get', 'cdp-url'])).cdpUrl ?? (await cli.run(['get', 'cdp-url']));
  const connection = await cdp(String(wsUrl));
  const { targetInfos } = await connection.send('Target.getTargets');
  const target = targetInfos.find(info => info.type === 'page' && /douyin\.com/.test(info.url));
  if (!target) throw new Error('未找到抖音标签页。');
  const { windowId } = await connection.send('Browser.getWindowForTarget', { targetId: target.targetId });
  await connection.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  const first = await session.status();
  const startedAt = Date.now();
  for (let index = 0; index < 7; index++) {
    await sleep(5_000);
    const state = await session.status().catch(error => ({ error: error.code ?? error.message }));
    samples.push({ elapsedMs: Date.now() - startedAt, time: state.video?.time ?? null, paused: state.video?.paused ?? null, error: state.error ?? null });
  }
  let frame = null;
  try {
    const bundle = await session.observe({ seconds: 1, maxFrames: 1 });
    frame = { bytes: bundle.frames[0]?.bytes ?? 0, frames: bundle.frames.length, notes: bundle.notes };
  } catch (error) { frame = { error: error.code ?? error.message }; }
  const last = await session.status().catch(() => null);
  await connection.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  connection.close();
  const times = samples.map(sample => sample.time).filter(value => typeof value === 'number');
  console.log(JSON.stringify({
    videoId: first.video.id, minimized: true, frameWhileMinimized: frame,
    advancedSeconds: times.length > 1 ? Math.max(...times) - Math.min(...times) : null,
    stillPlaying: last?.video?.paused === false, samples,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code ?? 'UNEXPECTED', message: error.message, samples }, null, 2));
  process.exitCode = 1;
}
