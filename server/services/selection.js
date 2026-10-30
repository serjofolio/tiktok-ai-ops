// 选品评估引擎：把 FastMoss 导出的原始数据变成「能不能上、为什么」
// 六个维度：需求规模、增长趋势、达人带货验证、竞争格局、利润空间、合规与风险
// 规则只用导出里的真实字段计算，每条结论都带上数据依据；AI 在此基础上做批量研判（见 report）
const settings = require('../settings');

// ---------- 站点：币种、平台费、人民币汇率（默认值，可在「利润测算参数」里改） ----------
const MARKETS = {
  MY: { name: '马来西亚', currency: 'RM', platformFeeRate: 14, fixedFee: 0.54, cnyRate: 1.65, note: '平台佣金约 10.26% + 交易费 3.78%（均含 SST）+ 每单 RM0.54 平台服务费；参加 Bonus Cashback 另加约 4.86%' },
  US: { name: '美国', currency: '$', platformFeeRate: 8, fixedFee: 0, cnyRate: 7.1, note: '默认值，请按后台类目费率修改' },
  GB: { name: '英国', currency: '£', platformFeeRate: 9, fixedFee: 0, cnyRate: 9.3, note: '默认值，请按后台类目费率修改' },
  SG: { name: '新加坡', currency: 'S$', platformFeeRate: 12, fixedFee: 0, cnyRate: 5.4, note: '默认值，请按后台类目费率修改' },
  TH: { name: '泰国', currency: '฿', platformFeeRate: 12, fixedFee: 0, cnyRate: 0.21, note: '默认值，请按后台类目费率修改' },
  PH: { name: '菲律宾', currency: '₱', platformFeeRate: 12, fixedFee: 0, cnyRate: 0.125, note: '默认值，请按后台类目费率修改' },
  VN: { name: '越南', currency: '₫', platformFeeRate: 12, fixedFee: 0, cnyRate: 0.00028, note: '默认值，请按后台类目费率修改' },
  ID: { name: '印尼', currency: 'Rp', platformFeeRate: 12, fixedFee: 0, cnyRate: 0.00045, note: '默认值，请按后台类目费率修改' },
};
const MARKET_ALIASES = { 马来西亚: 'MY', malaysia: 'MY', 美国: 'US', usa: 'US', 'united states': 'US', 英国: 'GB', uk: 'GB', 新加坡: 'SG', singapore: 'SG', 泰国: 'TH', thailand: 'TH', 菲律宾: 'PH', philippines: 'PH', 越南: 'VN', vietnam: 'VN', 印尼: 'ID', 印度尼西亚: 'ID', indonesia: 'ID' };
const SEA = ['MY', 'SG', 'TH', 'PH', 'VN', 'ID'];

function marketCode(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (MARKETS[s.toUpperCase()]) return s.toUpperCase();
  return MARKET_ALIASES[s.toLowerCase()] || MARKET_ALIASES[s] || '';
}

// 售价文本里的币种 → 站点
function currencyMarket(text) {
  const s = String(text || '');
  if (/RM/i.test(s)) return 'MY';
  if (/S\$/.test(s)) return 'SG';
  if (/£/.test(s)) return 'GB';
  if (/฿/.test(s)) return 'TH';
  if (/₱/.test(s)) return 'PH';
  if (/₫/.test(s)) return 'VN';
  if (/Rp/.test(s)) return 'ID';
  if (/\$/.test(s)) return 'US';
  return '';
}

// 当前用户对某个站点的测算参数（默认值 + 用户修改）
function marketProfile(code) {
  const a = settings.get().selection || {};
  const base = MARKETS[code] || MARKETS.US;
  return { code: MARKETS[code] ? code : 'US', ...base, ...(a.markets?.[code] || {}) };
}

