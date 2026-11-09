import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFriendInteractionsEnabled } from '../friend-interactions-guard.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-friend-guard-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^douyin-friend-guard-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, policy: path.join(root, 'friend-interactions-policy.json') };
}

test('missing policy and missing state directory are disabled without creating files', t => {
  const f = fixture(t), missing = path.join(f.root, 'absent-state');
  assert.equal(readFriendInteractionsEnabled(f.root), false);
  assert.equal(readFriendInteractionsEnabled(missing), false);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('only explicit enabled policy grants opt-in, and revocation is read on every check', t => {
  const f = fixture(t);
  for (const enabled of [true, false, true]) {
    fs.writeFileSync(f.policy, JSON.stringify({ version: 1, enabled }));
    assert.equal(readFriendInteractionsEnabled(f.root), enabled);
  }
  assert.equal(path.dirname(path.resolve(f.policy)), path.resolve(f.root));
  fs.unlinkSync(f.policy);
  assert.equal(readFriendInteractionsEnabled(f.root), false);
});

test('malformed, unknown-version and permissive-looking policies fail closed', t => {
  const f = fixture(t);
  for (const raw of ['{', 'null', '[]', '{}', '{"version":2,"enabled":true}', '{"version":1,"enabled":"true"}', '{"version":1,"enabled":1}', '{"version":1,"enabled":true,"extra":true}']) {
    fs.writeFileSync(f.policy, raw);
    assert.throws(() => readFriendInteractionsEnabled(f.root), /总开关记录损坏/);
  }
});

test('settings maintenance guard suppresses explicitly enabled policy', t => {
  const f = fixture(t);
  fs.writeFileSync(f.policy, JSON.stringify({ version: 1, enabled: true }));
  fs.writeFileSync(path.join(f.root, 'friend-interactions-settings.guard'), 'synthetic-maintenance');
  assert.equal(readFriendInteractionsEnabled(f.root), false);
});
