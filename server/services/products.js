// 智能选品：FastMoss 数据导入 → 六维评估（selection.js）→ AI 批量研判（report.js）→ 单品深度分析 → 测款
const crypto = require('crypto');
const db = require('../db');
const llm = require('../providers/llm');
const settings = require('../settings');
const ctx = require('../ctx');
const rag = require('./rag');
const selection = require('./selection');

// ---------- 导入：列名识别（以 FastMoss「商品搜索」导出的表头为准，兼容其他工具和手动整理的表格） ----------
// 顺序有意义：先精确匹配，再按这个顺序做包含匹配
const FIELDS = {
  name: { label: '商品名称', keys: ['商品名称', '商品标题', '商品名', '标题', 'product name', 'product title', 'title', 'name', '商品'] },
  productId: { label: '商品 ID', keys: ['商品id', '商品ID', 'product id', 'productid'] },
  listingStatus: { label: '商品状态', keys: ['商品状态', 'status'] },
  shop: { label: '店铺', keys: ['店铺名称', '店铺', '小店', 'shop', 'seller'] },
  market: { label: '国家/地区', keys: ['国家/地区', '国家', '地区', '站点', 'region', 'country', 'market'] },
  category: { label: '类目', keys: ['商品分类', '一级类目', '类目', '分类', '品类', 'category'] },
  price: { label: '售价', keys: ['售价', '价格', '商品价格', '单价', 'price'] },
  commissionRate: { label: '佣金比例 %', keys: ['佣金比例', '佣金率', '达人佣金', '佣金', 'commission'] },
  sales7d: { label: '近 7 天销量', keys: ['7天销量', '近7天销量', '近7日销量', '7日销量', '周销量', 'sales(7d)', '7d sales'] },
  gmv: { label: '近 7 天销售额', keys: ['7天销售额', '近7天销售额', '7日销售额', 'gmv(7d)', '7d gmv', '7d revenue'] },
  sales28d: { label: '近 28 天销量', keys: ['28天销量', '近28天销量', '近30天销量', '30天销量', '月销量', '28d sales', '30d sales'] },
  gmv28d: { label: '近 28 天销售额', keys: ['28天销售额', '近28天销售额', '30天销售额', '28d gmv', '28d revenue'] },
  salesTotal: { label: '总销量', keys: ['总销量', '累计销量', 'total sales', 'units sold', '销量'] },
  gmvTotal: { label: '总销售额', keys: ['总销售额', '累计销售额', 'total gmv', 'total revenue', '销售额', 'gmv'] },
  growth: { label: '销量增长率 %', keys: ['销量增长率', '销量环比', '增长率', '环比', 'growth'] },
  creatorConvRate: { label: '达人出单率 %', keys: ['达人出单率', '出单率'] },
  creatorCount: { label: '带货达人数', keys: ['带货达人总数', '带货达人数', '关联达人数', '达人数', '带货达人', 'creators'] },
  videoCount: { label: '带货视频数', keys: ['带货视频总数', '带货视频数', '关联视频数', '视频数', '带货视频', 'videos'] },
  liveCount: { label: '带货直播数', keys: ['带货直播总数', '带货直播数', '直播数', '带货直播', 'lives'] },
  rating: { label: '评分', keys: ['商品评分', '评分', '星级', 'rating'] },
  reviews: { label: '评价数', keys: ['评价数', '评论数', 'reviews'] },
  launchDate: { label: '上架时间', keys: ['预估商品上架时间', '上架时间', '首次上架', '上架日期', 'launch', 'listed'] },
  image: { label: '商品图片', keys: ['商品图片', '主图', '图片', 'image', 'cover'] },
  fastmossUrl: { label: 'FastMoss 商品链接', keys: ['FastMoss商品详情页地址', 'fastmoss链接', '商品详情页', 'fastmoss url'] },
  tiktokUrl: { label: 'TikTok 商品链接', keys: ['TikTok商品落地页地址', '落地页', 'tiktok链接', '商品链接', 'product url'] },
  shopUrl: { label: 'FastMoss 店铺链接', keys: ['FastMoss店铺详情页地址', '店铺详情页', '店铺链接'] },
};
const NUMERIC = ['price', 'sales7d', 'sales28d', 'salesTotal', 'gmv', 'gmv28d', 'gmvTotal', 'growth', 'creatorCount', 'creatorConvRate', 'videoCount', 'liveCount', 'commissionRate', 'rating', 'reviews'];
const PERCENT = ['growth', 'commissionRate', 'creatorConvRate'];

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-（）()：:/]/g, '');

