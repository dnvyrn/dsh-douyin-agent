// Run the inspected synthetic chat/share suites with no real browser or HOME.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-macos-safety-'));
const runtime = new URL('../playwright-runtime.mjs', import.meta.url).href;
const preload = `import { chromium } from ${JSON.stringify(runtime)};
for (const method of ['launch','launchPersistentContext','connectOverCDP','connect'])
  chromium[method] = async () => { throw new Error('NONBROWSER_REGRESSION_GUARD: ' + method); };`;
const files = [
  'friend-interactions-guard', 'friend-chat-share-isolation', 'chat', 'chat-recovery',
  'chat-auto-backlog', 'chat-all-day-reply', 'chat-permissions', 'chat-stable-identity',
  'chat-media-service', 'chat-unread-filter', 'chat-low-latency', 'chat-shared-work',
  'chat-history-watermark', 'chat-native-provider', 'chat-persona', 'chat-unanswered',
  'chat-unanswered-coordination', 'group-video-inbox', 'multi-recipient-watch',
  'watch-share-behavior', 'friend-auto-prepare', 'autonomous-share', 'shared-frame-proof', 'share-http',
];
try {
  const env = {
    PATH: process.env.PATH || '', TMPDIR: os.tmpdir(), HOME: root,
    DOUYIN_RUNTIME_LOCATION_FILE: path.join(root, 'runtime-location.json'),
    DOUYIN_STATE_DIR: path.join(root, 'state'),
    DEEPSEEK_SHARED_MEMORY_DB: path.join(root, 'memory', 'shared.sqlite'),
    DOUYIN_QQ_ROOT: path.join(root, 'qq'),
    DOUYIN_MEDIA_ENV_FILE: path.join(root, 'media', '.env'),
    DOUYIN_MEDIA_SETTINGS_FILE: path.join(root, 'media', 'settings.local.json'),
    DOUYIN_MEDIA_RUNTIME_ROOT: path.join(root, 'media'),
    DOUYIN_MEDIA_MODELS_DIR: path.join(root, 'media', '.models'),
  };
  const args = ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
    '--test', '--test-reporter=spec', '--test-concurrency=1', '--test-timeout=20000',
    // Positive skip pattern: a negative name filter can match file/parent scope!
    '--test-skip-pattern=真实Edge|真实合成分享面板|真实临时 Edge|真实合成输入',
    ...files.map(file => `tests/${file}.test.mjs`)];
  const result = spawnSync(process.execPath, args, { cwd: repo, env, stdio: 'inherit', timeout: 120000 });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.match(path.basename(root), /^douyin-macos-safety-/);
  fs.rmSync(root, { recursive: true, force: true });
}
