// 智能选品：FastMoss 数据导入 → 硬指标检查 + 利润测算 → AI 选品分析 → 测款方案
const db = require('../db');
const llm = require('../providers/llm');
const settings = require('../settings');
const ctx = require('../ctx');
const rag = require('./rag');

// ---------- 导入：列名识别（FastMoss 中英文导出、手动整理的表格都能认） ----------
const FIELDS = {
  name: { label: '商品名称', keys: ['商品名称', '商品标题', '商品名', '标题', '商品', 'product name', 'product title', 'title', 'product', 'name'] },
  productId: { label: '商品 ID', keys: ['商品id', '商品ID', 'product id', 'productid', 'id'] },
  price: { label: '售价', keys: ['售价', '价格', '商品价格', '均价', '单价', 'price', 'avg price'] },
  sales7d: { label: '近 7 天销量', keys: ['近7天销量', '7天销量', '近7日销量', '7日销量', '周销量', '销量(近7天)', 'sales(7d)', '7d sales', 'units sold 7d'] },
  salesPrev: { label: '上一周期销量', keys: ['上周销量', '前7天销量', '上期销量', 'prev sales'] },
  sales28d: { label: '近 28 天销量', keys: ['近28天销量', '28天销量', '近30天销量', '30天销量', '月销量', '28d sales', '30d sales'] },
  salesTotal: { label: '总销量', keys: ['总销量', '累计销量', '销量', 'total sales', 'units sold', 'sales'] },
  gmv: { label: '销售额', keys: ['近7天销售额', '7天销售额', '销售额', 'gmv', '成交金额', 'revenue'] },
  growth: { label: '销量增长率 %', keys: ['销量增长率', '销量环比', '增长率', '环比', '涨幅', 'growth', 'growth rate'] },
  creatorCount: { label: '带货达人数', keys: ['带货达人数', '关联达人数', '达人数', '关联达人', '带货达人', 'creators', 'influencers'] },
  videoCount: { label: '带货视频数', keys: ['带货视频数', '关联视频数', '视频数', '关联视频', '带货视频', 'videos'] },
  liveCount: { label: '带货直播数', keys: ['带货直播数', '直播数', '关联直播', 'lives'] },
  commissionRate: { label: '佣金率 %', keys: ['佣金比例', '佣金率', '达人佣金', '佣金', 'commission'] },
  rating: { label: '评分', keys: ['商品评分', '评分', '星级', 'rating'] },
  reviews: { label: '评价数', keys: ['评价数', '评论数', 'reviews'] },
  shop: { label: '店铺', keys: ['店铺名称', '店铺', '小店', 'shop', 'seller'] },
  shopCount: { label: '在售店铺数', keys: ['在售店铺数', '店铺数', '同款店铺', 'shops'] },
  category: { label: '类目', keys: ['一级类目', '类目', '分类', '品类', 'category'] },
  market: { label: '国家/地区', keys: ['国家/地区', '国家', '地区', '站点', 'region', 'country', 'market'] },
  launchDate: { label: '上架时间', keys: ['上架时间', '首次上架', '上架日期', 'launch', 'listed'] },
  fastmossUrl: { label: 'FastMoss 链接', keys: ['fastmoss链接', 'fastmoss', '详情链接', 'fastmoss url'] },
  tiktokUrl: { label: 'TikTok 商品链接', keys: ['商品链接', 'tiktok链接', '链接', 'url', 'link', 'product url'] },
  image: { label: '商品图片', keys: ['商品图片', '主图', '图片', 'image', 'cover'] },
};
const NUMERIC = ['price', 'sales7d', 'salesPrev', 'sales28d', 'salesTotal', 'gmv', 'growth', 'creatorCount', 'videoCount', 'liveCount', 'commissionRate', 'rating', 'reviews', 'shopCount'];

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-（）()：:]/g, '');

