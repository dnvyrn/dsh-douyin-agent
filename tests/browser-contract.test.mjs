import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlyObserver, resolveBackend } from '../browser/index.mjs';
import { BACKEND_CODES, normalizeState, assertObservable, assertVideoId, assertQuery } from '../browser/contract.mjs';

const ID = '7579432563794584933';
const raw = (overrides = {}) => ({
  url: `https://www.douyin.com/video/${ID}`, title: '作品', pageKind: 'video', videoSelection: { candidateCount: 1, ambiguous: false, identityConflict: false },
  pageViewport: { width: 1280, height: 720 },
  video: { id: ID, title: '标题', author: '作者', time: 2, duration: 30, paused: false, readyState: 4, viewport: { x: 0, y: 0, width: 720, height: 1280 } },
  ...overrides,
});

test('状态归一化只保留已知字段并施加边界', () => {
  const state = normalizeState({
    ...raw({ unknown: 'ignored', visibleText: 'x'.repeat(10_000), title: 'y'.repeat(1_000) }),
    searchResults: Array.from({ length: 30 }, (_, index) => ({ index, id: String(index).padStart(19, '0'), title: `结果 ${index}`, author: '@a' })),
  });
  assert.equal(state.visibleText.length, 800);
  assert.equal(state.title.length, 300);
  assert.equal(state.searchResults.length, 20);
  assert.equal(state.searchResults[0].index, 0);
  assert.equal('unknown' in state, false);
  assert.deepEqual(state.pageViewport, { width: 1280, height: 720 });
});

test('非法作品标识、时长与播放器区域不进入证据', () => {
  const state = normalizeState({ video: { id: '12/34', time: Number.NaN, duration: -1, readyState: 9, viewport: { x: -1, y: 0, width: 10, height: 10 } } });
  assert.equal(state.video.id, null);
  assert.equal(state.video.time, null);
  assert.equal(state.video.duration, null);
  assert.equal(state.video.readyState, null);
  assert.equal(state.video.viewport, null);
});

test('不可观察原因按优先级返回单一错误码', () => {
  const cases = [
    [{ unsupportedPage: true }, BACKEND_CODES.NOT_DOUYIN],
    [{ loginRequired: true }, BACKEND_CODES.NEEDS_USER],
    [{ verificationRequired: true }, BACKEND_CODES.NEEDS_USER],
    [{ privateChatVisible: true }, BACKEND_CODES.PRIVATE_AREA],
    [{ livePreview: { recognized: true } }, BACKEND_CODES.LIVE_PREVIEW],
    [{ videoSelection: { candidateCount: 2, ambiguous: true, identityConflict: true } }, BACKEND_CODES.IDENTITY_CONFLICT],
    [{ video: null }, BACKEND_CODES.NO_VIDEO],
  ];
  for (const [patch, code] of cases) assert.throws(() => assertObservable(normalizeState(raw(patch))), error => error.code === code);
});

test('作品标识与搜索词边界', () => {
  assert.equal(assertVideoId(ID), ID);
  for (const value of [123, '', 'abc', '1'.repeat(65)]) assert.throws(() => assertVideoId(value), error => error.code === BACKEND_CODES.INVALID_INPUT);
  assert.equal(assertQuery('  合成科普  '), '合成科普');
  for (const value of ['', '   ', 'x'.repeat(301), 'a\u0000b']) assert.throws(() => assertQuery(value), error => error.code === BACKEND_CODES.INVALID_INPUT);
});

test('后端选择默认沿用 playwright、未知取值失败关闭', () => {
  assert.equal(resolveBackend({}), 'playwright');
  assert.equal(resolveBackend({ DOUYIN_BROWSER_BACKEND: ' agent-browser ' }), 'agent-browser');
  assert.equal(resolveBackend({ DOUYIN_BROWSER_BACKEND: 'playwright' }), 'playwright');
  assert.throws(() => resolveBackend({ DOUYIN_BROWSER_BACKEND: 'firefox' }), error => error.code === BACKEND_CODES.INVALID_INPUT);
});

test('只读观察器不冒充 Playwright 后端，agent-browser 使用独立 profile 与工作目录', () => {
  assert.throws(() => createReadOnlyObserver({ backend: 'playwright', paths: {} }), error => error.code === BACKEND_CODES.NOT_IMPLEMENTED);
  const paths = { agentBrowserProfileDir: '/tmp/dy-profile', agentBrowserWorkDir: '/tmp/dy-frames' };
  const session = createReadOnlyObserver({ paths, session: 'dsh-douyin' });
  assert.ok(session, '未显式指定时使用独立浏览器后端');
  assert.ok(session);
  assert.equal(typeof session.observe, 'function');
  assert.equal(typeof session.next, 'function');
  assert.equal(paths.agentBrowserProfileDir, '/tmp/dy-profile');
});

test('没有时长且 ID 只来自链接/地址栏时，不把画面算到该作品名下', () => {
  for (const idSource of ['location', 'link', null]) {
    const live = normalizeState(raw({ video: { id: ID, idSource, duration: null, time: 3, paused: false, readyState: 4, viewport: { x: 0, y: 0, width: 640, height: 480 } } }));
    assert.equal(live.videoSelection.identityConflict, true, String(idSource));
    assert.throws(() => assertObservable(live), error => error.code === BACKEND_CODES.IDENTITY_CONFLICT);
  }
  const real = normalizeState(raw({ video: { ...raw().video, idSource: 'player' } }));
  assert.equal(real.videoSelection.identityConflict, false);
  assert.equal(real.video.idSource, 'player');
  const located = normalizeState(raw({ video: { ...raw().video, idSource: 'location', duration: 30 } }));
  assert.equal(located.videoSelection.identityConflict, false);
});
