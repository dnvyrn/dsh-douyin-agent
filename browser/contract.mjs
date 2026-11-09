// 后端契约：两个浏览器执行层共用同一套错误码与观察语义，避免上层依赖具体品牌。
export const BACKEND_CODES = Object.freeze({
  MISSING: 'AGENT_BROWSER_MISSING',
  TIMEOUT: 'AGENT_BROWSER_TIMEOUT',
  FAILED: 'AGENT_BROWSER_FAILED',
  BAD_JSON: 'AGENT_BROWSER_BAD_JSON',
  OUTPUT_LIMIT: 'AGENT_BROWSER_OUTPUT_LIMIT',
  BUSY: 'BROWSER_BUSY',
  NOT_IMPLEMENTED: 'BACKEND_NOT_IMPLEMENTED',
  NOT_DOUYIN: 'NOT_DOUYIN_PAGE',
  NEEDS_USER: 'NEEDS_USER_ACTION',
  PRIVATE_AREA: 'PRIVATE_AREA_VISIBLE',
  LIVE_PREVIEW: 'LIVE_PREVIEW_ACTIVE',
  IDENTITY_CONFLICT: 'VIDEO_IDENTITY_CONFLICT',
  NO_VIDEO: 'VIDEO_NOT_FOUND',
  VIDEO_CHANGED: 'VIDEO_CHANGED_DURING_OBSERVATION',
  VIDEO_PAUSED: 'VIDEO_PAUSED',
  IDENTITY_MISMATCH: 'VIDEO_IDENTITY_MISMATCH',
  SWITCH_NOT_CONFIRMED: 'SWITCH_NOT_CONFIRMED',
  SWITCH_NOT_READY: 'SWITCH_NOT_READY',
  SWITCH_UNKNOWN: 'SWITCH_RESULT_UNKNOWN',
  INVALID_INPUT: 'INVALID_ARGUMENT',
  FRAME_UNUSABLE: 'FRAME_UNUSABLE',
});

export class BackendError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    if (details && typeof details === 'object') for (const [key, value] of Object.entries(details)) if (key !== 'code' && key !== 'message') this[key] = value;
  }
}

export function fail(code, message, details) {
  throw new BackendError(code, message, details);
}

export const isBackendError = value => value instanceof BackendError && typeof value.code === 'string';

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function boundedText(value, max = 1000) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function assertVideoId(value, label = '作品ID') {
  if (typeof value !== 'string' || !/^\d{1,64}$/.test(value)) fail(BACKEND_CODES.INVALID_INPUT, `${label}须为纯数字字符串。`);
  return value;
}

export function assertQuery(value) {
  if (typeof value !== 'string') fail(BACKEND_CODES.INVALID_INPUT, '搜索词须为字符串。');
  const query = value.trim();
  if (!query || query.length > 300 || CONTROL.test(query)) fail(BACKEND_CODES.INVALID_INPUT, '搜索词须为 1–300 个字符且不含控制字符。');
  return query;
}

const finite = value => typeof value === 'number' && Number.isFinite(value);

