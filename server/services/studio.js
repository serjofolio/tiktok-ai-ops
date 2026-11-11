// 批量出片：上传商品素材（图片或视频，也可以不传）→ 一次做 N 条风格不同的短视频
// 省钱的关键是「先出图、后出片」：关键帧一张几毛钱，视频一秒就要几毛到一块。先给每条出 1–3 张关键帧，
// 看图模型对照真实商品打分，人确认后，只把合格的关键帧做成视频；成片再抽帧复检一次
// 每条视频的钩子和场景由程序分配，保证一批里彼此不同（官方建议每组广告放 3–5 条有明显差异的素材）
const fs = require('fs');
const path = require('path');
const db = require('../db');
const ctx = require('../ctx');
const media = require('../media');
const llm = require('../providers/llm');
const settings = require('../settings');
const connectors = require('../connectors');
const products = require('./products');
const playbook = require('./playbook');
const craft = require('./promptcraft');
const imagegen = require('./imagegen');
const videogen = require('./videogen');
const understand = require('./understand');
const viral = require('./viral');

const batches = db.collection('studio_batches');
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = Number(process.env.VIDEO_POLL_MS) || 10000;
const CLIP_TIMEOUT = 40 * 60 * 1000;
const IMAGE_CONCURRENCY = 3;
const VIDEO_CONCURRENCY = 3;
const MAX_COUNT = 20;
const PASS_FIDELITY = 75;

// ---------- 场景和钩子 ----------
// 场景只选 AI 能做好、又不需要「证明效果」的：测评、前后对比、回复真实评论这类必须实拍，不放进来
const SCENES = [
  { id: 'hand', name: '手持特写', prompt: 'a hand holding the product close to the camera, the product fills a third of the frame, shallow depth of field', motion: 'the hand slowly rotates the product toward the camera so light moves across it, handheld slight sway' },
  { id: 'wear', name: '上身 / 使用中', prompt: 'an adult using or wearing the product in daily life, close-up on the product in use', motion: 'the person naturally adjusts the product and glances at it, slow push-in' },
  { id: 'unbox', name: '桌面开箱', prompt: 'hands opening a simple package on a wooden desk, the product just revealed and clearly visible', motion: 'the hands lift the product out of the package and bring it toward the camera, static camera' },
  { id: 'life', name: '生活场景', prompt: 'the product in a real, tidy everyday setting where it is normally used, a person reaching for it', motion: 'the person picks the product up and starts using it, handheld slight sway' },
  { id: 'macro', name: '质感特写', prompt: 'extreme close-up of the product surface and material, crisp detail, light reflections', motion: 'very slow orbit around the product, soft light glinting on the surface' },
  { id: 'mirror', name: '镜前 POV', prompt: 'point-of-view mirror shot, a person holding a phone and showing the product on themselves', motion: 'the person turns slightly to show the product from another angle, handheld' },
  { id: 'gift', name: '送礼瞬间', prompt: 'two hands handing over the product as a gift, the receiver\'s hands about to take it, warm light', motion: 'the product is passed from one hand to the other, slow push-in' },
  { id: 'scale', name: '和日常物品同框', prompt: 'the product next to a common everyday object (a phone, a coffee cup or a coin) so its real size is obvious', motion: 'a hand places the product next to the object, static camera' },
  { id: 'problem', name: '痛点场景', prompt: 'the everyday annoying situation the product solves, the product entering the frame in a hand', motion: 'the hand brings the product into the situation, quick handheld move in the first second' },
];
// 钩子：去掉需要真实经历或真实评论的（我本来不信、回复评论）、需要多件商品的（清单）、要当场证明的（当场测试）、纯悬念
const HOOK_IDS = ['pain_callout', 'result_first', 'price_shock', 'pov', 'howto', 'warning', 'others_react', 'confession'];

// 视频格式：参考成品网站常见的几类带货视频（UGC 口播、开箱、上身试戴、产品展示、痛点、送礼），每类只用适合它的场景
const FORMATS = {
  mix: { name: '自动混合', scenes: SCENES.map((x) => x.id), desc: '各种场景轮流用，适合第一次测款' },
  ugc: { name: 'UGC 口播测评', scenes: ['wear', 'hand', 'mirror', 'life'], desc: '真人拿着或戴着商品对镜头说话，最像达人视频', talk: true },
  unbox: { name: '开箱', scenes: ['unbox', 'hand', 'macro'], desc: '拆包装、拿出来、看细节' },
  tryon: { name: '上身试戴', scenes: ['wear', 'mirror', 'scale'], desc: '首饰、服饰、包：戴上身看效果和大小' },
  showcase: { name: '产品展示（无人声）', scenes: ['macro', 'hand', 'scale', 'unbox'], desc: '质感特写 + 手部动作，配音乐，不需要口播' },
  pain: { name: '痛点解决', scenes: ['problem', 'life', 'hand'], desc: '先拍烦恼的场景，商品入画解决' },
  gift: { name: '送礼', scenes: ['gift', 'unbox', 'wear'], desc: '节日、生日送礼的瞬间' },
};

