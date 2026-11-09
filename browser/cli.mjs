#!/usr/bin/env node
// 只读观察用的命令行入口：需要已安装 agent-browser 并由本人手动完成登录。
// 输出 JSON 摘要；画面只在显式给出 --out 时落盘，默认不回传 base64。
import fs from 'node:fs';
import path from 'node:path';
import { createReadOnlyObserver } from './index.mjs';

const USAGE = `用法：
  node browser/cli.mjs open [--url https://www.douyin.com/]
  node browser/cli.mjs status
  node browser/cli.mjs observe --seconds 3 --frames 4 [--out 目录]
  node browser/cli.mjs next --expect <作品ID>
  node browser/cli.mjs search --query "关键词"
可选：--chrome <Chrome 可执行文件> 复用已安装的浏览器，--binary <agent-browser 路径>
说明：默认打开有头窗口；登录与人机验证由本人完成。本命令不点赞、不评论、不关注、不发布。`;

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const item = rest[index];
    if (!item.startsWith('--')) throw Object.assign(new Error(`未知参数：${item}`), { code: 'INVALID_ARGUMENT' });
    const key = item.slice(2), value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw Object.assign(new Error(`参数 ${item} 缺少取值。`), { code: 'INVALID_ARGUMENT' });
    options[key] = value; index++;
  }
  return { command, options };
}

function summarize(bundle) {
  return {
    ...bundle,
    frames: bundle.frames.map(({ data, ...frame }) => frame),
    frameBytes: bundle.frames.reduce((sum, frame) => sum + frame.bytes, 0),
  };
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  if (!command || command === '--help' || command === '-h') { process.stdout.write(`${USAGE}\n`); return; }
  if (!['open', 'status', 'observe', 'next', 'search'].includes(command)) throw Object.assign(new Error(`未知命令：${command}`), { code: 'INVALID_ARGUMENT' });
  const session = createReadOnlyObserver({ executablePath: options.chrome, binary: options.binary });
  try {
    if (command === 'open') process.stdout.write(`${JSON.stringify(await session.open({ url: options.url }), null, 2)}\n`);
    if (command === 'status') process.stdout.write(`${JSON.stringify(await session.status(), null, 2)}\n`);
    if (command === 'search') process.stdout.write(`${JSON.stringify(await session.search({ query: options.query }), null, 2)}\n`);
    if (command === 'next') process.stdout.write(`${JSON.stringify(await session.next({ expectedVideoId: options.expect }), null, 2)}\n`);
    if (command === 'observe') {
      const bundle = await session.observe({ seconds: options.seconds === undefined ? 3 : Number(options.seconds), maxFrames: options.frames === undefined ? 4 : Number(options.frames) });
      if (options.out) {
        const directory = path.resolve(options.out);
        fs.mkdirSync(directory, { recursive: true });
        for (const frame of bundle.frames) fs.writeFileSync(path.join(directory, `frame-${String(frame.index + 1).padStart(2, '0')}.jpg`), Buffer.from(frame.data, 'base64'));
      }
      process.stdout.write(`${JSON.stringify({ ...summarize(bundle), savedTo: options.out ? path.resolve(options.out) : null }, null, 2)}\n`);
    }
  } finally { await session.close(); }
}

main().catch(error => {
  const payload = { ok: false, code: error?.code ?? 'UNEXPECTED', message: error?.message ?? String(error) };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
