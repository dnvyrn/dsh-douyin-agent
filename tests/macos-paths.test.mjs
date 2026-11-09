// Dependency-free: no media/browser imports, real HOME, credentials, or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimePaths, resolveNodeExecutable } from '../runtime-paths.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-macos-paths-'));
  t.after(() => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('douyin-macos-paths-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const home = path.join(root, 'User Home'), sourceRoot = path.join(root, 'Package Source');
  const userRoot = path.join(home, '.dsh', 'douyin-browser');
  const options = { env: {}, home, sourceRoot, platform: 'darwin', legacyMemoryDbPath: path.join(root, 'legacy', 'shared.sqlite') };
  return { root, home, sourceRoot, userRoot, options, resolve: overrides => resolveRuntimePaths({ ...options, ...overrides }) };
}
function put(file, value = 'synthetic fixture, not credentials') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
function locator(f, record) {
  put(path.join(f.userRoot, 'runtime-location.json'), JSON.stringify(record));
}
function record(f) {
  const base = path.join(f.root, 'Chosen Data');
  return {
    version: 1, stateDir: path.join(base, 'state'), mediaEnvFile: path.join(base, 'audio.env'),
    mediaSettingsFile: path.join(base, 'settings.json'), mediaRuntimeRoot: path.join(base, 'runtime'),
    mediaModelsDir: path.join(base, 'models'), memoryDbPath: path.join(base, 'memory', 'custom.sqlite'),
  };
}
const variables = {
  stateDir: 'DOUYIN_STATE_DIR', mediaEnvFile: 'DOUYIN_MEDIA_ENV_FILE',
  mediaSettingsFile: 'DOUYIN_MEDIA_SETTINGS_FILE', mediaRuntimeRoot: 'DOUYIN_MEDIA_RUNTIME_ROOT',
  mediaModelsDir: 'DOUYIN_MEDIA_MODELS_DIR', memoryDbPath: 'DEEPSEEK_SHARED_MEMORY_DB',
};

const legacyCases = [
  ['stateDir', ['state'], true],
  ['mediaEnvFile', ['media', '.env'], false],
  ['mediaSettingsFile', ['media', 'settings.local.json'], false],
  ['mediaRuntimeRoot', ['media', '.venv'], true],
  ['mediaModelsDir', ['media', '.models'], true],
];

test('darwin fresh defaults use one durable user root, not the package or DSH_HOME', t => {
  const f = fixture(t);
  put(path.join(f.sourceRoot, 'media', '.env.example'));
  put(path.join(f.sourceRoot, 'media', 'index.mjs'));
  const before = fs.readdirSync(f.root, { recursive: true });
  const resolved = f.resolve({ env: { DSH_HOME: path.join(f.root, 'Other DSH Profile') } });
  assert.deepEqual(resolved, {
    locationFile: path.join(f.userRoot, 'runtime-location.json'), stateDir: path.join(f.userRoot, 'state'),
    memoryDir: path.join(f.userRoot, 'memory'), memoryDbPath: path.join(f.userRoot, 'memory', 'shared.sqlite'),
    mediaEnvFile: path.join(f.userRoot, 'media', '.env'), mediaSettingsFile: path.join(f.userRoot, 'media', 'settings.local.json'),
    mediaRuntimeRoot: path.join(f.userRoot, 'media'), mediaModelsDir: path.join(f.userRoot, 'media', '.models'),
    mediaCaptureDir: path.join(f.userRoot, 'state', 'media-captures'),
    browserProfileDir: path.join(f.userRoot, 'cli-profile'), browserControlDir: path.join(f.userRoot, 'control'),
  });
  assert.deepEqual(f.resolve({ sourceRoot: path.join(f.root, 'Updated Package') }), resolved);
  assert.deepEqual(fs.readdirSync(f.root, { recursive: true }), before);
  assert.equal(fs.existsSync(f.home), false);
});

for (const platform of ['win32', 'linux']) test(`${platform} keeps source-root defaults and shared user browser/memory`, t => {
  const f = fixture(t), resolved = f.resolve({ platform });
  assert.equal(resolved.stateDir, path.join(f.sourceRoot, 'state'));
  assert.equal(resolved.mediaEnvFile, path.join(f.sourceRoot, 'media', '.env'));
  assert.equal(resolved.mediaSettingsFile, path.join(f.sourceRoot, 'media', 'settings.local.json'));
  assert.equal(resolved.mediaRuntimeRoot, path.join(f.sourceRoot, 'media'));
  assert.equal(resolved.mediaModelsDir, path.join(f.sourceRoot, 'media', '.models'));
  assert.equal(resolved.memoryDbPath, path.join(f.userRoot, 'memory', 'shared.sqlite'));
  assert.equal(resolved.browserProfileDir, path.join(f.userRoot, 'cli-profile'));
});

test('platform defaults to the running OS without mutating process.platform', t => {
  const f = fixture(t), { platform, ...options } = f.options;
  assert.deepEqual(resolveRuntimePaths(options), f.resolve({ platform: process.platform }));
});

test('existing user state survives package replacement without being read or rewritten', t => {
  const f = fixture(t), state = path.join(f.userRoot, 'state', 'clock.json');
  put(state, '{"syntheticClock":123}');
  put(path.join(f.userRoot, 'media', '.env'));
  assert.equal(f.resolve().stateDir, path.dirname(state));
  assert.equal(f.resolve({ sourceRoot: path.join(f.root, 'Upgrade Package') }).stateDir, path.dirname(state));
  assert.equal(fs.readFileSync(state, 'utf8'), '{"syntheticClock":123}');
});

for (const [field, parts, directory] of legacyCases) test(`darwin refuses to silently abandon legacy ${field}`, t => {
  const f = fixture(t), legacy = path.join(f.sourceRoot, ...parts);
  if (directory) fs.mkdirSync(legacy, { recursive: true }); else put(legacy);
  const before = fs.readdirSync(f.root, { recursive: true });
  assert.throws(() => f.resolve(), error => error.message.includes(field) && error.message.includes(variables[field]) && /未切换/.test(error.message));
  assert.deepEqual(fs.readdirSync(f.root, { recursive: true }), before);
  assert.equal(fs.existsSync(f.home), false);
  // An explicit choice can keep the old path or select a manually migrated one.
  const keep = field === 'mediaRuntimeRoot' ? path.dirname(legacy) : legacy;
  assert.equal(f.resolve({ env: { [variables[field]]: keep } })[field], keep);
  const migrated = path.join(f.root, 'Migrated', field);
  assert.equal(f.resolve({ env: { [variables[field]]: migrated } })[field], migrated);
});

test('both legacy and user state require explicit selection, never heuristic merging', t => {
  const f = fixture(t);
  put(path.join(f.sourceRoot, 'state', 'clock.json'), 'old synthetic clock');
  put(path.join(f.userRoot, 'state', 'clock.json'), 'new synthetic clock');
  assert.throws(() => f.resolve(), /旧版 stateDir/);
  locator(f, { version: 1, stateDir: path.join(f.sourceRoot, 'state') });
  assert.equal(f.resolve().stateDir, path.join(f.sourceRoot, 'state'));
});

test('version-1 locator retains every selected location; per-field env still wins', t => {
  const f = fixture(t), stored = record(f);
  locator(f, stored);
  // Metadata in the source tree must not override an explicit locator.
  for (const [, parts, directory] of legacyCases) {
    const target = path.join(f.sourceRoot, ...parts);
    if (directory) fs.mkdirSync(target, { recursive: true }); else put(target);
  }
  for (const field of Object.keys(variables)) assert.equal(f.resolve()[field], stored[field]);
  for (const [field, variable] of Object.entries(variables)) {
    const override = path.join(f.root, 'Override', field);
    const resolved = f.resolve({ env: { [variable]: override, DSH_HOME: path.join(f.root, 'Ignored') } });
    assert.equal(resolved[field], override);
    for (const other of Object.keys(variables).filter(key => key !== field)) assert.equal(resolved[other], stored[other]);
  }
  assert.equal(fs.existsSync(stored.stateDir), false);
});

test('partial locator uses durable defaults; runtime override still controls model fallback only', t => {
  const f = fixture(t), stateDir = path.join(f.root, 'Explicit State'), runtime = path.join(f.root, 'Explicit Runtime');
  locator(f, { version: 1, stateDir });
  assert.equal(f.resolve().stateDir, stateDir);
  assert.equal(f.resolve().mediaEnvFile, path.join(f.userRoot, 'media', '.env'));
  for (const method of ['env', 'locator']) {
    const env = method === 'env' ? { DOUYIN_MEDIA_RUNTIME_ROOT: runtime } : {};
    if (method === 'locator') locator(f, { version: 1, stateDir, mediaRuntimeRoot: runtime });
    const resolved = f.resolve({ env });
    assert.equal(resolved.mediaModelsDir, path.join(runtime, '.models'));
    assert.equal(resolved.mediaEnvFile, path.join(f.userRoot, 'media', '.env'));
    assert.equal(resolved.mediaSettingsFile, path.join(f.userRoot, 'media', 'settings.local.json'));
  }
});

test('malformed locator and invalid explicit paths fail closed', t => {
  const f = fixture(t);
  for (const value of ['broken json', 'null', '[]', JSON.stringify({ ...record(f), version: 2 }), JSON.stringify({ ...record(f), stateDir: 'relative' })]) {
    put(path.join(f.userRoot, 'runtime-location.json'), value);
    assert.throws(() => f.resolve(), /运行位置记录/);
  }
  locator(f, record(f));
  for (const variable of [...Object.values(variables), 'DOUYIN_RUNTIME_LOCATION_FILE']) {
    assert.throws(() => f.resolve({ env: { [variable]: 'relative' } }), /绝对路径/);
  }
});

test('explicit location-file override avoids the default locator', t => {
  const f = fixture(t), stored = record(f), locationFile = path.join(f.root, 'Custom Locator.json');
  put(path.join(f.userRoot, 'runtime-location.json'), 'invalid default locator');
  put(locationFile, JSON.stringify(stored));
  const resolved = f.resolve({ env: { DOUYIN_RUNTIME_LOCATION_FILE: locationFile } });
  assert.equal(resolved.locationFile, locationFile);
  assert.equal(resolved.stateDir, stored.stateDir);
});

test('legacy checks read metadata only and fail closed on access errors', t => {
  const f = fixture(t), read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    assert.equal(file, path.join(f.userRoot, 'runtime-location.json'));
    return read(file, ...args);
  });
  t.mock.method(fs, 'lstatSync', () => { throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' }); });
  assert.throws(() => f.resolve(), /无法检查旧版 stateDir/);
});

test('dangling legacy symlink is not mistaken for a fresh install', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  fs.mkdirSync(f.sourceRoot, { recursive: true });
  fs.symlinkSync(path.join(f.root, 'Missing Target'), path.join(f.sourceRoot, 'state'));
  assert.throws(() => f.resolve(), /旧版 stateDir/);
});