function combos(n, format = 'mix', firstHook) {
  const hooks = HOOK_IDS.map(playbook.hook).filter(Boolean);
  if (firstHook && playbook.hook(firstHook)) hooks.unshift(...hooks.splice(Math.max(0, hooks.findIndex((h) => h.id === firstHook)), 1));
  const scenes = (FORMATS[format] || FORMATS.mix).scenes.map((id) => SCENES.find((x) => x.id === id));
  return Array.from({ length: n }, (_, i) => ({ hook: hooks[i % hooks.length], scene: scenes[(i + Math.floor(i / hooks.length)) % scenes.length] }));
}

// ---------- 价格：连接器里「模型映射」填的单价 ----------
function priceOf(c, modelId, kind) {
  const m = connectors.modelsOf(c).find((x) => x.id === modelId);
  const price = m && m.price !== '' && m.price != null ? Number(m.price) : null;
  return { price, unit: m?.unit || (kind === 'image' ? '张' : '秒') };
}
const yuan = (x) => Math.round(x * 100) / 100;
function videoCost(p, seconds) {
  if (p.price == null) return null;
  return p.unit === '条' ? p.price : p.price * seconds;
}

function connectorOf(id, kind) {
  const c = id ? connectors.get(id) : connectors.active(kind)[0];
  if (!c || connectors.VENDORS[c.vendor]?.kind !== kind) return null;
  return c;
}
function modelOf(c, model) {
  const list = connectors.modelsOf(c);
  return list.find((m) => m.id === model)?.id || c.options?.model || list[0]?.id || '';
}

function durationFor(c, want) {
  const rule = videogen.durationRule(c);
  return videogen.snap(rule, Math.max(1, Number(want) || 5));
}

// 估算：先出图再出片 vs 直接出片。直接出片的合格率是假设，用户自己按经验改
function estimate(input = {}) {
  const count = Math.min(MAX_COUNT, Math.max(1, Number(input.count) || 10));
  const candidates = Math.min(3, Math.max(1, Number(input.candidates) || 2));
  const passRate = Math.min(1, Math.max(0.1, Number(input.passRate) || 0.5));
  const vc = connectorOf(input.videoConnectorId, 'video');
  if (!vc) throw err('还没有接入视频模型：到「接入配置 → 视频模型」添加，你的中转站也可以');
  const vModel = modelOf(vc, input.videoModel);
  const seconds = durationFor(connectors.withModel(vc, vModel), input.duration);
  const vp = priceOf(vc, vModel, 'video');
  const ic = input.direct ? null : connectorOf(input.imageConnectorId, 'image');
  const iModel = ic ? modelOf(ic, input.imageModel) : '';
  const ip = ic ? priceOf(ic, iModel, 'image') : { price: null };
  const perVideo = videoCost(vp, seconds);
  const images = ic ? count * candidates : 0;
  const imageYuan = ic && ip.price != null ? ip.price * images : ic ? null : 0;
  const videoYuan = perVideo == null ? null : perVideo * count;
  const missing = [perVideo == null && `${vc.name} 的「${vModel}」`, ic && ip.price == null && `${ic.name} 的「${iModel}」`].filter(Boolean);
  return {
    count, candidates, seconds, passRate, mode: ic ? 'keyframe' : 'direct',
    video: { connector: vc.name, model: vModel, price: vp.price, unit: vp.unit, perVideo: perVideo == null ? null : yuan(perVideo), yuan: videoYuan == null ? null : yuan(videoYuan) },
    image: ic ? { connector: ic.name, model: iModel, price: ip.price, images, yuan: imageYuan == null ? null : yuan(imageYuan) } : null,
    total: imageYuan == null || videoYuan == null ? null : yuan(imageYuan + videoYuan),
    // 不先筛图：要拿到同样多条合格视频，平均要生成 count / passRate 条，不合格的也全价计费
    directTotal: perVideo == null ? null : yuan((count / passRate) * perVideo),
    missing,
  };
}

// ---------- 商品和素材 ----------
function productInfo(body) {
  if (body.productId) {
    const p = products.get(body.productId);
    if (!p) throw err('商品不存在', 404);
    const m = p.evaluation?.metrics || {};
    return { id: p.id, name: p.name, image: p.image || '', jewelry: m.group === '首饰', facts: { 名称: p.name, 类目: p.category, 成交均价: m.asp != null ? `${m.currency || ''}${m.asp}` : '', 卖点: body.sellingPoints || '', 痛点: (p.pains || []).slice(0, 4).map((x) => x.pain || x.text || x).join('；') } };
  }
  const name = String(body.productName || '').trim();
  if (!name) throw err('请选择选品库里的商品，或者填写商品名称');
  return { id: '', name, image: '', jewelry: /earring|necklace|bracelet|ring\b|anklet|jewel|首饰|耳环|项链|手链|戒指|脚链/i.test(`${name} ${body.sellingPoints || ''}`), facts: { 名称: name, 卖点: String(body.sellingPoints || '').slice(0, 1500) } };
}