function guessMapping(headers) {
  const map = {};
  const used = new Set();
  for (const pass of ['exact', 'contains']) {
    for (const [field, def] of Object.entries(FIELDS)) {
      if (map[field] !== undefined) continue;
      const idx = headers.findIndex((h, i) => !used.has(i) && def.keys.some((k) => (pass === 'exact' ? norm(h) === norm(k) : norm(h).includes(norm(k)))));
      if (idx >= 0) {
        map[field] = idx;
        used.add(idx);
      }
    }
  }
  return map;
}

// 去掉货币符号："RM13.45"、"$12.99"、"S$5"、"Rp 15.000" → 数字文本
const stripCurrency = (s) => String(s).replace(/US\$|S\$|RM|Rp|[$¥￥€£฿₱₫]/gi, '');

// "$12.99" "1.2万" "12.5k" "35%" "1,234" "-12.3%" "RM5.49 - 18.60"（区间取平均）→ 数字
function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = stripCurrency(String(v).trim()).replace(/[,\s]/g, '');
  if (!s || /^[-–—]+$/.test(s)) return null;
  let mul = 1;
  if (/万$/.test(s)) (mul = 1e4), (s = s.slice(0, -1));
  else if (/亿$/.test(s)) (mul = 1e8), (s = s.slice(0, -1));
  else if (/[kK]$/.test(s)) (mul = 1e3), (s = s.slice(0, -1));
  else if (/[mM]$/.test(s)) (mul = 1e6), (s = s.slice(0, -1));
  s = s.replace(/%$/, '');
  const range = s.split(/[-~–]/).filter(Boolean);
  const n = range.length === 2 && !s.startsWith('-') ? (Number(range[0]) + Number(range[1])) / 2 : Number(s);
  return Number.isFinite(n) ? Math.round(n * mul * 100) / 100 : null;
}

// 售价区间 "RM5.49 - 18.60" → { min: 5.49, max: 18.6 }
function parseRange(v) {
  if (typeof v === 'number') return { min: v, max: v };
  const nums = stripCurrency(String(v ?? '')).replace(/,/g, '').match(/\d+(\.\d+)?/g);
  if (!nums) return null;
  const vals = nums.map(Number);
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function parseDelimited(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const parse = (line) => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') (cur += '"'), i++;
        else q = !q;
      } else if (c === delim && !q) out.push(cur), (cur = '');
      else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  return lines.map(parse);
}

async function parseFile(buffer, filename) {
  if (/\.xlsx$/i.test(filename)) {
    const readXlsx = require('read-excel-file/node');
    const out = await readXlsx(buffer);
    // v9 起返回 [{ sheet, data }]（多个工作表），旧版直接返回二维数组；取数据行最多的工作表
    const sheets = Array.isArray(out) && out[0] && !Array.isArray(out[0]) && out[0].data ? out.map((x) => x.data) : [out];
    const rows = sheets.sort((a, b) => b.length - a.length)[0] || [];
    return rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 19).replace('T', ' ') : c === null || c === undefined ? '' : c)));
  }
  if (/\.xls$/i.test(filename)) throw Object.assign(new Error('暂不支持旧版 .xls，请在 Excel 里另存为 .xlsx 或 .csv'), { status: 400 });
  return parseDelimited(buffer.toString('utf8'));
}

// 预览：找到表头行（前 10 行里非空单元格最多的一行）
const pending = new Map();
function preview(rows) {
  if (!rows?.length) throw Object.assign(new Error('没有读到数据'), { status: 400 });
  let hi = 0;
  rows.slice(0, 10).forEach((r, i) => {
    if (r.filter((c) => String(c).trim()).length > rows[hi].filter((c) => String(c).trim()).length) hi = i;
  });
  const headers = rows[hi].map((h) => String(h).trim());
  const data = rows.slice(hi + 1).filter((r) => r.some((c) => String(c).trim()));
  const token = crypto.randomBytes(12).toString('hex');
  pending.set(token, { headers, data, at: Date.now(), uid: ctx.user()?.id });
  for (const [k, v] of pending) if (Date.now() - v.at > 3600e3) pending.delete(k);
  const mapping = guessMapping(headers);
  return { token, headers, sample: data.slice(0, 5), total: data.length, mapping, fields: Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, v.label])), missing: ['sales7d', 'sales28d', 'gmv', 'creatorCount', 'price'].filter((k) => mapping[k] === undefined).map((k) => FIELDS[k].label) };
}

