// 看懂视频：看画面的模型 + 语音转写
// 普通文字模型收到图片时可能不报错、直接编造内容，所以先发一张已知内容的图验证模型真的看得见
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const llm = require('../providers/llm');
const settings = require('../settings');
const connectors = require('../connectors');
const media = require('../media');
const { safeFetch, FormData, File } = require('../net');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
const opt = (c, k) => c.options?.[k] || connectors.VENDORS[c.vendor]?.options?.find((o) => o[0] === k)?.[2] || '';

// ---------- 看画面 ----------
const fromConnector = (c) => ({ name: c.name, protocol: c.vendor === 'visionclaude' ? 'anthropic' : 'openai', baseUrl: opt(c, 'baseUrl'), apiKey: c.creds.apiKey, model: opt(c, 'model') });

function visionCfg() {
  const c = connectors.active('vision')[0];
  if (c) return fromConnector(c);
  return settings.activeProvider();
}

// 一张左红右蓝的小图（程序生成，不依赖文件）
function testPng() {
  const w = 64, h = 32;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const at = row + 1 + x * 3;
      if (x < w / 2) raw[at] = 230;
      else raw[at + 2] = 230;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const seen = new Map(); // 地址 + 模型 → 看得见 / 看不见（内存缓存）
async function canSee(cfg, { force } = {}) {
  const key = `${cfg.baseUrl}|${cfg.model}|${crypto.createHash('sha1').update(cfg.apiKey || '').digest('hex').slice(0, 8)}`;
  if (!force && seen.has(key)) return seen.get(key);
  const r = await llm.chat({ messages: [llm.imageMessage(cfg, '这张图片左半边和右半边分别是什么颜色？只回答两种颜色，用逗号隔开，先说左边。', [{ mime: 'image/png', b64: testPng().toString('base64') }])], temperature: 0, maxTokens: 400 }, cfg);
  const text = String(r.text || '').toLowerCase();
  const left = text.search(/红|red/), right = text.search(/蓝|blue/);
  const ok = left >= 0 && right >= 0 && left < right;
  seen.set(key, ok);
  return ok;
}

// 一次问一张拼好的图，返回 JSON
async function askImage(cfg, prompt, file, { maxTokens = 4000 } = {}) {
  const b64 = fs.readFileSync(file).toString('base64');
  return llm.completeJSON('', { cfg, messages: [llm.imageMessage(cfg, prompt, [{ mime: 'image/jpeg', b64 }])], temperature: 0.2, maxTokens, timeoutMs: 180000, system: '你只输出 JSON。只描述图里真实看到的内容，看不清就写「看不清」，不要编。' });
}

// ---------- 语音转写 ----------
const asrCfg = () => connectors.active('asr')[0] || null;

async function sendAudio(c, file, { verbose } = {}) {
  const form = new FormData();
  form.append('file', new File([fs.readFileSync(file)], path.basename(file), { type: file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }));
  form.append('model', opt(c, 'model'));
  if (verbose) form.append('response_format', 'verbose_json');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    const res = await safeFetch(`${trim(opt(c, 'baseUrl'))}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${c.creds.apiKey}` }, body: form, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw Object.assign(err(`语音转写失败（HTTP ${res.status}）：${text.slice(0, 200)}`, 424), { http: res.status });
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  } catch (e) {
    if (e.name === 'AbortError') throw err('语音转写超时', 424);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// 返回 { text, segments: [{ start, end, text }], source }；有的接口只给全文，就没有逐句时间
async function transcribe(video, dir, { duration, hasAudio }) {
  const c = asrCfg();
  if (!c) return { text: '', segments: [], source: '', skipped: '没有接入语音转写' };
  if (!hasAudio) return { text: '', segments: [], source: c.name, skipped: '视频没有音轨' };
  const chunkSec = Number(opt(c, 'chunkSeconds')) || 0;
  const verbose = c.vendor === 'asropenai';
  if (!chunkSec || duration <= chunkSec) {
    const audio = await media.extractAudio(video, path.join(dir, 'audio.mp3'));
    let r;
    try {
      r = await sendAudio(c, audio, { verbose });
    } catch (e) {
      if (!verbose || e.http !== 400) throw e;
      r = await sendAudio(c, audio);
    }
    fs.rmSync(audio, { force: true });
    return { text: String(r.text || '').trim(), segments: (r.segments || []).map((s) => ({ start: s.start, end: s.end, text: String(s.text || '').trim() })), source: c.name };
  }
  // 接口限制单次时长（智谱 30 秒）：切成多段依次转写
  const segments = [];
  for (let start = 0; start < duration; start += chunkSec) {
    const piece = path.join(dir, `audio-${start}.mp3`);
    await media.extractAudio(video, piece, { start, duration: chunkSec });
    const r = await sendAudio(c, piece);
    fs.rmSync(piece, { force: true });
    if (r.text) segments.push({ start, end: Math.min(duration, start + chunkSec), text: String(r.text).trim() });
  }
  return { text: segments.map((s) => s.text).join(' '), segments, source: c.name };
}

// 1 秒静音 WAV：测试语音接口用
function silentWav() {
  const samples = 16000;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  return b;
}

const visionTest = {
  async test(c) {
    const cfg = fromConnector(c);
    if (!(await canSee(cfg, { force: true }))) throw err(`「${cfg.model}」看不见图片：换一个视觉模型`, 424);
    return `连接成功：${cfg.model} 能看到图片内容`;
  },
};
for (const v of ['visionglm', 'visionopenai', 'visionclaude']) connectors.register(v, visionTest);

const asrTest = {
  async test(c) {
    const file = path.join(require('os').tmpdir(), `tk-asr-test-${crypto.randomBytes(4).toString('hex')}.wav`);
    fs.writeFileSync(file, silentWav());
    try {
      await sendAudio(c, file);
    } finally {
      fs.rmSync(file, { force: true });
    }
    return '连接成功：语音转写接口可用';
  },
};
for (const v of ['asrsiliconflow', 'asrglm', 'asropenai']) connectors.register(v, asrTest);

module.exports = { visionCfg, canSee, askImage, asrCfg, transcribe };