// 只保留已知字段并做边界收敛；未知字段不向模型透传，避免页面文本夹带指令。
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(BACKEND_CODES.BAD_JSON, '页面状态不是对象。');
  const video = raw.video && typeof raw.video === 'object' && !Array.isArray(raw.video) ? raw.video : null;
  // 直播预览/浮层播放时，ID 可能只来自地址栏，且没有真实时长；此时不能把画面记到该作品名下。
  // 直播/浮层播放通常没有时长；若 ID 又不来自播放器本身，就无法证明画面属于该作品。
  const unverifiedPlayback = Boolean(video?.id && !(typeof video.duration === 'number' && video.duration > 0) && ['location', 'link', null].includes(video.idSource ?? null));
  const viewport = video?.viewport && typeof video.viewport === 'object' ? video.viewport : null;
  const boundedViewport = viewport && ['x', 'y', 'width', 'height'].every(key => finite(viewport[key]) && viewport[key] >= 0)
    ? { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height } : null;
  const selection = raw.videoSelection && typeof raw.videoSelection === 'object' ? raw.videoSelection : null;
  return {
    url: typeof raw.url === 'string' ? raw.url : null,
    title: boundedText(raw.title, 300),
    pageKind: typeof raw.pageKind === 'string' ? raw.pageKind : 'unknown',
    unsupportedPage: raw.unsupportedPage === true,
    loginRequired: raw.loginRequired === true,
    verificationRequired: raw.verificationRequired === true,
    privateChatVisible: raw.privateChatVisible === true,
    documentReadyState: typeof raw.documentReadyState === 'string' ? raw.documentReadyState : null,
    pageViewport: raw.pageViewport && finite(raw.pageViewport.width) && finite(raw.pageViewport.height) && raw.pageViewport.width > 0 && raw.pageViewport.height > 0
      ? { width: raw.pageViewport.width, height: raw.pageViewport.height } : null,
    livePreview: raw.livePreview?.recognized === true ? { recognized: true } : null,
    videoSelection: selection || unverifiedPlayback ? {
      candidateCount: Number.isSafeInteger(selection?.candidateCount) && selection.candidateCount >= 0 ? selection.candidateCount : null,
      ambiguous: selection?.ambiguous === true,
      identityConflict: selection?.identityConflict === true || unverifiedPlayback,
    } : null,
    video: video ? {
      id: typeof video.id === 'string' && /^\d{1,64}$/.test(video.id) ? video.id : null,
      idSource: ['player', 'container', 'link', 'location'].includes(video.idSource) ? video.idSource : null,
      url: typeof video.url === 'string' ? video.url : null,
      title: boundedText(video.title, 1000),
      author: boundedText(video.author, 256),
      time: finite(video.time) && video.time >= 0 ? video.time : null,
      duration: finite(video.duration) && video.duration > 0 ? video.duration : null,
      paused: video.paused === true,
      muted: video.muted === true,
      readyState: Number.isSafeInteger(video.readyState) && video.readyState >= 0 && video.readyState <= 4 ? video.readyState : null,
      ended: video.ended === true,
      loop: video.loop === true,
      width: Number.isSafeInteger(video.width) && video.width > 0 ? video.width : null,
      height: Number.isSafeInteger(video.height) && video.height > 0 ? video.height : null,
      viewport: boundedViewport,
    } : null,
    searchResults: Array.isArray(raw.searchResults) ? raw.searchResults.filter(item => item && typeof item === 'object' && typeof item.title === 'string').slice(0, 20).map((item, index) => ({
      index, id: typeof item.id === 'string' && /^\d{1,64}$/.test(item.id) ? item.id : null,
      url: typeof item.url === 'string' ? item.url : null, title: boundedText(item.title, 1000), author: boundedText(item.author, 256),
    })) : [],
    visibleText: boundedText(raw.visibleText, 800),
  };
}

// 只读状态：搜索页、推荐页也可能没有活动播放器，但登录/验证/私信仍要拒绝。
export function assertReadable(state) {
  if (state.unsupportedPage) fail(BACKEND_CODES.NOT_DOUYIN, '当前标签页不在抖音，未读取页面内容。');
  if (state.loginRequired) fail(BACKEND_CODES.NEEDS_USER, '页面要求登录，请本人手动登录后再操作。');
  if (state.verificationRequired) fail(BACKEND_CODES.NEEDS_USER, '页面要求人机验证，请本人处理后再操作。');
  if (state.privateChatVisible) fail(BACKEND_CODES.PRIVATE_AREA, '当前可见私信区域，未读取内容。');
  return state;
}

// 页面不可继续观察的具体原因；顺序即优先级，后续错误码不再叠加。
export function assertObservable(state) {
  assertReadable(state);
  if (state.livePreview) fail(BACKEND_CODES.LIVE_PREVIEW, '当前是直播预览，未采集画面。');
  if (state.videoSelection?.identityConflict) fail(BACKEND_CODES.IDENTITY_CONFLICT, '播放器与作品标识冲突，未继续操作。');
  if (!state.video?.id) fail(BACKEND_CODES.NO_VIDEO, '当前页面没有可识别的视频作品。');
  return state;
}

export function assertReadyToPlay(state) {
  if (!state.video) fail(BACKEND_CODES.NO_VIDEO, '当前页面没有可识别的视频作品。');
  if (state.video.paused && state.video.ended !== true) fail(BACKEND_CODES.VIDEO_PAUSED, '视频处于暂停状态；本工具不自动播放，请先恢复播放。');
  if (state.video.readyState !== null && state.video.readyState < 2) fail(BACKEND_CODES.NO_VIDEO, '视频尚未就绪，请稍后再观察。');
  return state;
}
