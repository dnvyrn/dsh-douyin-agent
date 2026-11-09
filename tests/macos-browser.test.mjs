import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { probeEdgeInstallation, readEdgeFileVersion, runBrowserHost } from '../browser-host.mjs';

const macEdge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
test('Mac detection matches the actual msedge channel, never a Windows or Chrome path', async () => {
  const visited = [];
  const result = await probeEdgeInstallation({ platform: 'darwin', env: { PROGRAMFILES: 'C:\\Program Files' }, exists: file => { visited.push(file); return file === macEdge; }, readVersion: async file => { assert.equal(file, macEdge); return '130.0.2849.80\n'; } });
  assert.deepEqual(visited, [macEdge]);
  assert.deepEqual(result, { installed: true, version: '130.0.2849.80', channel: 'msedge' });
});
test('missing Edge never invokes a version probe or falls back to Chrome', async () => {
  const result = await probeEdgeInstallation({ platform: 'darwin', env: {}, exists: () => false, readVersion: () => assert.fail('must not read missing app') });
  assert.deepEqual(result, { installed: false, version: null, channel: 'msedge' });
});
test('Mac version is read through bounded plutil, without executing the browser', async () => {
  const version = await readEdgeFileVersion(macEdge, { platform: 'darwin', exists: file => file === '/Applications/Microsoft Edge.app/Contents/Info.plist', executeImpl: async (command, args, options) => {
    assert.equal(command, '/usr/bin/plutil');
    assert.deepEqual(args, ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', '/Applications/Microsoft Edge.app/Contents/Info.plist']);
    assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 2048);
    return { stdout: '130.0.2849.80\n' };
  } });
  assert.equal(version, '130.0.2849.80');
});
test('unreadable or invalid version does not claim browser absent', async () => {
  for (const readVersion of [async () => { throw Error('permission denied'); }, async () => 'not-a-version']) {
    assert.deepEqual(await probeEdgeInstallation({ platform: 'darwin', env: {}, exists: () => true, readVersion }), { installed: true, version: null, channel: 'msedge' });
  }
  assert.equal(await readEdgeFileVersion(macEdge, { platform: 'darwin', exists: () => false, executeImpl: () => assert.fail() }), null);
});
test('Windows paths and file metadata reader remain testable on Mac', async () => {
  const file = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  const result = await probeEdgeInstallation({ platform: 'win32', env: { HOMEDRIVE: 'C:' }, exists: candidate => candidate === file, readVersion: async () => '130.0.1.2' });
  assert.equal(result.installed, true);
  assert.equal(await readEdgeFileVersion(file, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: () => true, executeImpl: async (command, args, options) => {
    assert.equal(command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(options.env.DOUYIN_EDGE_VERSION_FILE, file);
    assert.ok(args.includes('-NonInteractive')); return { stdout: '130.0.1.2' };
  } }), '130.0.1.2');
});
test('unsupported platform is not advertised as installed', async () => {
  assert.equal((await probeEdgeInstallation({ platform: 'linux', env: {}, exists: () => assert.fail() })).installed, false);
});
test('injected host retains dedicated profile, loopback CDP, headed mode and focus cleanup', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-mac-host-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^douyin-mac-host-/); fs.rmSync(root, { recursive: true, force: true }); });
  const page = new EventEmitter(); page.isClosed = () => false; page.mainFrame = () => null;
  const context = new EventEmitter(); context.pages = () => [page]; context.close = async () => {};
  const sent = []; context.newCDPSession = async () => ({ send: async (...args) => sent.push(args), detach: async () => {} });
  const profile = path.join(root, 'isolated-profile');
  const result = await runBrowserHost({ profile, controlDir: root, port: 19227, probeInstallation: async () => ({ installed: true, version: '130.0.1.2' }),
    chromiumImpl: { launchPersistentContext: async (actualProfile, options) => {
      assert.equal(actualProfile, profile); assert.equal(options.channel, 'msedge'); assert.equal(options.headless, false);
      assert.ok(options.args.includes('--remote-debugging-address=127.0.0.1')); assert.equal(options.executablePath, undefined);
      return context;
    } }, processImpl: { pid: process.pid, on() {}, exit(code) { assert.equal(code, 0); } }, logger: { log() {}, error() { assert.fail('unexpected host failure'); } } });
  assert.equal(result.started, true);
  assert.deepEqual(sent, [['Emulation.setFocusEmulationEnabled', { enabled: false }]]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'browser.json'), 'utf8')).ready, true);
  context.emit('close');
});