function fastmossLink(p) {
  if (p.fastmossUrl) return p.fastmossUrl;
  if (p.productId) return `https://www.fastmoss.com/zh/e-commerce/detail/${encodeURIComponent(p.productId)}`;
  return `https://www.fastmoss.com/zh/e-commerce/search?words=${encodeURIComponent(p.name || '')}`;
}

function commit(token, mapping) {
  const job = pending.get(token);
  if (!job || job.uid !== ctx.user()?.id) throw Object.assign(new Error('预览已过期，请重新上传'), { status: 400 });
  if (mapping.name === undefined || mapping.name === '' || mapping.name === null) throw Object.assign(new Error('必须指定「商品名称」对应的列'), { status: 400 });
  let created = 0, updated = 0;
  const ids = [];
  const now = db.now();
  const batchId = crypto.randomBytes(5).toString('hex');
  // Excel 的百分比单元格以小数存储（0.86 = 86%）：该列全是数字且都在 ±10 以内、含小数时按比例换算
  const fraction = {};
  for (const field of PERCENT) {
    const idx = mapping[field];
    if (idx === '' || idx === undefined || idx === null) continue;
    const vals = job.data.map((r) => r[Number(idx)]).filter((v) => v !== '' && v != null);
    fraction[field] = vals.length > 0 && vals.every((v) => typeof v === 'number' && Math.abs(v) <= 10) && vals.some((v) => v % 1 !== 0);
  }
  for (const r of job.data) {
    const p = {};
    for (const [field, idx] of Object.entries(mapping)) {
      if (idx === '' || idx === null || idx === undefined) continue;
      const raw = r[Number(idx)];
      p[field] = NUMERIC.includes(field) ? parseNum(raw) : String(raw ?? '').trim();
      if (fraction[field] && typeof p[field] === 'number') p[field] = Math.round(p[field] * 1000) / 10;
      if (field === 'price') {
        const rg = parseRange(raw);
        p.priceText = String(raw ?? '').trim();
        if (rg) Object.assign(p, { priceMin: rg.min, priceMax: rg.max, price: rg.min });
      }
    }
    if (!p.name) continue;
    if (p.tiktokUrl && /fastmoss\.com/i.test(p.tiktokUrl)) (p.fastmossUrl = p.tiktokUrl), delete p.tiktokUrl;
    if (!p.productId) p.productId = (p.fastmossUrl || p.tiktokUrl || '').match(/(\d{15,22})/)?.[1] || '';
    p.market = selection.marketCode(p.market) || selection.currencyMarket(p.priceText) || p.market || '';
    if (p.growth == null && p.sales7d != null && p.salesPrev) p.growth = Math.round(((p.sales7d - p.salesPrev) / p.salesPrev) * 1000) / 10;
    // 佣金率 / 出单率可能写成 0.15 这种小数
    for (const f of ['commissionRate', 'creatorConvRate']) if (!fraction[f] && p[f] != null && p[f] > 0 && p[f] < 1) p[f] = Math.round(p[f] * 1000) / 10;
    const exist = db.products.all().find((x) => (p.productId && x.productId === p.productId) || (!p.productId && x.name === p.name));
    if (exist) {
      // 数据更新后旧的 AI 结论作废，需要重新研判
      db.products.update(exist.id, { ...p, dataAt: now, batchId, ai: null });
      ids.push(exist.id);
      updated++;
    } else {
      ids.push(db.products.insert({ ...p, source: 'fastmoss', status: 'candidate', dataAt: now, batchId, judgement: {} }).id);
      created++;
    }
  }
  pending.delete(token);
  db.activity.insert({ type: 'product', text: `导入 FastMoss 数据：新增 ${created}，更新 ${updated}` });
  return { created, updated, ids, batchId };
}

