import { createRequire } from 'node:module';
import { BACKEND_CODES, fail } from './contract.mjs';

// 复用仓库内已附许可的 jpeg-js，只为把整屏截图裁到播放器区域，避免把私信等区域带进证据。
const require = createRequire(import.meta.url);
const jpeg = require('../storyboard/vendor/jpeg-js/index.js');

// 盒式平均降采样：比最近邻平滑，足够小图识别，且不引入额外依赖。
function boxDownscale(data, width, height, targetWidth, targetHeight) {
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const scaleX = width / targetWidth, scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const fromY = Math.floor(y * scaleY), toY = Math.min(height, Math.max(fromY + 1, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < targetWidth; x++) {
      const fromX = Math.floor(x * scaleX), toX = Math.min(width, Math.max(fromX + 1, Math.floor((x + 1) * scaleX)));
      let red = 0, green = 0, blue = 0, alpha = 0, count = 0;
      for (let sy = fromY; sy < toY; sy++) for (let sx = fromX; sx < toX; sx++) {
        const offset = (sy * width + sx) * 4;
        red += data[offset]; green += data[offset + 1]; blue += data[offset + 2]; alpha += data[offset + 3]; count++;
      }
      const target = (y * targetWidth + x) * 4;
      out[target] = red / count; out[target + 1] = green / count; out[target + 2] = blue / count; out[target + 3] = alpha / count;
    }
  }
  return out;
}

function integer(value) { return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null; }

// rect 使用 CSS 像素；截图可能带设备像素比，按比例换算后再裁。
export function cropJpeg(buffer, rect, { quality = 60, maxBytes = null, maxWidth = 720 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 128) fail(BACKEND_CODES.FRAME_UNUSABLE, '截图内容为空。');
  if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100) fail(BACKEND_CODES.INVALID_INPUT, '截图质量无效。');
  let image;
  try { image = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true }); }
  catch { fail(BACKEND_CODES.FRAME_UNUSABLE, '截图不是可解码的 JPEG。'); }
  const { width, height, data } = image;
  if (!width || !height) fail(BACKEND_CODES.FRAME_UNUSABLE, '截图尺寸无效。');
  const x = integer(rect?.x), y = integer(rect?.y), w = integer(rect?.width), h = integer(rect?.height);
  if (x === null || y === null || w === null || h === null || w < 8 || h < 8) fail(BACKEND_CODES.FRAME_UNUSABLE, '播放器区域无效。');
  const scaleX = width / (rect.viewportWidth ?? width), scaleY = height / (rect.viewportHeight ?? height);
  const rawLeft = Math.round(x * scaleX), rawTop = Math.round(y * scaleY);
  const rawWidth = Math.round(w * scaleX), rawHeight = Math.round(h * scaleY);
  const left = Math.max(0, rawLeft), top = Math.max(0, rawTop);
  const right = Math.min(width, rawLeft + rawWidth), bottom = Math.min(height, rawTop + rawHeight);
  const cropWidth = right - left, cropHeight = bottom - top;
  // 重叠不足一半通常说明视口尺寸与截图像素比不一致；宁可丢帧，也不返回错误区域的画面。
  if (cropWidth <= 0 || cropHeight <= 0 || (cropWidth * cropHeight) / Math.max(1, rawWidth * rawHeight) < 0.5) fail(BACKEND_CODES.FRAME_UNUSABLE, '播放器区域超出截图范围或比例不一致。');
  const out = Buffer.alloc(cropWidth * cropHeight * 4);
  for (let row = 0; row < cropHeight; row++) {
    const from = ((top + row) * width + left) * 4;
    data.copy ? data.copy(out, row * cropWidth * 4, from, from + cropWidth * 4) : out.set(data.subarray(from, from + cropWidth * 4), row * cropWidth * 4);
  }
  // Retina 截图像素是 CSS 像素的两倍；按最长边收敛，避免把 2MP 大图交给模型。
  let pixels = out, outWidth = cropWidth, outHeight = cropHeight;
  if (Number.isSafeInteger(maxWidth) && maxWidth > 0 && cropWidth > maxWidth) {
    outWidth = maxWidth;
    outHeight = Math.max(1, Math.round((cropHeight * maxWidth) / cropWidth));
    pixels = boxDownscale(out, cropWidth, cropHeight, outWidth, outHeight);
  }
  const encoded = Buffer.from(jpeg.encode({ data: pixels, width: outWidth, height: outHeight }, quality).data);
  if (maxBytes && encoded.length > maxBytes) fail(BACKEND_CODES.FRAME_UNUSABLE, `裁剪后的画面超过 ${maxBytes} 字节上限。`);
  return { data: encoded, width: outWidth, height: outHeight, mimeType: 'image/jpeg', bytes: encoded.length };
}