function guessMapping(headers) {
  const map = {};
  const used = new Set();
  // 先精确匹配，再包含匹配，避免「销量」抢走「近7天销量」
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

// "$12.99" "1.2万" "12.5k" "35%" "1,234" "-12.3%" → 数字
function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[,$¥￥€£\s]/g, '');
  if (!s || s === '-' || s === '--') return null;
  let mul = 1;
  if (/万$/.test(s)) (mul = 1e4), (s = s.slice(0, -1));
  else if (/亿$/.test(s)) (mul = 1e8), (s = s.slice(0, -1));
  else if (/[kK]$/.test(s)) (mul = 1e3), (s = s.slice(0, -1));
  else if (/[mM]$/.test(s)) (mul = 1e6), (s = s.slice(0, -1));
  s = s.replace(/%$/, '');
  const range = s.split(/[-~]/).filter(Boolean); // 价格区间取平均
  const n = range.length === 2 && !s.startsWith('-') ? (Number(range[0]) + Number(range[1])) / 2 : Number(s);
  return Number.isFinite(n) ? Math.round(n * mul * 100) / 100 : null;
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
    return rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? '' : c)));
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
  const token = require('crypto').randomBytes(12).toString('hex');
  pending.set(token, { headers, data, at: Date.now(), uid: ctx.user()?.id });
  for (const [k, v] of pending) if (Date.now() - v.at > 3600e3) pending.delete(k);
  return { token, headers, sample: data.slice(0, 5), total: data.length, mapping: guessMapping(headers), fields: Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, v.label])) };
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
  const now = db.now();
  // Excel 的百分比单元格以小数存储（0.86 = 86%）：该列全是数字且都在 ±10 以内、含小数时按比例换算
  const fraction = {};
  for (const field of ['growth', 'commissionRate']) {
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
    }
    if (!p.name) continue;
    if (p.tiktokUrl && /fastmoss\.com/i.test(p.tiktokUrl)) (p.fastmossUrl = p.tiktokUrl), delete p.tiktokUrl;
    if (!p.productId) p.productId = (p.fastmossUrl || p.tiktokUrl || '').match(/(\d{15,22})/)?.[1] || '';
    // 没有增长率但有上一周期销量时自行计算
    if (p.growth == null && p.sales7d != null && p.salesPrev) p.growth = Math.round(((p.sales7d - p.salesPrev) / p.salesPrev) * 1000) / 10;
    // 佣金率可能是 0.15 这种小数
    if (!fraction.commissionRate && p.commissionRate != null && p.commissionRate > 0 && p.commissionRate < 1) p.commissionRate = Math.round(p.commissionRate * 1000) / 10;
    const exist = db.products.all().find((x) => (p.productId && x.productId === p.productId) || (!p.productId && x.name === p.name));
    if (exist) {
      db.products.update(exist.id, { ...p, dataAt: now });
      updated++;
    } else {
      db.products.insert({ ...p, source: 'fastmoss', status: 'candidate', dataAt: now, judgement: {} });
      created++;
    }
  }
  pending.delete(token);
  return { created, updated };
}

