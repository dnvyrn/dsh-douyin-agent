import { readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readPageState } from '../page-state.mjs';
import { BACKEND_CODES, fail, normalizeState, assertObservable, assertReadyToPlay, assertVideoId, assertQuery, boundedText } from './contract.mjs';
import { cropJpeg } from './frame-crop.mjs';

const NEXT_SELECTOR = '[data-e2e="video-switch-next-arrow"]';
const PREVIOUS_SELECTOR = '[data-e2e="video-switch-prev-arrow"]';
const MAX_FRAME_BYTES = 262_144;
const MAX_TOTAL_FRAME_BYTES = 1_200_000;

// 页面脚本与 Playwright 后端共用同一份 readPageState，避免两套选择器语义漂移。
export const stateScript = `(${readPageState.toString()})()`;
export const prevSelector = PREVIOUS_SELECTOR;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class DouyinSession {
  #cli; #workDir; #now; #sleep; #switchTimeoutMs; #pollMs; #frameQuality; #frameBytes; #busy = false; #closed = false;

  constructor({ cli, workDir, now = Date.now, sleep = delay, switchTimeoutMs = 8_000, pollMs = 250, frameQuality = 60, frameBytes = MAX_FRAME_BYTES } = {}) {
    if (!cli || typeof cli.eval !== 'function' || typeof cli.screenshot !== 'function') fail(BACKEND_CODES.INVALID_INPUT, '缺少浏览器执行层。');
    if (typeof workDir !== 'string' || !workDir) fail(BACKEND_CODES.INVALID_INPUT, '缺少截图临时目录。');
    if (typeof switchTimeoutMs !== 'number' || switchTimeoutMs < 500 || switchTimeoutMs > 30_000) fail(BACKEND_CODES.INVALID_INPUT, '换片等待时长无效。');
    if (typeof pollMs !== 'number' || pollMs < 50 || pollMs > 2_000) fail(BACKEND_CODES.INVALID_INPUT, '轮询间隔无效。');
    this.#cli = cli; this.#workDir = workDir; this.#now = now; this.#sleep = sleep;
    this.#switchTimeoutMs = switchTimeoutMs; this.#pollMs = pollMs; this.#frameQuality = frameQuality; this.#frameBytes = frameBytes;
  }

  async #exclusive(operation) {
    if (this.#closed) fail(BACKEND_CODES.FAILED, '浏览器会话已关闭。');
    if (this.#busy) fail(BACKEND_CODES.BUSY, '同一浏览器会话已有操作进行中，未并发执行。');
    this.#busy = true;
    try { return await operation(); } finally { this.#busy = false; }
  }

  async status({ signal } = {}) {
    return assertObservable(normalizeState(await this.#cli.eval(stateScript, { signal })));
  }

  async observe({ seconds = 3, maxFrames = 4, signal } = {}) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0.5 || seconds > 10) fail(BACKEND_CODES.INVALID_INPUT, '观察时长须在 0.5–10 秒之间。');
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 6) fail(BACKEND_CODES.INVALID_INPUT, '画面帧数须为 1–6 的整数。');
    return this.#exclusive(async () => {
      const first = assertReadyToPlay(await this.status({ signal }));
      const videoId = first.video.id, startedAt = this.#now(), frames = [], notes = [];
      const interval = clamp(Math.round((seconds * 1000) / maxFrames), 200, 2_000);
      let lastState = first, totalBytes = 0, truncated = false, paused = false;
      const deadline = startedAt + seconds * 1000;
      for (let index = 0; index < maxFrames; index++) {
        const at = this.#now();
        if (at >= deadline && frames.length) break;
        const state = index === 0 ? first : assertObservable(normalizeState(await this.#cli.eval(stateScript, { signal })));
        if (state.video.id !== videoId) fail(BACKEND_CODES.VIDEO_CHANGED, '观察期间作品已变化，本次证据作废，请重新观察。', { framesCaptured: frames.length });
        lastState = state;
        // 先判定暂停再截图：暂停后的画面不作为“新观察到的内容”计入证据。
        if (state.video.paused && state.video.ended !== true) { paused = true; notes.push('观察期间视频暂停，覆盖范围不完整。'); truncated = true; break; }
        const frame = await this.#capture(state, { signal, label: `观察第 ${index + 1} 帧` });
        if (frame) {
          totalBytes += frame.bytes;
          if (totalBytes > MAX_TOTAL_FRAME_BYTES) { notes.push('画面总字节超过上限，其余帧未保留。'); truncated = true; break; }
          frames.push({ ...frame, index, videoId: state.video.id, time: state.video.time, capturedAt: new Date(at).toISOString() });
        } else notes.push(`第 ${index + 1} 帧不可用，已丢弃，未用整屏画面替代。`);
        const remaining = deadline - this.#now();
        if (remaining <= 0) break;
        await this.#sleep(Math.min(interval, remaining), undefined, { signal });
      }
      const after = await this.#cli.eval(stateScript, { signal }).then(normalizeState).catch(error => { if (signal?.aborted) throw error; return lastState; });
      if (after.video?.id && after.video.id !== videoId) fail(BACKEND_CODES.VIDEO_CHANGED, '观察结束时作品已变化，本次证据作废，请重新观察。', { framesCaptured: frames.length });
      const times = frames.map(frame => frame.time).filter(value => typeof value === 'number');
      const coveredSeconds = frames.length > 1 && times.length > 1 ? Math.max(0, times[times.length - 1] - times[0]) : 0;
      return {
        observationId: randomUUID(),
        videoId,
        url: after.url ?? first.url,
        title: boundedText(after.video?.title ?? first.video.title, 1000),
        author: boundedText(after.video?.author ?? first.video.author, 256),
        state: after,
        frames,
        coverage: {
          requestedSeconds: seconds, sampledFrames: frames.length, videoTimeFrom: times[0] ?? null, videoTimeTo: times[times.length - 1] ?? null,
          coveredSeconds, complete: !truncated && !paused && frames.length > 0,
        },
        notes,
      };
    });
  }

  async #capture(state, { signal, label }) {
    const viewport = state.video?.viewport, size = state.pageViewport;
    if (!viewport || viewport.width < 8 || viewport.height < 8) fail(BACKEND_CODES.FRAME_UNUSABLE, '播放器区域不可见，未采集画面。');
    try { mkdirSync(this.#workDir, { recursive: true }); } catch { fail(BACKEND_CODES.FRAME_UNUSABLE, `无法创建截图临时目录 ${this.#workDir}。`); }
    const file = path.join(this.#workDir, `frame-${randomUUID()}.jpg`);
    try {
      await this.#cli.screenshot(file, { quality: this.#frameQuality, signal });
      let raw;
      try { raw = readFileSync(file); } catch { fail(BACKEND_CODES.FRAME_UNUSABLE, `${label}未生成截图文件。`); }
      const cropped = cropJpeg(raw, { ...viewport, viewportWidth: size?.width ?? viewport.width, viewportHeight: size?.height ?? viewport.height }, { quality: this.#frameQuality, maxBytes: this.#frameBytes });
      return { mimeType: cropped.mimeType, width: cropped.width, height: cropped.height, bytes: cropped.bytes, data: cropped.data.toString('base64') };
    } catch (error) {
      if (error?.code === BACKEND_CODES.TIMEOUT || signal?.aborted) throw error;
      return null;
    } finally { try { unlinkSync(file); } catch {} }
  }

  async next({ expectedVideoId, signal, direction = 1 } = {}) {
    if (direction !== 1 && direction !== -1) fail(BACKEND_CODES.INVALID_INPUT, '换片方向无效。');
    if (expectedVideoId !== undefined) assertVideoId(expectedVideoId, '预期作品ID');
    return this.#exclusive(async () => {
      const before = assertObservable(normalizeState(await this.#cli.eval(stateScript, { signal })));
      const beforeId = before.video.id;
      if (expectedVideoId !== undefined && expectedVideoId !== beforeId) fail(BACKEND_CODES.IDENTITY_MISMATCH, '当前作品与预期不一致，未执行换片。', { expectedVideoId, actualVideoId: beforeId });
      const selector = direction > 0 ? NEXT_SELECTOR : PREVIOUS_SELECTOR;
      const beforeAt = this.#now(), deadline = beforeAt + this.#switchTimeoutMs;
      try {
        await this.#cli.click(selector, { signal });
      } catch (error) {
        if (error?.code === BACKEND_CODES.TIMEOUT) fail(BACKEND_CODES.SWITCH_UNKNOWN, '换片命令超时，结果未知；未自动重试，请先核对当前作品。', { beforeVideoId: beforeId });
        if (signal?.aborted) throw error;
        // 箭头不可点时按既有交互用滚轮，仍在同一把锁内，避免两个写操作同时发生。
        const center = before.video.viewport;
        if (!center) fail(BACKEND_CODES.SWITCH_NOT_CONFIRMED, '换片控件不可用且播放器区域未知，未执行换片。', { beforeVideoId: beforeId });
        await this.#cli.mouseMove(Math.round(center.x + center.width / 2), Math.round(center.y + center.height / 2), { signal });
        await this.#cli.mouseWheel(direction * 700, { signal });
      }
      let last = before;
      for (;;) {
        if (this.#now() >= deadline) {
          if (last.video?.id && last.video.id !== beforeId) fail(BACKEND_CODES.SWITCH_NOT_READY, '已换片但新作品未就绪，未继续播放。', { beforeVideoId: beforeId, afterVideoId: last.video.id, readyState: last.video.readyState });
          fail(BACKEND_CODES.SWITCH_NOT_CONFIRMED, '换片后作品未发生变化，未重复执行。', { beforeVideoId: beforeId, waitedMs: this.#switchTimeoutMs });
        }
        await this.#sleep(this.#pollMs, undefined, { signal });
        try { last = normalizeState(await this.#cli.eval(stateScript, { signal })); }
        catch (error) { if (signal?.aborted || error?.code === BACKEND_CODES.TIMEOUT) throw error; continue; }
        if (last.video?.id && last.video.id !== beforeId) {
          if (last.video.readyState !== null && last.video.readyState < 2) continue;
          return { changed: true, before: { videoId: beforeId, title: before.video.title }, state: last, elapsedMs: this.#now() - beforeAt };
        }
      }
    });
  }

  async search({ query, signal, timeoutMs = 15_000 } = {}) {
    const keyword = assertQuery(query);
    return this.#exclusive(async () => {
      const url = `https://www.douyin.com/search/${encodeURIComponent(keyword)}`;
      const startedAt = this.#now(), deadline = startedAt + timeoutMs;
      await this.#cli.open(url, { signal });
      let last = null;
      for (;;) {
        last = normalizeState(await this.#cli.eval(stateScript, { signal }));
        if (last.unsupportedPage) fail(BACKEND_CODES.NOT_DOUYIN, '搜索后标签页不在抖音。');
        if (last.pageKind === 'search' && (last.searchResults.length > 0 || last.documentReadyState === 'complete')) break;
        if (this.#now() >= deadline) break;
        await this.#sleep(this.#pollMs, undefined, { signal });
      }
      return {
        query: keyword, url: last?.url ?? url, elapsedMs: this.#now() - startedAt,
        results: last?.searchResults ?? [],
        note: (last?.searchResults?.length ?? 0) ? null : '未读到可核实的结果卡片；不把空列表当成“没有相关作品”。',
      };
    });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (typeof this.#cli.close === 'function') await this.#cli.close().catch(() => {});
  }
}

export function createSession({ transport, workDir, ...options }) {
  return new DouyinSession({ cli: transport, workDir, ...options });
}
