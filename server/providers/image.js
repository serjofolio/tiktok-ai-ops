// 文生图适配层：OpenAI 兼容 images/generations（OpenAI gpt-image、火山方舟 Seedream、硅基流动等）+ 离线演示
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { MEDIA_DIR, id } = require('../db');
const { http, trimSlash } = require('./llm');

const PALETTES = [
  ['#FE2C55', '#7B2CFF'],
  ['#25F4EE', '#2B5CFF'],
  ['#FF9A3C', '#FF2C7A'],
  ['#00D2A8', '#0077FF'],
  ['#A855F7', '#EC4899'],
  ['#F59E0B', '#EF4444'],
];

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function wrap(text, max) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/(\s+)/)) {
    if ((line + word).length > max && line) {
      out.push(line.trim());
      line = word;
    } else line += word;
    while (line.length > max) {
      out.push(line.slice(0, max));
      line = line.slice(max);
    }
  }
  if (line.trim()) out.push(line.trim());
  return out.slice(0, 4);
}

// 离线模式：生成带渐变和文字的竖版海报 SVG，保证无 Key 也能跑通全流程
function mockSVG({ prompt, title, emoji, size }) {
  const [w, h] = (size || '1024x1792').split('x').map(Number);
  const seed = [...(prompt || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const [c1, c2] = PALETTES[seed % PALETTES.length];
  // 版式：标题在上、主体居中、提示词在中下，底部 30% 留给视频字幕
  const lines = wrap(prompt || '', 34).slice(0, 3);
  const titleLines = wrap(title || 'AI Generated', /[一-龥]/.test(title || '') ? 12 : 22).slice(0, 2);
  const font = 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif';
  const circles = Array.from({ length: 6 }, (_, i) => {
    const r = 80 + ((seed * (i + 3)) % 220);
    const cx = (seed * (i + 7) * 37) % w;
    const cy = (seed * (i + 11) * 53) % h;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" opacity="${0.04 + (i % 3) * 0.03}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.42" r="0.4"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>${circles}
<rect width="100%" height="100%" fill="url(#glow)"/>
${titleLines
  .map((l, i) => `<text x="50%" y="${h * 0.13 + i * w * 0.075}" font-family="${font}" font-size="${Math.round(w * 0.058)}" font-weight="800" fill="#fff" text-anchor="middle">${esc(l)}</text>`)
  .join('\n')}
<text x="50%" y="${h * 0.38}" font-size="${Math.round(w * 0.3)}" text-anchor="middle" dominant-baseline="middle">${esc(emoji || '🛍️')}</text>
${lines
  .map((l, i) => `<text x="50%" y="${h * 0.56 + i * w * 0.042}" font-family="${font}" font-size="${Math.round(w * 0.03)}" fill="#fff" opacity="0.8" text-anchor="middle">${esc(l)}</text>`)
  .join('\n')}
<text x="50%" y="${h - w * 0.06}" font-family="${font}" font-size="${Math.round(w * 0.024)}" fill="#fff" opacity="0.55" text-anchor="middle">DEMO · 离线演示图 · 配置图像模型后生成真实图片</text>
</svg>`;
}

async function saveRemote(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  const ext = type.includes('video') || /\.mp4(\?|$)/.test(url) ? 'mp4' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const name = `${id(ext === 'mp4' ? 'vid_' : 'img_')}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
  return `/media/${name}`;
}

function readLocalAsDataURL(localUrl) {
  if (!localUrl || !localUrl.startsWith('/media/')) return localUrl;
  const p = path.join(MEDIA_DIR, path.basename(localUrl));
  if (!fs.existsSync(p)) return null;
  const ext = path.extname(p).slice(1).replace('jpg', 'jpeg');
  if (ext === 'svg') return null; // 演示图不作为参考图上传
  return `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`;
}

/**
 * 生成图片，返回本地可访问的 URL（/media/xxx）
 * @param {{prompt:string, size?:string, title?:string, emoji?:string, referenceImage?:string, negativePrompt?:string}} opts
 */
async function generate(opts) {
  const cfg = settings.get().image;
  const size = opts.size || cfg.size || '1024x1792';
  if (cfg.provider === 'mock') {
    const name = `${id('img_')}.svg`;
    fs.writeFileSync(path.join(MEDIA_DIR, name), mockSVG({ ...opts, size }));
    return { url: `/media/${name}`, provider: 'mock' };
  }
  if (!cfg.apiKey) throw new Error('未配置图像模型 API Key');
  const body = { model: cfg.model, prompt: opts.prompt, size, n: 1, response_format: 'b64_json' };
  if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
  const ref = readLocalAsDataURL(opts.referenceImage);
  if (ref) body.image = ref;
  const call = (b) =>
    http(`${trimSlash(cfg.baseUrl)}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(b),
    }, 180000);
  let data;
  try {
    data = await call(body);
  } catch (e) {
    // 部分模型（如 gpt-image-1）不接受 response_format 参数
    if (/response_format/i.test(e.message)) {
      delete body.response_format;
      data = await call(body);
    } else throw e;
  }
  const item = data.data?.[0] || {};
  if (item.b64_json) {
    const name = `${id('img_')}.png`;
    fs.writeFileSync(path.join(MEDIA_DIR, name), Buffer.from(item.b64_json, 'base64'));
    return { url: `/media/${name}`, provider: cfg.provider };
  }
  if (item.url) return { url: await saveRemote(item.url), provider: cfg.provider };
  throw new Error('图像接口未返回图片数据');
}

module.exports = { generate, readLocalAsDataURL, saveRemote };
