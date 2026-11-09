import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DouyinSession, stateScript } from '../browser/douyin-session.mjs';
import { BACKEND_CODES } from '../browser/contract.mjs';

const require = createRequire(import.meta.url);
const jpeg = require('../storyboard/vendor/jpeg-js/index.js');
const VIDEO_ID = '7579432563794584933';
const VIEWPORT = { width: 800, height: 600 };

function solidJpeg(width = VIEWPORT.width, height = VIEWPORT.height, quality = 80) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = 30; data[i * 4 + 1] = 90; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return Buffer.from(jpeg.encode({ data, width, height }, quality).data);
}

function pageState(overrides = {}) {
  return {
    url: `https://www.douyin.com/video/${VIDEO_ID}`, title: '合成作品', pageKind: 'video', documentReadyState: 'complete',
    loginRequired: false, verificationRequired: false, privateChatVisible: false, livePreview: null, searchResults: [],
    pageViewport: VIEWPORT, videoSelection: { candidateCount: 1, ambiguous: false, identityConflict: false },
    video: { id: VIDEO_ID, url: `https://www.douyin.com/video/${VIDEO_ID}`, title: '合成作品标题', author: '合成作者', time: 1.5, duration: 30, paused: false, muted: true, readyState: 4, ended: false, loop: false, width: 1080, height: 1920, viewport: { x: 40, y: 20, width: 640, height: 480 } },
    ...overrides,
  };
}

function fixture(t, { state = pageState(), screenshot = () => solidJpeg(), afterEval, afterScreenshot, clickImpl } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-session-'));
  const page = { state: structuredClone(state) };
  let clock = 1_000_000, evals = 0, screenshots = 0;
  const calls = [];
  const cli = {
    calls,
    async eval(source) {
      assert.equal(source, stateScript);
      evals++; calls.push(['eval']);
      afterEval?.(evals, page);
      return structuredClone(page.state);
    },
    async screenshot(file) {
      screenshots++; calls.push(['screenshot']); await afterScreenshot?.(screenshots, page);
      fs.writeFileSync(file, screenshot(page));
      return file;
    },
    async open(url) { calls.push(['open', url]); page.state.url = url; page.state.pageKind = 'search'; page.state.video = null; },
    async click(selector) { calls.push(['click', selector]); return clickImpl ? clickImpl(selector, page, calls) : true; },
    async mouseMove(x, y) { calls.push(['mouseMove', x, y]); },
    async mouseWheel(dy) { calls.push(['mouseWheel', dy]); },
    async close() { calls.push(['close']); },
  };
  const session = new DouyinSession({ cli, workDir: path.join(directory, 'frames'), now: () => clock, sleep: async ms => { clock += ms; }, switchTimeoutMs: 2_000, pollMs: 250 });
  t.after(() => { assert.equal(path.dirname(directory), os.tmpdir()); fs.rmSync(directory, { recursive: true, force: true }); });
  return { session, cli, page, calls, directory, advance: ms => { clock += ms; } };
}

test('观察返回有界证据：作品标识、覆盖范围与裁剪后的小画面', async t => {
  const f = fixture(t);
  const bundle = await f.session.observe({ seconds: 3, maxFrames: 3 });
  assert.equal(bundle.videoId, VIDEO_ID);
  assert.equal(bundle.title, '合成作品标题');
  assert.equal(bundle.frames.length, 3);
  assert.equal(bundle.coverage.complete, true);
  for (const frame of bundle.frames) {
    assert.equal(frame.videoId, VIDEO_ID);
    assert.equal(frame.mimeType, 'image/jpeg');
    assert.ok(frame.bytes > 0 && frame.bytes <= 262_144);
    assert.equal(frame.width, 640);
    assert.equal(frame.height, 480);
    assert.equal(typeof frame.time, 'number');
    assert.equal(Buffer.from(frame.data, 'base64').length, frame.bytes);
  }
  assert.deepEqual(f.calls.filter(call => call[0] === 'eval').length >= 3, true);
});

test('观察期间作品变化时本次证据作废，不返回混入两件作品的画面', async t => {
  const f = fixture(t, { afterEval: count => { if (count === 2) f.page.state.video.id = '7579432563794584999'; } });
  await assert.rejects(f.session.observe({ seconds: 3, maxFrames: 3 }), error => error.code === BACKEND_CODES.VIDEO_CHANGED && error.framesCaptured === 1);
});

