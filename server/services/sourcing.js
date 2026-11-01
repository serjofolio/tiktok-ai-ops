// 找货：给选中的商品在 1688 找同款供应商
// 1. 生成 1688 中文搜索词（AI）+ 商品主图 → 关键词搜货 + 以图搜货（API 或浏览器插件送来的结果）
// 2. 多供应商比价矩阵：阶梯价 30%、库存深度 20%、发货地 15%、单件重量 15%、SKU 丰富度 10%、商品状态 10%（权重可调）
// 3. AI 判断是不是同款；按「采购 + 物流 ≤ 成本上限」标出利润是否成立
// 4. 选定供应商后，采购价和估算物流自动填进利润测算
const db = require('../db');
const llm = require('../providers/llm');
const settings = require('../settings');
const connectors = require('../connectors');
const products = require('./products');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const WEIGHTS = { price: 30, stock: 20, origin: 15, weight: 15, sku: 10, status: 10 };
const DIM_LABEL = { price: '阶梯价', stock: '库存深度', origin: '发货地', weight: '单件重量', sku: 'SKU 丰富度', status: '商品状态' };
// 跨境集货仓集中在广东，浙江/福建/江苏/上海也有成熟的跨境物流
const NEAR = /广东|深圳|广州|东莞|佛山|汕头|揭阳|中山|惠州|浙江|义乌|金华|宁波|杭州|温州|台州|福建|泉州|厦门|莆田|江苏|上海/;

const opts = () => {
  const s = settings.get().selection || {};
  return { weights: { ...WEIGHTS, ...(s.sourcingWeights || {}) }, perKg: s.shipping?.perKg ?? 30, perItem: s.shipping?.perItem ?? 2 };
};

// 估算单件物流（¥）：按重量 × 每公斤运费 + 每件操作费；没有重量时按 0.2kg 估
function shippingCny(o, { perKg, perItem } = opts()) {
  const kg = o.unitWeight ?? 0.2;
  return Math.round((Math.max(kg, 0.05) * perKg + perItem) * 10) / 10;
}

const curve = (x, pts) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return pts[i - 1][1] + ((x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])) * (pts[i][1] - pts[i - 1][1]);
  return pts.at(-1)[1];
};

// 比价矩阵：每个维度 0-100，按权重加权
function score(offers, ceilingCny) {
  const { weights, perKg, perItem } = opts();
  const prices = offers.map((o) => o.price).filter((x) => x > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return offers.map((o) => {
    const d = {
      price: o.price > 0 && minPrice ? (minPrice / o.price) * 100 : 40,
      stock: o.amountOnSale == null ? 50 : curve(Math.log10(o.amountOnSale + 1), [[1, 15], [2, 40], [3, 70], [4, 100]]),
      origin: !o.sendGoodsAddress ? 50 : NEAR.test(o.sendGoodsAddress) ? 100 : 60,
      weight: o.unitWeight == null ? 50 : curve(o.unitWeight, [[0.05, 100], [0.1, 85], [0.2, 70], [0.5, 45], [1, 25], [3, 5]]),
      sku: !o.skuCount ? 40 : curve(o.skuCount, [[1, 30], [2, 50], [5, 75], [10, 100]]),
      status: o.status === 'published' ? 100 : 0,
    };
    const matrix = Math.round(Object.entries(d).reduce((a, [k, v]) => a + v * (weights[k] || 0), 0) / total);
    const ship = shippingCny(o, { perKg, perItem });
    const landed = o.price != null ? Math.round((o.price + ship) * 10) / 10 : null;
    return { ...o, dims: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.round(v)])), matrix, shippingCny: ship, landedCny: landed, profitOk: landed != null && ceilingCny != null ? landed <= ceilingCny : null };
  });
}

// 综合排序：同款匹配度优先（不是同款的价格再低也没用），其次比价矩阵
const rank = (a, b) => (b.match ?? 60) * 0.5 + b.matrix * 0.5 - ((a.match ?? 60) * 0.5 + a.matrix * 0.5) || (a.landedCny ?? 1e9) - (b.landedCny ?? 1e9);

// 1688 中文搜索词：优先用已有的 AI 研判结果，没有就让模型翻译提炼一次
async function keywordFor(p) {
  if (p.kw1688) return p.kw1688;
  if (p.ai?.kw1688) return p.ai.kw1688;
  if (!settings.activeProvider()) return p.evaluation.metrics.type;
  const r = await llm.completeJSON(`把这个 TikTok Shop 商品标题提炼成 1688 中文搜索关键词（4-12 个字，写品类和关键规格，不要品牌名和型号兼容列表），只输出 JSON {"kw": "..."}。\n标题：${p.name}`, { maxTokens: 300, noThinking: true, timeoutMs: 60000 });
  const kw = String(r.kw || '').trim().slice(0, 30) || p.evaluation.metrics.type;
  db.products.update(p.id, { kw1688: kw });
  return kw;
}