// ---------- 评估 ----------
function enrich(p, groups) {
  const ev = selection.assess(p, groups);
  // AI 研判过的以 AI 结论为准，规则结论保留用于对照；但硬伤（定邀、带电、品牌/IP、刷单数据、客单价太低）AI 不能推翻
  const hard = ev.flags.some((f) => f.level === 'block');
  const verdict = hard ? '不建议上' : p.ai?.verdict || ev.verdict;
  return { ...p, fastmossLink: fastmossLink(p), evaluation: { ...ev, ruleVerdict: ev.verdict, verdict, aiOverruled: !!(hard && p.ai && p.ai.verdict !== '不建议上') } };
}

const VERDICT_ORDER = { 可以上: 0, 谨慎测试: 1, 数据不足: 2, 不建议上: 3 };

function list({ q, status, verdict, category, sort = 'score', batch } = {}) {
  const all = db.products.all();
  const groups = selection.population(all);
  let items = all.map((p) => enrich(p, groups));
  if (q) {
    const k = q.toLowerCase();
    items = items.filter((p) => `${p.name} ${p.category || ''} ${p.shop || ''} ${p.evaluation.metrics.type}`.toLowerCase().includes(k));
  }
  if (status) items = items.filter((p) => (p.status || 'candidate') === status);
  if (verdict) items = items.filter((p) => p.evaluation.verdict === verdict);
  if (category) items = items.filter((p) => p.category === category);
  if (batch) items = items.filter((p) => p.batchId === batch);
  const sc = (p) => p.ai?.score ?? p.evaluation.score ?? -1;
  const by = {
    score: (a, b) => (VERDICT_ORDER[a.evaluation.verdict] ?? 9) - (VERDICT_ORDER[b.evaluation.verdict] ?? 9) || sc(b) - sc(a),
    sales: (a, b) => (b.sales7d ?? b.salesTotal ?? 0) - (a.sales7d ?? a.salesTotal ?? 0),
    gmv: (a, b) => (b.gmv ?? 0) - (a.gmv ?? 0),
    trend: (a, b) => (b.evaluation.metrics.momentum ?? -1) - (a.evaluation.metrics.momentum ?? -1),
    profit: (a, b) => (b.evaluation.profit?.margin ?? b.evaluation.profit?.ceilingCny ?? -1e9) - (a.evaluation.profit?.margin ?? a.evaluation.profit?.ceilingCny ?? -1e9),
    recent: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
  };
  return items.sort(by[sort] || by.score);
}

function get(id) {
  const p = db.products.get(id);
  return p ? enrich(p, selection.population(db.products.all())) : null;
}

function categories() {
  return [...new Set(db.products.all().map((p) => p.category).filter(Boolean))];
}

// 给 AI 的单品数据摘要
function brief(p) {
  const ev = p.evaluation;
  const m = ev.metrics;
  return {
    商品: p.name, 店铺: p.shop, 站点: m.market, 类目: p.category, 品型: m.type, 标价: p.priceText || p.price, 成交均价: `${m.currency}${m.asp}`,
    近7天销量: p.sales7d, 近7天销售额: p.gmv, 近28天销量: p.sales28d, 累计销量: p.salesTotal, 上架天数: m.ageDays, 趋势倍数: m.momentum, 阶段: ev.stage,
    带货达人: p.creatorCount, 达人出单率: p.creatorConvRate, 带货视频: p.videoCount, 带货直播: p.liveCount, 佣金: p.commissionRate,
  };
}