test('观察期间暂停会截断覆盖范围，并明确标记不完整', async t => {
  const f = fixture(t, { afterScreenshot: (count, page) => { if (count === 1) page.state.video.paused = true; } });
  const bundle = await f.session.observe({ seconds: 3, maxFrames: 3 });
  assert.equal(bundle.coverage.complete, false);
  assert.equal(bundle.frames.length, 1);
  assert.ok(bundle.notes.some(note => /暂停/.test(note)));
});

test('截图不可解码时丢帧，不用整屏画面兜底', async t => {
  const f = fixture(t, { screenshot: () => Buffer.from('not-a-jpeg') });
  const bundle = await f.session.observe({ seconds: 0.5, maxFrames: 1 });
  assert.equal(bundle.frames.length, 0);
  assert.ok(bundle.notes.some(note => /整屏画面替代/.test(note)));
  assert.equal(bundle.coverage.complete, false);
});

test('需要人工登录或验证时拒绝观察', async t => {
  const login = fixture(t, { state: pageState({ loginRequired: true }) });
  await assert.rejects(login.session.observe({ seconds: 1 }), error => error.code === BACKEND_CODES.NEEDS_USER);
  const captcha = fixture(t, { state: pageState({ verificationRequired: true }) });
  await assert.rejects(captcha.session.status(), error => error.code === BACKEND_CODES.NEEDS_USER);
});

test('私信可见、直播预览与标识冲突都不采集', async t => {
  const privateArea = fixture(t, { state: pageState({ privateChatVisible: true }) });
  await assert.rejects(privateArea.session.observe({ seconds: 1 }), error => error.code === BACKEND_CODES.PRIVATE_AREA);
  const live = fixture(t, { state: pageState({ video: null, livePreview: { recognized: true } }) });
  await assert.rejects(live.session.observe({ seconds: 1 }), error => error.code === BACKEND_CODES.LIVE_PREVIEW);
  const conflict = fixture(t, { state: pageState({ videoSelection: { candidateCount: 2, ambiguous: true, identityConflict: true } }) });
  await assert.rejects(conflict.session.observe({ seconds: 1 }), error => error.code === BACKEND_CODES.IDENTITY_CONFLICT);
});

test('暂停状态下不自动播放，也不假装观察到内容', async t => {
  const f = fixture(t, { state: pageState({ video: { ...pageState().video, paused: true } }) });
  await assert.rejects(f.session.observe({ seconds: 1 }), error => error.code === BACKEND_CODES.VIDEO_PAUSED);
  assert.equal(f.calls.some(call => call[0] === 'click'), false);
});

test('预期作品不一致时不做任何换片动作', async t => {
  const f = fixture(t);
  await assert.rejects(f.session.next({ expectedVideoId: '7579432563794584000' }), error => error.code === BACKEND_CODES.IDENTITY_MISMATCH);
  assert.equal(f.calls.some(call => call[0] === 'click'), false);
  assert.equal(f.calls.some(call => call[0] === 'mouseWheel'), false);
});

test('换片成功需要作品标识真实变化并就绪', async t => {
  const f = fixture(t, { clickImpl: (selector, page) => { assert.equal(selector, '[data-e2e="video-switch-next-arrow"]'); page.state.video = { ...page.state.video, id: '7579432563794584934', time: 0 }; } });
  const result = await f.session.next({ expectedVideoId: VIDEO_ID });
  assert.equal(result.changed, true);
  assert.equal(result.before.videoId, VIDEO_ID);
  assert.equal(result.state.video.id, '7579432563794584934');
  assert.equal(f.calls.filter(call => call[0] === 'click').length, 1);
});

test('换片未确认时只报错，不重复点击', async t => {
  const f = fixture(t);
  await assert.rejects(f.session.next({ expectedVideoId: VIDEO_ID }), error => error.code === BACKEND_CODES.SWITCH_NOT_CONFIRMED && error.beforeVideoId === VIDEO_ID);
  assert.equal(f.calls.filter(call => call[0] === 'click').length, 1, '不重复点击');
  assert.ok(f.calls.filter(call => call[0] === 'mouseWheel').length <= 1, '最多补一次滚轮');
});