// 上传的素材：图片统一转成 JPG；视频抽 3 帧当参考图（商品镜头最好是实拍视频里截的）
async function addAssets(files) {
  const out = [];
  const dir = media.newDir('studio-assets');
  for (const f of files.slice(0, 12)) {
    const head = fs.readFileSync(f.path).subarray(0, 16);
    const name = String(f.originalname || 'asset').slice(0, 80);
    media.assertQuota(f.size);
    if (media.imageMime(head)) {
      const abs = path.join(dir, `img-${out.length + 1}-${Date.now()}.jpg`);
      await media.toJpeg(f.path, abs);
      out.push(media.register({ abs, kind: 'studio-asset', title: name, mime: 'image/jpeg', meta: { from: 'image' } }));
    } else if (media.sniff(f.path)) {
      const info = await media.probe(f.path);
      if (!info) throw err(`「${name}」读不出来，换一个视频试试`);
      const n = Math.min(3, Math.max(1, Math.floor(info.duration)));
      for (let i = 0; i < n; i++) {
        const abs = path.join(dir, `frame-${out.length + 1}-${Date.now()}.jpg`);
        await media.frameAt(f.path, (info.duration * (i + 0.5)) / n, abs, { width: 1080 });
        out.push(media.register({ abs, kind: 'studio-asset', title: `${name} 第 ${i + 1} 帧`, mime: 'image/jpeg', meta: { from: 'video' } }));
      }
    } else throw err(`「${name}」不是支持的图片或视频（图片 JPG / PNG / WebP，视频 MP4 / MOV / WebM）`);
  }
  return out.map((m) => ({ id: m.id, title: m.title, from: m.from }));
}

// 选品库的商品主图：下载下来当参考图
async function productAsset(url) {
  const { buf } = await imagegen.fetchImage(url);
  const dir = media.newDir('studio-assets');
  const raw = path.join(dir, 'product-raw');
  fs.writeFileSync(raw, buf);
  const abs = path.join(dir, 'product.jpg');
  await media.toJpeg(raw, abs);
  fs.rmSync(raw, { force: true });
  return media.register({ abs, kind: 'studio-asset', title: '商品主图', mime: 'image/jpeg', meta: { from: 'product' } });
}

const filesOf = (ids) => (ids || []).map((id) => media.records.get(id)).filter(Boolean).map((m) => media.absPath(m));
const refFiles = (batch) => filesOf(batch.refs); // 只有商品图：质检对照用
// 发给图片模型的参考图：商品图在前（image 1 起），人物图在后，保证同一批视频是同一个人
const allRefs = (batch) => [...filesOf(batch.refs).slice(0, 4), ...filesOf(batch.personRefs).slice(0, 2)];
const personNo = (batch) => Math.min(4, (batch.refs || []).length) + 1;
const dataUri = (file, mime = 'image/jpeg') => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

// ---------- 写每条的画面和文案 ----------
const multiShot = (batch) => batch.seconds >= 8;
function fallbackBrief(batch, { hook, scene }, n) {
  const p = batch.product.name;
  const who = batch.personRefs?.length ? ` The person is the same person as in image ${personNo(batch)}.` : '';
  const more = multiShot(batch) ? ' Then cut to a close-up of the product in use, hands moving it slowly. Then cut to the person holding the product toward the camera.' : '';
  return {
    n, hookId: hook.id, hookName: hook.name, sceneId: scene.id, sceneName: scene.name,
    angle: `${hook.name} × ${scene.name}`,
    keyframe: `Vertical 9:16 photo, the first frame of a TikTok product video, shot on a smartphone, candid UGC look. ${scene.prompt.replace('the product', 'the product from image 1')}.${who} Real everyday location, natural window light, clean background, top fifth of the frame kept calm.`,
    motion: `${scene.motion}. Clear movement starts in the first second.${more}`,
    caption: '', voiceover: '',
    why: `${hook.name}：${hook.formula}`,
    product: p,
  };
}

async function writeBriefs(batch) {
  const list = combos(batch.count, batch.format, batch.viral?.hookType);
  if (llm.isMock()) return list.map((x, i) => fallbackBrief(batch, x, i + 1));
  const lang = batch.language;
  const prompt = `为下面这个 TikTok Shop 商品批量策划 ${batch.count} 条 AI 生成的竖屏短视频，每条 ${batch.seconds} 秒、一个连续镜头。这批视频要拿去测试哪种开头更能卖，所以每条的钩子和场景已经分配好，必须照用，彼此要明显不同。

${playbook.brief({ jewelry: batch.product.jewelry })}

${craft.brief()}

商品信息：${JSON.stringify(batch.product.facts)}${craft.withGlossary(JSON.stringify(batch.product.facts))}
参考图：${batch.refs.length ? `有 ${Math.min(4, batch.refs.length)} 张真实商品图，提示词里统一称为 the product from image 1` : '没有商品图：关键帧只能凭文字画商品，画面以人和场景为主，商品不要特写'}
${batch.personRefs?.length ? `人物：这批视频用同一个人，提示词里写 the same person as in image ${personNo(batch)}，不要再描述长相\n` : ''}视频格式：${(FORMATS[batch.format] || FORMATS.mix).name}（${(FORMATS[batch.format] || FORMATS.mix).desc}）
${multiShot(batch) ? `镜头：每条 ${batch.seconds} 秒，一次生成 2–3 个镜头。motion 写成时间线，例如 "Shot 1 (0-3s): ... Cut to Shot 2 (3-7s): ... Cut to Shot 3: ..."，第一个镜头从关键帧画面开始，每个镜头只有一个动作，最后一个镜头商品清楚地朝向镜头\n` : ''}${batch.viral ? `学习这条爆款的结构和节奏（只学手法，不照抄台词、画面和品牌）：${JSON.stringify(batch.viral)}\n` : ''}
屏幕字和口播语言：${lang}
${batch.note ? `运营补充要求：${batch.note}\n` : ''}
分配：
${list.map((x, i) => `${i + 1}. 钩子「${x.hook.name}」（${x.hook.formula}；第一帧：${x.hook.frame}；注意：${x.hook.trap}）；场景「${x.scene.name}」（${x.scene.prompt}）`).join('\n')}

只输出 JSON：{"briefs":[{"n":1,"angle":"切入角度(中文，一句话)","keyframe":"关键帧提示词(English)","motion":"动作提示词(English)","caption":"屏幕字(${lang})","voiceover":"口播(${lang})","why":"为什么能让目标买家停下来(中文)"}]}`;
  const r = await llm.completeJSON(prompt, { system: '你是 TikTok 带货短视频的创意总监和 AI 视频提示词工程师。只写真实、合规、AI 能拍好的画面。只输出 JSON。', temperature: 0.8, maxTokens: 8000, timeoutMs: 150000, noThinking: true });
  const got = Array.isArray(r.briefs) ? r.briefs : [];
  return list.map((x, i) => {
    const b = got.find((g) => Number(g.n) === i + 1) || got[i];
    const base = fallbackBrief(batch, x, i + 1);
    if (!b?.keyframe || !b?.motion) return base;
    const s = (v, max) => String(v || '').trim().slice(0, max);
    return { ...base, angle: s(b.angle, 120) || base.angle, keyframe: s(b.keyframe, 1500), motion: s(b.motion, 800), caption: s(b.caption, 120), voiceover: s(b.voiceover, 400), why: s(b.why, 200) || base.why };
  });
}