test('memory precedence remains explicit database, locator, existing legacy file, user default', t => {
  const f = fixture(t), legacy = f.options.legacyMemoryDbPath;
  assert.equal(f.resolve().memoryDbPath, path.join(f.userRoot, 'memory', 'shared.sqlite'));
  put(legacy);
  assert.equal(f.resolve().memoryDbPath, legacy);
  const stored = record(f);
  locator(f, stored);
  assert.equal(f.resolve().memoryDbPath, stored.memoryDbPath);
  const explicit = path.join(f.root, 'Explicit Memory', 'custom.sqlite');
  assert.equal(f.resolve({ env: { DEEPSEEK_SHARED_MEMORY_DB: explicit } }).memoryDbPath, explicit);
  locator(f, { version: 1, stateDir: stored.stateDir, memoryDir: path.dirname(stored.memoryDbPath) });
  assert.equal(f.resolve().memoryDbPath, path.join(path.dirname(stored.memoryDbPath), 'shared.sqlite'));
  assert.equal(fs.existsSync(path.dirname(explicit)), false);
});

test('Node lookup keeps the non-Electron fast path and offers platform-neutral failure advice', t => {
  const f = fixture(t);
  assert.equal(resolveNodeExecutable({ env: {}, versions: {}, executable: process.execPath }), process.execPath);
  assert.throws(() => resolveNodeExecutable({ env: {}, versions: { electron: 'synthetic' }, sourceRoot: f.sourceRoot, resourcesPath: f.root }), error => /DOUYIN_NODE_EXECUTABLE/.test(error.message) && !/node\.exe/.test(error.message));
});
