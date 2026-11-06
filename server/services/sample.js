// 示例工作区：一键载入一组虚构数据，不接任何模型和接口也能看到完整流程；一键清除
// 所有记录都带 sample: true，页面上明确标注「示例」。这些数字不是真实市场数据
const db = require('../db');
const products = require('./products');
const sourcing = require('./sourcing');
const listing = require('./listing');
const scripts = require('./scripts');
const launch = require('./launch');

const viral = db.collection('viral_videos');
const imports = db.collection('imports');
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dayAgo = (n, base = Date.now()) => new Date(base - n * 86400e3).toISOString();

// 销量按时间线铺开：两次以上快照，增长榜能算出实测增长
function history({ now7, prev7, price, creators, videos }) {
  // 每个时间点的周销量；累计销量按两次快照之间的天数累加
  const weeks = [[21, prev7 * 0.8, 0], [14, prev7, 7], [0, now7, 14]];
  let sum = Math.round(prev7 * 6);
  return weeks.map(([ago, w, gap]) => {
    sum += Math.round((w * gap) / 7);
    return { at: dayAgo(ago), sales7d: Math.round(w), gmv: Math.round(w * price), salesTotal: sum, gmvTotal: Math.round(sum * price), sales28d: Math.round(w * 3.2), gmv28d: Math.round(w * 3.2 * price), creatorCount: Math.round(creators * (ago ? 0.7 : 1)), videoCount: Math.round(videos * (ago ? 0.7 : 1)), price };
  });
}

const PRODUCTS = [
  { key: 'pearl', name: 'Layered Freshwater Pearl Chain Necklace 18K Plated', category: '时尚配件', price: 59, now7: 1860, prev7: 820, creators: 86, videos: 210, shop: 'Lumi Atelier（示例）', cost: 14, ship: 4.6, ai: '可以上', headline: '近期销量翻倍，达人还不拥挤，毛利撑得住投放', kw: '淡水珍珠 叠戴项链 18K', state: 'scale' },
  { key: 'huggie', name: 'Stainless Steel Chunky Huggie Hoop Earrings 3 Pairs Set', category: '时尚配件', price: 45, now7: 1240, prev7: 930, creators: 64, videos: 150, shop: 'Daily Shine（示例）', cost: 11, ship: 3.8, ai: '可以上', headline: '需求稳定上升，套装价有优势', kw: '不锈钢 粗圈耳环 三对装', state: 'keep' },
  { key: 'case', name: 'Travel Jewelry Organizer Case Mini Velvet Box', category: '收纳', price: 32, now7: 640, prev7: 610, creators: 41, videos: 90, shop: 'Neat Corner（示例）', cost: 12, ship: 6, ai: '谨慎测试', headline: '需求平，利润薄，内容不容易拍出差异', kw: '首饰收纳盒 便携 绒面', state: 'stop' },
  { key: 'name', name: 'Custom Initial Bracelet Dainty Gold Tone Chain', category: '时尚配件', price: 49, now7: 980, prev7: 500, creators: 38, videos: 72, shop: 'Letter Lane（示例）', cost: 9.5, ship: 3.2, ai: '可以上', headline: '送礼场景明确，新品还在起量', kw: '字母手链 细链 金色', state: 'prep' },
  { key: 'anklet', name: 'Butterfly Charm Anklet Adjustable Beach Chain', category: '时尚配件', price: 29, now7: 1520, prev7: 610, creators: 57, videos: 130, shop: 'Sea Glow（示例）', state: 'idle' },
  { key: 'clover', name: 'Clover Stud Earrings Minimal Daily Wear', category: '时尚配件', price: 25, now7: 720, prev7: 800, creators: 210, videos: 640, shop: 'Petal Row（示例）', state: 'idle' },
  { key: 'bangle', name: 'Cartier Style Love Bangle Gold Plated', category: '时尚配件', price: 68, now7: 2300, prev7: 1500, creators: 120, videos: 300, shop: 'Lux Copy（示例）', state: 'idle' },
  { key: 'odd', name: 'Crystal Pendant Necklace Gift Box', category: '时尚配件', price: 199, now7: 1400, prev7: 1100, creators: 3, videos: 4, shop: 'Fast Sold（示例）', state: 'idle' },
];