// 发给模型的完整提示词：程序在最后补上保护语
const keyframePrompt = (b, note) => [b.keyframe, note ? `Change for this version: ${note}` : '', craft.KEYFRAME_GUARD].filter(Boolean).join(' ');
const motionPrompt = (b, batch) => [b.motion, batch.audio && b.voiceover ? `The person says in ${batch.language}: "${b.voiceover}".` : '', craft.MOTION_GUARD].filter(Boolean).join(' ');

// ---------- 质检：看图模型对照真实商品打分 ----------
async function vision() {
  const cfg = understand.visionCfg();
  if (!cfg) return { cfg: null, reason: '没有能看图的模型（接入配置 → 看画面），跳过质检' };
  try {
    if (await understand.canSee(cfg)) return { cfg };
    return { cfg: null, reason: `「${cfg.model}」看不到图片，跳过质检` };
  } catch (e) {
    return { cfg: null, reason: `看图模型连不上：${e.message}` };
  }
}

async function qcImages(batch, files, kind, dir) {
  const v = await vision();
  if (!v.cfg) return { skipped: true, reason: v.reason };
  const refs = refFiles(batch).slice(0, 2);
  const sheet = path.join(dir, `qc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`);
  await media.sideBySide([...refs, ...files], sheet);
  const head = refs.length ? `左边 ${refs.length} 张是真实商品照片，` : '没有真实商品照片，';
  const what = kind === 'video' ? `右边 ${files.length} 张是同一条 AI 视频的开头、中间、结尾` : '最右边 1 张是 AI 生成的视频第一帧';
  const prompt = `${head}${what}。商品：${batch.product.name}。请检查，只输出 JSON：
{"sameProduct":0-100（${refs.length ? '生成画面里的商品和真实商品是不是同一件：外形、颜色、材质、比例、数量' : '没有参考图时填 null'}），"stopPower":0-100（${kind === 'video' ? '整条视频里商品是否一直清楚、动作是否自然' : '作为短视频第一帧能不能让人停下：商品清楚、有人或手在互动、主体突出、不杂乱'}），"problems":["发现的问题(中文)，如 商品变形 / 颜色不对 / 多了一件商品 / 手指数量不对 / 出现乱码文字 / 画面模糊"],"verdict":"pass 或 fail"}`;
  try {
    const r = await understand.askImage(v.cfg, prompt, sheet, { maxTokens: 800 });
    const same = r.sameProduct == null || r.sameProduct === 'null' ? null : Math.max(0, Math.min(100, Number(r.sameProduct) || 0));
    const stop = Math.max(0, Math.min(100, Number(r.stopPower) || 0));
    const problems = (Array.isArray(r.problems) ? r.problems : []).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 5);
    const pass = String(r.verdict).toLowerCase() !== 'fail' && (same == null || same >= PASS_FIDELITY);
    return { sameProduct: same, stopPower: stop, score: Math.round(same == null ? stop : same * 0.6 + stop * 0.4), problems, pass };
  } catch (e) {
    return { skipped: true, reason: `质检失败：${e.message.slice(0, 120)}` };
  } finally {
    fs.rmSync(sheet, { force: true });
  }
}