// ---------- 品型识别：标题里最早出现的关键词决定品型（马来语 / 英语 / 中文） ----------
const TYPES = [
  ['充电宝', /power\s?bank|bank kuasa|powerbank|充电宝|移动电源/i],
  ['数据线', /\bcable\b|\bkabel\b|数据线|充电线/i],
  ['充电器', /charger|pengecas|adapter|adaptor|充电器|充电头|\bGaN\b/i],
  ['挂绳/配件', /\btali\b|lanyard|\bstrap\b|挂绳/i],
  ['手机壳', /\bcases?\b|casing|sarung|\bkes\b|phone cover|手机壳|保护壳|tahan jatuh|anti-?drop|shockproof|kalis kejutan|hentakan/i],
  ['钢化膜', /tempered glass|screen protector|pelindung skrin|privacy glass|back protector|钢化膜|贴膜|\bkaca\b/i],
  ['屏幕总成', /\bLCD\b|touch screen replacement|digitizer|屏幕总成/i],
  ['智能手表', /smart\s?watch|jam tangan pintar|智能手表|手环|\bH9\b/i],
  ['耳机', /fon telinga|fon kepala|earphone|earbud|headphone|headset|耳机|\bTWS\b/i],
  ['音箱', /speaker|pembesar suara|音箱|音响/i],
  ['支架', /\bstand\b|holder|pemegang|cawan sedut|tripod|selfie|支架|自拍杆/i],
  ['风扇', /\bfan\b|kipas|风扇/i],
  ['灯', /\blamp\b|night light|lampu|LED light|灯/i],
  ['电池', /CR20\d\d|battery|bateri|电池/i],
  ['存储', /memory card|sd card|flash drive|pendrive|U盘|内存卡/i],
];

function productType(name) {
  const s = String(name || '');
  let best = null;
  for (const [type, re] of TYPES) {
    const m = s.match(re);
    if (m && (best === null || m.index < best.index)) best = { type, index: m.index };
  }
  let type = best?.type || '其他';
  if (type === '耳机') type = /wireless|tanpa wayar|bluetooth|\bTWS\b|无线/i.test(s) ? '无线耳机' : /berwayar|wired|有线/i.test(s) ? '有线耳机' : '耳机';
  return type;
}

// 知名品牌：卖家本身是品牌方/经销商时，跨境卖家不能卖同款
const BRANDS = ['ugreen', 'mcdodo', 'niumo', 'baseus', 'anker', 'xiaomi', 'redmi', 'samsung', 'apple', 'huawei', 'honor', 'oppo', 'vivo', 'realme', 'infinix', 'jbl', 'sony', 'jeep', 'torras', 'spigen', 'belkin', 'philips', 'lenovo', 'cuktech', 'hoco', 'remax', 'joyroom', 'edifier', 'soundpeats', 'qcy', 'romoss', 'orico', 'esr', 'ringke'];
const IP = /\bMLBB\b|mobile legends|black myth|wukong|pok[eé]mon|disney|marvel|sanrio|hello kitty|naruto|one piece|doraemon|labubu|spider-?man|\bnba\b/i;

function sellerBrand(p) {
  const shop = String(p.shop || '').toLowerCase();
  const title = String(p.name || '').replace(/^[\s【\[(（][^】\])）]*[】\])）]\s*/, '').toLowerCase();
  const b = BRANDS.find((x) => shop.includes(x) || title.startsWith(x) || new RegExp(`^\\S*\\s*${x}\\b`).test(title));
  if (b) return b.toUpperCase();
  if (/official|kedai rasmi|flagship/i.test(`${p.shop} ${p.name}`)) return '官方店';
  return '';
}

// ---------- 工具 ----------
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const median = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
// 分段线性插值：points = [[x, score], ...]，x 递增
const curve = (x, points) => {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points.at(-1)[1];
};
const fmt = (n) => (n == null ? '—' : n >= 1e4 ? `${round(n / 1e4, 1)}万` : Math.round(n).toLocaleString('en-US'));
const money = (cur, n) => (n == null ? '—' : `${cur}${n >= 1e4 ? `${round(n / 1e4, 1)}万` : round(n, 2)}`);
const DAY = 86400e3;