const SCRIPT_HOOKS = {
  pearl: [
    { style: 'styling', hook: 'Stop wearing one thin necklace with every outfit.', text: 'One chain. Three looks.', frame: '镜子前，手把项链从单层拉成两层', title: '一条项链三种戴法', angle: '用一物多搭证明值这个价' },
    { style: 'gift', hook: 'I gave this to my sister and she thought I overspent.', text: 'She guessed the wrong price', frame: '礼盒打开，妹妹的手拿起项链', title: '她猜错了价格', angle: '用送礼反应带出价格反差' },
    { style: 'price', hook: 'Under RM60, and my boss asked where I got it.', text: 'Under RM60. Boss noticed.', frame: '办公桌前特写项链，同事的手指过来', title: '老板问我哪里买的', angle: '先给价格再给社交认可' },
  ],
  huggie: [
    { style: 'demo', hook: 'Three pairs. Same price as one at the mall.', text: '3 pairs. One price.', frame: '手掌上摊开三对耳环', title: '三对的价格账', angle: '用单对价格算账' },
    { style: 'styling', hook: 'Your small ears need chunky hoops like these.', text: 'Small ears? Try chunky.', frame: '耳朵特写，手指扣上耳环', title: '小耳朵也能戴粗圈', angle: '点名小耳朵人群' },
  ],
  case: [{ style: 'demo', hook: 'My necklaces stopped tangling in my suitcase.', text: 'No more tangled chains', frame: '行李箱里拿出收纳盒打开', title: '行李箱不再打结', angle: '放大打结这个具体痛点' }],
  name: [{ style: 'gift', hook: 'Her initial, her birthday, and it costs less than dinner.', text: 'Cheaper than dinner', frame: '手链躺在手写贺卡上', title: '比一顿饭便宜的生日礼', angle: '用送礼和价格锚点' }],
};

function makeScript(p, h, i) {
  const scenes = [
    { part: 'Hook', duration: 3, shot: '近景，手机随手拍', visual: h.frame, voiceover: h.hook, caption: h.text, props: '商品', retention: '第一帧就看到商品，第一句直接说结果', productVisible: true, videoPrompt: 'Close-up handheld shot of a hand showing a delicate piece of jewelry, soft window light' },
    { part: 'Demo', duration: 8, shot: '中近景，两次切换', visual: '换两种场景戴给你看，每次切换都用手带动画面', voiceover: 'Watch how it looks here, and now with a plain tee.', caption: 'Two looks, 8 seconds', props: '白 T 恤、衬衫', retention: '每 3–4 秒换一个造型，让人想看下一个', productVisible: true, videoPrompt: 'Medium close-up of a person changing tops, jewelry clearly visible, natural light' },
    { part: 'Proof', duration: 8, shot: '手部特写', visual: '放在手上转动，让反光和扣头都能看清', voiceover: '[占位：说一句你自己戴了多久、有没有掉色的真实经历]', caption: '[占位：真实使用时长]', props: '手', retention: '展示细节回答「看着会不会很廉价」', productVisible: true, videoPrompt: 'Macro shot of jewelry rotating slowly on a palm, showing clasp and shine' },
    { part: 'CTA', duration: 4, shot: '近景', visual: '戴好后看镜头，手指向购物车位置', voiceover: 'Tap the cart while this price is still on.', caption: 'Tap the cart', props: '', retention: '明确告诉观众下一步', productVisible: true, videoPrompt: 'Person smiling at the camera wearing the jewelry, simple room background' },
  ];
  let t = 0;
  const withTime = scenes.map((s, n) => { const x = { ...s, n: n + 1, time: `${t}s-${t + s.duration}s` }; t += s.duration; return x; });
  const script = {
    title: h.title, angle: h.angle, hook: h.hook, hookText: h.text, hookFrame: h.frame, hookAlternatives: [],
    strategy: { audience: '喜欢日常精致感、在意性价比的年轻女性', pain: '想要好看但不想买贵，也怕买到便宜货', whyItWorks: h.angle, proof: '手部特写和真实佩戴时长', objection: '看着会不会很廉价' },
    style: h.style, duration: t, language: 'English', scenes: withTime, caption: `${p.name.split(' ').slice(0, 4).join(' ')} for everyday wear`, hashtags: ['#tiktokshop', '#jewelry', '#fyp'], cta: 'Tap the cart while this price is still on.', bgm: '商用音乐库里轻快的流行曲', shootingTips: ['窗边自然光', '手机竖屏，商品占画面一半以上'], testPlan: '先看 2 秒播放率，再看点击率，最后看订单',
  };
  return db.scripts.insert({ productId: p.id, productName: p.name, benchmark: '', styleId: h.style, hookType: '', hookName: h.title, mode: 'person', sample: true, createdAt: dayAgo(9 - i), ...script, check: scripts.lint(script, { duration: t, jewelry: true }) });
}