// ---------- 创建和准备（写画面 → 出关键帧 → 质检） ----------
async function create(body = {}) {
  const est = estimate(body);
  const product = productInfo(body);
  media.assertQuota();
  const ownAssets = (ids) => (ids || []).map((id) => media.records.get(id)).filter((m) => m && m.kind === 'studio-asset');
  const own = ownAssets(body.assetIds);
  const personRefs = ownAssets(body.personAssetIds).map((m) => m.id).slice(0, 2);
  let viralRef = null;
  if (body.viralId) {
    const v = viral.get(body.viralId);
    const a = v?.analysis;
    if (!a) throw err('这条爆款还没有拆解完');
    viralRef = { id: v.id, title: v.title, hookType: a.hook?.type, hook: a.hook?.typeName, firstLine: a.hook?.spokenLine, formula: a.structure?.formula, pacing: a.structure?.pacing, takeaways: a.takeaways, template: a.reusable?.template, mustKeep: a.reusable?.mustKeep, doNotCopy: a.doNotCopy };
  }
  let refs = own.map((m) => m.id);
  if (!refs.length && product.image && body.useProductImage !== false) {
    try {
      refs = [(await productAsset(product.image)).id];
    } catch {
      // 主图下载不到就当没有图：照样能做，只是商品不做特写
    }
  }
  const vc = connectorOf(body.videoConnectorId, 'video');
  const ic = est.mode === 'keyframe' ? connectorOf(body.imageConnectorId, 'image') : null;
  const budget = Number(body.budget) > 0 ? Number(body.budget) : null;
  if (budget != null && est.total != null && est.total > budget) throw err(`预计花费 ¥${est.total}，超过预算 ¥${budget}：少做几条、每条少出一张关键帧，或者换便宜的模型`);
  const batch = batches.insert({
    title: `${product.name} · ${est.count} 条`, status: 'preparing', step: '写画面和文案',
    product, refs: refs.slice(0, 6), personRefs, format: FORMATS[body.format] ? body.format : 'mix', viral: viralRef, count: est.count, candidates: est.candidates, seconds: est.seconds, ratio: '9:16', audio: !!body.audio,
    language: body.language || settings.get().store?.language || 'English', note: String(body.note || '').slice(0, 500), budget,
    mode: est.mode, imageConnectorId: ic?.id || '', imageModel: est.image?.model || '', videoConnectorId: vc.id, videoModel: est.video.model,
    estimate: est, spent: { images: 0, imageYuan: 0, videos: 0, videoYuan: 0 }, briefs: [],
  });
  prepare(batch.id);
  return batch;
}

const running = new Set();
async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

function patchBrief(id, n, patch) {
  return batches.update(id, (b) => ({ briefs: b.briefs.map((x) => (x.n === n ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)) }));
}
function addSpent(id, d) {
  batches.update(id, (b) => ({ spent: { images: b.spent.images + (d.images || 0), imageYuan: yuan(b.spent.imageYuan + (d.imageYuan || 0)), videos: b.spent.videos + (d.videos || 0), videoYuan: yuan(b.spent.videoYuan + (d.videoYuan || 0)) } }));
}

// 每条挑分最高、通过质检的那张；都没通过就不勾选，留给人看
function autoPick(brief) {
  const ok = (brief.candidates || []).map((c, i) => ({ c, i })).filter((x) => x.c.status === 'done');
  if (!ok.length) return { pick: null, approved: false };
  const scored = ok.filter((x) => !x.c.qc?.skipped);
  if (!scored.length) return { pick: ok[0].i, approved: true };
  const best = scored.sort((a, b) => (b.c.qc.score || 0) - (a.c.qc.score || 0))[0];
  return { pick: best.i, approved: !!best.c.qc.pass };
}

async function keyframe(batchId, n, { note } = {}) {
  const batch = batches.get(batchId);
  const brief = batch.briefs.find((x) => x.n === n);
  const c = connectors.get(batch.imageConnectorId);
  if (!c) throw err('这批用的图片模型连接已被删除');
  const dir = path.join(db.MEDIA_DIR, batch.dir);
  const refs = allRefs(batch).map((f) => dataUri(f));
  const price = priceOf(c, batch.imageModel, 'image').price;
  const idx = brief.candidates.length;
  patchBrief(batchId, n, (x) => ({ candidates: [...x.candidates, { status: 'running', note: note || '' }] }));
  const set = (patch) => patchBrief(batchId, n, (x) => ({ candidates: x.candidates.map((cd, i) => (i === idx ? { ...cd, ...patch } : cd)) }));
  try {
    const out = await imagegen.generateAny(c, { prompt: keyframePrompt(brief, note), refs, model: batch.imageModel }, path.join(dir, `kf-${n}-${idx + 1}-${Date.now()}`));
    addSpent(batchId, { images: 1, imageYuan: price || 0 });
    const m = media.register({ abs: out.abs, kind: 'keyframe', title: `${batch.product.name} 第 ${n} 条 关键帧 ${idx + 1}`, mime: out.mime, meta: { batchId } });
    set({ status: 'checking', mediaId: m.id });
    const qc = await qcImages(batches.get(batchId), [out.abs], 'image', dir);
    set({ status: 'done', qc });
  } catch (e) {
    set({ status: 'failed', error: e.message.slice(0, 300) });
  }
}