// ---------- 派生指标 ----------
function metrics(p, now = Date.now()) {
  const code = marketCode(p.market) || currencyMarket(p.priceText) || marketCode(settings.get().store?.market) || 'US';
  const mk = marketProfile(code);
  const s7 = p.sales7d ?? null;
  const s28 = p.sales28d ?? null;
  // 实际成交均价 = 7 天销售额 ÷ 7 天销量（比标价可靠：区间价商品能看出买家到底买哪个 SKU）
  const asp = p.gmv && s7 ? p.gmv / s7 : p.gmv28d && s28 ? p.gmv28d / s28 : p.price ?? p.priceMin ?? null;
  const listed = p.launchDate ? Date.parse(p.launchDate) : NaN;
  const ageDays = Number.isFinite(listed) ? Math.max(1, Math.round((now - listed) / DAY)) : null;
  // 趋势：近 7 天销量 ÷ 近 28 天的周均（上架不足 28 天的按实际周数算）
  let momentum = null;
  if (s7 != null && s28) {
    const weeks = ageDays && ageDays < 28 ? Math.max(1, ageDays / 7) : 4;
    momentum = s7 / (s28 / weeks);
  } else if (p.growth != null) momentum = 1 + p.growth / 100;
  const total = p.salesTotal ?? null;
  return {
    market: mk.code,
    currency: mk.currency,
    asp: round(asp, 2),
    ageDays,
    momentum: round(momentum, 2),
    recentShare: total && s28 != null ? round(s28 / total, 3) : null,
    weeklyAvg28: s28 != null ? Math.round(s28 / 4) : null,
    type: productType(p.name),
    brand: sellerBrand(p),
    ip: IP.test(p.name || '') || IP.test(p.shop || ''),
    priceSpread: p.priceMin && p.priceMax ? round(p.priceMax / p.priceMin, 2) : null,
  };
}

// 同一批数据的整体情况，用于排名和异常判断（只和同站点的商品比较）
function population(products) {
  const groups = {};
  for (const p of products) {
    const m = metrics(p);
    const g = (groups[m.market] = groups[m.market] || { items: [], shops: {}, types: {} });
    g.items.push({ p, m });
    if (p.shop) g.shops[p.shop] = (g.shops[p.shop] || 0) + 1;
    g.types[m.type] = (g.types[m.type] || 0) + 1;
  }
  for (const g of Object.values(groups)) {
    g.n = g.items.length;
    g.medianAsp = median(g.items.map((x) => x.m.asp));
    g.gmvSorted = g.items.map((x) => x.p.gmv ?? 0).sort((a, b) => a - b);
    g.salesSorted = g.items.map((x) => x.p.sales7d ?? 0).sort((a, b) => a - b);
    g.gmvRank = [...g.items].sort((a, b) => (b.p.gmv ?? 0) - (a.p.gmv ?? 0)).map((x) => x.p.id);
  }
  return groups;
}

const pctRank = (sorted, v) => {
  if (!sorted.length || v == null) return null;
  let lo = 0;
  while (lo < sorted.length && sorted[lo] < v) lo++;
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === v) eq++;
  return ((lo + (eq - lo) / 2) / sorted.length) * 100;
};

