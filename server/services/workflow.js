// 工作流引擎：选品 → 脚本 → 分镜图片 → 图生视频 → 发布素材包
const db = require('../db');
const products = require('./products');
const scripts = require('./scripts');
const imageProvider = require('../providers/image');
const videoProvider = require('../providers/video');
const settings = require('../settings');

const STEPS = [
  { key: 'select', name: '智能选品', desc: '按评分模型选择商品并生成选品分析' },
  { key: 'script', name: 'AI 脚本', desc: '结合知识库生成分镜脚本' },
  { key: 'images', name: '分镜生图', desc: '为每个镜头文生图' },
  { key: 'video', name: '图生视频', desc: '图片生成视频片段并合成成片' },
  { key: 'publish', name: '发布素材包', desc: '标题、文案、话题标签与发布建议' },
];

const running = new Set();

function start(options = {}) {
  const run = db.runs.insert({
    name: options.name || '选品-图片-视频 一键工作流',
    options,
    status: 'running',
    steps: STEPS.filter((s) => !(s.key === 'video' && options.generateVideo === false)).map((s) => ({ ...s, status: 'pending' })),
    outputs: {},
  });
  running.add(run.id);
  execute(run.id)
    .catch((e) => {
      console.error('[workflow]', e);
      db.runs.update(run.id, { status: 'failed', error: e.message, finishedAt: db.now() });
    })
    .finally(() => running.delete(run.id));
  db.activity.insert({ type: 'workflow', text: `启动工作流：${run.name}` });
  return run;
}