// AI 判断每个货源是不是同款（看标题、价格、规格），给 0-100 分和一句话说明
async function matchOffers(p, offers) {
  if (!settings.activeProvider() || !offers.length) return offers;
  try {
    const out = await llm.completeJSON(`判断下面的 1688 货源是不是这个 TikTok 商品的同款（或可替代的同类款），给 0-100 分：90+ 基本同款，70-89 同类可替代，50-69 相近但规格不同，<50 不是一个东西。
TikTok 商品：${p.name}（成交均价 ${p.evaluation.metrics.currency}${p.evaluation.metrics.asp}）
1688 货源：${JSON.stringify(offers.slice(0, 30).map((o, i) => ({ i: i + 1, 标题: o.title, 价格: o.price, SKU数: o.skuCount })))}
只输出 JSON：{"items": [{"i": 1, "match": 0-100, "note": "一句话：哪里一样/哪里不同"}]}`, { maxTokens: 4000, noThinking: true, timeoutMs: 120000 });
    for (const m of out.items || []) {
      const o = offers[Number(m.i) - 1];
      if (o) Object.assign(o, { match: Math.max(0, Math.min(100, Number(m.match) || 0)), matchNote: String(m.note || '').slice(0, 80) });
    }
  } catch (e) {
    console.warn('[sourcing] 同款判断失败：', e.message);
  }
  return offers;
}

function dedupe(list) {
  const seen = new Map();
  for (const o of list) {
    const k = o.offerId || o.url || o.title;
    if (!k) continue;
    seen.set(k, { ...(seen.get(k) || {}), ...Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))) });
  }
  return [...seen.values()];
}

function saveResult(p, offers, meta) {
  const ceiling = p.evaluation.profit?.ceilingCny ?? null;
  const scored = score(offers, ceiling).sort(rank);
  const prev = db.products.get(p.id)?.sourcing || {};
  const sourcing = { ...prev, ...meta, at: db.now(), ceilingCny: ceiling, offers: scored.slice(0, 40) };
  db.products.update(p.id, { sourcing });
  return sourcing;
}

// 通过 API 搜货（关键词 + 以图搜，取前几个补详情）
async function search(id, { keyword } = {}) {
  const p = products.get(id);
  if (!p) throw err('商品不存在', 404);
  const cons = connectors.active('sourcing');
  if (!cons.length) throw err('还没有可用的 1688 接口：在「接入配置 → 数据源与 ERP」里添加 1688 官方或第三方数据接口；也可以用浏览器插件在 1688 页面一键采集', 400);
  const kw = keyword || (await keywordFor(p));
  if (keyword) db.products.update(p.id, { kw1688: keyword });
  const found = [];
  const errors = [];
  for (const c of cons) {
    const a = connectors.adapter(c);
    const jobs = [a.keyword(c, kw)];
    if (p.image && a.image) jobs.push(a.image(c, p.image));
    for (const r of await Promise.allSettled(jobs)) r.status === 'fulfilled' ? found.push(...r.value) : errors.push(`${c.name}：${r.reason.message}`);
  }
  let offers = dedupe(found).filter((o) => o.title && o.price != null);
  if (!offers.length) throw err(errors.length ? errors.join('；') : `用「${kw}」没有搜到货源，换个关键词试试`, errors.length ? 424 : 400);
  // 预筛：先按价格和是否在售粗排，前 8 个补商品详情（阶梯价、库存、重量、发货地）
  offers = score(offers, p.evaluation.profit?.ceilingCny).sort((a, b) => b.matrix - a.matrix);
  const c0 = cons[0];
  const a0 = connectors.adapter(c0);
  if (a0.detail) {
    const details = await Promise.allSettled(offers.slice(0, 8).filter((o) => o.offerId).map((o) => a0.detail(c0, o.offerId)));
    offers = dedupe([...offers, ...details.filter((r) => r.status === 'fulfilled' && r.value.offerId).map((r) => r.value)]);
  }
  offers = await matchOffers(p, offers.slice(0, 30));
  return saveResult(p, offers, { keyword: kw, via: cons.map((c) => c.name).join('、'), errors });
}

// 浏览器插件 / 手动送来的货源
async function addOffers(id, raw, source = '浏览器插件') {
  const p = products.get(id);
  if (!p) throw err('商品不存在', 404);
  const incoming = (Array.isArray(raw) ? raw : [raw]).map((o) => connectors.normalizeOffer(o, source)).filter((o) => o.title || o.url);
  if (!incoming.length) throw err('没有识别到货源');
  const merged = dedupe([...(p.sourcing?.offers || []), ...incoming]);
  const fresh = merged.filter((o) => o.match == null);
  await matchOffers(p, fresh);
  return saveResult(p, merged, { via: p.sourcing?.via ? `${p.sourcing.via}、${source}` : source });
}

// 选定供应商：采购价（按起批价）和估算物流写进利润测算
function choose(id, offerId) {
  const p = db.products.get(id);
  const o = p?.sourcing?.offers?.find((x) => x.offerId === offerId || x.url === offerId);
  if (!o) throw err('货源不存在', 404);
  db.products.update(id, { sourcing: { ...p.sourcing, chosen: o.offerId || o.url, chosenAt: db.now() }, costCny: o.price, shippingCny: o.shippingCny });
  return products.get(id);
}

// 没有 API 时：给出可以直接打开的 1688 搜索链接
function links(p, kw) {
  return {
    keywordUrl: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}&charset=utf8`,
    // 装了插件：打开 1688 后插件自动搜索 / 上传主图以图搜，采集结果并补详情
    autoKeywordUrl: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}&charset=utf8#tkops=${p.id}&mode=keyword`,
    autoImageUrl: p.image ? `https://www.1688.com/#tkops=${p.id}&mode=image` : null,
  };
}

module.exports = { search, addOffers, choose, score, links, keywordFor, WEIGHTS, DIM_LABEL, shippingCny };