// ---------- 合规与风险标记 ----------
// level：block（不能上）/ major（重大风险，最多谨慎测试）/ minor（注意事项）/ info（数据解读）
function riskFlags(p, m, g, sel) {
  const flags = [];
  const add = (level, title, detail) => flags.push({ level, title, detail });
  const cross = (sel.storeMode || 'crossborder') === 'crossborder';
  const sea = SEA.includes(m.market);
  const invited = sel.invited || {};
  const cny = marketProfile(m.market).cnyRate;

  if (m.type === '充电宝') {
    if (cross && m.market === 'MY' && !invited.powerbank) add('block', '充电宝需定邀 + 本地仓', '马来西亚跨境：充电宝仅限定邀卖家销售，且必须由马来西亚本地海外仓发货，直邮无法上架');
    else add('major', '带电产品', '充电宝属于带电产品，需要电池信息披露和安全认证，物流和售后成本高');
  }
  if (['充电器', '数据线'].includes(m.type)) {
    if (cross && sea && !invited.charger) add('block', '充电类目需定邀', '东南亚跨境：充电线、充电器、适配器属于定邀类目，未获邀请无法上架（已获定邀可在「利润测算参数」里勾选）');
    else add('minor', '安全认证', '充电类产品可能需要提交安全认证（马来西亚如 SIRIM）');
  }
  if (m.type === '电池') add('block', '纽扣 / 锂电池', '电池属于带电危险品，跨境物流受限，平台对电池类商品有单独的上架规范');
  if (m.type === '屏幕总成') add('major', '维修配件', '手机屏幕等维修配件型号兼容复杂、退货和售后率高，需要懂技术的客服');
  if (['无线耳机', '音箱', '智能手表'].includes(m.type) || /bluetooth|wireless|tanpa wayar/i.test(p.name || ''))
    add('minor', '无线设备认证', `蓝牙/无线设备${m.market === 'MY' ? '在马来西亚通常需要 SIRIM / MCMC 认证，' : ''}上架时可能要提交合规证明`);
  if (m.type === '智能手表') add('minor', '电子手表规范', '电子手表有单独的上架规范，需写清电池、续航和兼容系统');
  if (m.type === '风扇') add('minor', 'USB 风扇合规', 'USB 便携风扇在东南亚跨境可能需要提供安全合规凭证');
  if (m.brand) add('block', `品牌商品（${m.brand}）`, `卖家是品牌方或品牌经销商，这个商品不能卖同款（需品牌授权）；如果品型有需求，可以做无品牌同类，但要和品牌的信任度、价格竞争`);
  if (m.ip) add('block', 'IP 授权', '商品使用了游戏/动漫等 IP，未获授权属于侵权，不能跟卖');
  if (/zikir|quran|ruqyah|surah|al-?quran|佛经|念佛/i.test(p.name || '')) add('minor', '宗教用品', '宗教相关商品文化敏感，宣传话术和画面要谨慎');

  // 数据可信度
  const creators = p.creatorCount ?? 0, videos = p.videoCount ?? 0, lives = p.liveCount ?? 0;
  const x = m.asp && g.medianAsp ? m.asp / g.medianAsp : 0;
  if ((x > 5 && creators < 20 && (p.sales7d ?? 0) >= 300) || (x > 3 && creators >= 1 && creators <= 10 && videos <= 10 && (p.sales7d ?? 0) >= 1000))
    add('block', '数据可疑', `成交均价 ${money(m.currency, m.asp)} 是同批中位数 ${money(m.currency, g.medianAsp)} 的 ${round(m.asp / g.medianAsp, 1)} 倍，却只有 ${creators} 位达人、${videos} 条视频就 7 天卖出 ${fmt(p.sales7d)} 件，很可能是刷单或价格异常，不能作为选品依据`);
  const lowPrice = { 智能手表: 25, 无线耳机: 12, 充电宝: 25 }[m.type];
  if (lowPrice && m.asp && m.asp * cny < lowPrice)
    add('major', '价格异常低', `${m.type}成交均价只有 ${money(m.currency, m.asp)}（约 ¥${round(m.asp * cny, 1)}），明显低于正常价格，销量可能来自配件/引流 SKU，不代表主商品真实需求`);
  if ((p.sales7d ?? 0) >= 1000 && !creators && !videos && !lives)
    add('major', '销量来源不明', `7 天卖出 ${fmt(p.sales7d)} 件却没有任何带货达人、视频和直播：订单来自商品卡搜索、广告、站外引流甚至刷单，无法用内容打法复制`);
  else if ((p.sales7d ?? 0) >= 300 && !creators && !videos && !lives)
    add('minor', '非达人驱动', '有销量但没有任何带货达人、视频和直播：订单来自商品卡搜索、广告或店铺自运营，达人带货模式没有被验证');
  if (m.priceSpread >= 3 && m.asp && p.priceMin && m.asp <= p.priceMin * 1.35)
    add('info', '低价引流款', `标价 ${money(m.currency, p.priceMin)}–${money(m.currency, p.priceMax)}，实际成交均价 ${money(m.currency, m.asp)}：大部分买家买的是最便宜的 SKU，利润要按低价款算`);
  return flags;
}