test('换片命令超时视为结果未知，绝不重试', async t => {
  const f = fixture(t, { clickImpl: () => { throw Object.assign(new Error('timeout'), { code: BACKEND_CODES.TIMEOUT }); } });
  await assert.rejects(f.session.next({ expectedVideoId: VIDEO_ID }), error => error.code === BACKEND_CODES.SWITCH_UNKNOWN);
  assert.equal(f.calls.filter(call => call[0] === 'click').length, 1);
});

test('新作品标识已变但未就绪时返回明确错误码', async t => {
  const f = fixture(t, { clickImpl: (selector, page) => { page.state.video = { ...page.state.video, id: '7579432563794584934', readyState: 1, paused: true }; } });
  await assert.rejects(f.session.next({ expectedVideoId: VIDEO_ID }), error => error.code === BACKEND_CODES.SWITCH_NOT_READY && error.afterVideoId === '7579432563794584934');
});

test('箭头不可点时退化为播放器区域滚轮，仍然只在一个写操作内', async t => {
  const f = fixture(t, { clickImpl: () => { throw Object.assign(new Error('not clickable'), { code: BACKEND_CODES.FAILED }); } });
  await assert.rejects(f.session.next({ expectedVideoId: VIDEO_ID }), error => error.code === BACKEND_CODES.SWITCH_NOT_CONFIRMED);
  assert.deepEqual(f.calls.filter(call => ['mouseMove', 'mouseWheel'].includes(call[0])), [['mouseMove', 360, 260], ['mouseWheel', 700]], '点击失败后只补一次滚轮');
});

test('同一会话并发写操作被拒绝', async t => {
  const f = fixture(t);
  const first = f.session.observe({ seconds: 0.5, maxFrames: 1 });
  await assert.rejects(f.session.next({ expectedVideoId: VIDEO_ID }), error => error.code === BACKEND_CODES.BUSY);
  await first;
});

test('搜索结果为空时明确不把空列表当成没有作品', async t => {
  const f = fixture(t);
  const result = await f.session.search({ query: '合成科普' });
  assert.equal(result.results.length, 0);
  assert.match(result.note, /不把空列表/);
  assert.deepEqual(f.calls.find(call => call[0] === 'open'), ['open', `https://www.douyin.com/search/${encodeURIComponent('合成科普')}`]);
});

test('参数边界：观察时长、帧数、搜索词与换片方向', async t => {
  const f = fixture(t);
  await assert.rejects(f.session.observe({ seconds: 0.4 }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  await assert.rejects(f.session.observe({ seconds: 3, maxFrames: 7 }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  await assert.rejects(f.session.search({ query: '  ' }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  await assert.rejects(f.session.next({ direction: 2 }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  await assert.rejects(f.session.next({ expectedVideoId: 123 }), error => error.code === BACKEND_CODES.INVALID_INPUT);
});

test('导航限制在抖音 https 域内', async t => {
  const f = fixture(t);
  for (const url of ['https://example.com/', 'http://www.douyin.com/', 'https://douyin.com.evil.example/']) await assert.rejects(f.session.open({ url }), error => error.code === BACKEND_CODES.INVALID_INPUT);
  const result = await f.session.open({ url: 'https://www.douyin.com/' });
  assert.equal(result.state.documentReadyState, 'complete');
  assert.deepEqual(f.calls.find(call => call[0] === 'open'), ['open', 'https://www.douyin.com/']);
});

test('短视频循环时按时间跨度计算覆盖，并标记 looped', async t => {
  const f = fixture(t, { afterScreenshot: (count, page) => { page.state.video.time = count === 1 ? 6.5 : 1.2; } });
  const bundle = await f.session.observe({ seconds: 3, maxFrames: 3 });
  assert.equal(bundle.coverage.looped, true);
  assert.ok(bundle.coverage.coveredSeconds > 0);
  assert.equal(bundle.coverage.complete, true);
});

test('搜索结果晚于 complete 渲染时才返回，空列表不冒充无结果', async t => {
  const f = fixture(t, { afterEval: (count, page) => { if (count >= 3) page.state.searchResults = [{ index: 0, id: '7579432563794584001', url: 'https://www.douyin.com/video/7579432563794584001', title: '合成结果', author: null }]; } });
  const result = await f.session.search({ query: '科普' });
  assert.equal(result.results.length, 1);
  assert.equal(result.note, null);
});
