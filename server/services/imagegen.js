// 生成图片：批量出片先用商品图出关键帧（视频第一帧），比直接生成视频便宜得多，看过、挑过再花钱做成视频
// 两种接口：/images/generations（火山方舟 Seedream 和大多数中转站，参考图放 image 字段）和 /chat/completions 出图（Gemini 图片模型一类）
const fs = require('fs');
const connectors = require('../connectors');
const media = require('../media');
const { safeFetch } = require('../net');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
const opt = (c, k) => c.options?.[k] || connectors.VENDORS[c.vendor]?.options?.find((o) => o[0] === k)?.[2] || '';
const MAX = 25 * 1024 * 1024;

function base(c) {
  const b = trim(opt(c, 'baseUrl'));
  if (!b) throw err(`「${c.name}」还没有填接口地址`);
  return b;
}
const headers = (c) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${c.creds.apiKey}` });

// 模型返回的图片：data URI 直接解码，链接下载下来（链接通常几小时后过期）
async function fetchImage(src) {
  const m = String(src).match(/^data:image\/[\w.+-]+;base64,(.+)$/);
  let buf;
  if (m) buf = Buffer.from(m[1], 'base64');
  else {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await safeFetch(src, { signal: ctrl.signal });
      if (!res.ok) throw err(`下载生成的图片失败：HTTP ${res.status}`, 424);
      buf = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(t);
    }
  }
  if (buf.length > MAX) throw err('生成的图片太大', 413);
  const mime = media.imageMime(buf);
  if (!mime) throw err('模型返回的不是图片', 424);
  return { buf, mime };
}

const images = {
  async generate(c, { prompt, refs = [], size }) {
    const body = { model: opt(c, 'model'), prompt, n: 1, response_format: 'url', watermark: false };
    const sz = size || opt(c, 'size');
    if (sz) body.size = sz;
    if (refs.length) body.image = refs.length === 1 ? refs[0] : refs;
    if (c.vendor === 'seedream') body.sequential_image_generation = 'disabled';
    const d = await connectors.request(`${base(c)}/images/generations`, { method: 'POST', headers: headers(c), body: JSON.stringify(body) }, 180000);
    const item = Array.isArray(d.data) ? d.data[0] : null;
    if (item?.b64_json) return fetchImage(`data:image/png;base64,${item.b64_json}`);
    if (item?.url) return fetchImage(item.url);
    throw err(`没有返回图片：${String(d.error?.message || JSON.stringify(d)).slice(0, 160)}`, 424);
  },
};

// 对话接口出图：回复里的图片可能在 images 字段、内容数组，或者是 markdown 里的链接 / base64
function findImage(msg) {
  if (!msg) return '';
  const fromList = (msg.images || []).map((x) => x?.image_url?.url || x?.url || '').find(Boolean);
  if (fromList) return fromList;
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      const u = part?.image_url?.url || part?.url || (part?.type === 'image' && part.source?.data ? `data:${part.source.media_type || 'image/png'};base64,${part.source.data}` : '');
      if (u) return u;
      if (part?.inline_data?.data) return `data:${part.inline_data.mime_type || 'image/png'};base64,${part.inline_data.data}`;
    }
  }
  const text = typeof msg.content === 'string' ? msg.content : '';
  return text.match(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/)?.[0] || text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)?.[1] || text.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S*)?/i)?.[0] || '';
}
const chat = {
  async generate(c, { prompt, refs = [] }) {
    const content = [...refs.map((url) => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: `${prompt}\nGenerate one vertical 9:16 image. Return the image only.` }];
    const d = await connectors.request(`${base(c)}/chat/completions`, { method: 'POST', headers: headers(c), body: JSON.stringify({ model: opt(c, 'model'), messages: [{ role: 'user', content }], modalities: ['image', 'text'] }) }, 180000);
    const url = findImage(d.choices?.[0]?.message);
    if (!url) throw err(`模型回复里没有图片：${String(d.choices?.[0]?.message?.content || JSON.stringify(d)).slice(0, 160)}`, 424);
    return fetchImage(url);
  },
};

const ADAPTERS = { seedream: images, imageopenai: images, imagechat: chat };

// 测试连接不出图（出图要花钱）：查模型列表。密钥不对会 401 / 403
async function ping(c) {
  try {
    await connectors.request(`${base(c)}/models`, { headers: headers(c) }, 20000);
    return '连接正常，密钥可用（只查了模型列表，没有出图，也没有扣费）';
  } catch (e) {
    if (/HTTP 40[13]/.test(e.message)) throw err('密钥无效或没有权限（没有扣费，这只是查询测试）', 424);
    if (/无法连接|超时|内网/.test(e.message)) throw e;
    return '地址可以连上；这个服务没有模型列表接口，密钥要在第一次出图时确认（没有扣费）';
  }
}
for (const [vendor, a] of Object.entries(ADAPTERS)) connectors.register(vendor, { ...a, test: ping });

// 生成一张图存到 outBase（不带扩展名），返回文件路径和类型
async function generate(c, { prompt, refs, size, model }, outBase) {
  const a = ADAPTERS[c.vendor];
  if (!a) throw err('这个连接不是图片模型');
  const { buf, mime } = await a.generate(connectors.withModel(c, model), { prompt, refs, size });
  media.assertQuota(buf.length);
  const abs = `${outBase}.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
  fs.writeFileSync(abs, buf);
  return { abs, mime };
}

// 出图失败（没额度、被拒等）时换下一个启用的图片模型，最多试 3 个
async function generateAny(c, opts, outBase) {
  const model = opts.model || c.options?.model || '';
  const pool = connectors.autoFallback() ? connectors.mediaPool('image').filter((x) => !(x.connectorId === c.id && x.model === model)) : [];
  const tried = [];
  let first;
  for (const x of [{ c, model, connectorId: c.id }, ...pool].slice(0, 3)) {
    try {
      const out = await generate(x.c, { ...opts, model: x.model }, outBase);
      return Object.assign(out, { model: x.model, connectorId: x.connectorId, fellBack: tried });
    } catch (e) {
      connectors.markFail(`${x.c.hub || x.connectorId}|${x.model}`);
      first = first || e;
      tried.push({ model: x.model, error: String(e.message).slice(0, 120) });
    }
  }
  if (tried.length > 1) first.message = `${first.message}（已自动换了 ${tried.length - 1} 个备用图片模型，也都失败了）`;
  throw first;
}

module.exports = { generate, generateAny, ADAPTERS, findImage, fetchImage };