const OFFERS = (seed, cost, ship) => [
  { offerId: `sample-${seed}-1`, title: `示例货源 A · ${seed}`, url: '', price: cost, amountOnSale: 5200, sendGoodsAddress: '广东 东莞', unitWeight: (ship - 2) / 30, skuCount: 6, status: 'published', match: 92, matchNote: '款式和规格基本一致（示例）', moq: 2, source: '示例', priceRanges: [{ startQuantity: 2, price: cost }, { startQuantity: 100, price: Math.round(cost * 88) / 100 }] },
  { offerId: `sample-${seed}-2`, title: `示例货源 B · ${seed}`, url: '', price: Math.round(cost * 82) / 100, amountOnSale: 800, sendGoodsAddress: '浙江 义乌', unitWeight: (ship - 1.5) / 30, skuCount: 3, status: 'published', match: 74, matchNote: '同类款，链条更细（示例）', moq: 5, source: '示例', priceRanges: [] },
  { offerId: `sample-${seed}-3`, title: `示例货源 C · ${seed}`, url: '', price: Math.round(cost * 70) / 100, amountOnSale: 90, sendGoodsAddress: '河南 郑州', unitWeight: 0.2, skuCount: 1, status: 'published', match: 48, matchNote: '不是同款（示例）', moq: 10, source: '示例', priceRanges: [] },
];

function pack(p) {
  return {
    titleLocal: `${p.name.split(' ').slice(0, 5).join(' ')} Rantai Harian Wanita`, titleEn: p.name.slice(0, 110),
    sellingPoints: ['Mudah dipadankan dengan pakaian harian', 'Saiz boleh laras untuk kebanyakan pemakai', 'Kilauan lembut untuk gaya kerja dan santai', 'Sesuai sebagai hadiah hari jadi', 'Datang dalam pembungkusan kecil yang kemas'],
    description: 'Contoh penerangan produk. Semak bahan, saiz dan gambar sebenar sebelum diterbitkan.', keywords: ['rantai wanita', 'aksesori harian', 'hadiah', 'jewelry', 'necklace'],
    skus: [{ name: 'Gold', spec: '示例规格' }, { name: 'Silver', spec: '示例规格' }], categoryHint: '时尚配件 > 首饰（示例）', attributes: { 材质: '上架前按货源确认' }, packageList: '商品 x1，包装袋 x1', notes: '这是示例数据。上架前要用实拍图，并确认材质说法有依据。',
  };
}

// 素材表现按「保本 CPA 的倍数」生成，用户改了费率也能得到同样的演示状态
function rows(p, scriptsList, state) {
  const econ = launch.economics(products.get(p.id));
  const be = econ.ownOrder;
  const row = (ago, sc, orders, ratio, ctr = 1.6, cvr = 3) => {
    const adSpend = Math.round(orders ? orders * be * ratio * 100 : be * ratio * 100) / 100;
    const clicks = orders ? Math.round((orders / cvr) * 100) : Math.round((be * ratio) / 0.4);
    return { date: dayAgo(ago).slice(0, 10), scriptId: sc?.id || '', views: Math.round((clicks / ctr) * 100), clicks, orders, adSpend, creatorOrders: Math.floor(orders * 0.2), note: '' };
  };
  const [a, b, c] = scriptsList;
  if (state === 'scale') return [row(7, a, 3, 0.75), row(7, b, 1, 1.5, 0.9, 1.6), row(6, a, 4, 0.6), row(6, c, 2, 0.8), row(5, a, 6, 0.5), row(5, c, 2, 0.9), row(4, a, 7, 0.5), row(3, a, 8, 0.45, 1.9, 3.4), row(2, a, 9, 0.48, 1.9, 3.4), row(1, a, 11, 0.5, 1.9, 3.4)];
  if (state === 'keep') return [row(4, a, 2, 1), row(3, b, 3, 0.95), row(2, a, 2, 0.8), row(1, b, 3, 0.85)];
  if (state === 'stop') return [row(3, a, 0, 0.8, 0.7), row(2, a, 0, 0.8, 0.7), row(1, a, 0, 0.7, 0.6)];
  return [];
}

