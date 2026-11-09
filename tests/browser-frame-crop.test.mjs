import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cropJpeg } from '../browser/frame-crop.mjs';
import { BACKEND_CODES } from '../browser/contract.mjs';

const require = createRequire(import.meta.url);
const jpeg = require('../storyboard/vendor/jpeg-js/index.js');

function image(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    data[offset] = x % 256; data[offset + 1] = y % 256; data[offset + 2] = 128; data[offset + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 80).data);
}

test('裁剪到播放器区域并保留设备像素比换算', () => {
  const cropped = cropJpeg(image(1280, 720), { x: 100, y: 50, width: 400, height: 300, viewportWidth: 1280, viewportHeight: 720 });
  assert.equal(cropped.width, 400);
  assert.equal(cropped.height, 300);
  assert.equal(cropped.mimeType, 'image/jpeg');
  assert.equal(cropped.bytes, cropped.data.length);
  const decoded = jpeg.decode(cropped.data, { useTArray: true });
  assert.equal(decoded.width, 400);
  assert.equal(decoded.height, 300);
});

test('视网膜截图按 CSS 像素比例换算，不越界', () => {
  const cropped = cropJpeg(image(2560, 1440), { x: 100, y: 50, width: 400, height: 300, viewportWidth: 1280, viewportHeight: 720 }, { maxWidth: 0 });
  assert.equal(cropped.width, 800);
  assert.equal(cropped.height, 600);
});

test('超出画面、过小区域与不可解码内容都拒绝', () => {
  const source = image(640, 360);
  assert.throws(() => cropJpeg(source, { x: 600, y: 0, width: 200, height: 100, viewportWidth: 640, viewportHeight: 360 }), error => error.code === BACKEND_CODES.FRAME_UNUSABLE);
  assert.throws(() => cropJpeg(source, { x: 0, y: 0, width: 4, height: 4, viewportWidth: 640, viewportHeight: 360 }), error => error.code === BACKEND_CODES.FRAME_UNUSABLE);
  assert.throws(() => cropJpeg(Buffer.from('not jpeg at all'.repeat(20)), { x: 0, y: 0, width: 100, height: 100, viewportWidth: 640, viewportHeight: 360 }), error => error.code === BACKEND_CODES.FRAME_UNUSABLE);
  assert.throws(() => cropJpeg(Buffer.alloc(0), { x: 0, y: 0, width: 100, height: 100 }), error => error.code === BACKEND_CODES.FRAME_UNUSABLE);
});

test('超过单帧字节上限时丢弃，而不是把大图交给模型', () => {
  const source = image(2560, 1440);
  assert.throws(() => cropJpeg(source, { x: 0, y: 0, width: 1280, height: 720, viewportWidth: 2560, viewportHeight: 1440 }, { maxBytes: 1_000 }), error => error.code === BACKEND_CODES.FRAME_UNUSABLE);
});

test('默认把 Retina 大图收敛到 720 宽并保持比例', () => {
  const cropped = cropJpeg(image(2136, 2206), { x: 0, y: 0, width: 2136, height: 2206, viewportWidth: 2136, viewportHeight: 2206 });
  assert.equal(cropped.width, 720);
  assert.equal(cropped.height, 744);
  const full = cropJpeg(image(2136, 2206), { x: 0, y: 0, width: 2136, height: 2206, viewportWidth: 2136, viewportHeight: 2206 }, { maxWidth: 0 });
  assert.ok(cropped.bytes < full.bytes, `降采样后应更小：${cropped.bytes} vs ${full.bytes}`);
  const small = cropJpeg(image(640, 360), { x: 0, y: 0, width: 640, height: 360, viewportWidth: 640, viewportHeight: 360 });
  assert.equal(small.width, 640, '小图不应被放大');
});