// ---------- 评估：硬指标 + 利润测算 ----------
function evaluate(p) {
  const a = settings.get().selection;
  const checks = [];
  const add = (key, title, status, detail) => checks.push({ key, title, status, detail });

  // 1. 销量在增长
  if (p.growth != null) add('growth', '销量在增长', p.growth >= 20 ? 'pass' : p.growth >= 0 ? 'warn' : 'fail', `销量环比 ${p.growth > 0 ? '+' : ''}${p.growth}%${p.growth >= 20 ? '，处于上升期' : p.growth >= 0 ? '，增长偏弱，需看是否刚过高峰' : '，正在下滑，谨慎'}`);
  else add('growth', '销量在增长', 'unknown', '缺少增长率数据：在 FastMoss 导出时带上「销量增长率」或上一周期销量');

  // 2. 利润够
  const price = p.price || 0;
  const commission = p.commissionRate ?? a.creatorRate;
  const fees = price * ((a.platformFeeRate + commission + a.returnRate + a.adRate) / 100);
  let profit = null;
  if (price && p.cost != null) {
    const unit = price - fees - (p.cost || 0) - (p.shipping || 0);
    const margin = (unit / price) * 100;
    profit = { price, cost: p.cost, shipping: p.shipping || 0, platformFee: (price * a.platformFeeRate) / 100, creatorFee: (price * commission) / 100, returnReserve: (price * a.returnRate) / 100, adReserve: (price * a.adRate) / 100, unitProfit: Math.round(unit * 100) / 100, margin: Math.round(margin * 10) / 10, commission };
    add('profit', '利润够', margin >= a.targetMargin ? 'pass' : margin >= a.targetMargin / 2 ? 'warn' : 'fail', `扣除平台 ${a.platformFeeRate}%、达人 ${commission}%、退货 ${a.returnRate}%、广告 ${a.adRate}% 和采购物流后，单件净利 $${profit.unitProfit}，净利率 ${profit.margin}%（目标 ≥ ${a.targetMargin}%）`);
  } else add('profit', '利润够', 'unknown', price ? '还没填采购价和物流成本：在 1688 找到货源后填入，即可算出净利' : '缺少售价');

  // 3. 对标视频足够多
  if (p.videoCount != null) add('videos', '对标视频足够多', p.videoCount >= 50 ? 'pass' : p.videoCount >= 10 ? 'warn' : 'fail', `已有 ${p.videoCount} 条带货视频${p.videoCount >= 50 ? '，可拆解的爆款结构充足' : p.videoCount >= 10 ? '，对标素材偏少' : '，几乎没有可对标内容，内容需从零验证'}`);
  else add('videos', '对标视频足够多', 'unknown', '缺少带货视频数');

  // 4. 价格带适合冲动消费
  if (price) add('price', '价格适合冲动下单', price >= 10 && price <= 40 ? 'pass' : price < 10 ? 'warn' : price <= 60 ? 'warn' : 'fail', `售价 $${price}${price >= 10 && price <= 40 ? '，在 $10–40 冲动消费区间' : price < 10 ? '，客单价低，利润空间容易被物流吃掉' : '，偏高，需要更强的信任和演示'}`);

  // 5. 竞争与达人分布：有多个达人在带说明需求真实，但不能被少数店铺垄断
  if (p.creatorCount != null) {
    const st = p.creatorCount >= 20 && p.creatorCount <= 800 ? 'pass' : p.creatorCount < 20 ? 'warn' : 'warn';
    add('creators', '有人在卖但没被垄断', st, `${p.creatorCount} 位达人在带货${p.shopCount != null ? `，${p.shopCount} 家店铺在售` : ''}${p.creatorCount < 20 ? '，需求验证不足' : p.creatorCount > 800 ? '，竞争已很激烈，需要差异化' : '，需求真实且仍有空间'}`);
  } else add('creators', '有人在卖但没被垄断', 'unknown', '缺少带货达人数');

  // 6. 人工判断：卖点可视化、自己也想买
  const j = p.judgement || {};
  add('visual', '卖点能被拍出来', j.visual === true ? 'pass' : j.visual === false ? 'fail' : 'unknown', j.visual === true ? '3 秒内能拍出使用前后对比或效果' : j.visual === false ? '卖点难以在视频里直观展示' : '请人工判断：卖点能否在 3 秒内拍出来');
  add('wantBuy', '自己看到也想买', j.wantBuy === true ? 'pass' : j.wantBuy === false ? 'fail' : 'unknown', j.wantBuy === true ? '有真实的购买冲动' : j.wantBuy === false ? '自己都不想买，慎重' : '请人工判断');

  const pass = checks.filter((c) => c.status === 'pass').length;
  const fail = checks.filter((c) => c.status === 'fail').length;
  const unknown = checks.filter((c) => c.status === 'unknown').length;
  const hardFail = checks.some((c) => ['growth', 'profit'].includes(c.key) && c.status === 'fail');
  const verdict = hardFail || fail >= 2 ? '建议放弃' : unknown >= 3 ? '数据不足' : pass >= 5 && fail === 0 ? '推荐测款' : '再观察';
  return { checks, profit, verdict, score: { pass, fail, unknown, total: checks.length }, assumptions: a };
}

function enrich(p) {
  return { ...p, fastmossLink: fastmossLink(p), evaluation: evaluate(p) };
}

function list({ q, status, category, sort = 'growth' } = {}) {
  let items = db.products.all().map(enrich);
  if (q) {
    const k = q.toLowerCase();
    items = items.filter((p) => `${p.name} ${p.category || ''} ${p.shop || ''}`.toLowerCase().includes(k));
  }
  if (status) items = items.filter((p) => (p.status || 'candidate') === status);
  if (category) items = items.filter((p) => p.category === category);
  const by = {
    growth: (a, b) => (b.growth ?? -1e9) - (a.growth ?? -1e9),
    sales: (a, b) => (b.sales7d ?? b.salesTotal ?? 0) - (a.sales7d ?? a.salesTotal ?? 0),
    videos: (a, b) => (b.videoCount ?? 0) - (a.videoCount ?? 0),
    margin: (a, b) => (b.evaluation.profit?.margin ?? -1e9) - (a.evaluation.profit?.margin ?? -1e9),
    pass: (a, b) => b.evaluation.score.pass - a.evaluation.score.pass,
    recent: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
  };
  return items.sort(by[sort] || by.growth);
}

function get(id) {
  const p = db.products.get(id);
  return p ? enrich(p) : null;
}

function categories() {
  return [...new Set(db.products.all().map((p) => p.category).filter(Boolean))];
}