function load() {
  if (db.products.all().some((p) => p.sample)) throw err('示例数据已经载入了', 409);
  const batchId = 'sample';
  const created = {};
  for (const d of PRODUCTS) {
    const snaps = history(d);
    const cur = snaps.at(-1);
    const { key, now7, prev7, creators, videos, cost, ship, ai, headline, kw, state, ...base } = d;
    created[key] = db.products.insert({
      ...base, sample: true, source: 'sample', market: 'MY', status: 'candidate', priceMin: d.price, priceMax: d.price, commissionRate: 12, creatorConvRate: 62, liveCount: 12, rating: 4.7, reviews: 300, launchDate: dayAgo(120).slice(0, 10), judgement: {},
      ...Object.fromEntries(Object.entries(cur).filter(([k]) => k !== 'at')), snapshots: snaps, dataAt: db.now(), batchId, batchIds: [batchId], importDates: snaps.map((s) => s.at.slice(0, 10)),
      ...(ai ? { ai: { verdict: ai, score: state === 'stop' ? 55 : 78, headline, reasons: { 需求: '示例：销量持续上升', 趋势: '示例：近两周明显加速', 达人: '示例：达人数量适中', 竞争: '示例：没有头部垄断', 利润: '示例：毛利能覆盖投放', 风险: '示例：材质说法要有依据' }, kw1688: kw, angle: '示例：叠戴和送礼', nextStep: '备货小批量，测 3 条开头', at: db.now(), model: '示例' } } : {}),
    });
  }
  imports.insert({ batchId, sample: true, source: 'sample', fileName: '示例数据', date: dayAgo(0).slice(0, 10), importDate: dayAgo(0).slice(0, 10), count: PRODUCTS.length, created: PRODUCTS.length, updated: 0, history: 0, categories: ['时尚配件'] });
  for (const d of PRODUCTS.filter((x) => x.cost)) {
    const id = created[d.key].id;
    const ceiling = products.get(id).evaluation.profit?.ceilingCny;
    const offers = sourcing.score(OFFERS(d.key, d.cost, d.ship), ceiling);
    db.products.update(id, { sourcing: { keyword: d.kw, via: '示例', at: db.now(), ceilingCny: ceiling, offers, chosen: offers[0].offerId, chosenAt: db.now() }, costCny: d.cost, shippingCny: offers[0].shippingCny });
    const p = products.get(id);
    db.products.update(id, { listing: { pack: pack(p), price: listing.pricing(p), offer: offers[0], compliance: { issues: [], risks: [] }, status: d.state === 'prep' ? 'draft' : 'pushed', at: db.now(), pushes: [] }, launch: { startedAt: dayAgo(8), days: [] }, status: d.state === 'prep' ? 'candidate' : 'testing' });
    const list = (SCRIPT_HOOKS[d.key] || []).map((h, i) => makeScript(p, h, i));
    const entries = rows(p, list, d.state).map((r, i) => ({ id: `d_s${i}`, ...r }));
    db.products.update(id, { launch: { startedAt: dayAgo(8), days: entries } });
  }
  viral.insert(VIRAL);
  db.activity.insert({ type: 'product', text: '载入示例工作区（虚构数据）' });
  return status();
}

