// 带货视频脚本：按爆款方法论（playbook.js）生成。选风格、钩子和痛点，也可以学一条爆款视频的结构（viral.js）
const db = require('../db');
const llm = require('../providers/llm');
const rag = require('./rag');
const products = require('./products');
const settings = require('../settings');
const playbook = require('./playbook');
const listing = require('./listing');
const craft = require('./promptcraft');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const STYLES = Object.fromEntries(playbook.STYLES.map((s) => [s.id, s.name]));

const MODES = {
  person: '真人出镜：真人对镜头说话，手机随手拍的感觉',
  hands: '不露脸：只拍手和产品，靠口播或屏幕字讲解',
  ai: 'AI 模型生成：场景和人物可以生成；商品特写镜头标注 productVisible=true，提醒用实拍素材替换，不能让 AI 改变商品的外观',
};

// 商品信息：选品库的商品，或者手动填的商品名和卖点（还没进选品库也能写）
function productBrief({ productId, productName, productDesc }) {
  if (productId) {
    const p = products.get(productId);
    if (!p) throw err('商品不存在', 404);
    const a = p.analysis || {};
    return {
      id: p.id,
      name: p.name,
      jewelry: p.evaluation.metrics.group === '首饰',
      facts: { 名称: p.name, 类目: p.category, 品型: p.evaluation.metrics.type, 站点: p.evaluation.metrics.market, 成交均价: `${p.evaluation.metrics.currency}${p.evaluation.metrics.asp ?? ''}`, 近7天销量: p.sales7d, 带货视频数: p.videoCount, 评分: p.rating, 选品结论: a.verdict, 目标人群: a.audience, 卖点及拍法: a.sellingPoints, 建议对标角度: a.benchmarkAngles, 人工备注: p.judgement?.notes, 买家评论摘录: p.reviewsText ? String(p.reviewsText).slice(0, 1500) : undefined },
      pains: p.pains,
    };
  }
  const name = String(productName || '').trim();
  if (!name) throw err('请先选择商品，或填写商品名称');
  return { id: '', name, jewelry: /earring|necklace|bracelet|ring\b|jewel|anklet|首饰|耳环|项链|手链|戒指/i.test(`${name} ${productDesc || ''}`), facts: { 名称: name, 商品介绍: String(productDesc || '').slice(0, 1500) } };
}

// ---------- 痛点挖掘 ----------
async function pains(body) {
  const prod = productBrief(body);
  const result = await llm.completeJSON(
    `为这个 TikTok Shop 商品挖掘拍视频用的痛点和渴望。

商品：${JSON.stringify(prod.facts)}

方法：${playbook.full().pain.intro}
从这些方向找：${playbook.full().pain.sources.map((s) => `${s.name}（${s.how}）`).join('；')}
分三层：功能（东西不好用）、情绪（尴尬、失望）、身份（想成为什么样的人）。首饰、服饰这类商品也要找「渴望」，比如想被夸、想显贵，不能只写问题。
要求：
1. 写具体的场景和症状，不要写「质量不好」这种空话；
2. 有买家评论的优先用评论里反复出现的问题，evidence 写「评论」；没有依据只是推断的写「推断」，绝对不要编造数据和评论；
3. 产品解决不了的不要写；
4. 口播用 ${body.language || settings.get().store.language || 'English'}，其他字段用中文。

只输出 JSON：
{"audience":"目标人群一句话","pains":[{"pain":"痛点或渴望","level":"功能|情绪|身份","moment":"什么时候最强烈","evidence":"评论|推断","hookSpoken":"第一句话","hookText":"屏幕字（短）","hookFrame":"第一帧画面","proof":"怎么在视频里证明","caution":"合规注意"}]}
写 5 条，按打动力从高到低排。`,
    { system: '你是 TikTok 带货内容策划，只输出 JSON。', temperature: 0.7, noThinking: true, timeoutMs: 90000 },
  );
  if (!Array.isArray(result.pains) || !result.pains.length) throw err('模型没有返回痛点，请重试或换一个模型', 424);
  if (prod.id) db.products.update(prod.id, { pains: result });
  return result;
}

// ---------- 自检：程序能确定的项目，不靠模型自评 ----------
const CJK = /[一-龥ぁ-んァ-ンก-๙]/;
const wordCount = (s) => {
  const text = String(s || '');
  return CJK.test(text) ? Math.round(text.replace(/\s/g, '').length / 2.2) : text.trim().split(/\s+/).filter(Boolean).length;
};

