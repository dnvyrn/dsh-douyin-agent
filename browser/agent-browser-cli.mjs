import { spawn } from 'node:child_process';
import { BACKEND_CODES, fail } from './contract.mjs';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 8 * 1024 * 1024;
const SESSION_NAME = /^[\p{L}\p{N}_-]{1,64}$/u;

function boundedMs(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > MAX_TIMEOUT_MS) fail(BACKEND_CODES.INVALID_INPUT, '超时参数无效。');
  return Math.round(value);
}

// 只传必要环境，避免把宿主凭据、代理或调试开关带进浏览器进程。
function childEnvironment(source, extras) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) if (typeof source?.[key] === 'string') env[key] = source[key];
  for (const values of [source, extras]) for (const [key, value] of Object.entries(values || {})) if (/^AGENT_BROWSER_[A-Z0-9_]+$/.test(key) && typeof value === 'string') env[key] = value;
  return env;
}

// --json 输出可能是结果本身，也可能是 {success,data:{result}} 包装；两种都收敛成一个值。
export function unwrapJson(payload, label = 'agent-browser') {
  let value = payload;
  for (let depth = 0; depth < 3; depth++) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if (value.success === false || value.error) {
      const detail = typeof value.error === 'string' ? value.error : value.error?.message || value.message || '命令报告失败';
      fail(BACKEND_CODES.FAILED, `${label} 执行失败：${String(detail).slice(0, 500)}`);
    }
    if (value.data !== undefined) { value = value.data; continue; }
    if (value.result !== undefined) return value.result;
    return value;
  }
  return value;
}

export class AgentBrowserCli {
  #binary; #binaryArgs; #session; #profileDir; #namespace; #headed; #allowedDomains; #env; #spawnImpl; #outputLimit; #timeoutMs;

  constructor({ binary = 'agent-browser', binaryArgs = [], session, profileDir, namespace = 'dsh-douyin', headed = true,
    allowedDomains = ['douyin.com'], env = process.env, spawnImpl = spawn, outputLimit = DEFAULT_OUTPUT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof binary !== 'string' || !binary.trim()) fail(BACKEND_CODES.INVALID_INPUT, '浏览器可执行文件名无效。');
    if (!Array.isArray(binaryArgs) || binaryArgs.some(value => typeof value !== 'string')) fail(BACKEND_CODES.INVALID_INPUT, '浏览器前置参数无效。');
    if (!SESSION_NAME.test(String(session ?? ''))) fail(BACKEND_CODES.INVALID_INPUT, '会话名只能包含字母、数字、下划线和连字符。');
    if (typeof profileDir !== 'string' || !profileDir.trim()) fail(BACKEND_CODES.INVALID_INPUT, '必须指定专用 profile 目录。');
    if (!Array.isArray(allowedDomains) || !allowedDomains.length) fail(BACKEND_CODES.INVALID_INPUT, '必须指定允许访问的域名。');
    this.#binary = binary; this.#binaryArgs = [...binaryArgs]; this.#session = session; this.#profileDir = profileDir; this.#namespace = namespace;
    this.#headed = headed === true; this.#allowedDomains = [...allowedDomains]; this.#env = env;
    this.#spawnImpl = spawnImpl; this.#outputLimit = outputLimit; this.#timeoutMs = timeoutMs;
  }