async function step(runId, key, fn) {
  const setStep = (patch) =>
    db.runs.update(runId, (r) => ({ steps: r.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  setStep({ status: 'running', startedAt: db.now() });
  try {
    const out = await fn((progress) => setStep({ progress }));
    setStep({ status: 'done', endedAt: db.now(), summary: out?.summary });
    return out;
  } catch (e) {
    setStep({ status: 'failed', endedAt: db.now(), error: e.message });
    throw e;
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

async function execute(runId) {
  const run = db.runs.get(runId);
  const o = run.options;
  const out = (patch) => db.runs.update(runId, (r) => ({ outputs: { ...r.outputs, ...patch } }));

  // 1. 选品
  const product = await step(runId, 'select', async () => {
    let p = o.productId ? products.getScored(o.productId) : null;
    if (!p) {
      const candidates = products.list({ category: o.category || undefined }).filter((x) => !db.runs.all().some((r) => r.id !== runId && r.outputs?.productId === x.id));
      p = candidates[0] || products.list()[0];
    }
    if (!p.analysis) p.analysis = await products.analyze(p.id);
    out({ productId: p.id, productName: p.nameCn });
    return { ...p, summary: `${p.emoji} ${p.nameCn}（评分 ${p.score} · ${p.analysis.verdict}）` };
  });

  // 2. 脚本
  const script = await step(runId, 'script', async () => {
    const s = await scripts.generate({
      productId: product.id,
      style: o.style || 'pain',
      duration: o.duration || 20,
      language: o.language,
      extra: o.extra,
    });
    out({ scriptId: s.id });
    return { ...s, summary: `${s.scenes.length} 个镜头 · 钩子："${s.hook}"` };
  });

  // 3. 分镜图片
  const maxScenes = Math.max(1, Math.min(Number(o.imageCount) || script.scenes.length, script.scenes.length));
  const scenes = script.scenes.slice(0, maxScenes);
  const images = await step(runId, 'images', async (progress) => {
    let done = 0;
    const list = await pool(scenes, 2, async (sc) => {
      const prompt = `${sc.imagePrompt}${o.imageStyle ? `, ${o.imageStyle}` : ''}`;
      const r = await imageProvider.generate({ prompt, title: sc.caption, emoji: product.emoji, size: settings.get().image.size });
      const img = db.images.insert({ url: r.url, prompt, provider: r.provider, productId: product.id, runId, scriptId: script.id, scene: sc.n, title: `${product.nameCn} · 镜头${sc.n}` });
      progress(`${++done}/${scenes.length}`);
      return img;
    });
    out({ imageIds: list.map((x) => x.id) });
    return { list, summary: `生成 ${list.length} 张分镜图` };
  });

  // 4. 视频
  if (o.generateVideo !== false) {
    await step(runId, 'video', async (progress) => {
      const cfg = settings.get().video;
      let storyboard = scenes.map((sc, i) => ({
        image: images.list[i].url,
        caption: sc.caption,
        voiceover: sc.voiceover,
        duration: Number(sc.duration) || 4,
        motion: sc.motion || 'zoom-in',
      }));
      if (cfg.provider !== 'mock') {
        // 真实模型：逐镜头图生视频，再按分镜顺序拼接播放
        let done = 0;
        const clips = await pool(scenes, 2, async (sc, i) => {
          const { done: p } = videoProvider.generate({
            image: images.list[i].url,
            prompt: `${sc.visual}. ${sc.imagePrompt}. smooth ${sc.motion} camera motion`,
            duration: 5,
            title: `${product.nameCn} · 镜头${sc.n}`,
            productId: product.id,
            runId,
          });
          const rec = await p;
          progress(`${++done}/${scenes.length}`);
          return rec;
        });
        storyboard = storyboard.map((s, i) => ({ ...s, video: clips[i]?.status === 'succeeded' ? clips[i].url : undefined }));
      }
      const { record } = videoProvider.generate({
        title: `${product.nameCn}｜成片`,
        prompt: script.hook,
        scenes: storyboard,
        productId: product.id,
        runId,
        composite: true,
      });
      out({ videoId: record.id });
      return { summary: `成片 ${storyboard.reduce((a, s) => a + s.duration, 0)} 秒 · ${storyboard.length} 段` };
    });
  }

  // 5. 发布素材包
  await step(runId, 'publish', async () => {
    const kit = {
      title: script.title,
      caption: script.caption,
      hashtags: script.hashtags,
      cta: script.cta,
      bgm: script.bgm,
      bestTime: product.market === 'US' ? '美东时间 19:00-22:00（北京时间 07:00-10:00）' : product.market === 'UK' ? '英国时间 18:00-21:00（北京时间 01:00-04:00）' : '当地时间 12:00-13:00 / 20:00-22:00',
      checklist: ['挂载商品小黄车链接', '添加商用音乐（Commercial Music）', '检查字幕是否遮挡商品', '避免绝对化功效用语', '发布后 1 小时内回复评论'],
    };
    out({ publishKit: kit });
    return { summary: '素材包已就绪' };
  });

  db.runs.update(runId, { status: 'done', finishedAt: db.now() });
  db.activity.insert({ type: 'workflow', text: `工作流完成：${product.emoji} ${product.nameCn}` });
}

function detail(runId) {
  const r = db.runs.get(runId);
  if (!r) return null;
  const o = r.outputs || {};
  return {
    ...r,
    product: o.productId ? products.getScored(o.productId) : null,
    script: o.scriptId ? db.scripts.get(o.scriptId) : null,
    images: (o.imageIds || []).map((i) => db.images.get(i)).filter(Boolean),
    video: o.videoId ? db.videos.get(o.videoId) : null,
    clips: db.videos.find((v) => v.runId === runId && v.id !== o.videoId),
  };
}

// 服务重启时，标记中断的任务
function recover() {
  for (const r of db.runs.all())
    if (r.status === 'running' && !running.has(r.id)) db.runs.update(r.id, { status: 'failed', error: '服务重启，任务中断' });
  for (const v of db.videos.all())
    if (['queued', 'running'].includes(v.status)) db.videos.update(v.id, { status: 'failed', error: '服务重启，任务中断' });
}

module.exports = { start, detail, recover, STEPS };
