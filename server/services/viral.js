// 爆款视频拆解：上传视频 → ffmpeg 测量镜头节奏、抽帧 → 语音转写 → 看画面的模型逐帧描述 → 文字模型写详细报告 → 学习结构生成脚本
// 时长、切镜次数、语速是程序测出来的；后台运行，前端轮询进度
const fs = require('fs');
const path = require('path');
const db = require('../db');
const llm = require('../providers/llm');
const settings = require('../settings');
const media = require('../media');
const understand = require('./understand');
const playbook = require('./playbook');
const scripts = require('./scripts');

const items = db.collection('viral_videos');
const running = new Set();
const MAX_CONCURRENT = 2; // 抽帧吃 CPU，整台服务器同时最多处理两条
const MAX_SECONDS = 600;
const ANALYZE_SECONDS = 180; // 超长视频只看前 3 分钟
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const round2 = (v) => Math.round(v * 100) / 100;

// 现在的配置能看到什么：页面上先告诉用户
function capabilities() {
  const vision = understand.visionCfg();
  const asr = understand.asrCfg();
  return { llm: settings.activeProvider()?.name || '', vision: vision ? `${vision.name} · ${vision.model}` : '', asr: asr?.name || '' };
}

async function add(file, originalName, fields = {}) {
  if (!settings.activeProvider()) throw llm.noLLM();
  const kind = media.sniff(file);
  if (!kind) throw err('这不是视频文件。支持 MP4、MOV、WebM（在抖音、TikTok 保存下来的视频都可以）');
  const size = fs.statSync(file).size;
  media.assertQuota(size);
  const info = await media.probe(file);
  if (!info) throw err('读不出这个视频，文件可能损坏了');
  if (info.duration > MAX_SECONDS) throw err(`视频有 ${Math.round(info.duration / 60)} 分钟，太长了。请传 10 分钟以内的视频`);
  if ([...running].filter((id) => id).length >= MAX_CONCURRENT) throw err('现在有视频正在分析，请稍等一两分钟再传', 429);
  const dir = media.newDir('viral');
  const dest = path.join(dir, `source.${kind.ext}`);
  fs.renameSync(file, dest);
  const title = String(fields.title || originalName || '爆款视频').replace(/\.[^.]+$/, '').slice(0, 80);
  const m = media.register({ abs: dest, kind: 'viral', title, mime: kind.mime, meta: { duration: info.duration } });
  const num = (v) => (v === undefined || v === '' ? undefined : Number(String(v).replace(/[,\s]/g, '')));
  const doc = items.insert({
    title, status: 'running', step: '读取视频', mediaId: m.id, dir: path.relative(db.MEDIA_DIR, dir), probe: info,
    context: { url: String(fields.url || '').slice(0, 500), views: num(fields.views), likes: num(fields.likes), comments: num(fields.comments), shares: num(fields.shares), gmv: String(fields.gmv || '').slice(0, 40), notes: String(fields.notes || '').slice(0, 1000), transcript: String(fields.transcript || '').slice(0, 20000) },
  });
  start(doc.id);
  return doc;
}

function start(id) {
  running.add(id);
  analyzeVideo(id).finally(() => running.delete(id));
}

