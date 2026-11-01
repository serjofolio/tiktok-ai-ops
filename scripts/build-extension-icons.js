// 生成浏览器插件图标（暖色渐变圆角方块 + 「T」，与站点 Logo 一致）：node scripts/build-extension-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 渐变：#f3e9d2 → #ffb35c → #ff6a4d（沿左上到右下）
const STOPS = [[0, [243, 233, 210]], [0.45, [255, 179, 92]], [1, [255, 106, 77]]];
function grad(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i], [t0, c0] = STOPS[i - 1];
    if (t <= t1) return c0.map((v, k) => v + ((c1[k] - v) * (t - t0)) / (t1 - t0));
  }
  return STOPS.at(-1)[1];
}

function icon(size) {
  const S = 4; // 4×4 超采样抗锯齿
  const buf = Buffer.alloc(size * size * 4);
  const r = 0.24; // 圆角半径（相对边长）
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // 「T」：横 0.25–0.75 × 0.25–0.39；竖 0.425–0.575 × 0.25–0.77
  const inT = (x, y) => (y >= 0.25 && y <= 0.39 && x >= 0.25 && x <= 0.75) || (x >= 0.425 && x <= 0.575 && y >= 0.25 && y <= 0.77);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0, ink = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
        if (!inRounded(x, y)) continue;
        cover++;
        if (inT(x, y)) ink++;
      }
      const a = cover / (S * S);
      const bg = grad(((px + py) / 2 + 0.5) / size);
      const k = cover ? ink / cover : 0;
      const col = bg.map((v, i) => v * (1 - k) + [20, 12, 6][i] * k);
      buf.set([...col.map(Math.round), Math.round(a * 255)], (py * size + px) * 4);
    }
  }
  return png(size, size, buf);
}

for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(__dirname, '..', 'extension', `icon${s}.png`), icon(s));
console.log('ok');
