/**
 * 生成插件图标 PNG 文件
 * 使用 Canvas API（Node.js 内置，通过 Chromium 的 canvas）
 * 实际上我们生成基于 SVG 转 base64 的 ICO/PNG
 */

const fs = require('fs');
const path = require('path');

// 生成一个简单的 PNG 文件（使用纯 JS 实现 PNG 编码）
// PNG 格式：IHDR + IDAT + IEND

function createPNG(width, height, pixels) {
  // pixels: Uint8Array, RGBA 格式，行优先
  const zlib = require('zlib');

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[i] = c;
      }
      return t;
    })();
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function uint32BE(n) {
    return Buffer.from([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]);
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = uint32BE(data.length);
    const crcData = Buffer.concat([typeBytes, data]);
    const crcVal = uint32BE(crc32(crcData));
    return Buffer.concat([len, typeBytes, data, crcVal]);
  }

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.concat([
    uint32BE(width), uint32BE(height),
    Buffer.from([8, 2, 0, 0, 0]) // 8-bit depth, RGB (no alpha for simplicity... use 6 for RGBA)
  ]);
  // Use color type 6 = RGBA
  ihdr[8 + 4] = 6; // bit depth
  ihdr[8 + 5] = 2; // color type RGB... let's redo

  const ihdrData = Buffer.from([
    (width >>> 24) & 0xFF, (width >>> 16) & 0xFF, (width >>> 8) & 0xFF, width & 0xFF,
    (height >>> 24) & 0xFF, (height >>> 16) & 0xFF, (height >>> 8) & 0xFF, height & 0xFF,
    8, // bit depth
    6, // color type: RGBA
    0, // compression
    0, // filter
    0  // interlace
  ]);

  // Raw image data (with filter byte per row)
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = [0]; // filter type 0 = None
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      row.push(pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]);
    }
    rawRows.push(Buffer.from(row));
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * 在指定尺寸的画布上绘制图标像素
 */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = a;
  }

  function fillRect(x1, y1, x2, y2, r, g, b, a = 255) {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  // 绘制带圆角的背景（绿色 #10a37f）
  const bgR = 16, bgG = 163, bgB = 127;
  const radius = Math.round(size * 0.18);

  // 先全填充背景色
  fillRect(0, 0, size - 1, size - 1, bgR, bgG, bgB);

  // 处理圆角（简单处理：四角设为透明）
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCorner = (
        (x < radius && y < radius && Math.sqrt((x - radius) ** 2 + (y - radius) ** 2) > radius) ||
        (x >= size - radius && y < radius && Math.sqrt((x - (size - radius - 1)) ** 2 + (y - radius) ** 2) > radius) ||
        (x < radius && y >= size - radius && Math.sqrt((x - radius) ** 2 + (y - (size - radius - 1)) ** 2) > radius) ||
        (x >= size - radius && y >= size - radius && Math.sqrt((x - (size - radius - 1)) ** 2 + (y - (size - radius - 1)) ** 2) > radius)
      );
      if (inCorner) {
        setPixel(x, y, 0, 0, 0, 0);
      }
    }
  }

  // 绘制文档线条（白色，模拟 PDF 文档图标）
  const lineW = Math.max(1, Math.round(size * 0.06));
  const lx1 = Math.round(size * 0.22);
  const lx2 = Math.round(size * 0.78);
  const lineSpacing = Math.round(size * 0.14);
  const startY = Math.round(size * 0.28);

  // 四条白色横线
  for (let i = 0; i < 4; i++) {
    const ly = startY + i * lineSpacing;
    const rx2 = i >= 2 ? Math.round(size * 0.62) : lx2; // 后两条短一点
    fillRect(lx1, ly, rx2, ly + lineW - 1, 255, 255, 255, 230);
  }

  // 右下角小圆圈（橙色 #ff6b35）+ 下载箭头（白色）
  if (size >= 32) {
    const cx = Math.round(size * 0.72);
    const cy = Math.round(size * 0.72);
    const cr = Math.round(size * 0.20);
    const orR = 255, orG = 107, orB = 53;

    // 绘制圆形
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist <= cr) {
          setPixel(x, y, orR, orG, orB, 255);
        }
      }
    }

    // 绘制向下箭头（白色）
    const arrowX = cx;
    const arrowY1 = cy - Math.round(cr * 0.55);
    const arrowY2 = cy + Math.round(cr * 0.1);
    const arrowW = Math.max(1, Math.round(size * 0.04));

    // 竖线
    fillRect(arrowX - arrowW, arrowY1, arrowX + arrowW, arrowY2, 255, 255, 255, 240);

    // 箭头头部（V形）
    const headSize = Math.round(cr * 0.45);
    for (let i = 0; i <= headSize; i++) {
      const hy = arrowY2 + i;
      fillRect(arrowX - i - arrowW, hy, arrowX - i, hy, 255, 255, 255, 240);
      fillRect(arrowX + i, hy, arrowX + i + arrowW, hy, 255, 255, 255, 240);
    }
  }

  return pixels;
}

// 生成三种尺寸
const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

sizes.forEach(size => {
  const pixels = renderIcon(size);
  const png = createPNG(size, size, pixels);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`生成图标: icon${size}.png (${png.length} bytes)`);
});

console.log('图标生成完成！');