async function analyzeVideo(id) {
  const update = (patch) => items.update(id, patch);
  try {
    const doc = items.get(id);
    const m = media.records.get(doc.mediaId);
    if (!m) throw err('视频文件已被删除');
    const file = media.absPath(m);
    const dir = path.join(db.MEDIA_DIR, doc.dir);
    const info = doc.probe;
    const span = Math.min(info.duration, ANALYZE_SECONDS);

    // 1. 测量
    update({ status: 'running', step: '测量镜头节奏', error: '', warnings: [] });
    const cuts = (await media.sceneCuts(file)).filter((t) => t <= span);
    const shotCount = cuts.length + 1;
    const measured = { duration: info.duration, analyzedSeconds: span, width: info.width, height: info.height, vertical: info.height > info.width, shotCount, avgShotSeconds: round2(span / shotCount), firstCutAt: cuts[0] ?? null, cuts: cuts.slice(0, 200), hasAudio: info.hasAudio };

    // 2. 抽帧：前 3 秒每半秒一张（看钩子），其余均匀抽，最多约 36 张
    update({ step: '抽取画面', measured });
    for (const f of fs.readdirSync(dir)) if (/^(hook|f)-.*\.jpg$|^sheet/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    const hookFiles = await media.frames(file, dir, { prefix: 'hook', interval: 0.5, duration: Math.min(3, info.duration) });
    const interval = Math.max(1.5, round2(span / 36));
    const frameFiles = await media.frames(file, dir, { prefix: 'f', interval, duration: span });
    const frames = frameFiles.map((f, i) => ({ t: round2(i * interval), file: f }));
    const hookFrames = hookFiles.map((f, i) => ({ t: round2(i * 0.5), file: f }));
    update({ frames, hookFrames });

    // 3. 口播
    update({ step: '转写口播' });
    const warnings = [];
    let transcript = { text: doc.context.transcript || '', segments: [], source: doc.context.transcript ? '你粘贴的文字' : '' };
    if (!transcript.text) {
      try {
        const r = await understand.transcribe(file, dir, { duration: span, hasAudio: info.hasAudio });
        transcript = r;
        if (r.skipped === '没有接入语音转写') warnings.push('没有接入语音转写：口播只能从画面字幕读，可能不全。到「接入配置 → 视频模型」添加语音转写后点「重新分析」');
        else if (r.skipped) warnings.push(`${r.skipped}，没有口播可分析`);
      } catch (e) {
        warnings.push(`语音转写失败（${e.message}）：口播只能从画面字幕读`);
      }
    }
    const words = String(transcript.text || '').trim().split(/\s+/).filter(Boolean).length;
    if (transcript.text) measured.speechPerSecond = round2((/[一-龥]/.test(transcript.text) ? transcript.text.replace(/\s/g, '').length : words) / span);
    update({ transcript, measured, warnings });

    // 4. 看画面
    update({ step: '看画面' });
    const cfg = understand.visionCfg();
    let sees = false;
    try {
      sees = !!cfg && (await understand.canSee(cfg));
    } catch (e) {
      warnings.push(`看画面的模型调用失败：${e.message}`);
    }
    const seen = { hook: null, frames: [] };
    if (sees) {
      update({ step: '看画面：开头 3 秒' });
      const hookSheet = path.join(dir, 'sheet-hook.jpg');
      await media.contactSheet(dir, hookFiles, hookSheet, { cols: Math.min(6, hookFiles.length) });
      seen.hook = await understand.askImage(cfg, `这是一条 TikTok 带货视频开头 3 秒的 ${hookFiles.length} 帧，从左到右依次是第 ${hookFrames.map((f) => `${f.t}s`).join('、')}。
只输出 JSON：{"firstFrame":"第一帧画面","person":true,"face":true,"product":true,"productWhat":"产品是什么","onScreenText":"屏幕上的文字原文，没有写空","motion":"这 3 秒发生了什么动作变化","camera":"景别和运镜"}`, hookSheet, { maxTokens: 1500 });
      const perSheet = 12;
      for (let i = 0; i < frames.length; i += perSheet) {
        update({ step: `看画面：${Math.min(i + perSheet, frames.length)}/${frames.length}` });
        const group = frames.slice(i, i + perSheet);
        const sheet = path.join(dir, `sheet-${i}.jpg`);
        await media.contactSheet(dir, group.map((f) => f.file), sheet, { cols: 4 });
        const r = await understand.askImage(cfg, `这张图是一条 TikTok 带货视频按时间顺序抽的 ${group.length} 帧，从左到右、从上到下，时间依次是 ${group.map((f) => `${f.t}s`).join('、')}。
逐帧描述，只输出 JSON：{"frames":[{"t":0,"shot":"特写|近景|中景|全景","person":true,"product":true,"visual":"画面和动作，一句话","text":"屏幕文字原文，没有写空"}]}`, sheet);
        seen.frames.push(...(r.frames || []));
        fs.rmSync(sheet, { force: true });
      }
    } else {
      warnings.push(cfg ? `「${cfg.model}」看不了图片，这次没有看画面，只分析了文字。到「接入配置 → 视频模型」添加看画面的模型（智谱 GLM-4.6V-Flash 官方标明免费）` : '没有可用的模型看画面');
    }
    if (!sees && !transcript.text) throw err('这次既看不到画面，也拿不到口播，没法分析。到「接入配置 → 视频模型」添加看画面的模型（智谱 GLM-4.6V-Flash 官方标明免费）或语音转写，再点「重新分析」');
    update({ seen, warnings });

    // 5. 写报告
    update({ step: '写拆解报告' });
    const analysis = await report(doc, measured, transcript, seen, { sees });
    if (!analysis.summary) throw err('模型没有返回拆解结果，请重试或换一个模型', 424);
    update({ status: 'done', step: '完成', analysis, finishedAt: db.now(), warnings });
    db.activity.insert({ type: 'script', text: `拆解爆款视频：${doc.title}` });
  } catch (e) {
    console.error('[viral]', e.message);
    update({ status: 'error', error: e.message, finishedAt: db.now() });
  }
}

async function report(doc, measured, transcript, seen, { sees }) {
  const pb = playbook.full();
  const c = doc.context;
  const stats = [c.views != null && `播放 ${c.views}`, c.likes != null && `点赞 ${c.likes}`, c.comments != null && `评论 ${c.comments}`, c.shares != null && `转发 ${c.shares}`, c.gmv && `成交 ${c.gmv}`].filter(Boolean).join('，');
  return llm.completeJSON(
    `你是 TikTok 带货内容拆解专家。下面是一条爆款视频的真实素材，请写一份尽量详细、能照着学的拆解。

【程序测量的事实，直接采用】
${JSON.stringify(measured)}
${stats ? `【用户提供的数据】${stats}\n` : '【用户没有提供播放和成交数据：不要声称它有多少播放，也不要断言它是投流还是自然爆】\n'}${c.notes ? `【用户备注】${c.notes}\n` : ''}
【口播${transcript.source ? `，来源：${transcript.source}` : ''}】
${transcript.segments?.length ? transcript.segments.map((s) => `${s.start}-${s.end}s ${s.text}`).join('\n') : transcript.text || '（没有拿到口播）'}

【开头 3 秒】${seen.hook ? JSON.stringify(seen.hook) : '（没有看画面）'}
【抽帧描述】${sees ? JSON.stringify(seen.frames) : '（没有看画面）'}

【判断标准】
钩子类型：${pb.hooks.map((h) => `${h.id}=${h.name}`).join('，')}
风格类型：${pb.styles.map((s) => `${s.id}=${s.name}`).join('，')}
${playbook.brief({})}

要求：
1. 结论先行：先说这条视频最关键的爆点是什么，再展开；
2. 只写素材里看得到、听得到的内容；推断的地方写「推测」；拿不到的写「未知」，绝对不要编造台词、数据或画面；
3. 分镜尽量按真实时间写满整条视频，台词用原文；
4. 不要说空话，每条分析都要指向这条视频里具体的画面或台词；
5. 除了原文台词，其他都用中文。

只输出 JSON：
{"summary":"3-5 句总结：卖什么、给谁、怎么拍、为什么有效","keyReason":"最关键的一个爆点","takeaways":["可以马上学的做法，5-8 条，每条具体"],
"basics":{"product":"","category":"","audience":"","format":"风格 id","formatName":"风格名","presenter":"真人出镜/手部/无人/数字人","tone":"","language":""},
"hook":{"type":"钩子 id","typeName":"钩子名","firstFrame":"","spokenLine":"原文","onScreenText":"原文","sound":"","aligned":"画面、字、话是否说同一件事，为什么","whyStops":"为什么能让人停下来","whoItFilters":"筛选出了什么人","score":0,"improve":"怎么能更好"},
"timeline":[{"start":0,"end":3,"part":"Hook|Problem|Demo|Proof|Offer|CTA|Story|Twist","visual":"","camera":"","spoken":"原文","onScreenText":"原文","audio":"","purpose":"这一段的作用","retention":"留人手法","emotion":""}],
"structure":{"formula":"一句话结构公式","pacing":"结合切镜次数、平均镜头时长和语速分析节奏","productFirstAt":"产品第几秒出现","priceAt":"价格或优惠第几秒出现，没有写无","openLoops":["留下的悬念以及何时揭晓"],"payoff":"最大的满足感在哪一刻","rewatch":"有没有让人重看的设计"},
"painAndDesire":{"pain":"","agitation":"怎么放大的","desire":"","moment":"场景"},
"sellingPoints":[{"point":"","how":"怎么展示的","proof":"实测/对比/评论/数据/他人反应/无"}],
"trust":["信任元素"],
"conversion":{"offer":"","cta":"原文","urgency":"","objections":["处理了哪些顾虑"],"commentBait":"引导评论的设计"},
"emotionCurve":[{"t":"0-3s","emotion":"","intensity":0}],
"scores":{"hook":{"score":0,"why":""},"retention":{"score":0,"why":""},"proof":{"score":0,"why":""},"conversion":{"score":0,"why":""},"shareability":{"score":0,"why":""}},
"reusable":{"template":"可复用的脚本模板，用 [槽位] 表示要替换的地方","slots":[{"slot":"[槽位]","how":"怎么替换"}],"mustKeep":["学的时候必须保留的"],"canChange":["可以换的"]},
"doNotCopy":["不能照搬的：原视频台词、人物肖像、商标、版权音乐、无法证明的说法等"],
"compliance":["这条视频里有哪些合规风险，你学的时候要避开"],
"limits":"这次分析的局限（比如只看了抽帧、没有声音）"}`,
    { system: '你是 TikTok 爆款视频分析师，只依据给出的素材，不编造。只输出 JSON。', temperature: 0.4, maxTokens: 12000, timeoutMs: 280000 },
  );
}

function rerun(id) {
  const doc = items.get(id);
  if (!doc) throw err('记录不存在', 404);
  if (running.has(id)) throw err('正在分析中', 409);
  if (doc.sample) throw err('示例报告没有视频文件，不能重新分析');
  items.update(id, { status: 'running', step: '准备重新分析', error: '' });
  start(id);
  return items.get(id);
}

function remove(id) {
  const doc = items.get(id);
  if (!doc) return false;
  if (running.has(id)) throw err('正在分析中，等它结束再删除', 409);
  if (doc.mediaId) media.remove(doc.mediaId);
  if (doc.dir) fs.rmSync(path.join(db.MEDIA_DIR, doc.dir), { recursive: true, force: true });
  return items.remove(id);
}

// 帧图片路径（只接受系统生成的文件名）
function framePath(id, name) {
  const doc = items.get(id);
  if (!doc || !/^(hook|f)-\d+\.jpg$/.test(name)) return null;
  const file = path.join(db.MEDIA_DIR, doc.dir, name);
  return fs.existsSync(file) ? file : null;
}

// 学习这条爆款，写一条新脚本（要几条前端调几次，variant 递增）
async function learn(id, body = {}) {
  const doc = items.get(id);
  if (!doc) throw err('记录不存在', 404);
  if (!doc.analysis) throw err('这条视频还没有分析完');
  const a = doc.analysis;
  const viral = { keyReason: a.keyReason, hook: a.hook, structure: a.structure, timeline: (a.timeline || []).map(({ start, end, part, purpose, retention }) => ({ start, end, part, purpose, retention })), pain: a.painAndDesire, reusable: a.reusable, takeaways: a.takeaways, doNotCopy: a.doNotCopy };
  const duration = Number(body.duration) || Math.min(60, Math.max(10, Math.round(doc.probe?.duration || 20)));
  const hookType = body.keepHook === false ? undefined : (playbook.hook(a.hook?.type) ? a.hook.type : undefined);
  const style = playbook.style(a.basics?.format) ? a.basics.format : 'ugc';
  // 第一条保留原视频的钩子类型，其余换钩子，方便对比哪个开头更好
  return scripts.generate({ ...body, style, hookType: Number(body.variant) === 0 || !body.variant ? hookType : body.hookType, duration, viral, viralId: id, viralTitle: doc.title });
}

function recover() {
  for (const d of items.all()) if (d.status === 'running') items.update(d.id, { status: 'error', error: '服务重启，分析中断，点「重新分析」即可' });
}

const list = () => items.all().map(({ analysis, seen, transcript, frames, hookFrames, ...d }) => ({ ...d, summary: analysis?.summary, keyReason: analysis?.keyReason }));
const get = (id) => items.get(id);

module.exports = { capabilities, add, rerun, remove, framePath, learn, recover, list, get };
