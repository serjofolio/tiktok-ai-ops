// AI 出片创作台的辅助功能：把一句话改写成合格的视频提示词、用图片模型出首帧、把改好的分镜存成脚本
// 生成视频本身在 videogen.js（startFree），这里不花视频的钱
const path = require('path');
const db = require('../db');
const llm = require('../providers/llm');
const media = require('../media');
const connectors = require('../connectors');
const craft = require('./promptcraft');
const imagegen = require('./imagegen');
const scripts = require('./scripts');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const ownImage = (id) => {
  const m = id ? media.records.get(id) : null;
  return m && /^image\//.test(m.mime) ? m : null;
};

// 改写提示词：用户可以写中文大白话，返回英文提示词（视频的写动作，首帧的写画面）
async function polish(body = {}) {
  const text = String(body.text || '').trim().slice(0, 2000);
  if (!text) throw err('先写一句想要的画面');
  const kind = body.kind === 'keyframe' ? 'keyframe' : 'motion';
  const seconds = Math.max(1, Math.min(30, Number(body.seconds) || 5));
  const rules = kind === 'keyframe' ? craft.KEYFRAME_RULES : craft.MOTION_RULES;
  const prompt = `把下面这段要求改写成给${kind === 'keyframe' ? '图片模型的首帧' : '视频模型的'}提示词（英文）。
${kind === 'motion' ? `这个镜头 ${seconds} 秒，${body.hasImage ? '已经有首帧图：只写怎么动，不要重复描述画面外观' : '没有首帧图：要写清楚主体、场景、光线，再写动作和镜头'}。` : ''}
${body.hasRefs ? '有商品参考图：商品写成 the product from image 1，要求和参考图一致。' : ''}
规则：
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

要求原文：${text}

只输出 JSON：{"prompt":"English prompt","note":"改了什么(中文，一句话)"}`;
  const r = await llm.completeJSON(prompt, { system: '你是 AI 视频提示词工程师，写 TikTok 带货短视频的画面。只输出 JSON。', temperature: 0.5, maxTokens: 1500, timeoutMs: 60000, noThinking: true });
  if (!r.prompt) throw err('模型没有返回提示词，请重试', 502);
  return { prompt: String(r.prompt).slice(0, 3000), note: String(r.note || '').slice(0, 200) };
}

// 出一张首帧：商品参考图在前，返回媒体记录（页面直接显示，生成视频时当首帧）
async function keyframe(body = {}) {
  const c = body.connectorId ? connectors.get(body.connectorId) : connectors.active('image')[0];
  if (!c || connectors.VENDORS[c.vendor]?.kind !== 'image') throw err('还没有接入图片模型：到「接入配置」点「添加模型」，启用一个图片模型');
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw err('先写这个镜头的画面');
  media.assertQuota();
  const refs = (body.refAssetIds || []).map(ownImage).filter(Boolean).slice(0, 6).map((m) => `data:${m.mime};base64,${require('fs').readFileSync(media.absPath(m)).toString('base64')}`);
  const model = connectors.modelsOf(c).find((x) => x.id === body.model)?.id || c.options?.model || '';
  const full = /no text/i.test(prompt) ? prompt : `${prompt} ${craft.KEYFRAME_GUARD}`;
  const dir = media.newDir('keyframe');
  const out = await imagegen.generateAny(c, { prompt: full, refs, model }, path.join(dir, `kf-${Date.now()}`));
  const m = connectors.modelsOf(connectors.get(out.connectorId) || c).find((x) => x.id === out.model);
  return { ...media.register({ abs: out.abs, kind: 'keyframe', title: prompt.slice(0, 60), mime: out.mime }), price: m && m.price !== '' ? m.price : null };
}

// 存成脚本：创作台改好的分镜可以存回脚本库，下次再改或者批量用
function saveScript(body = {}, id) {
  const scenes = (Array.isArray(body.shots) ? body.shots : []).slice(0, 30).map((x, i) => ({
    n: i + 1, part: String(x.part || '').slice(0, 20), duration: Math.max(1, Math.min(30, Math.round(Number(x.duration) || 5))),
    visual: String(x.visual || '').slice(0, 600), voiceover: String(x.voiceover || '').slice(0, 400), caption: String(x.caption || '').slice(0, 120),
    videoPrompt: String(x.prompt || '').slice(0, 3000), productVisible: !!x.productVisible,
  }));
  if (!scenes.length) throw err('至少要有一个镜头');
  const title = String(body.title || '').trim().slice(0, 80) || '我的分镜';
  const patch = { title, scenes, duration: scenes.reduce((a, x) => a + x.duration, 0), language: body.language || 'English', edited: true };
  if (id) {
    const old = db.scripts.get(id);
    if (!old) throw err('脚本不存在', 404);
    // 改过之后重新自检（寒暄开头、违禁词、口播念不完等）
    return db.scripts.update(id, { ...patch, check: scripts.lint({ ...old, ...patch }, { duration: patch.duration }) });
  }
  const doc = { ...patch, productId: '', productName: String(body.productName || '').slice(0, 120), hook: scenes[0].voiceover || '', style: '自己写的分镜' };
  return db.scripts.insert({ ...doc, check: scripts.lint(doc, { duration: patch.duration }) });
}

module.exports = { polish, keyframe, saveScript };