async function prepare(id) {
  if (running.has(id)) return;
  running.add(id);
  try {
    let batch = batches.get(id);
    if (!batch.dir) batch = batches.update(id, { dir: path.relative(db.MEDIA_DIR, media.newDir('studio')) });
    if (!batch.briefs.length) {
      const briefs = await writeBriefs(batch);
      batch = batches.update(id, { briefs: briefs.map((b) => ({ ...b, candidates: [], pick: null, approved: batch.mode === 'direct', video: null })) });
    }
    if (batch.mode === 'keyframe') {
      batches.update(id, { step: '出关键帧并质检' });
      const jobs = [];
      for (const b of batch.briefs) {
        // 服务重启时：生成到一半的作废重来，已经好的不重复花钱
        const live = (b.candidates || []).filter((c) => c.status === 'done' || c.status === 'failed');
        if (live.length !== (b.candidates || []).length) patchBrief(id, b.n, { candidates: live });
        for (let k = live.length; k < batch.candidates; k++) jobs.push(b.n);
      }
      await pool(jobs, IMAGE_CONCURRENCY, (n) => keyframe(id, n));
      for (const b of batches.get(id).briefs) if (b.pick == null) patchBrief(id, b.n, autoPick(b));
    }
    const after = batches.get(id);
    const passed = after.briefs.filter((b) => b.approved).length;
    batches.update(id, { status: 'review', step: after.mode === 'keyframe' ? `关键帧好了：${passed}/${after.count} 条通过质检，确认后再生成视频` : '画面和文案写好了，确认后生成视频' });
  } catch (e) {
    console.error('[studio]', e.message);
    batches.update(id, { status: 'error', error: e.message.slice(0, 300) });
  } finally {
    running.delete(id);
  }
}

// 给某一条再出一张（可以写一句修改意见）
async function regen(id, n, { note } = {}) {
  const batch = batches.get(id);
  if (!batch) throw err('批次不存在', 404);
  if (batch.mode !== 'keyframe') throw err('这批没有用图片模型');
  if (!['review', 'done'].includes(batch.status)) throw err('等这一步做完再重出', 409);
  const b = batch.briefs.find((x) => x.n === Number(n));
  if (!b) throw err('没有这一条', 404);
  if (b.candidates.length >= 8) throw err('这一条已经出了 8 张，换个思路改改文字再试');
  await keyframe(id, b.n, { note: String(note || '').slice(0, 200) });
  const fresh = batches.get(id).briefs.find((x) => x.n === b.n);
  const last = fresh.candidates.length - 1;
  if (fresh.candidates[last].status === 'done') patchBrief(id, b.n, { pick: last, approved: fresh.candidates[last].qc?.pass !== false });
  return batches.get(id);
}

// 人工修改：选哪张、要不要做、文字
function updateBrief(id, n, body = {}) {
  const batch = batches.get(id);
  if (!batch) throw err('批次不存在', 404);
  const b = batch.briefs.find((x) => x.n === Number(n));
  if (!b) throw err('没有这一条', 404);
  const patch = {};
  if (body.pick != null) {
    const i = Number(body.pick);
    if (b.candidates[i]?.status !== 'done') throw err('这张关键帧不可用');
    patch.pick = i;
  }
  if (body.approved != null) patch.approved = !!body.approved;
  for (const k of ['caption', 'voiceover', 'motion', 'keyframe']) if (typeof body[k] === 'string') patch[k] = body[k].slice(0, k === 'keyframe' ? 1500 : 800);
  return patchBrief(id, b.n, patch);
}

// ---------- 生成视频 ----------
function renderPlan(batch) {
  const c = connectors.get(batch.videoConnectorId);
  if (!c) throw err('这批用的视频模型连接已被删除');
  const todo = batch.briefs.filter((b) => b.approved && (batch.mode === 'direct' || b.pick != null) && (!b.video || b.video.status === 'failed'));
  const vp = priceOf(c, batch.videoModel, 'video');
  const per = videoCost(vp, batch.seconds);
  return { c, todo, per, yuan: per == null ? null : yuan(per * todo.length) };
}

function render(id) {
  const batch = batches.get(id);
  if (!batch) throw err('批次不存在', 404);
  if (running.has(id)) throw err('这批还在处理', 409);
  if (!['review', 'done'].includes(batch.status)) throw err('关键帧还没准备好', 409);
  const p = renderPlan(batch);
  if (!p.todo.length) throw err('没有勾选要生成的视频');
  media.assertQuota();
  const spent = batch.spent.imageYuan + batch.spent.videoYuan;
  if (batch.budget != null && p.yuan != null && spent + p.yuan > batch.budget) throw err(`这次要花约 ¥${p.yuan}，加上已经花的 ¥${yuan(spent)} 超过预算 ¥${batch.budget}：少勾几条再生成`);
  for (const b of p.todo) patchBrief(id, b.n, { video: { status: 'pending' } });
  batches.update(id, { status: 'rendering', step: `生成视频 0/${p.todo.length}` });
  runRender(id);
  return batches.get(id);
}