// ---------- 六维评分 ----------
function assess(p, groups) {
  const sel = settings.get().selection || {};
  const m = metrics(p);
  const g = groups?.[m.market] || population([p])[m.market];
  const mk = marketProfile(m.market);
  const cur = m.currency;
  const dims = [];
  const dim = (key, label, score, summary, evidence = []) => dims.push({ key, label, score: score == null ? null : Math.round(clamp(score)), summary, evidence });

  // 1. 需求规模：周销量（绝对量，对数）+ 销售额在同批中的排名
  if (p.sales7d != null || p.salesTotal != null) {
    const s7 = p.sales7d ?? 0;
    const abs = clamp(((Math.log10(Math.max(s7, 1)) - 1.5) / 2.5) * 100);
    const pr = g.n >= 5 ? pctRank(g.gmvSorted, p.gmv ?? 0) : null;
    const rank = g.n >= 5 && p.gmv != null ? g.gmvRank.indexOf(p.id) + 1 : null;
    dim('demand', '需求规模', pr == null ? abs : abs * 0.5 + pr * 0.5,
      `近 7 天卖出 ${fmt(s7)} 件${p.gmv != null ? `、销售额 ${money(cur, p.gmv)}` : ''}${rank > 0 ? `，销售额在同批 ${g.n} 个商品中排第 ${rank}` : ''}`,
      [p.sales28d != null && `近 28 天 ${fmt(p.sales28d)} 件`, p.salesTotal != null && `累计 ${fmt(p.salesTotal)} 件`].filter(Boolean));
  } else dim('demand', '需求规模', null, '缺少销量数据');

  // 2. 增长趋势：近 7 天 vs 近 28 天周均；结合上架时长判断生命周期
  let stage = '';
  if (m.momentum != null) {
    const mo = m.momentum;
    stage = m.ageDays != null && m.ageDays <= 60 && mo >= 1.05 ? '新品起量' : mo >= 1.25 ? '加速上升' : mo >= 1.05 ? '稳步上升' : mo >= 0.9 ? '平稳' : mo >= 0.75 ? '回落' : '明显下滑';
    if (stage === '平稳' && m.ageDays > 365 && m.recentShare != null && m.recentShare < 0.12) stage = '长尾老品';
    const score = curve(mo, [[0.5, 8], [0.7, 22], [0.85, 38], [1, 55], [1.15, 70], [1.4, 85], [1.8, 95]]);
    dim('trend', '增长趋势', score,
      p.sales28d != null ? `近 7 天销量是近 28 天周均（${fmt(m.weeklyAvg28)} 件）的 ${mo} 倍，${stage}` : `销量环比 ${p.growth > 0 ? '+' : ''}${p.growth}%，${stage}`,
      [m.ageDays != null && `上架 ${m.ageDays} 天`, m.recentShare != null && `近 28 天销量占累计的 ${round(m.recentShare * 100, 0)}%`].filter(Boolean));
  } else dim('trend', '增长趋势', null, '缺少近 28 天销量或增长率，无法判断趋势');

  // 3. 达人带货验证：多少达人带过、出单率、视频和直播数量
  if (p.creatorCount != null || p.videoCount != null) {
    const c = p.creatorCount ?? 0, v = p.videoCount ?? 0;
    const conv = p.creatorConvRate;
    let score;
    let summary;
    if (!c && !v) {
      score = 15;
      summary = '没有达人和视频在带：销量不是内容带来的，达人带货模式未被验证';
    } else {
      const sc = clamp((Math.log10(c + 1) / Math.log10(500)) * 100);
      score = sc * 0.6 + (conv ?? 55) * 0.4;
      summary = `${fmt(c)} 位达人带过货${conv != null ? `，出单率 ${conv}%` : ''}${conv != null ? (conv >= 80 ? '：大部分达人都能出单，寄样招达人的成功率高' : conv >= 55 ? '：约一半以上达人能出单' : '：多数达人带不动，内容门槛高') : ''}`;
    }
    dim('content', '达人带货验证', score, summary, [`带货视频 ${fmt(v)} 条`, p.liveCount != null && `直播 ${fmt(p.liveCount)} 场`, p.commissionRate != null && `佣金 ${p.commissionRate}%`].filter(Boolean));
  } else dim('content', '达人带货验证', null, '缺少带货达人和视频数据');

  // 4. 竞争格局：内容拥挤度、品牌/头部店铺、同品型数量、新卖家能否进入
  {
    let score = 70;
    const ev = [];
    const c = p.creatorCount ?? 0, v = p.videoCount ?? 0;
    if (c >= 3000) (score -= 20), ev.push(`${fmt(c)} 位达人已在带，内容非常拥挤`);
    else if (c >= 1000) (score -= 10), ev.push(`${fmt(c)} 位达人在带，竞争较激烈`);
    if (v >= 10000) (score -= 10), ev.push(`${fmt(v)} 条带货视频，同质化严重`);
    if (m.brand) (score -= 25), ev.push(`卖家是品牌方（${m.brand}）`);
    const sameShop = g.shops[p.shop] || 0;
    if (sameShop >= 3) (score -= 10), ev.push(`店铺「${p.shop}」在同批里有 ${sameShop} 个商品，头部店铺优势明显`);
    const sameType = g.types[m.type] || 0;
    if (m.type !== '其他' && sameType >= Math.max(6, g.n * 0.15)) (score -= 10), ev.push(`同批里有 ${sameType} 个「${m.type}」，品型扎堆`);
    if (m.ageDays != null && m.ageDays <= 180 && (p.sales7d ?? 0) >= 1000) (score += 12), ev.push(`上架仅 ${m.ageDays} 天就进入头部，新卖家仍有机会`);
    if (!ev.length) ev.push('达人和视频数量适中，没有明显的垄断迹象');
    dim('competition', '竞争格局', score, score >= 65 ? '竞争可接受，有进入空间' : score >= 45 ? '竞争较激烈，需要差异化' : '红海或被头部占据，新卖家很难切入', ev);
  }

  // 5. 利润空间：没有成本时按目标净利倒推「采购 + 物流」上限；填了成本则算实际净利
  const commission = p.commissionRate ?? sel.creatorRate ?? 10;
  const pctFees = mk.platformFeeRate + commission + (sel.returnRate ?? 5) + (sel.adRate ?? 10);
  const target = sel.targetMargin ?? 20;
  let profit = null;
  if (m.asp) {
    const ceiling = m.asp * (1 - (pctFees + target) / 100) - mk.fixedFee;
    profit = {
      currency: cur, asp: m.asp, cnyRate: mk.cnyRate, commission, platformFeeRate: mk.platformFeeRate, fixedFee: mk.fixedFee,
      returnRate: sel.returnRate ?? 5, adRate: sel.adRate ?? 10, targetMargin: target,
      ceiling: round(ceiling, 2), ceilingCny: round(ceiling * mk.cnyRate, 1),
    };
    const hasCost = p.costCny != null;
    if (hasCost) {
      const costLocal = (p.costCny + (p.shippingCny || 0)) / mk.cnyRate;
      const unit = m.asp * (1 - pctFees / 100) - mk.fixedFee - costLocal;
      Object.assign(profit, { costCny: p.costCny, shippingCny: p.shippingCny || 0, costLocal: round(costLocal, 2), unitProfit: round(unit, 2), unitProfitCny: round(unit * mk.cnyRate, 1), margin: round((unit / m.asp) * 100, 1) });
      const score = curve(profit.margin, [[-10, 3], [0, 20], [target / 2, 45], [target, 75], [target + 10, 92]]);
      dim('profit', '利润空间', score, `按成交均价 ${money(cur, m.asp)}，扣除全部费用和成本后单件净利 ${money(cur, profit.unitProfit)}（约 ¥${profit.unitProfitCny}），净利率 ${profit.margin}%`,
        [`采购 ¥${p.costCny} + 物流 ¥${p.shippingCny || 0}`, `费用合计 ${round(pctFees, 1)}%${mk.fixedFee ? ` + 每单 ${money(cur, mk.fixedFee)}` : ''}`]);
    } else {
      const score = curve(profit.ceilingCny, [[0, 4], [3, 22], [6, 42], [10, 58], [20, 76], [40, 90], [60, 95]]);
      dim('profit', '利润空间', score,
        profit.ceiling > 0 ? `想赚 ${target}% 净利，采购 + 物流合计不能超过 ${money(cur, profit.ceiling)}（约 ¥${profit.ceilingCny}）` : `成交均价 ${money(cur, m.asp)} 太低，扣完费用就没有 ${target}% 的利润空间`,
        [`成交均价 ${money(cur, m.asp)}`, `平台 ${mk.platformFeeRate}% + 达人 ${commission}% + 退货 ${sel.returnRate ?? 5}% + 广告 ${sel.adRate ?? 10}%${mk.fixedFee ? ` + 每单 ${money(cur, mk.fixedFee)}` : ''}`, '去 1688 找到同款后填入采购价，可算出实际净利']);
    }
  } else dim('profit', '利润空间', null, '缺少售价');

  // 6. 合规与风险（含利润不成立）
  const flags = riskFlags(p, m, g, sel);
  if (profit) {
    const floor = (sel.storeMode || 'crossborder') === 'local' ? 2 : 5;
    if (profit.margin != null && profit.margin < 0) flags.unshift({ level: 'block', title: '按成本会亏钱', detail: `按你填的采购价和物流，每卖一件亏 ${money(cur, -profit.unitProfit)}` });
    else if (profit.margin == null && profit.ceilingCny < floor)
      flags.unshift({ level: 'block', title: '客单价太低', detail: `成交均价 ${money(cur, m.asp)}，扣掉平台、达人、退货、广告费用和 ${target}% 目标利润后，采购 + 物流只剩 ¥${Math.max(0, profit.ceilingCny)}，${floor === 5 ? '跨境直邮' : '本土发货'}做不出利润` });
  }
  {
    let score = 92;
    for (const f of flags) score -= { block: 80, major: 30, minor: 8, info: 0 }[f.level];
    const serious = flags.filter((f) => f.level !== 'info');
    dim('risk', '合规与风险', score, serious.length ? serious.map((f) => f.title).join('、') : '没有发现明显的合规或数据风险', serious.map((f) => f.detail));
  }

  // 人工判断（卖点能否拍出来、自己想不想买）作为加减分
  const j = p.judgement || {};
  const W = { demand: 0.2, trend: 0.25, content: 0.15, competition: 0.15, profit: 0.15, risk: 0.1 };
  const known = dims.filter((d) => d.score != null);
  let score = known.length ? known.reduce((a, d) => a + d.score * W[d.key], 0) / known.reduce((a, d) => a + W[d.key], 0) : null;
  if (score != null) score = clamp(score + (j.visual === true ? 3 : j.visual === false ? -8 : 0) + (j.wantBuy === true ? 3 : j.wantBuy === false ? -8 : 0));

  // 结论
  const blocks = flags.filter((f) => f.level === 'block');
  const majors = flags.filter((f) => f.level === 'major');
  const get = (k) => dims.find((d) => d.key === k)?.score;
  let verdict;
  if (score == null || (p.sales7d == null && p.salesTotal == null)) verdict = '数据不足';
  else if (blocks.length) verdict = '不建议上';
  else if (score >= 64 && (get('trend') ?? 50) >= 58 && (get('profit') ?? 50) >= 50 && !majors.length) verdict = '可以上';
  else if (score >= 48) verdict = '谨慎测试';
  else verdict = '不建议上';

  return { verdict, score: score == null ? null : Math.round(score), stage, dims, flags, profit, metrics: m, headline: headline(verdict, dims, flags, m) };
}