// ---------- AI 选品分析 ----------
async function analyze(id) {
  const p = get(id);
  if (!p) throw Object.assign(new Error('商品不存在'), { status: 404 });
  const ev = p.evaluation;
  const store = settings.get().store;
  const ctx = await rag.contextFor(`TikTok 选品 测款 竞品分析 ${p.category || ''} ${p.name}`, 4);
  const data = {
    商品: p.name, 类目: p.category, 站点: p.market || store.market, 售价美元: p.price, 近7天销量: p.sales7d, 近28天销量: p.sales28d, 总销量: p.salesTotal, 销售额: p.gmv, 销量环比: p.growth,
    带货达人数: p.creatorCount, 带货视频数: p.videoCount, 带货直播数: p.liveCount, 在售店铺数: p.shopCount, 店铺: p.shop, 佣金率: p.commissionRate, 评分: p.rating, 评价数: p.reviews, 上架时间: p.launchDate,
    采购价: p.cost, 物流成本: p.shipping, 人工备注: p.judgement?.notes,
  };
  const result = await llm.completeJSON(
    `你是资深 TikTok Shop 跨境选品操盘手。下面是从 FastMoss 导出的真实商品数据和系统的硬指标检查结果。请做选品分析，结论要具体、可执行，不要空话；数据缺失时明确指出需要补什么，不要编造数字。

商品数据：${JSON.stringify(data)}
硬指标检查：${JSON.stringify(ev.checks.map((c) => `${c.title}：${c.status}，${c.detail}`))}
利润测算：${JSON.stringify(ev.profit)}
${ctx ? `\n内部知识库参考：\n${ctx}\n` : ''}
输出 JSON，字段如下：
{
 "verdict": "推荐测款 | 再观察 | 建议放弃",
 "why": ["为什么选（或不选）这个品，每条结合具体数据"],
 "audience": "目标人群画像（年龄、场景、痛点）",
 "sellingPoints": [{"point": "卖点", "howToShow": "视频里怎么拍出来"}],
 "competitors": "竞品与市场判断：竞争程度、价格带、差评常见点可能是什么、我们的差异化切入点",
 "risks": ["风险：政策/物流/退货/侵权/季节性等"],
 "sourcing": "1688 找货建议：搜索关键词（中文）、规格要求、目标采购价上限（按售价和 ${ev.assumptions.targetMargin}% 净利倒推）",
 "testPlan": {"inventory": "首批备货量", "creators": "达人寄样数量与达人类型", "videos": "自营视频条数与内容角度", "budget": "测试预算（美元）", "successMetrics": "成功标准（CTR、转化率、ROI 等具体数值）", "stopLoss": "止损线"},
 "benchmarkAngles": ["建议对标的视频角度（钩子 + 演示方式）"]
}`,
    { system: '你只输出 JSON。你熟悉 TikTok Shop 美区/东南亚市场、FastMoss 数据和 1688 供应链。' },
  );
  db.products.update(id, { analysis: result, analyzedAt: db.now() });
  db.activity.insert({ type: 'product', text: `AI 选品分析：${p.name}（${result.verdict || ''}）` });
  return result;
}

function patch(id, body) {
  const allowed = ['status', 'cost', 'shipping', 'judgement', 'notes', 'name', 'category', 'price', 'fastmossUrl', 'tiktokUrl', 'sourceUrl'];
  const clean = {};
  for (const k of allowed) if (body[k] !== undefined) clean[k] = ['cost', 'shipping', 'price'].includes(k) ? parseNum(body[k]) : body[k];
  if (clean.judgement) clean.judgement = { ...(db.products.get(id)?.judgement || {}), ...clean.judgement };
  const p = db.products.update(id, clean);
  if (!p) throw Object.assign(new Error('商品不存在'), { status: 404 });
  return enrich(p);
}

function createManual(body) {
  if (!body.name) throw Object.assign(new Error('请填写商品名称'), { status: 400 });
  const p = { name: String(body.name).trim(), source: 'manual', status: 'candidate', judgement: {}, dataAt: db.now() };
  for (const k of ['category', 'shop', 'market', 'fastmossUrl', 'tiktokUrl', 'productId']) if (body[k]) p[k] = String(body[k]).trim();
  for (const k of NUMERIC) if (body[k] !== undefined && body[k] !== '') p[k] = parseNum(body[k]);
  if (!p.productId) p.productId = (p.fastmossUrl || p.tiktokUrl || '').match(/(\d{15,22})/)?.[1] || '';
  return enrich(db.products.insert(p));
}

// 早期版本写入的演示商品不是真实数据，启动时清理
function removeDemo() {
  const all = db.products.all();
  const real = all.filter((p) => p.source !== 'demo');
  if (real.length !== all.length) db.products.replaceAll(real);
}

module.exports = { FIELDS, preview, parseFile, parseDelimited, commit, list, get, categories, analyze, patch, createManual, evaluate, removeDemo, parseNum };
