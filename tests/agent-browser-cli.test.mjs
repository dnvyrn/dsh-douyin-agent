import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentBrowserCli, unwrapJson } from '../browser/agent-browser-cli.mjs';
import { BACKEND_CODES } from '../browser/contract.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-agent-browser.mjs', import.meta.url));
const SAFE_HOME = process.env.HOME || os.tmpdir();

function workspace(t, { mode = 'ok', value, jpeg = '' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-ab-cli-'));
  const log = path.join(directory, 'argv.log');
  const env = { PATH: process.env.PATH, HOME: SAFE_HOME, TMPDIR: os.tmpdir(), DSH_TEST_SECRET: 'must-not-leak',
    AGENT_BROWSER_FAKE_LOG: log, AGENT_BROWSER_FAKE_MODE: mode };
  if (value !== undefined) env.AGENT_BROWSER_FAKE_VALUE = JSON.stringify(value);
  if (jpeg) env.AGENT_BROWSER_FAKE_JPEG = jpeg;
  const profileDir = path.join(directory, 'profile');
  const cli = new AgentBrowserCli({ binary: process.execPath, binaryArgs: [FAKE], session: 'test-session', profileDir, env });
  t.after(() => { assert.equal(path.dirname(directory), os.tmpdir()); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, log, env, cli, profileDir };
}

const readLog = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

test('全局参数固定带上会话、专用 profile、命名空间、域名白名单与有头模式', t => {
  const { cli, profileDir } = workspace(t);
  assert.deepEqual(cli.globalArgs(), ['--json', '--session', 'test-session', '--profile', profileDir, '--namespace', 'dsh-douyin', '--allowed-domains', 'douyin.com', '--headed']);
});

test('eval 解包 {success,data:{result}} 并只传白名单环境', async t => {
  const { cli, log } = workspace(t, { value: { url: 'https://www.douyin.com/video/1' } });
  assert.deepEqual(await cli.eval('({a:1})'), { url: 'https://www.douyin.com/video/1' });
  const [entry] = readLog(log);
  assert.equal(entry.secret, null, '宿主环境变量不应进入浏览器进程');
  assert.ok(entry.argv.includes('eval'));
  assert.ok(entry.argv.includes('--headed'));
});

test('非零退出码保留 stderr 尾部并归类为失败', async t => {
  const { cli } = workspace(t, { mode: 'fail' });
  await assert.rejects(cli.eval('1'), error => error.code === BACKEND_CODES.FAILED && /synthetic failure/.test(error.message) && error.exitCode === 3);
});

test('可执行文件缺失时明确失败，不尝试下载浏览器', async t => {
  const { directory, env } = workspace(t);
  const cli = new AgentBrowserCli({ binary: path.join(directory, 'missing-binary'), session: 'missing', profileDir: path.join(directory, 'profile'), env });
  await assert.rejects(cli.eval('1'), error => error.code === BACKEND_CODES.MISSING && /不会自动下载浏览器/.test(error.message));
});

test('超时会终止子进程并标记结果未知', async t => {
  const { cli } = workspace(t, { mode: 'hang' });
  const started = Date.now();
  await assert.rejects(cli.eval('1', { timeoutMs: 300 }), error => error.code === BACKEND_CODES.TIMEOUT);
  assert.ok(Date.now() - started < 5_000);
});

test('空输出与坏 JSON 不被当成成功', async t => {
  const empty = workspace(t, { mode: 'no-json' });
  await assert.rejects(empty.cli.eval('1'), error => error.code === BACKEND_CODES.BAD_JSON);
  const broken = workspace(t, { mode: 'bad-json' });
  await assert.rejects(broken.cli.eval('1'), error => error.code === BACKEND_CODES.BAD_JSON);
});

test('命令自身报告失败时抛错，而不是返回 error 对象', async t => {
  const { cli } = workspace(t, { mode: 'envelope-error' });
  await assert.rejects(cli.eval('1'), error => error.code === BACKEND_CODES.FAILED && /synthetic error/.test(error.message));
});

test('批量命令通过 stdin 传数组并逐行解包', async t => {
  const { cli, log } = workspace(t, { value: 'ok' });
  const rows = await cli.batch([['eval', '1'], ['get', 'url']]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { row: ['get', 'url'], value: 'ok' });
  const [entry] = readLog(log);
  assert.deepEqual(entry.argv.slice(-2), ['batch', '--bail']);
});

test('只允许打开 https 地址且截图参数有边界', async t => {
  const { cli } = workspace(t);
  await assert.rejects(cli.open('http://www.douyin.com/'), error => error.code === BACKEND_CODES.INVALID_INPUT);
  await assert.rejects(cli.screenshot('x.jpg', { quality: 0 }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  await assert.rejects(cli.open(''), error => error.code === BACKEND_CODES.INVALID_INPUT);
});

test('会话名与 profile 目录缺失时在构造阶段拒绝', () => {
  assert.throws(() => new AgentBrowserCli({ session: 'has space', profileDir: '/tmp/x' }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  assert.throws(() => new AgentBrowserCli({ session: 'ok' }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  assert.throws(() => new AgentBrowserCli({ session: 'ok', profileDir: '/tmp/x', allowedDomains: [] }), error => error.code === BACKEND_CODES.INVALID_INPUT);
});

test('unwrapJson 支持裸值、result 与嵌套 data', () => {
  assert.deepEqual(unwrapJson({ a: 1 }), { a: 1 });
  assert.deepEqual(unwrapJson({ success: true, data: { result: 7 } }), 7);
  assert.deepEqual(unwrapJson({ data: { data: { result: 'x' } } }), 'x');
  assert.throws(() => unwrapJson({ success: false, error: 'bad' }), error => error.code === BACKEND_CODES.FAILED);
});