// 一句话结论：最强的两个理由 + 最大的顾虑
function headline(verdict, dims, flags, m) {
  if (verdict === '数据不足') return '缺少销量数据，无法判断';
  const block = flags.find((f) => f.level === 'block');
  if (block) return `${block.title}：${block.detail.split(/[，；]/)[0]}`;
  const good = { demand: '需求大', trend: '销量在上升', content: '达人带货已验证', competition: '竞争不激烈', profit: '利润空间足' };
  const bad = { demand: '需求偏小', trend: '销量在回落', content: '达人带货没验证', competition: '竞争激烈', profit: '利润空间小' };
  const scored = dims.filter((d) => d.score != null && d.key !== 'risk');
  const pos = [...scored].filter((d) => d.score >= 65).sort((a, b) => b.score - a.score).slice(0, 2).map((d) => good[d.key]);
  const major = flags.find((f) => f.level === 'major');
  const worst = [...scored].sort((a, b) => a.score - b.score)[0];
  const neg = major ? major.title : worst && worst.score < 50 ? bad[worst.key] : '';
  const prefix = m.type !== '其他' ? `${m.type}：` : '';
  if (!pos.length) return `${prefix}各项指标一般${neg ? '，' + neg : ''}`;
  return `${prefix}${pos.join('、')}${neg ? '，但' + neg : ''}`;
}

module.exports = { MARKETS, marketCode, currencyMarket, marketProfile, productType, metrics, population, assess };
