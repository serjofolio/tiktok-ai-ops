// AI 上架包：把「选好的商品 + 选定的 1688 货源」变成可以直接发布的商品资料，再推送到 ERP
// 上架包 = 当地语言标题 / 英文标题 / 卖点 / 描述 / 搜索词 / SKU / 定价 + 违禁词与合规检查
const db = require('../db');
const llm = require('../providers/llm');
const settings = require('../settings');
const connectors = require('../connectors');
const products = require('./products');
const selection = require('./selection');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const LANG = { MY: 'Bahasa Melayu', ID: 'Bahasa Indonesia', TH: 'ภาษาไทย', VN: 'Tiếng Việt', PH: 'English', SG: 'English', US: 'English', GB: 'English' };

// TikTok Shop 常见的违规用语：绝对化、医疗功效、虚假承诺、引流站外
const BANNED = [
  [/\b(best|no\.?\s?1|number one|#1)\b/i, '绝对化用语（best / No.1）'],
  [/\b(cure|cures|heal|treat|therapy|medical grade)\b/i, '医疗功效用语'],
  [/100\s?%|\bguarantee[ds]?\b|\bpermanent\b/i, '绝对承诺（100% / guaranteed / permanent）'],
  [/\b(original|authentic|genuine)\b.*\b(apple|samsung|xiaomi|huawei)\b/i, '冒充原装品牌'],
  [/whatsapp|wechat|telegram|shopee|lazada|\.com\b/i, '引流到站外'],
  [/(?<!(for|with|untuk|dengan|fits|serasi)\s)\b(apple|samsung|xiaomi|huawei|oppo|vivo)\b/i, '品牌名需写成「for xxx / compatible with xxx」，不能当作自己的品牌'],
];

function checkText(text) {
  return BANNED.filter(([re]) => re.test(text || '')).map(([, why]) => why);
}

// 定价：按目标利润倒推最低售价，再和同类成交均价比较
function pricing(p) {
  const ev = p.evaluation;
  const mk = selection.marketProfile(ev.metrics.market);
  const sel = settings.get().selection || {};
  const pr = ev.profit;
  if (!pr || p.costCny == null) return null;
  const landedLocal = (p.costCny + (p.shippingCny || 0)) / mk.cnyRate;
  const fees = (mk.platformFeeRate + pr.commission + (sel.returnRate ?? 5) + (sel.adRate ?? 10)) / 100;
  const target = (sel.targetMargin ?? 20) / 100;
  const floor = (landedLocal + mk.fixedFee) / (1 - fees - target);
  const asp = ev.metrics.asp;
  // 建议价：不低于保本 + 目标利润；竞品均价更高时贴着竞品略低一点定
  const suggested = Math.max(floor, asp ? asp * 0.95 : floor);
  const r2 = (v) => Math.round(v * 100) / 100;
  return { currency: ev.metrics.currency, floor: r2(floor), suggested: r2(suggested), competitorAsp: asp, landedLocal: r2(landedLocal), warn: asp && floor > asp ? `按目标利润至少要卖 ${ev.metrics.currency}${r2(floor)}，高于同类成交均价 ${ev.metrics.currency}${asp}，价格没有竞争力` : '' };
}

async function build(id) {
  const p = products.get(id);
  if (!p) throw err('商品不存在', 404);
  const offer = p.sourcing?.offers?.find((o) => (o.offerId || o.url) === p.sourcing?.chosen);
  const ev = p.evaluation;
  const lang = LANG[ev.metrics.market] || settings.get().store?.language || 'English';
  const price = pricing(p);
  const pack = await llm.completeJSON(`为 TikTok Shop ${ev.metrics.market} 站生成一份可以直接上架的商品资料（上架包）。
对标商品（FastMoss 数据）：${JSON.stringify(products.brief(p))}
${offer ? `1688 货源：${JSON.stringify({ 标题: offer.title, 价格: offer.price, 阶梯价: offer.priceRanges, SKU数: offer.skuCount, 重量kg: offer.unitWeight, 发货地: offer.sendGoodsAddress })}` : '还没有选定 1688 货源，SKU 按对标商品推断。'}
${p.analysis ? `选品分析里的卖点和人群：${JSON.stringify({ 人群: p.analysis.audience, 卖点: p.analysis.sellingPoints, 差异化: p.analysis.competitors })}` : p.ai ? `AI 研判：${JSON.stringify({ 切入点: p.ai.angle, 理由: p.ai.reasons })}` : ''}
${p.reviewsText ? `买家差评（要在卖点和描述里提前回应）：${String(p.reviewsText).slice(0, 1500)}` : ''}
要求：
1. 标题：${lang} 和英文各一个，≤ 120 字符，前 40 字符放核心词，写清适用机型/规格，品牌名只能写成 "for iPhone" 这种兼容写法；
2. 不使用绝对化、医疗功效、100%/guaranteed、站外引流等违规用语；
3. 卖点 5 条（${lang}），每条一句话，能对应到视频里的一个镜头；
4. 描述（${lang}）分段：痛点、卖点、规格参数、包装清单、售后说明；
5. SKU 按货源实际规格整理（颜色/型号/套装），给每个 SKU 一个英文名；
6. 搜索关键词 8-12 个（${lang} + 英文）。
只输出 JSON：
{"titleLocal": "", "titleEn": "", "sellingPoints": [""], "description": "", "keywords": [""], "skus": [{"name": "", "spec": ""}], "categoryHint": "TikTok 类目建议（中文路径）", "attributes": {"材质": ""}, "packageList": "", "notes": "上架前需要人工确认的事项（认证、实拍图、尺寸表等）"}`,
    { system: '你是 TikTok Shop 东南亚和美区的资深上架运营，熟悉平台规则和本地化文案。只输出 JSON。', maxTokens: 6000, noThinking: true, timeoutMs: 180000 },
  );
  const issues = [...new Set([...checkText(pack.titleLocal), ...checkText(pack.titleEn), ...checkText(pack.description), ...(pack.sellingPoints || []).flatMap(checkText)])];
  const blocks = ev.flags.filter((f) => f.level === 'block' || f.level === 'major').map((f) => `${f.title}：${f.detail}`);
  const listing = { pack, price, offer: offer || null, compliance: { issues, risks: blocks }, status: 'draft', at: db.now(), pushes: db.products.get(id).listing?.pushes || [] };
  db.products.update(id, { listing });
  return products.get(id);
}

function update(id, body) {
  const p = db.products.get(id);
  if (!p?.listing) throw err('还没有生成上架包', 404);
  const listing = { ...p.listing };
  if (body.pack) listing.pack = { ...listing.pack, ...body.pack };
  if (body.price != null && listing.price) listing.price = { ...listing.price, suggested: Number(body.price) || listing.price.suggested };
  if (body.status && ['draft', 'approved'].includes(body.status)) listing.status = body.status;
  listing.compliance = { ...listing.compliance, issues: [...new Set([...checkText(listing.pack.titleLocal), ...checkText(listing.pack.titleEn), ...checkText(listing.pack.description)])] };
  db.products.update(id, { listing });
  return products.get(id);
}

// 推送到 ERP（妙手 / Webhook …），记录每次推送结果
async function push(id, connectorId) {
  const p = products.get(id);
  if (!p?.listing) throw err('请先生成上架包', 400);
  if (p.listing.status !== 'approved') throw err('上架包还没确认：检查标题、定价和合规提示后点「确认上架包」', 400);
  const c = connectorId ? connectors.get(connectorId) : connectors.active('erp')[0];
  if (!c) throw err('还没有可用的 ERP：在「接入配置 → 数据源与 ERP」里添加妙手 ERP 或通用 Webhook', 400);
  const payload = {
    event: 'listing.push',
    at: new Date().toISOString(),
    product: { id: p.id, name: p.name, market: p.evaluation.metrics.market, category: p.category, fastmoss: p.fastmossLink, tiktok: p.tiktokUrl || null, image: p.image || null },
    source: p.listing.offer ? { platform: '1688', offerId: p.listing.offer.offerId, url: p.listing.offer.url, price: p.listing.offer.price, priceRanges: p.listing.offer.priceRanges, weightKg: p.listing.offer.unitWeight } : null,
    listing: { ...p.listing.pack, price: p.listing.price?.suggested ?? null, currency: p.evaluation.metrics.currency },
  };
  const record = { connectorId: c.id, connector: c.name, at: db.now() };
  try {
    const r = await connectors.adapter(c).push(c, payload);
    Object.assign(record, { ok: true, message: r.message, remoteId: r.remoteId });
  } catch (e) {
    Object.assign(record, { ok: false, message: e.message });
  }
  const cur = db.products.get(id);
  db.products.update(id, { listing: { ...cur.listing, status: record.ok ? 'pushed' : cur.listing.status, pushes: [record, ...(cur.listing.pushes || [])].slice(0, 20) }, ...(record.ok ? { status: 'testing' } : {}) });
  db.activity.insert({ type: 'listing', text: `${record.ok ? '已推送' : '推送失败'}：${p.name} → ${c.name}` });
  if (!record.ok) throw err(`推送失败：${record.message}`, 424);
  return products.get(id);
}

// 导出上架包（CSV，可导入 ERP 或交给运营）
function exportCsv(ids) {
  const rows = [['商品', '本地标题', '英文标题', '卖点', '描述', '关键词', 'SKU', '建议售价', '币种', '1688 货源', '采购价¥', '合规提示']];
  for (const id of ids) {
    const p = products.get(id);
    if (!p?.listing) continue;
    const L = p.listing, k = L.pack;
    rows.push([p.name, k.titleLocal, k.titleEn, (k.sellingPoints || []).join('\n'), k.description, (k.keywords || []).join(', '), (k.skus || []).map((s) => `${s.name}: ${s.spec}`).join('\n'), L.price?.suggested ?? '', p.evaluation.metrics.currency, L.offer?.url || '', L.offer?.price ?? '', [...L.compliance.issues, ...L.compliance.risks].join('\n')]);
  }
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

module.exports = { build, update, push, exportCsv, checkText, pricing };
