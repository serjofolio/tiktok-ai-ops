// 从视频脚本生成视频：提交任务 → 轮询 → 下载存到本地（厂商的链接通常 24 小时过期）→ 多段合并成一条
// 每个厂商一个适配器，统一成 submit / poll；任务写进数据库，服务重启后接着查
const fs = require('fs');
const path = require('path');
const db = require('../db');
const ctx = require('../ctx');
const media = require('../media');
const connectors = require('../connectors');
const { safeFetch } = require('../net');
const craft = require('./promptcraft');

const jobs = db.collection('video_jobs');
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const POLL_MS = Number(process.env.VIDEO_POLL_MS) || 10000;
const CLIP_TIMEOUT = 40 * 60 * 1000;
const CONCURRENCY = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
const opt = (c, k) => c.options?.[k] || connectors.VENDORS[c.vendor]?.options?.find((o) => o[0] === k)?.[2] || '';
const bearer = (c, extra) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${c.creds.apiKey}`, ...extra });
const post = (url, headers, body) => connectors.request(url, { method: 'POST', headers, body: JSON.stringify(body) }, 60000);
const get = (url, headers) => connectors.request(url, { headers }, 30000);
const dig = (o, p) => String(p || '').split('.').filter(Boolean).reduce((a, k) => (a == null ? a : a[k]), o);
const base64Only = (image) => String(image).replace(/^data:[^;]+;base64,/, '');

// 统一的轮询结果：{ status: 'running' | 'done' | 'failed', url, error }
const seedance = {
  async submit(c, t) {
    const content = [{ type: 'text', text: t.prompt }];
    if (t.image) content.push({ type: 'image_url', image_url: { url: t.image }, role: 'first_frame' });
    // 没有首帧时可以给参考图（2.0 系列 1–9 张）：商品外形参照它，但画面由模型重新构图。两种不能混用
    else for (const url of (t.refs || []).slice(0, 9)) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
    const d = await post(`${trim(opt(c, 'baseUrl'))}/contents/generations/tasks`, bearer(c), { model: opt(c, 'model'), content, ratio: t.ratio, duration: t.duration, resolution: opt(c, 'resolution'), generate_audio: !!t.audio, watermark: false });
    if (!d.id) throw err(`Seedance 没有返回任务 ID：${JSON.stringify(d).slice(0, 160)}`, 424);
    return d.id;
  },
  async poll(c, id) {
    const d = await get(`${trim(opt(c, 'baseUrl'))}/contents/generations/tasks/${encodeURIComponent(id)}`, bearer(c));
    if (d.status === 'succeeded') return { status: 'done', url: d.content?.video_url };
    if (['failed', 'cancelled', 'expired'].includes(d.status)) return { status: 'failed', error: d.error?.message || d.status };
    return { status: 'running' };
  },
};

const kling = {
  async submit(c, t) {
    const settings = { multi_shot: !!t.multiShot, audio: t.audio ? 'native' : 'off', resolution: opt(c, 'resolution'), aspect_ratio: t.ratio, duration: t.duration };
    const base = trim(opt(c, 'baseUrl'));
    const model = opt(c, 'model');
    const d = t.image
      ? await post(`${base}/image-to-video/${model}`, bearer(c), { contents: [{ type: 'prompt', text: t.prompt }, { type: 'first_frame', url: /^https?:/.test(t.image) ? t.image : base64Only(t.image) }], settings })
      : await post(`${base}/text-to-video/${model}`, bearer(c), { prompt: t.prompt, settings });
    if (d.code !== 0 || !d.data?.id) throw err(`可灵：${d.message || JSON.stringify(d).slice(0, 160)}`, 424);
    return d.data.id;
  },
  async poll(c, id) {
    const d = await get(`${trim(opt(c, 'baseUrl'))}/tasks?task_ids=${encodeURIComponent(id)}`, bearer(c));
    if (d.code !== 0) throw err(`可灵：${d.message || d.code}`, 424);
    const task = Array.isArray(d.data) ? d.data[0] : d.data;
    if (!task) return { status: 'running' };
    if (task.status === 'succeeded') return { status: 'done', url: (task.outputs || []).find((o) => o.type === 'video')?.url };
    if (task.status === 'failed') return { status: 'failed', error: task.message || '可灵返回失败' };
    return { status: 'running' };
  },
};

const wan = {
  async submit(c, t) {
    const headers = bearer(c, { 'X-DashScope-Async': 'enable' });
    const base = trim(opt(c, 'baseUrl'));
    const body = t.image
      ? { model: opt(c, 'imageModel'), input: { prompt: t.prompt, media: [{ type: 'first_frame', url: t.image }] }, parameters: { resolution: opt(c, 'resolution'), duration: t.duration, watermark: false } }
      : { model: opt(c, 'model'), input: { prompt: t.prompt }, parameters: { resolution: opt(c, 'resolution'), ratio: t.ratio, duration: t.duration, watermark: false } };
    const d = await post(`${base}/services/aigc/video-generation/video-synthesis`, headers, body);
    if (!d.output?.task_id) throw err(`通义万相：${d.message || JSON.stringify(d).slice(0, 160)}`, 424);
    return d.output.task_id;
  },
  async poll(c, id) {
    const d = await get(`${trim(opt(c, 'baseUrl'))}/tasks/${encodeURIComponent(id)}`, bearer(c));
    const s = d.output?.task_status;
    if (s === 'SUCCEEDED') return { status: 'done', url: d.output.video_url };
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(s)) return { status: 'failed', error: d.output?.message || s };
    return { status: 'running' };
  },
};

const minimaxCheck = (d) => {
  const code = d.base_resp?.status_code;
  if (code) throw err(`海螺：${d.base_resp.status_msg || code}`, code === 1004 || code === 2049 ? 401 : 424);
};
const minimax = {
  async submit(c, t) {
    const body = { model: opt(c, 'model'), prompt: t.prompt.slice(0, 2000), duration: t.duration, resolution: opt(c, 'resolution'), prompt_optimizer: true };
    if (t.image) body.first_frame_image = t.image;
    const d = await post(`${trim(opt(c, 'baseUrl'))}/v1/video_generation`, bearer(c), body);
    minimaxCheck(d);
    return d.task_id;
  },
  async poll(c, id) {
    const base = trim(opt(c, 'baseUrl'));
    const d = await get(`${base}/v1/query/video_generation?task_id=${encodeURIComponent(id)}`, bearer(c));
    minimaxCheck(d);
    if (d.status === 'Fail') return { status: 'failed', error: d.base_resp?.status_msg || '海螺返回失败' };
    if (d.status !== 'Success') return { status: 'running' };
    const f = await get(`${base}/v1/files/retrieve?file_id=${encodeURIComponent(d.file_id)}`, bearer(c));
    minimaxCheck(f);
    return { status: 'done', url: f.file?.download_url };
  },
};

// 中转站统一格式（new-api 一类）：POST {接口地址}/videos 提交，GET /videos/{id} 查询（也可以换成 /video/generations）
// 素材放在 images 数组：1 张是首帧，3 张以上是参考图（对象写法显式标 role）。MiniMax 系列用 first_image / referenceImages
// 各家中转站返回的字段不完全一样：状态和视频地址按常见的几种写法都找一遍
const relay = {
  url(c, id) {
    const b = trim(opt(c, 'baseUrl'));
    if (!b) throw err('中转站还没有填接口地址');
    const path = opt(c, 'endpoint') === '/video/generations' ? '/video/generations' : '/videos';
    return `${b}${path}${id ? `/${encodeURIComponent(id)}` : ''}`;
  },
  async submit(c, t) {
    const model = opt(c, 'model');
    const body = { model, prompt: t.prompt, duration: t.duration, seconds: String(t.duration), aspect_ratio: t.ratio, ratio: t.ratio, resolution: opt(c, 'resolution') || '720p', generate_audio: !!t.audio, watermark: false };
    if (/minimax|hailuo/i.test(model)) {
      if (t.image) body.first_image = t.image;
      else if (t.refs?.length) body.referenceImages = t.refs.slice(0, 5);
    } else if (t.image) body.images = [t.image];
    else if (t.refs?.length) body.images = t.refs.slice(0, 9).map((url) => ({ url, role: 'reference_image' }));
    const d = await post(this.url(c), bearer(c), body);
    const id = d.task_id || d.id || d.data?.task_id || d.data?.id;
    if (!id) throw err(`中转站没有返回任务 ID：${JSON.stringify(d).slice(0, 160)}`, 424);
    return String(id);
  },
  async poll(c, id) {
    const d = await get(this.url(c, id), bearer(c));
    const x = d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? { ...d, ...d.data } : d;
    const s = String(x.status || x.state || x.task_status || '').toLowerCase();
    const url = x.video_url || x.url || (Array.isArray(x.data) ? x.data[0]?.url : '') || x.metadata?.url || x.result_url || x.content?.video_url || x.output?.video_url;
    if (['completed', 'succeeded', 'success', 'done'].includes(s)) return { status: 'done', url };
    if (['failed', 'fail', 'failure', 'error', 'cancelled', 'canceled', 'expired'].includes(s)) return { status: 'failed', error: String(x.error?.message || x.fail_reason || x.error || s) };
    return { status: 'running' };
  },
};

// 自定义接口：按用户填的模板提交，按路径取结果
const custom = {
  headers(c) {
    const [name, ...rest] = String(opt(c, 'authHeader')).split(':');
    return { 'Content-Type': 'application/json', [name.trim()]: rest.join(':').trim().replace('{{key}}', c.creds.apiKey) };
  },
  async submit(c, t) {
    if (!opt(c, 'submitUrl')) throw err('自定义接口还没有填提交地址');
    const fill = (s) => {
      const vals = { prompt: t.prompt, model: opt(c, 'model'), duration: t.duration, ratio: t.ratio, image: t.image || '', audio: !!t.audio };
      return s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vals ? JSON.stringify(vals[k]).replace(/^"|"$/g, '') : m));
    };
    let body;
    try {
      body = JSON.parse(fill(opt(c, 'submitBody')));
    } catch {
      throw err('自定义接口的请求体模板不是合法 JSON');
    }
    const d = await post(opt(c, 'submitUrl'), this.headers(c), body);
    const direct = dig(d, opt(c, 'videoUrlPath'));
    if (direct) return `direct:${direct}`;
    const id = dig(d, opt(c, 'taskIdPath'));
    if (!id) throw err(`自定义接口没有返回任务 ID（路径 ${opt(c, 'taskIdPath')}）：${JSON.stringify(d).slice(0, 160)}`, 424);
    return String(id);
  },
  async poll(c, id) {
    if (id.startsWith('direct:')) return { status: 'done', url: id.slice(7) };
    if (!opt(c, 'queryUrl')) throw err('自定义接口还没有填查询地址');
    const d = await get(opt(c, 'queryUrl').replace('{{id}}', encodeURIComponent(id)), this.headers(c));
    const s = String(dig(d, opt(c, 'statusPath')) ?? '').toLowerCase();
    const list = (k) => opt(c, k).split(',').map((x) => x.trim().toLowerCase());
    if (list('doneValues').includes(s)) return { status: 'done', url: dig(d, opt(c, 'videoUrlPath')) };
    if (list('failValues').includes(s)) return { status: 'failed', error: String(dig(d, opt(c, 'errorPath')) || s) };
    return { status: 'running' };
  },
};

const ADAPTERS = { seedance, kling, wan, minimax, videonewapi: relay, videocustom: custom };

// 测试连接不能真的生成（要花钱）：查一个不存在的任务，密钥不对会报 401 / 403，其他情况说明地址和密钥可用
const ping = (a) => async (c) => {
  try {
    await a.poll(c, '000000000000');
  } catch (e) {
    if (e.status === 401 || /HTTP 40[13]/.test(e.message)) throw err('密钥无效或没有权限（没有扣费，这只是查询测试）', 424);
    if (/无法连接|超时/.test(e.message) || e.status === 400) throw e;
  }
  return '连接正常，密钥可用（只做了查询测试，没有生成视频，也没有扣费）';
};
for (const [vendor, a] of Object.entries(ADAPTERS)) connectors.register(vendor, { ...a, test: ping(a) });

// ---------- 时长：脚本的每个镜头 2–5 秒，模型有自己的最短和可选时长 ----------
function durationRule(c) {
  const raw = String(opt(c, 'durations') || '5-10');
  const m = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const list = raw.split(/[,，\s]+/).map(Number).filter(Boolean).sort((a, b) => a - b);
  return list.length ? { list, min: list[0], max: list.at(-1) } : { min: 5, max: 10 };
}
function snap(rule, sec) {
  if (rule.list) return rule.list.find((x) => x >= sec) ?? rule.max;
  return Math.max(rule.min, Math.min(rule.max, Math.ceil(sec)));
}

// ---------- 提示词 ----------
const FRAME = 'Vertical 9:16 UGC-style short video shot on a smartphone, natural light, realistic, not a commercial.';
const AVOID = 'No on-screen text, no captions, no subtitles, no watermark, no logos.';
const REF = 'The product must look exactly like the reference image: same shape, color, material, size and quantity. Do not add features.';

function scenePrompt(s, { hasImage, audio, language } = {}) {
  const body = s.videoPrompt || [s.shot, s.visual].filter(Boolean).join('. ');
  const say = audio && s.voiceover ? `The person says in ${language || 'the original language'}: "${s.voiceover}".` : '';
  return [FRAME, body, say, hasImage ? REF : '', AVOID].filter(Boolean).join(' ');
}

// 整条一次生成：把每个镜头按顺序写进一条提示词。可灵有专门的多镜头格式
function wholePrompt(script, scenes, durations, { vendor, hasImage, audio }) {
  const lines = scenes.map((s, i) => ({ n: i + 1, sec: durations[i], text: s.videoPrompt || [s.shot, s.visual].filter(Boolean).join('. '), say: audio && s.voiceover ? ` Says: "${s.voiceover}".` : '' }));
  const tail = [hasImage ? REF : '', AVOID].filter(Boolean).join(' ');
  if (vendor === 'kling') return lines.map((l) => `shot ${l.n}, ${l.sec}, ${`${l.text}${l.say}`.slice(0, 480)}`).join('; ') + `; ${tail}`;
  return `${FRAME} One continuous video, same person and same location throughout, with these shots in order. ${lines.map((l) => `Shot ${l.n} (${l.sec}s): ${l.text}${l.say}`).join(' ')} ${tail}`;
}

// 商品图转成 data URI 再发：FastMoss 给的图片地址可能过期或防盗链，模型服务商不一定下载得到
async function imageDataUri(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await safeFetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(type)) throw new Error('不是图片');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) throw new Error('图片超过 10MB');
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } finally {
    clearTimeout(t);
  }
}

// ---------- 规划：提交前告诉用户要生成几段、一共多少秒（费用按秒或按条算） ----------
function plan({ script, connectorId, mode = 'scenes', sceneNs }) {
  const c = connectorId ? connectors.get(connectorId) : connectors.active('video')[0];
  if (!c || connectors.VENDORS[c.vendor]?.kind !== 'video') throw err('还没有接入视频模型：到「接入配置 → 视频模型」添加一个');
  const rule = durationRule(c);
  const picked = (script.scenes || []).filter((s) => !sceneNs?.length || sceneNs.includes(s.n));
  if (!picked.length) throw err('这个脚本没有可以生成的镜头');
  const durs = picked.map((s) => Math.max(1, Math.round(Number(s.duration) || 4)));
  const total = durs.reduce((a, b) => a + b, 0);
  if (mode === 'whole') {
    if (total > rule.max) throw err(`整条 ${total} 秒超过这个模型单次最长 ${rule.max} 秒：请改成「分镜逐段生成」或选时长更短的脚本`);
    return { connector: c, rule, mode, clips: [{ scenes: picked, durations: durs, target: total, duration: snap(rule, total) }], seconds: snap(rule, total) };
  }
  const clips = picked.map((s, i) => ({ scenes: [s], durations: [durs[i]], target: durs[i], duration: snap(rule, durs[i]) }));
  return { connector: c, rule, mode: 'scenes', clips, seconds: clips.reduce((a, x) => a + x.duration, 0) };
}

const publicPlan = (p) => ({ connector: { id: p.connector.id, name: p.connector.name, vendor: p.connector.vendor }, mode: p.mode, maxSeconds: p.rule.max, tasks: p.clips.length, seconds: p.seconds, clips: p.clips.map((x) => ({ scenes: x.scenes.map((s) => s.n), target: x.target, duration: x.duration })) });

// ---------- 任务 ----------
const active = new Set();

function patchClip(jobId, i, patch) {
  return jobs.update(jobId, (j) => ({ clips: j.clips.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
}

async function startJob(body, script) {
  const p = plan({ script, connectorId: body.connectorId, mode: body.mode, sceneNs: body.sceneNs });
  media.assertQuota();
  const c = p.connector;
  assertSlots(1);
  const ratio = ['9:16', '1:1', '16:9'].includes(body.ratio) ? body.ratio : '9:16';
  const audio = !!body.audio;
  const hasImage = !!body.imageUrl || !!body.imageMediaId;
  const language = script.language;
  const clips = p.clips.map((x) => ({
    scenes: x.scenes.map((s) => s.n),
    duration: x.duration,
    target: x.target,
    status: 'pending',
    prompt: x.scenes.length > 1 ? wholePrompt(script, x.scenes, x.durations, { vendor: c.vendor, hasImage, audio }) : scenePrompt(x.scenes[0], { hasImage, audio, language }),
    multiShot: x.scenes.length > 1,
  }));
  const job = jobs.insert({
    status: 'running', step: '提交任务', scriptId: script.id, title: script.title, productId: script.productId || '', productName: script.productName || '',
    connectorId: c.id, vendor: c.vendor, connectorName: c.name, model: opt(c, 'model'), mode: p.mode, ratio, audio, imageUrl: body.imageUrl || '', imageMediaId: body.imageMediaId || '', clips, seconds: p.seconds, aiLabelReminder: true,
  });
  run(job.id);
  return job;
}

// 每个账号同时最多跑 3 个视频任务
const MAX_RUNNING = 3;
function assertSlots(n) {
  const mine = [...active].filter((id) => jobs.get(id)).length;
  if (mine + n > MAX_RUNNING) throw err(`同时最多跑 ${MAX_RUNNING} 个视频任务，现在有 ${mine} 个在跑，等它们结束再开始`, 409);
}

// ---------- 自由创作：不依赖脚本，自己写分镜 ----------
// shots：[{ prompt, duration, voiceover, imageMediaId }]，每个镜头可以有自己的首帧图；没有首帧时把商品参考图交给支持参考图的模型
const ownImage = (id) => {
  const m = id ? media.records.get(id) : null;
  return m && /^image\//.test(m.mime) ? m : null;
};
function freeScript(body) {
  const shots = (Array.isArray(body.shots) ? body.shots : []).slice(0, 12).map((x, i) => ({
    n: i + 1,
    videoPrompt: String(x.prompt || '').trim().slice(0, 3000),
    duration: Math.max(1, Math.min(30, Math.round(Number(x.duration) || 5))),
    voiceover: String(x.voiceover || '').trim().slice(0, 400),
    imageMediaId: ownImage(x.imageMediaId)?.id || '',
  }));
  if (!shots.length) throw err('至少写一个镜头');
  const empty = shots.find((x) => !x.videoPrompt);
  if (empty) throw err(`第 ${empty.n} 个镜头还没写画面`);
  return { id: '', title: String(body.title || '').trim().slice(0, 80) || shots[0].videoPrompt.slice(0, 40), language: body.language || 'English', scenes: shots };
}
function freePrompt(scenes, durations, { vendor, audio, language, guard, hasImage }) {
  const say = (x) => (audio && x.voiceover ? ` The person says in ${language}: "${x.voiceover}".` : '');
  const tail = guard ? ` ${hasImage ? REF : ''} ${craft.MOTION_GUARD}`.replace(/\s+/g, ' ') : '';
  if (scenes.length === 1) return `${scenes[0].videoPrompt}${say(scenes[0])}${tail}`;
  if (vendor === 'kling') return scenes.map((x, i) => `shot ${i + 1}, ${durations[i]}, ${`${x.videoPrompt}${say(x)}`.slice(0, 480)}`).join('; ') + (tail ? `;${tail}` : '');
  return scenes.map((x, i) => `${i ? 'Cut to ' : ''}Shot ${i + 1} (${durations[i]}s): ${x.videoPrompt}${say(x)}`).join(' ') + tail;
}
function freeCost(c, model, seconds, tasks) {
  const m = connectors.modelsOf(c).find((x) => x.id === model);
  if (!m || m.price === '' || m.price == null) return null;
  return Math.round((m.unit === '条' ? m.price * tasks : m.price * seconds) * 100) / 100;
}
function planFree(body) {
  const script = freeScript(body);
  const c0 = body.connectorId ? connectors.get(body.connectorId) : connectors.active('video')[0];
  if (!c0 || connectors.VENDORS[c0.vendor]?.kind !== 'video') throw err('还没有接入视频模型：到「接入配置 → 视频与图片模型」添加，你的中转站也可以');
  const model = connectors.modelsOf(c0).find((x) => x.id === body.model)?.id || c0.options?.model || '';
  const c = connectors.withModel(c0, model);
  const p = plan({ script, connectorId: c0.id, mode: body.mode === 'whole' ? 'whole' : 'scenes' });
  const variants = Math.max(1, Math.min(4, Number(body.variants) || 1));
  return { script, c, model, p, variants, yuan: freeCost(c0, model, p.seconds * variants, p.clips.length * variants) };
}
const publicFreePlan = (x) => ({ ...publicPlan(x.p), model: x.model, variants: x.variants, totalTasks: x.p.clips.length * x.variants, totalSeconds: x.p.seconds * x.variants, yuan: x.yuan });

function startFree(body = {}) {
  const x = planFree(body);
  media.assertQuota();
  assertSlots(x.variants);
  const { script, c, p } = x;
  const ratio = ['9:16', '1:1', '16:9', '3:4', '4:3'].includes(body.ratio) ? body.ratio : '9:16';
  const audio = !!body.audio;
  const guard = body.guard !== false;
  const refs = (body.refAssetIds || []).map(ownImage).filter(Boolean).map((m) => m.id).slice(0, 9);
  const out = [];
  for (let v = 0; v < x.variants; v++) {
    const clips = p.clips.map((cl) => {
      const imageMediaId = cl.scenes[0].imageMediaId || '';
      return {
        scenes: cl.scenes.map((sc) => sc.n), duration: cl.duration, target: cl.target, status: 'pending', imageMediaId,
        prompt: freePrompt(cl.scenes, cl.durations, { vendor: c.vendor, audio, language: script.language, guard, hasImage: !!imageMediaId || refs.length > 0 }),
        multiShot: cl.scenes.length > 1,
      };
    });
    out.push(jobs.insert({
      status: 'running', step: '提交任务', free: true, scriptId: body.scriptId || '', title: x.variants > 1 ? `${script.title} · 版本 ${v + 1}` : script.title, productId: '', productName: '',
      connectorId: c.id, vendor: c.vendor, connectorName: c.name, model: x.model, mode: p.mode, ratio, audio, imageUrl: '', imageMediaId: '', refs, clips, seconds: p.seconds, aiLabelReminder: true,
    }));
  }
  for (const j of out) run(j.id);
  return out;
}

async function imageFor(job) {
  if (job.imageMediaId) {
    const m = media.records.get(job.imageMediaId);
    if (m) return `data:${m.mime};base64,${fs.readFileSync(media.absPath(m)).toString('base64')}`;
  }
  if (job.imageUrl) {
    try {
      return await imageDataUri(job.imageUrl);
    } catch {
      return job.imageUrl; // 下载不到就把地址直接交给模型服务商试试
    }
  }
  return '';
}

async function run(id) {
  if (active.has(id)) return;
  active.add(id);
  const failJob = (message) => jobs.update(id, { status: 'error', error: message, finishedAt: db.now() });
  try {
    const job = jobs.get(id);
    const c0 = connectors.get(job.connectorId);
    const c = c0 && job.free && job.model ? connectors.withModel(c0, job.model) : c0;
    if (!c) return failJob('这个视频模型的连接已被删除');
    const adapter = ADAPTERS[c.vendor];
    const dir = job.dir ? path.join(db.MEDIA_DIR, job.dir) : media.newDir('job');
    if (!job.dir) jobs.update(id, { dir: path.relative(db.MEDIA_DIR, dir) });
    const image = job.clips.some((x) => x.status === 'pending') ? await imageFor(job) : '';
    const dataOf = (m) => `data:${m.mime};base64,${fs.readFileSync(media.absPath(m)).toString('base64')}`;
    const refs = (job.refs || []).map(ownImage).filter(Boolean).map(dataOf);
    const errorsInARow = new Map();
    for (;;) {
      const cur = jobs.get(id);
      if (!cur) return; // 任务被删除
      const running = cur.clips.filter((x) => x.status === 'running').length;
      let slots = CONCURRENCY - running;
      for (const [i, clip] of cur.clips.entries()) {
        if (clip.status !== 'pending' || slots <= 0) continue;
        slots--;
        try {
          const own = ownImage(clip.imageMediaId);
          const first = own ? dataOf(own) : image;
          const taskId = await adapter.submit(c, { prompt: clip.prompt, duration: clip.duration, ratio: cur.ratio, audio: cur.audio, image: first, refs: first ? [] : refs, multiShot: clip.multiShot });
          patchClip(id, i, { status: 'running', taskId, submittedAt: db.now() });
        } catch (e) {
          patchClip(id, i, { status: 'failed', error: e.message });
        }
      }
      const now = jobs.get(id);
      if (!now) return;
      for (const [i, clip] of now.clips.entries()) {
        if (clip.status !== 'running') continue;
        if (Date.now() - Date.parse(clip.submittedAt) > CLIP_TIMEOUT) {
          patchClip(id, i, { status: 'failed', error: '等待超过 40 分钟，判定超时。到模型控制台看看任务状态，或点重试' });
          continue;
        }
        try {
          const r = await adapter.poll(c, clip.taskId);
          errorsInARow.delete(i);
          if (r.status === 'failed') patchClip(id, i, { status: 'failed', error: r.error });
          else if (r.status === 'done') {
            if (!r.url) throw err('任务完成了但没有返回视频地址', 424);
            const file = path.join(dir, `clip-${i + 1}-${Date.now()}.mp4`);
            await media.download(r.url, file);
            const info = await media.probe(file);
            patchClip(id, i, { status: 'done', file: path.relative(db.MEDIA_DIR, file), width: info?.width, height: info?.height, realDuration: info?.duration, hasAudio: !!info?.hasAudio, doneAt: db.now() });
          }
        } catch (e) {
          // 查询偶尔失败不算任务失败，连续 12 次才放弃（生成结果下载失败同样重试）
          const n = (errorsInARow.get(i) || 0) + 1;
          errorsInARow.set(i, n);
          if (n >= 12) patchClip(id, i, { status: 'failed', error: e.message });
        }
      }
      const after = jobs.get(id);
      if (!after) return;
      const finished = after.clips.every((x) => x.status === 'done' || x.status === 'failed');
      const doneCount = after.clips.filter((x) => x.status === 'done').length;
      jobs.update(id, { step: `已完成 ${doneCount}/${after.clips.length} 段` });
      if (finished) break;
      await sleep(POLL_MS);
    }
    await finish(id, dir);
  } catch (e) {
    console.error('[videogen]', e.message);
    failJob(e.message);
  } finally {
    active.delete(id);
  }
}

// 全部结束：保存每一段，能合并就合并成一条
async function finish(id, dir) {
  const job = jobs.get(id);
  const done = job.clips.map((x, i) => ({ ...x, i })).filter((x) => x.status === 'done');
  if (!done.length) return jobs.update(id, { status: 'error', error: job.clips.find((x) => x.error)?.error || '没有生成成功的片段', finishedAt: db.now() });
  const failed = job.clips.length - done.length;
  let outFile = path.join(db.MEDIA_DIR, done[0].file);
  if (job.mode === 'scenes' && done.length > 1) {
    jobs.update(id, { step: '合并成一条视频' });
    try {
      const size = job.ratio === '1:1' ? [720, 720] : job.ratio === '16:9' ? [1280, 720] : [720, 1280];
      const parts = [];
      for (const clip of done) {
        const part = path.join(dir, `norm-${clip.i + 1}.mp4`);
        await media.normalizeClip(path.join(db.MEDIA_DIR, clip.file), part, { width: size[0], height: size[1], duration: clip.target, hasAudio: clip.hasAudio });
        parts.push(part);
      }
      outFile = path.join(dir, `final-${Date.now()}.mp4`);
      await media.concat(parts, outFile);
      for (const part of parts) fs.rmSync(part, { force: true });
    } catch (e) {
      jobs.update(id, { warning: `片段都生成好了，但合并失败：${e.message}。可以单独下载每一段` });
      outFile = path.join(db.MEDIA_DIR, done[0].file);
    }
  }
  const info = await media.probe(outFile).catch(() => null);
  const item = media.register({ abs: outFile, kind: 'generated', title: job.title, mime: 'video/mp4', meta: { jobId: id, scriptId: job.scriptId, duration: info?.duration } });
  const clipMedia = job.mode === 'scenes' && done.length > 1
    ? done.map((clip) => ({ n: clip.i, id: media.register({ abs: path.join(db.MEDIA_DIR, clip.file), kind: 'clip', title: `${job.title} · 第 ${clip.scenes.join('、')} 镜`, mime: 'video/mp4', meta: { jobId: id } }).id }))
    : [];
  jobs.update(id, (j) => ({
    status: 'done',
    step: failed ? `完成，有 ${failed} 段失败` : '完成',
    mediaId: item.id,
    duration: info?.duration,
    clips: j.clips.map((x, k) => ({ ...x, mediaId: clipMedia.find((m) => m.n === k)?.id })),
    finishedAt: db.now(),
  }));
  db.activity.insert({ type: 'script', text: `生成视频：${job.title}` });
}

// 失败的片段重新生成
function retry(id) {
  const job = jobs.get(id);
  if (!job) throw err('任务不存在', 404);
  if (active.has(id)) throw err('任务正在运行', 409);
  if (!job.clips.some((x) => x.status === 'failed')) throw err('没有失败的片段');
  if (job.mediaId) media.remove(job.mediaId);
  for (const clip of job.clips) if (clip.mediaId) media.remove(clip.mediaId);
  jobs.update(id, (j) => ({ status: 'running', error: '', warning: '', mediaId: '', step: '重试失败的片段', clips: j.clips.map((x) => ({ ...x, mediaId: undefined, ...(x.status === 'failed' ? { status: 'pending', error: '', taskId: '' } : {}) })) }));
  run(id);
  return jobs.get(id);
}

function removeJob(id) {
  const job = jobs.get(id);
  if (!job) throw err('任务不存在', 404);
  if (job.mediaId) media.remove(job.mediaId);
  for (const clip of job.clips || []) if (clip.mediaId) media.remove(clip.mediaId);
  if (job.dir) fs.rmSync(path.join(db.MEDIA_DIR, job.dir), { recursive: true, force: true });
  return jobs.remove(id);
}

// 服务重启：还在跑的任务接着查（任务 ID 已经存下来了，不会重复提交、不会重复扣费）
function recover(userById) {
  for (const job of jobs.all()) {
    if (job.status !== 'running') continue;
    const user = userById(job.uid);
    if (!user) continue;
    ctx.run(user, () => run(job.id));
  }
}

const list = () => jobs.all();
const getJob = (id) => jobs.get(id);

module.exports = { opt, planFree, publicFreePlan, startFree, plan, publicPlan, startJob, retry, removeJob, recover, list, getJob, ADAPTERS, scenePrompt, wholePrompt, durationRule, snap };
