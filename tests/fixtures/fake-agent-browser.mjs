#!/usr/bin/env node
// 测试替身：模拟 agent-browser 的 CLI 契约，不启动任何浏览器。
import fs from 'node:fs';

const argv = process.argv.slice(2);
const log = process.env.AGENT_BROWSER_FAKE_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv, secret: process.env.DSH_TEST_SECRET ?? null, hasFakeFlag: process.env.AGENT_BROWSER_FAKE_MODE ?? null }) + '\n');
const mode = process.env.AGENT_BROWSER_FAKE_MODE || 'ok';
const value = (() => { try { return JSON.parse(process.env.AGENT_BROWSER_FAKE_VALUE || '{"ok":true}'); } catch { return { ok: true }; } })();
const command = argv.find((item, index) => !item.startsWith('--') && !['--session', '--profile', '--namespace', '--allowed-domains', '--screenshot-format', '--screenshot-quality'].includes(argv[index - 1]));
const output = payload => process.stdout.write(JSON.stringify(payload));

if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'fail') { process.stderr.write('synthetic failure\n'); process.exit(3); }
else if (mode === 'no-json') { process.exit(0); }
else if (mode === 'bad-json') { process.stdout.write('{not json'); }
else if (mode === 'envelope-error') { output({ success: false, error: 'synthetic error' }); }
else if (command === 'batch') {
  const raw = fs.readFileSync(0, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) { process.stderr.write('batch stdin is not an array\n'); process.exit(2); }
  output(rows.map((row, index) => ({ success: true, index, data: { result: { row, value } } })));
} else if (command === 'eval') {
  output({ success: true, data: { result: value } });
} else if (command === 'screenshot') {
  const file = argv[argv.indexOf('screenshot') + 1];
  fs.writeFileSync(file, Buffer.from(process.env.AGENT_BROWSER_FAKE_JPEG || '', 'base64'));
  output({ success: true, data: { result: file } });
} else {
  output({ success: true, data: { result: { command, value } } });
}