  get session() { return this.#session; }
  get profileDir() { return this.#profileDir; }

  // 全局参数集中一处生成，测试只断言这里，不散落到各调用点。
  globalArgs() {
    const args = ['--json', '--session', this.#session, '--profile', this.#profileDir, '--namespace', this.#namespace,
      '--allowed-domains', this.#allowedDomains.join(',')];
    if (this.#headed) args.push('--headed');
    return args;
  }

  run(args, { stdin, signal, timeoutMs, env } = {}) {
    if (!Array.isArray(args) || !args.length || args.some(value => typeof value !== 'string')) return Promise.reject(new TypeError('浏览器命令参数无效。'));
    const limit = boundedMs(timeoutMs, this.#timeoutMs);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      let child;
      try {
        child = this.#spawnImpl(this.#binary, [...this.#binaryArgs, ...this.globalArgs(), ...args], {
          env: childEnvironment(this.#env, env), stdio: ['pipe', 'pipe', 'pipe'], shell: false,
        });
      } catch (error) { return reject(error?.code === 'ENOENT' ? missing(error) : error); }
      const stdout = [], stderr = [];
      let size = 0, settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true;
        clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort);
        error ? reject(error) : resolve(value);
      };
      const kill = () => { try { child.kill('SIGKILL'); } catch {} };
      const onAbort = () => { kill(); finish(signal.reason); };
      const timer = setTimeout(() => {
        kill();
        finish(Object.assign(new Error(`浏览器命令超过 ${limit}ms 未返回；结果未知，未自动重试。`), { code: BACKEND_CODES.TIMEOUT }));
      }, limit);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      const collect = (chunks, chunk) => {
        size += chunk.length;
        if (size > this.#outputLimit) { kill(); finish(Object.assign(new Error('浏览器输出超过上限。'), { code: BACKEND_CODES.OUTPUT_LIMIT })); return false; }
        chunks.push(chunk); return true;
      };
      child.stdout.on('data', chunk => collect(stdout, chunk));
      child.stderr.on('data', chunk => collect(stderr, chunk));
      child.on('error', error => finish(error?.code === 'ENOENT' ? missing(error) : error));
      child.on('close', code => {
        if (settled) return;
        const out = Buffer.concat(stdout).toString('utf8').trim(), err = Buffer.concat(stderr).toString('utf8').trim();
        if (code !== 0) return finish(Object.assign(new Error(`agent-browser 退出码 ${code}${err ? `：${err.slice(-2000)}` : ''}`), { code: BACKEND_CODES.FAILED, exitCode: code, stderr: err.slice(-2000) }));
        if (!out) return finish(Object.assign(new Error('agent-browser 没有返回 JSON。'), { code: BACKEND_CODES.BAD_JSON, stderr: err.slice(-2000) }));
        let parsed;
        try { parsed = JSON.parse(out); }
        catch { return finish(Object.assign(new Error('agent-browser 返回的不是合法 JSON。'), { code: BACKEND_CODES.BAD_JSON, stderr: err.slice(-2000) })); }
        try { finish(null, unwrapJson(parsed)); } catch (error) { finish(error); }
      });
      if (stdin !== undefined) child.stdin.end(typeof stdin === 'string' ? stdin : JSON.stringify(stdin));
      else child.stdin.end();
    });
  }

  async eval(source, options = {}) {
    if (typeof source !== 'string' || !source.trim()) fail(BACKEND_CODES.INVALID_INPUT, '页面脚本不能为空。');
    return this.run(['eval', source], options);
  }

  // 批量在单次 CLI 内完成，减少进程与连接往返。
  async batch(commands, { signal, timeoutMs } = {}) {
    if (!Array.isArray(commands) || !commands.length) fail(BACKEND_CODES.INVALID_INPUT, '批量命令不能为空。');
    const rows = await this.run(['batch', '--bail'], { stdin: JSON.stringify(commands), signal, timeoutMs });
    if (!Array.isArray(rows)) fail(BACKEND_CODES.BAD_JSON, '批量命令返回格式不是数组。');
    return rows.map(row => unwrapJson(row));
  }

  async open(url, options = {}) {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) fail(BACKEND_CODES.INVALID_INPUT, '只允许打开 https 地址。');
    return this.run(['open', url], options);
  }

  async getUrl(options = {}) { return this.run(['get', 'url'], options); }

  async click(selector, options = {}) {
    if (typeof selector !== 'string' || !selector.trim()) fail(BACKEND_CODES.INVALID_INPUT, '选择器不能为空。');
    return this.run(['click', selector], options);
  }

  async mouseMove(x, y, options = {}) { return this.run(['mouse', 'move', String(x), String(y)], options); }
  async mouseWheel(dy, options = {}) { return this.run(['mouse', 'wheel', String(dy)], options); }

  async screenshot(path, { quality = 60, signal, timeoutMs } = {}) {
    if (typeof path !== 'string' || !path.trim()) fail(BACKEND_CODES.INVALID_INPUT, '截图路径无效。');
    if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100) fail(BACKEND_CODES.INVALID_INPUT, '截图质量须为 1–100 的整数。');
    return this.run(['screenshot', path, '--screenshot-format', 'jpeg', '--screenshot-quality', String(quality)], { signal, timeoutMs });
  }

  async close(options = {}) { return this.run(['close'], options); }
}

function missing(error) {
  return Object.assign(new Error('未找到 agent-browser 可执行文件；本机未安装时请先由本人确认安装，不会自动下载浏览器。'), { code: BACKEND_CODES.MISSING, cause: error });
}

export function isTimeoutError(error) { return error?.code === BACKEND_CODES.TIMEOUT; }
