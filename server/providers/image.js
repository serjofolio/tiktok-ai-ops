// 文生图适配层：OpenAI 兼容 images/generations（OpenAI gpt-image、火山方舟 Seedream、硅基流动等）+ 离线演示
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { MEDIA_DIR, id } = require('../db');
const { http, trimSlash } = require('./llm');

// 演示图配色：[底色, 色块, 文字]，平涂海报风格
const PALETTES = [
  ['#111110', '#D2FF1F', '#F5F4EF'],
  ['#D2FF1F', '#111110', '#111110'],
  ['#F3F2EE', '#FF4A2B', '#111110'],
  ['#FF4A2B', '#F3F2EE', '#111110'],
  ['#E8E4D8', '#111110', '#111110'],
  ['#1F3D2B', '#D2FF1F', '#F5F4EF'],
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

// 离线模式：生成平涂海报风格的竖版 SVG，保证无 Key 也能跑通全流程
function mockSVG({ prompt, title, emoji, size }) {
  const [w, h] = (size || '1024x1792').split('x').map(Number);
  const seed = [...(prompt || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const [bg, shape, ink] = PALETTES[seed % PALETTES.length];
  // 版式：标题在上、主体居中、提示词在中下，底部 30% 留给视频字幕
  const lines = wrap(prompt || '', 34).slice(0, 3);
  const titleLines = wrap(title || 'AI Generated', /[\u4e00-\u9fa5]/.test(title || '') ? 12 : 22).slice(0, 2);
  const font = 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif';
  const grid = Array.from({ length: 9 }, (_, i) => `<line x1="${(w / 8) * i}" y1="0" x2="${(w / 8) * i}" y2="${h}" stroke="${ink}" stroke-opacity="0.07"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="${bg}"/>${grid}
<circle cx="${w / 2}" cy="${h * 0.38}" r="${w * 0.3}" fill="${shape}"/>
<rect x="${w * 0.08}" y="${h * 0.06}" width="${w * 0.84}" height="${h * 0.88}" fill="none" stroke="${ink}" stroke-opacity="0.25" stroke-width="2"/>
${titleLines
  .map((l, i) => `<text x="50%" y="${h * 0.13 + i * w * 0.075}" font-family="${font}" font-size="${Math.round(w * 0.058)}" font-weight="800" fill="${ink}" text-anchor="middle">${esc(l)}</text>`)
  .join('\n')}
<text x="50%" y="${h * 0.38}" font-size="${Math.round(w * 0.26)}" text-anchor="middle" dominant-baseline="middle">${esc(emoji || '🛍️')}</text>
${lines
  .map((l, i) => `<text x="50%" y="${h * 0.6 + i * w * 0.042}" font-family="${font}" font-size="${Math.round(w * 0.03)}" fill="${ink}" opacity="0.7" text-anchor="middle">${esc(l)}</text>`)
  .join('\n')}
<text x="50%" y="${h - w * 0.1}" font-family="${font}" font-size="${Math.round(w * 0.024)}" fill="${ink}" opacity="0.5" text-anchor="middle">DEMO · 离线演示图 · 配置图像模型后生成真实图片</text>
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