function lint(s, { duration, jewelry } = {}) {
  const items = [];
  const add = (label, pass, note, level = 'warn') => items.push({ label, pass: !!pass, note: pass ? '' : note, level });
  const scenes = s.scenes || [];
  const hook = String(s.hook || '');
  const all = [s.hook, s.hookText, ...scenes.flatMap((x) => [x.voiceover, x.caption]), s.caption, s.cta, ...(s.hashtags || [])].filter(Boolean).join(' \n ');
  add('开头没有寒暄', !/^\s*(hi|hello|hey)\b|^\s*(so\s+)?guys\b|大家好|今天给大家|今天来/i.test(hook), '第一句有寒暄，观众两秒内就会走。直接说问题或结果', 'fail');
  add('不是纯悬念钩子', !/won'?t believe|you need to see this|wait (for|till) the end|绝对想不到|你不会相信|看到最后/i.test(hook), '纯悬念招来的是看热闹的人，能拿点击但转化差', 'warn');
  add('第一句够短', wordCount(hook) <= 18, `第一句约 ${wordCount(hook)} 个词，太长，2 秒说不完`);
  add('有屏幕字钩子', !!s.hookText, '缺少开头的屏幕字，静音看的人抓不住重点');
  add('屏幕字够短', !s.hookText || wordCount(s.hookText) <= 12, `屏幕字约 ${wordCount(s.hookText)} 个词，手机上读不完`);
  add('第一帧有产品', scenes[0]?.productVisible !== false, '第一个镜头看不到产品。数据显示第一帧有产品的钩子更好');
  add('第二镜前产品已出现', scenes.slice(0, 2).some((x) => x.productVisible !== false), '前两个镜头都没有产品，太晚了');
  const over = scenes.filter((x) => wordCount(x.voiceover) > (Number(x.duration) || 4) * 3.5).map((x) => x.n);
  add('口播念得完', !over.length, `第 ${over.join('、')} 镜的口播在规定时长内念不完`);
  const total = scenes.reduce((a, x) => a + (Number(x.duration) || 0), 0);
  add('总时长对得上', !duration || Math.abs(total - duration) <= 2, `镜头加起来 ${total} 秒，要求 ${duration} 秒`);
  add('结尾有行动号召', !!s.cta || /CTA/i.test(scenes.at(-1)?.part || ''), '没有告诉观众下一步做什么');
  const banned = listing.checkText(all);
  add('没有违禁用语', !banned.length, banned.join('；'), 'fail');
  add('没有提其他品牌', !/\bdupe\b|平替|van\s?cleef|cartier|tiffany|bvlgari|bulgari|chanel|dior|gucci|hermes|louis vuitton/i.test(all), '提到了大牌或「平替」，平台禁止冒用商标', 'fail');
  if (jewelry) add('材质和功能说法有依据', !/hypoallergenic|nickel[- ]?free|won'?t tarnish|never tarnish|tarnish[- ]?free|waterproof|anti[- ]?karat|防过敏|无镍|永不|不褪色/i.test(all), '提到防过敏、无镍、防水或不褪色：发布前确认有检测报告或实测，否则删掉');
  const placeholders = (all.match(/\[占位/g) || []).length;
  if (placeholders) add('占位内容已替换', false, `有 ${placeholders} 处要换成真实内容（真实评论、真实使用经历）`);
  const passed = items.filter((x) => x.pass).length;
  return { score: Math.round((passed / items.length) * 100), items };
}

function normalize(script, { duration }) {
  if (typeof script.hook === 'object' && script.hook) {
    const h = script.hook;
    script.hookText = script.hookText || h.onScreenText || h.text;
    script.hookFrame = script.hookFrame || h.firstFrame || h.frame;
    script.hook = h.spoken || h.line || '';
  }
  script.hookAlternatives = (script.hookAlternatives || []).map((x) => (typeof x === 'string' ? { spoken: x } : x));
  script.scenes = script.scenes.map((s, i) => ({ duration: 4, ...s, n: i + 1 }));
  // 模型给的时长加起来和要求不一致时按比例调整，时间轴重新计算
  const total = script.scenes.reduce((a, x) => a + (Number(x.duration) || 0), 0);
  if (duration && total && Math.abs(total - duration) > 2) {
    const k = duration / total;
    script.scenes.forEach((x) => (x.duration = Math.max(1, Math.round(Number(x.duration) * k))));
  }
  let t = 0;
  for (const x of script.scenes) {
    x.duration = Math.max(1, Math.round(Number(x.duration) || 4));
    x.time = `${t}s-${t + x.duration}s`;
    t += x.duration;
  }
  return script;
}

// ---------- 生成一条。要几条就由前端调几次（每条 30–60 秒，一次全写完容易超时）----------
async function generate(body = {}) {
  const prod = productBrief(body);
  const duration = Math.min(180, Math.max(5, Number(body.duration) || 20));
  const lang = body.language || settings.get().store.language || 'English';
  const st = playbook.style(body.style) || playbook.style('pain');
  // 指定了钩子就用；否则按第几条轮流用这个风格适合的钩子，几条之间角度不同
  const variant = Math.max(0, Number(body.variant) || 0);
  const hookId = playbook.hook(body.hookType) ? body.hookType : st.hooks[variant % st.hooks.length];
  const hk = playbook.hook(hookId);
  const pain = body.pain && typeof body.pain === 'object' ? body.pain : null;
  const mode = MODES[body.mode] ? body.mode : 'person';
  const kb = body.useKb === false ? '' : await rag.contextFor(`TikTok 带货短视频脚本 钩子 ${st.name}`, 3);
  const viral = body.viral;
  const prompt = `为下面这个 TikTok Shop 商品写一条 ${duration} 秒的带货短视频脚本，这是一批里的第 ${variant + 1} 条，要有自己的切入角度。

${playbook.brief({ styleId: viral ? undefined : st.id, hookId, jewelry: prod.jewelry })}

【屏幕字和口播】
${craft.COPY_RULES.slice(0, 3).map((r, i) => `${i + 1}. ${r}`).join('\n')}

风格：${viral ? '沿用下面这条爆款的结构' : st.name}
钩子类型：${hk.name}
拍摄方式：${MODES[mode]}
口播和字幕语言：${lang}
商品信息：${JSON.stringify(prod.facts)}
${pain ? `这一条主打的痛点或渴望：${JSON.stringify(pain)}\n` : ''}${viral ? `要学习的爆款视频拆解（学结构、节奏和手法，不能照抄台词和画面，不能提它的品牌）：\n${JSON.stringify(viral)}\n` : ''}${body.benchmark ? `对标视频参考（学结构，不要照抄）：\n${String(body.benchmark).slice(0, 3000)}\n` : ''}${body.avoid?.length ? `这批已经写过这些开头，这条必须完全不同：${JSON.stringify(body.avoid).slice(0, 800)}\n` : ''}${body.extra ? `额外要求：${String(body.extra).slice(0, 500)}\n` : ''}${kb ? `参考知识库：\n${kb}\n` : ''}
要求：
1. ${Math.max(3, Math.min(8, Math.round(duration / 4)))} 个左右的镜头，时长加起来等于 ${duration} 秒，每个镜头写清楚拍什么、怎么拍，新手照着就能拍；
2. 每个镜头写一个留人手法（retention）：这一镜凭什么让人继续看；
3. 只用商品信息里有的事实，不知道的卖点不要编；需要真实评论或真实经历的地方写成 [占位：说明要填什么]；
4. videoPrompt 用英文写给视频生成模型，按「主体 + 一到两个简单动作 + 具体场景 + 一种镜头运动 + 光线」写：竖屏手机实拍感（UGC），第 1 秒就有明显动作，商品保持原样不变形、不新增物体，不写屏幕文字；
5. 另外给 3 个不同钩子类型的备选开头，用来 A/B 测试。

只输出 JSON：
{"title":"脚本标题(中文)","angle":"一句话切入角度(中文)","hook":"第一句话(${lang})","hookText":"开头屏幕字(${lang}，短)","hookFrame":"第一帧画面(中文)","hookAlternatives":[{"type":"钩子类型(中文)","spoken":"第一句话(${lang})","text":"屏幕字(${lang})","frame":"第一帧(中文)"}],
"strategy":{"audience":"给谁看(中文)","pain":"抓的痛点或渴望(中文)","whyItWorks":"这条为什么能打动人(中文)","proof":"用什么证明(中文)","objection":"回答了哪个购买顾虑(中文)"},
"style":"${viral ? '学习爆款结构' : st.name}","duration":${duration},"language":"${lang}",
"scenes":[{"n":1,"part":"Hook|Problem|Demo|Proof|Offer|CTA","duration":3,"shot":"景别/机位","visual":"画面与动作(中文，具体可执行)","voiceover":"口播(${lang})","caption":"屏幕字(${lang}，简短，不挡产品)","props":"道具","retention":"留人手法(中文)","productVisible":true,"videoPrompt":"English prompt"}],
"caption":"发布文案(${lang})，把品类关键词写进去","hashtags":["#tag"],"cta":"结尾行动号召(${lang})","bgm":"声音建议","shootingTips":["拍摄注意(中文)"],"testPlan":"这条要重点看什么数据、怎么改(中文)"}`;
  const script = await llm.completeJSON(prompt, { system: '你是 TikTok 带货短视频编剧，熟悉 TikTok Shop 规则，只写真实可拍的内容。只输出 JSON。', temperature: 0.85, maxTokens: 6000, timeoutMs: 90000, noThinking: true });
  if (!Array.isArray(script.scenes) || !script.scenes.length || !script.hook) throw err('模型返回的脚本缺少分镜或钩子，请重试或换一个模型', 502);
  normalize(script, { duration });
  script.duration = duration;
  script.language = lang;
  const saved = db.scripts.insert({
    productId: prod.id, productName: prod.name, benchmark: body.benchmark || '', styleId: viral ? '' : st.id, hookType: hookId, hookName: hk.name, mode, viralId: body.viralId || '', viralTitle: body.viralTitle || '',
    ...script,
    check: lint(script, { duration, jewelry: prod.jewelry }),
  });
  db.activity.insert({ type: 'script', text: `生成脚本：${prod.name}` });
  return saved;
}

// 字幕文件：剪映 / CapCut 可以直接导入
function srt(script) {
  const stamp = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')},000`;
  let t = 0;
  return (script.scenes || []).map((s, i) => {
    const start = t;
    t += Number(s.duration) || 4;
    return `${i + 1}\n${stamp(start)} --> ${stamp(t)}\n${s.voiceover || s.caption || ''}\n`;
  }).join('\n');
}

module.exports = { generate, pains, lint, srt, STYLES, MODES };
