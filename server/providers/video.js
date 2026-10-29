// 图生视频适配层：火山方舟 Seedance / 通用异步任务接口（可适配可灵、Runway、海螺等）+ 离线本地合成
const settings = require('../settings');
const db = require('../db');
const { http, trimSlash } = require('./llm');
const { readLocalAsDataURL, saveRemote } = require('./image');

const pick = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function absoluteImage(url) {
  // 外部服务需要可访问的图片：本地图片转为 base64 data URL
  if (!url) return null;
  if (/^https?:/.test(url)) return url;
  return readLocalAsDataURL(url);
}

async function createTask(cfg, { image, prompt, duration, ratio }) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
  const img = absoluteImage(image);
  if (cfg.provider === 'ark') {
    const content = [{ type: 'text', text: `${prompt} --duration ${duration || 5} --ratio ${ratio || '9:16'}` }];
    if (img) content.push({ type: 'image_url', image_url: { url: img } });
    const data = await http(`${trimSlash(cfg.baseUrl)}/contents/generations/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, content }),
    });
    return data.id;
  }
  const data = await http(`${trimSlash(cfg.baseUrl)}${cfg.createPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, prompt, image: img, duration: duration || 5, aspect_ratio: ratio || '9:16' }),
  });
  return pick(data, cfg.idField || 'id');
}

async function queryTask(cfg, taskId) {
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.provider === 'ark') {
    const data = await http(`${trimSlash(cfg.baseUrl)}/contents/generations/tasks/${taskId}`, { headers });
    return { status: data.status, url: data.content?.video_url, error: data.error?.message };
  }
  const data = await http(`${trimSlash(cfg.baseUrl)}${cfg.queryPath.replace('{id}', taskId)}`, { headers });
  return { status: String(pick(data, cfg.statusField || 'status') || '').toLowerCase(), url: pick(data, cfg.urlField || 'video_url') };
}

const DONE = ['succeeded', 'success', 'completed', 'done', 'finished'];
const FAIL = ['failed', 'failure', 'error', 'cancelled', 'canceled', 'expired'];

/**
 * 创建视频记录并在后台执行，返回记录
 * scenes: 本地合成模式下的分镜（图片 + 字幕 + 时长 + 运镜）
 */
function generate({ image, prompt, duration = 5, ratio = '9:16', scenes, title, productId, runId, composite = false }) {
  const cfg = settings.get().video;
  const storyboard = scenes?.length
    ? scenes
    : [{ image, caption: prompt?.slice(0, 60) || '', duration, motion: 'zoom-in' }];
  const rec = db.videos.insert({
    title: title || prompt?.slice(0, 30) || '未命名视频',
    image,
    prompt,
    duration,
    ratio,
    productId,
    runId,
    provider: composite ? 'composite' : cfg.provider,
    status: composite ? 'succeeded' : 'queued',
    kind: composite ? 'storyboard' : undefined,
    storyboard,
  });
  // composite：多段分镜/片段的合成成片，由前端播放器按顺序渲染，无需调用模型
  if (composite) return { record: rec, done: Promise.resolve(rec) };
  const done = execute(rec.id, cfg).catch((e) => db.videos.update(rec.id, { status: 'failed', error: e.message }));
  return { record: rec, done };
}

async function execute(recId, cfg) {
  const rec = db.videos.get(recId);
  if (cfg.provider === 'mock') {
    // 离线模式：由前端 Canvas 实时渲染分镜（Ken Burns 运镜 + 字幕），可导出 WebM
    await sleep(600);
    db.videos.update(recId, { status: 'succeeded', kind: 'storyboard' });
    return db.videos.get(recId);
  }
  if (!cfg.apiKey) throw new Error('未配置视频模型 API Key');
  db.videos.update(recId, { status: 'running' });
  const taskId = await createTask(cfg, rec);
  if (!taskId) throw new Error('视频接口未返回任务 ID');
  db.videos.update(recId, { taskId });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const r = await queryTask(cfg, taskId);
    if (DONE.includes(r.status)) {
      if (!r.url) throw new Error('任务完成但未返回视频地址');
      let url = r.url;
      try {
        url = await saveRemote(r.url);
      } catch {}
      db.videos.update(recId, { status: 'succeeded', url, kind: 'file' });
      return db.videos.get(recId);
    }
    if (FAIL.includes(r.status)) throw new Error(r.error || `视频任务失败：${r.status}`);
  }
  throw new Error('视频生成超时');
}

module.exports = { generate };