// ---------- 单品深度分析 ----------
async function analyze(id) {
  const p = get(id);
  if (!p) throw Object.assign(new Error('商品不存在'), { status: 404 });
  const ev = p.evaluation;
  const store = settings.get().store;
  const kb = await rag.contextFor(`TikTok 选品 测款 竞品分析 ${ev.metrics.type} ${p.category || ''}`, 4);
  const result = await llm.completeJSON(
    `你是资深 TikTok Shop 跨境选品操盘手（${store.mode === 'local' ? '本土店' : '中国跨境卖家'}）。下面是 FastMoss 导出的真实数据、系统的六维评估和风险标记。请做单品深度分析：结论具体、可执行，每条理由都要引用数据；数据里没有的不要编造，估算要写明是估算。

商品数据：${JSON.stringify(brief(p))}
六维评估：${JSON.stringify(ev.dims.map((d) => `${d.label} ${d.score ?? '—'} 分：${d.summary}${d.evidence.length ? '（' + d.evidence.join('；') + '）' : ''}`))}
风险标记：${JSON.stringify(ev.flags.map((f) => `[${f.level}] ${f.title}：${f.detail}`))}
利润倒推：${JSON.stringify(ev.profit)}
人工判断：${JSON.stringify(p.judgement || {})}
${p.reviewsText ? `\n买家评论 / 差评（用户从 FastMoss 商品评论复制）：\n${String(p.reviewsText).slice(0, 4000)}\n` : ''}${kb ? `\n内部知识库参考：\n${kb}\n` : ''}
只输出 JSON：
{
 "verdict": "可以上 | 谨慎测试 | 不建议上",
 "why": ["结论的理由，每条结合具体数据（需求、趋势、达人、竞争、利润、风险）"],
 "audience": "目标人群画像（年龄、场景、痛点），结合站点的本地消费习惯",
 "sellingPoints": [{"point": "卖点", "howToShow": "视频里怎么拍出来"}],
 "competitors": "竞品与市场判断：头部店铺/品牌、价格带、我们的差异化切入点",
 "reviewInsights": ${p.reviewsText ? '["从评论里提炼的痛点和改良机会，按出现频率排序"]' : '[]'},
 "risks": ["风险：合规认证/物流/退货/侵权/季节性等"],
 "sourcing": "1688 找货：中文搜索关键词、规格要求、预估采购价区间（写明是估算），以及按利润倒推的采购价上限 ¥${ev.profit?.ceilingCny ?? '?'} 能否找到货",
 "testPlan": {"inventory": "首批备货量", "creators": "达人寄样数量与达人类型", "videos": "自营视频条数与内容角度", "budget": "测试预算（${ev.metrics.currency}）", "successMetrics": "成功标准（CTR、转化率、ROI 等具体数值）", "stopLoss": "止损线"},
 "benchmarkAngles": ["建议对标的视频角度（钩子 + 演示方式）"]
}`,
    { system: '你只输出 JSON。你熟悉 TikTok Shop 美区和东南亚市场、FastMoss 数据和 1688 供应链。', maxTokens: 6000 },
  );
  db.products.update(id, { analysis: result, analyzedAt: db.now() });
  db.activity.insert({ type: 'product', text: `AI 单品分析：${p.name}（${result.verdict || ''}）` });
  return result;
}

function patch(id, body) {
  const allowed = ['status', 'costCny', 'shippingCny', 'judgement', 'notes', 'name', 'category', 'fastmossUrl', 'tiktokUrl', 'sourceUrl', 'reviewsText'];
  const clean = {};
  for (const k of allowed) if (body[k] !== undefined) clean[k] = ['costCny', 'shippingCny'].includes(k) ? parseNum(body[k]) : body[k];
  if (clean.reviewsText != null) clean.reviewsText = String(clean.reviewsText).slice(0, 20000);
  if (clean.judgement) clean.judgement = { ...(db.products.get(id)?.judgement || {}), ...clean.judgement };
  const p = db.products.update(id, clean);
  if (!p) throw Object.assign(new Error('商品不存在'), { status: 404 });
  return get(id);
}

function createManual(body) {
  if (!body.name) throw Object.assign(new Error('请填写商品名称'), { status: 400 });
  const p = { name: String(body.name).trim(), source: 'manual', status: 'candidate', judgement: {}, dataAt: db.now() };
  for (const k of ['category', 'shop', 'market', 'fastmossUrl', 'tiktokUrl', 'productId', 'launchDate']) if (body[k]) p[k] = String(body[k]).trim();
  for (const k of NUMERIC) if (body[k] !== undefined && body[k] !== '') p[k] = parseNum(body[k]);
  p.market = selection.marketCode(p.market) || p.market || '';
  if (p.price != null) Object.assign(p, { priceMin: p.price, priceMax: p.price });
  if (!p.productId) p.productId = (p.fastmossUrl || p.tiktokUrl || '').match(/(\d{15,22})/)?.[1] || '';
  return get(db.products.insert(p).id);
}

// 早期版本写入的演示商品不是真实数据，启动时清理
function removeDemo() {
  const all = db.products.all();
  const real = all.filter((p) => p.source !== 'demo');
  if (real.length !== all.length) db.products.replaceAll(real);
}

module.exports = { FIELDS, preview, parseFile, parseDelimited, commit, list, get, categories, analyze, patch, createManual, removeDemo, parseNum, brief };
