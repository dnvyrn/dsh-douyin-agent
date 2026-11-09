#!/usr/bin/env node
// 短时长浸泡验收：前台窗口持续播放，周期性读状态/抽帧，记录失败与进程占用。
// 用法：node verification/agent-browser-soak.mjs <分钟>
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { AgentBrowserCli } from '../browser/agent-browser-cli.mjs';
import { DouyinSession } from '../browser/douyin-session.mjs';
import { resolveRuntimePaths } from '../runtime-paths.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const minutes = Math.max(1, Math.min(30, Number(process.argv[2] ?? 3)));
const paths = resolveRuntimePaths({});
const cli = new AgentBrowserCli({ binary: process.env.DOUYIN_AGENT_BROWSER_BIN || 'agent-browser', session: 'dsh-douyin', profileDir: paths.agentBrowserProfileDir, executablePath: process.env.DOUYIN_AGENT_BROWSER_CHROME || undefined });
const session = new DouyinSession({ cli, workDir: paths.agentBrowserWorkDir, switchTimeoutMs: 8_000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromeRssBytes() {
  try {
    const output = execFileSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8' });
    return output.split('\n').filter(line => line.includes('agent-browser/profile') || line.includes('agent-browser-darwin-arm64'))
      .reduce((sum, line) => sum + (Number(line.trim().split(/\s+/)[0]) || 0) * 1024, 0);
  } catch { return null; }
}

// 日志放在仓库内，隔夜后任何会话都能直接读取；产物不入库。
const logDir = path.dirname(fileURLToPath(import.meta.url));
const logFile = path.join(logDir, 'agent-browser-soak.jsonl');
mkdirSync(logDir, { recursive: true });
const record = entry => { try { appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch {} };
const startedAt = Date.now(), deadline = startedAt + minutes * 60_000, samples = [], observations = [], switches = [];
let lastSwitchAt = Date.now();
let videoId = null;
try {
  const opened = await session.open({});
  if (opened.state?.video?.paused) { await cli.eval("document.querySelector('video')?.play()"); await sleep(1_000); }
  videoId = (await session.status()).video?.id ?? null;
  const rssStart = chromeRssBytes();
  while (Date.now() < deadline) {
    await sleep(15_000);
    try {
      const state = await session.status();
      const sample = { at: Date.now() - startedAt, id: state.video?.id ?? null, time: state.video?.time ?? null, paused: state.video?.paused ?? null };
      samples.push(sample); record({ kind: 'status', ...sample });
    } catch (error) { const sample = { at: Date.now() - startedAt, error: error.code ?? error.message }; samples.push(sample); record({ kind: 'status', ...sample }); }
    if (Date.now() - lastSwitchAt >= 10 * 60_000) {
      lastSwitchAt = Date.now();
      try {
        const before = await session.status();
        const changed = await session.next({ expectedVideoId: before.video?.id });
        const item = { at: Date.now() - startedAt, changed: true, videoId: changed.state?.video?.id ?? null };
        switches.push(item); record({ kind: 'next', ...item });
      } catch (error) { const item = { at: Date.now() - startedAt, error: error.code ?? error.message }; switches.push(item); record({ kind: 'next', ...item }); }
    }
    if (samples.length % 4 === 0) {
      try {
        const bundle = await session.observe({ seconds: 1, maxFrames: 1 });
        const item = { at: Date.now() - startedAt, frames: bundle.frames.length, bytes: bundle.frames[0]?.bytes ?? 0, complete: bundle.coverage.complete };
        observations.push(item); record({ kind: 'observe', ...item });
      } catch (error) { const item = { at: Date.now() - startedAt, error: error.code ?? error.message }; observations.push(item); record({ kind: 'observe', ...item }); }
    }
  }
  const result = {
    minutes, videoId, rssStartBytes: rssStart, rssEndBytes: chromeRssBytes(),
    statusFailures: samples.filter(item => item.error).length, observationFailures: observations.filter(item => item.error).length, switchFailures: switches.filter(item => item.error).length,
    advancedSeconds: (() => { const times = samples.map(item => item.time).filter(Number.isFinite); return times.length > 1 ? times.at(-1) - times[0] : null; })(),
    identityChanges: new Set(samples.map(item => item.id).filter(Boolean)).size,
    samples, observations, switches, logFile,
  };
  writeFileSync(path.join(logDir, 'agent-browser-soak-summary.json'), JSON.stringify(result, null, 2));
  record({ kind: 'summary', ...result, samples: undefined, observations: undefined, switches: undefined });
  console.log(JSON.stringify({ ...result, samples: undefined, observations: undefined, switches: undefined }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code ?? 'UNEXPECTED', message: error.message }));
  process.exitCode = 1;
}