async function runRender(id) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const batch = batches.get(id);
    const conn = connectors.get(batch.videoConnectorId);
    if (!conn) throw err('这批用的视频模型连接已被删除');
    const c = connectors.withModel(conn, batch.videoModel);
    const adapter = videogen.ADAPTERS[c.vendor];
    const dir = path.join(db.MEDIA_DIR, batch.dir);
    const per = videoCost(priceOf(c, batch.videoModel, 'video'), batch.seconds) || 0;
    const refs = batch.mode === 'direct' ? allRefs(batch).map((f) => dataUri(f)) : [];
    const errorsInARow = new Map();
    const set = (n, patch) => patchBrief(id, n, (x) => ({ video: { ...x.video, ...patch } }));
    let holdUntil = 0; // 模型那边繁忙：这之前不提交新的，免得几条一起撞
    for (;;) {
      const cur = batches.get(id);
      if (!cur) return;
      const mine = cur.briefs.filter((b) => b.video);
      let slots = VIDEO_CONCURRENCY - mine.filter((b) => b.video.status === 'running').length;
      for (const b of mine) {
        if (b.video.status !== 'pending' || slots <= 0) continue;
        if (Date.now() < holdUntil || (b.video.retryAt && Date.now() < Date.parse(b.video.retryAt))) continue;
        slots--;
        try {
          const kf = b.pick != null ? media.records.get(b.candidates[b.pick]?.mediaId) : null;
          const image = kf ? dataUri(media.absPath(kf), kf.mime) : '';
          const taskId = await adapter.submit(c, { prompt: motionPrompt(b, cur), duration: cur.seconds, ratio: cur.ratio, audio: cur.audio, image, refs: image ? [] : refs });
          set(b.n, { status: 'running', taskId, submittedAt: db.now(), busy: 0, retryAt: '', error: '' });
        } catch (e) {
          // 503「上游繁忙」这类临时错误：等一会儿再提交同一条，不算失败
          const k = (b.video.busy || 0) + 1;
          if (videogen.busy(e) && k <= videogen.BUSY_TRIES) {
            const wait = Math.min(videogen.BUSY_MS * 2 ** (k - 1), 5 * 60 * 1000);
            holdUntil = Date.now() + wait;
            set(b.n, { busy: k, retryAt: new Date(holdUntil).toISOString(), error: `模型那边繁忙，${Math.round(wait / 1000)} 秒后自动重试（第 ${k}/${videogen.BUSY_TRIES} 次）：${e.message}`.slice(0, 300) });
            break;
          }
          set(b.n, { status: 'failed', error: (videogen.busy(e) ? `模型那边一直繁忙，自动重试了 ${videogen.BUSY_TRIES} 次还不行（${e.message}）。过一会儿点「重试」` : e.message).slice(0, 300) });
        }
      }
      for (const b of batches.get(id).briefs.filter((x) => x.video?.status === 'running')) {
        if (Date.now() - Date.parse(b.video.submittedAt) > CLIP_TIMEOUT) {
          set(b.n, { status: 'failed', error: '等待超过 40 分钟，判定超时。到模型控制台看看任务状态，或点重试' });
          continue;
        }
        try {
          const r = await adapter.poll(c, b.video.taskId);
          errorsInARow.delete(b.n);
          if (r.status === 'failed') set(b.n, { status: 'failed', error: String(r.error || '模型返回失败').slice(0, 300) });
          else if (r.status === 'done') {
            if (!r.url) throw err('任务完成了但没有返回视频地址', 424);
            const file = path.join(dir, `video-${b.n}-${Date.now()}.mp4`);
            await media.download(r.url, file);
            addSpent(id, { videos: 1, videoYuan: per });
            const info = await media.probe(file);
            const m = media.register({ abs: file, kind: 'generated', title: `${cur.product.name} · ${b.angle}`.slice(0, 120), mime: 'video/mp4', meta: { batchId: id, duration: info?.duration } });
            set(b.n, { status: 'checking', mediaId: m.id, duration: info?.duration });
            set(b.n, { status: 'done', qc: await videoQc(batches.get(id), file, info, dir), doneAt: db.now() });
          }
        } catch (e) {
          const k = (errorsInARow.get(b.n) || 0) + 1;
          errorsInARow.set(b.n, k);
          if (k >= 12) set(b.n, { status: 'failed', error: e.message.slice(0, 300) });
        }
      }
      const after = batches.get(id);
      if (!after) return;
      const vids = after.briefs.filter((b) => b.video);
      const done = vids.filter((b) => b.video.status === 'done').length;
      const finished = vids.every((b) => ['done', 'failed'].includes(b.video.status));
      const wait = holdUntil - Date.now();
      batches.update(id, { step: `生成视频 ${done}/${vids.length}${!finished && wait > 0 ? `，模型那边繁忙，约 ${Math.ceil(wait / 1000)} 秒后自动重试` : ''}` });
      if (finished) {
        const failed = vids.length - done;
        batches.update(id, { status: 'done', step: failed ? `完成，${failed} 条失败，可以重试` : `完成：${done} 条视频`, finishedAt: db.now() });
        db.activity.insert({ type: 'script', text: `批量出片：${after.product.name} ${done} 条` });
        return;
      }
      await sleep(POLL_MS);
    }
  } catch (e) {
    console.error('[studio]', e.message);
    batches.update(id, { status: 'error', error: e.message.slice(0, 300) });
  } finally {
    running.delete(id);
  }
}

// 成片复检：抽开头、中间、结尾三帧，对照真实商品
async function videoQc(batch, file, info, dir) {
  if (!info?.duration) return { skipped: true, reason: '读不出视频时长，跳过复检' };
  const frames = [];
  try {
    for (const t of [0.4, info.duration / 2, Math.max(0.5, info.duration - 0.4)]) frames.push(await media.frameAt(file, t, path.join(dir, `chk-${Date.now()}-${frames.length}.jpg`), { width: 480 }));
    return await qcImages(batch, frames, 'video', dir);
  } catch (e) {
    return { skipped: true, reason: `复检失败：${e.message.slice(0, 120)}` };
  } finally {
    for (const f of frames) fs.rmSync(f, { force: true });
  }
}