const VIRAL = {
  sample: true, status: 'done', title: '示例：叠戴项链 26 秒（虚构报告）', step: '', frames: [], hookFrames: [], warnings: ['这是虚构的示例报告，用来展示拆解的样子。上传你自己的视频才会得到真实分析。'],
  measured: { duration: 26, shotCount: 11, avgShotSeconds: 2.4, firstCutAt: 1.6, speechPerSecond: 2.4 },
  transcript: { text: 'Stop wearing one thin necklace with every outfit. Watch this. One chain, three looks...', source: '示例' },
  analysis: {
    keyReason: '第一秒就同时给出问题和商品：手已经在拉项链，屏幕字和第一句话说的是同一件事。',
    summary: '这条靠「一条项链三种戴法」把单价问题变成划算问题。每 2–3 秒换一个造型，观众想看下一种；最后才给价格，此时已经看过三种用法。',
    takeaways: ['第一帧让手已经在动，不要先露脸寒暄', '屏幕字、口播和画面说同一件事', '把价格放到价值展示之后', '每个镜头只讲一种戴法'],
    hook: { typeName: '结果前置', score: 86, firstFrame: '镜子前，手把项链从单层拉成两层', spokenLine: 'Stop wearing one thin necklace with every outfit.', onScreenText: 'One chain. Three looks.', sound: '轻快流行曲，第一个切点卡拍' },
    timeline: [{ start: 0, end: 3, part: 'Hook', visual: '手拉项链变成两层', voiceover: 'Stop wearing one thin necklace...', why: '动作带来好奇，也说清了卖点' }, { start: 3, end: 16, part: 'Demo', visual: '三套衣服三种戴法', voiceover: 'Work, dinner, weekend.', why: '用场景覆盖不同人群' }, { start: 16, end: 22, part: 'Proof', visual: '手部特写扣头和光泽', voiceover: '[真实佩戴经历]', why: '回答会不会显廉价' }, { start: 22, end: 26, part: 'CTA', visual: '手指向购物车', voiceover: 'Tap the cart.', why: '只给一个动作' }],
    structure: { formula: '结果钩子 → 三个场景 → 细节证明 → 行动号召', pacing: '前 3 秒两次切换，之后每 2–3 秒一切', productTiming: '第 0 秒就出现' },
    scores: { hook: { score: 86, why: '商品和卖点都在第一秒' }, retention: { score: 78, why: '换造型制造期待' }, proof: { score: 64, why: '证明偏弱，没有真实评价' }, conversion: { score: 72, why: '行动清楚，价格锚点一般' }, shareability: { score: 58, why: '可收藏，分享动机一般' } },
    emotionCurve: [{ t: 0, emotion: '好奇', intensity: 8 }, { t: 8, emotion: '期待', intensity: 7 }, { t: 18, emotion: '信任', intensity: 6 }, { t: 25, emotion: '行动', intensity: 8 }],
    basics: { audience: '喜欢日常精致感的年轻女性' }, painAndDesire: { pain: '一条项链搭不了所有衣服', amplify: '用没戴好的画面对比', desire: '花一次钱多几种造型' },
    conversion: { offer: '无明确优惠', cta: 'Tap the cart', urgency: '弱' },
    sellingPoints: [{ point: '可叠戴', show: '拉成两层', proof: '当场演示' }, { point: '百搭', show: '三套衣服', proof: '连续换装' }],
    reusable: { template: '[动作展示结果] → 场景 1 → 场景 2 → 场景 3 → [细节证明] → 只给一个行动', slots: [{ slot: '动作', example: '拉成两层' }], mustKeep: ['第一帧有商品和动作', '价格放在展示之后'], canChange: ['场景', '人物', '音乐'] },
    doNotCopy: ['原视频的台词和人物', '任何品牌名'], compliance: ['材质和防过敏说法要有依据'], limits: '这是示例内容，不代表真实视频分析。',
  },
};

function clear() {
  const ids = new Set();
  for (const p of db.products.all().filter((x) => x.sample)) {
    ids.add(p.id);
    db.products.remove(p.id);
  }
  for (const s of db.scripts.all().filter((x) => x.sample || ids.has(x.productId))) db.scripts.remove(s.id);
  for (const v of viral.all().filter((x) => x.sample)) viral.remove(v.id);
  for (const i of imports.all().filter((x) => x.sample)) imports.remove(i.id);
  return status();
}

function status() {
  return { products: db.products.all().filter((p) => p.sample).length };
}

module.exports = { load, clear, status };