function retry(id) {
  const batch = batches.get(id);
  if (!batch) throw err('批次不存在', 404);
  if (batch.status === 'error' && !batch.briefs.length) {
    batches.update(id, { status: 'preparing', error: '', step: '写画面和文案' });
    prepare(id);
    return batches.get(id);
  }
  if (batch.status === 'error' && batch.briefs.some((b) => !b.candidates.length) && batch.mode === 'keyframe') {
    batches.update(id, { status: 'preparing', error: '', step: '出关键帧并质检' });
    prepare(id);
    return batches.get(id);
  }
  const failed = batch.briefs.filter((b) => b.video?.status === 'failed');
  if (!failed.length) throw err('没有失败的视频');
  for (const b of failed) {
    if (b.video.mediaId) media.remove(b.video.mediaId);
    patchBrief(id, b.n, { video: { status: 'pending' } });
  }
  batches.update(id, { status: 'rendering', error: '', step: '重试失败的视频' });
  runRender(id);
  return batches.get(id);
}

function remove(id) {
  const batch = batches.get(id);
  if (!batch) throw err('批次不存在', 404);
  if (running.has(id)) throw err('还在处理，等这一步结束再删', 409);
  for (const b of batch.briefs) {
    for (const c of b.candidates || []) if (c.mediaId) media.remove(c.mediaId);
    if (b.video?.mediaId) media.remove(b.video.mediaId);
  }
  if (batch.dir) fs.rmSync(path.join(db.MEDIA_DIR, batch.dir), { recursive: true, force: true });
  return batches.remove(id);
}

// 服务重启：准备中的接着出图（已出的不重复），生成中的接着查（任务 ID 已经存下，不重复扣费）
function recover(userById) {
  for (const b of batches.all()) {
    const user = userById(b.uid);
    if (!user) continue;
    if (b.status === 'preparing') ctx.run(user, () => prepare(b.id));
    if (b.status === 'rendering') ctx.run(user, () => runRender(b.id));
  }
}

// 列表不带每条的长提示词
const list = () => batches.all().map((b) => ({ id: b.id, title: b.title, status: b.status, step: b.step, error: b.error, count: b.count, mode: b.mode, spent: b.spent, estimate: { total: b.estimate?.total }, createdAt: b.createdAt, cover: b.briefs.find((x) => x.pick != null)?.candidates?.[b.briefs.find((x) => x.pick != null).pick]?.mediaId || '', videos: b.briefs.filter((x) => x.video?.status === 'done').length }));
function view(id) {
  const b = batches.get(id);
  if (!b) throw err('批次不存在', 404);
  const p = ['review', 'done'].includes(b.status) ? renderPlan(b) : null;
  const named = (ids) => (ids || []).map((rid) => ({ id: rid, title: media.records.get(rid)?.title || '' }));
  return { ...b, refs: named(b.refs), personRefs: named(b.personRefs), formatName: (FORMATS[b.format] || FORMATS.mix).name, next: p ? { count: p.todo.length, yuan: p.yuan, per: p.per == null ? null : yuan(p.per) } : null };
}

// 字幕：开头 3 秒是屏幕字，之后按句子把口播平均铺开。剪映 / CapCut 可以直接导入
function srt(id, n) {
  const b = batches.get(id);
  if (!b) throw err('批次不存在', 404);
  const x = b.briefs.find((y) => y.n === Number(n));
  if (!x) throw err('没有这一条', 404);
  const total = Number(x.video?.duration) || b.seconds;
  const t = (sec) => {
    const ms = Math.round(sec * 1000);
    const p = (v, w = 2) => String(v).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const cues = [];
  const head = Math.min(3, total);
  if (x.caption) cues.push([0, head, x.caption]);
  const lines = String(x.voiceover || '').split(/(?<=[.!?。！？])\s*/).map((l) => l.trim()).filter(Boolean);
  const start = x.caption ? head : 0;
  const span = (total - start) / (lines.length || 1);
  lines.forEach((l, i) => cues.push([start + i * span, start + (i + 1) * span, l]));
  return cues.map(([a, z, text], i) => `${i + 1}\n${t(a)} --> ${t(z)}\n${text}\n`).join('\n');
}

// 导出发布清单：每条的屏幕字、口播和文件名，剪辑和发布时照着用
function exportMd(id) {
  const b = view(id);
  const lines = [`# ${b.title}`, '', `${b.formatName} · ${b.seconds} 秒 · ${b.ratio} · 视频模型 ${b.videoModel}${b.imageModel ? ` · 关键帧 ${b.imageModel}` : ''} · 已花约 ¥${yuan(b.spent.imageYuan + b.spent.videoYuan)}`, '', '发布前：逐条对比真实商品，有出入就不要发；发布时打开「AI-generated content」标识。屏幕字在剪映 / TikTok 编辑器里加。', ''];
  for (const x of b.briefs) {
    lines.push(`## 第 ${x.n} 条：${x.angle}`, `- 钩子：${x.hookName}；场景：${x.sceneName}`, `- 屏幕字：${x.caption || '（自己写）'}`, `- 口播：${x.voiceover || '（无）'}`, `- 为什么：${x.why}`);
    if (x.video?.status === 'done') lines.push(`- 视频：已生成${x.video.qc?.pass === false ? '（复检没通过：' + (x.video.qc.problems || []).join('、') + '）' : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { SCENES, HOOK_IDS, FORMATS, srt, combos, estimate, addAssets, create, regen, updateBrief, render, retry, remove, recover, list, view, exportMd, autoPick, keyframePrompt, motionPrompt };
