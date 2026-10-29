// 智能选品：商品库、选品评分模型、AI 选品分析
const db = require('../db');
const llm = require('../providers/llm');
const rag = require('./rag');

// 演示商品库（基于 TikTok Shop 常见热卖品类，数据为模拟值，可通过 CSV 导入真实数据）
const SEED = [
  ['Heatless Curling Rod Headband', '无热卷发棒发带', '美妆个护', '💇‍♀️', 12.99, 2.1],
  ['Lip Oil Plumping Gloss', '丰唇唇油', '美妆个护', '💄', 9.99, 1.3],
  ['Ice Roller Face Massager', '冰敷滚轮美容仪', '美妆个护', '🧊', 14.99, 2.6],
  ['Scalp Massager Shampoo Brush', '硅胶头皮按摩梳', '美妆个护', '🪮', 7.99, 0.9],
  ['LED Teeth Whitening Kit', 'LED 牙齿美白套装', '美妆个护', '🦷', 29.99, 5.5],
  ['Sunset Projection Lamp', '日落氛围投影灯', '家居生活', '🌅', 19.99, 4.2],
  ['Magnetic Cable Organizer', '磁吸理线器', '家居生活', '🧲', 8.99, 1.1],
  ['Portable Mini Steamer', '便携挂烫机', '家居生活', '♨️', 34.99, 9.8],
  ['Self-Stirring Coffee Mug', '自动搅拌咖啡杯', '厨房好物', '☕', 16.99, 3.9],
  ['Electric Oil Sprayer Bottle', '电动喷油壶', '厨房好物', '🫒', 18.99, 4.4],
  ['Vegetable Chopper Pro', '多功能切菜器', '厨房好物', '🥒', 24.99, 6.1],
  ['Mini Waffle Maker', '迷你华夫饼机', '厨房好物', '🧇', 21.99, 6.8],
  ['Magnetic Phone Grip Stand', '磁吸手机支架', '3C数码', '📱', 11.99, 1.8],
  ['Wireless Lavalier Mic', '无线领夹麦克风', '3C数码', '🎙️', 26.99, 7.2],
  ['Open-Ear Sport Earbuds', '开放式运动耳机', '3C数码', '🎧', 39.99, 11.5],
  ['Mini Thermal Label Printer', '迷你标签打印机', '3C数码', '🖨️', 32.99, 10.2],
  ['Car Phone Vacuum Mount', '车载真空吸盘支架', '汽车用品', '🚗', 15.99, 3.2],
  ['Cordless Car Vacuum', '无线车载吸尘器', '汽车用品', '🌀', 29.99, 8.7],
  ['Tummy Control Leggings', '高腰收腹瑜伽裤', '服饰配件', '🧘‍♀️', 22.99, 4.9],
  ['Butterfly Claw Clip Set', '蝴蝶抓夹套装', '服饰配件', '🦋', 6.99, 0.8],
  ['Oversized Hoodie Blanket', '可穿戴毛毯卫衣', '服饰配件', '🧥', 36.99, 10.9],
  ['Crossbody Phone Bag', '斜挎手机包', '服饰配件', '👜', 13.99, 2.7],
  ['Cat Window Hammock', '猫咪窗户吊床', '宠物用品', '🐈', 19.99, 4.6],
  ['Dog Paw Cleaner Cup', '狗狗洗脚杯', '宠物用品', '🐾', 12.99, 2.2],
  ['Interactive Cat Laser Toy', '自动逗猫激光玩具', '宠物用品', '🔴', 17.99, 3.8],
  ['Pet Hair Remover Roller', '宠物除毛滚筒', '宠物用品', '🧹', 10.99, 1.7],
  ['Baby Silicone Bib Set', '婴儿硅胶围兜', '母婴用品', '👶', 11.99, 1.9],
  ['White Noise Sleep Machine', '白噪音助眠仪', '母婴用品', '🌙', 23.99, 5.6],
  ['Massage Gun Mini', '迷你筋膜枪', '运动户外', '💪', 39.99, 12.4],
  ['Smart Jump Rope', '智能计数跳绳', '运动户外', '🪢', 14.99, 3.1],
  ['Collapsible Water Bottle', '可折叠水杯', '运动户外', '🥤', 9.99, 1.6],
  ['Posture Corrector Brace', '驼背矫正带', '运动户外', '🧍', 16.99, 2.9],
  ['Stanley-Style Tumbler 40oz', '40oz 保温大杯', '家居生活', '🥛', 27.99, 6.9],
  ['Rotating Makeup Organizer', '旋转化妆品收纳架', '家居生活', '🗂️', 21.99, 5.2],
  ['Acupressure Foot Mat', '足底按摩垫', '家居生活', '🦶', 18.99, 3.6],
  ['Nail Art Stamping Kit', '美甲印花套装', '美妆个护', '💅', 12.99, 2.0],
];

function rand(seed) {
  let x = seed;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

function seedProducts() {
  if (db.products.count() > 0) return;
  const items = SEED.map(([name, nameCn, category, emoji, price, cost], i) => {
    const r = rand(i * 131 + 7);
    const growth = Math.round((r() * 260 - 30) * 10) / 10;
    const sales7d = Math.round(800 + r() * 42000);
    const base = sales7d / 7;
    const trend = Array.from({ length: 14 }, (_, d) =>
      Math.max(5, Math.round(base * (1 + (growth / 100) * (d / 13 - 0.5)) * (0.85 + r() * 0.3))),
    );
    return {
      name,
      nameCn,
      category,
      emoji,
      price,
      cost: Math.round((cost + 2.5) * 100) / 100, // 含头程物流
      commissionRate: Math.round(8 + r() * 17),
      sales7d,
      salesGrowth: growth,
      gmv7d: Math.round(sales7d * price),
      videoCount: Math.round(200 + r() * 9000),
      creatorCount: Math.round(30 + r() * 1500),
      rating: Math.round((4 + r() * 0.95) * 10) / 10,
      reviews: Math.round(100 + r() * 18000),
      competition: Math.round(15 + r() * 80),
      market: ['US', 'UK', 'US', 'SEA', 'US'][i % 5],
      trend,
      tags: [],
      source: 'demo',
      favorite: false,
    };
  });
  db.products.replaceAll(items.map((p, i) => ({ id: `pr_demo${String(i).padStart(3, '0')}`, createdAt: db.now(), ...p })));
}

// 选品评分模型：增长 30% + 销量 20% + 毛利 20% + 竞争度 15% + 评分 10% + 内容潜力 5%
function score(p, all) {
  const maxSales = Math.max(...all.map((x) => x.sales7d || 0), 1);
  const margin = p.price > 0 ? (p.price - (p.cost || 0) - (p.price * (p.commissionRate || 0)) / 100) / p.price : 0;
  const parts = {
    growth: Math.max(0, Math.min(1, ((p.salesGrowth || 0) + 30) / 230)),
    sales: Math.sqrt((p.sales7d || 0) / maxSales),
    margin: Math.max(0, Math.min(1, margin / 0.6)),
    competition: 1 - (p.competition || 50) / 100,
    rating: Math.max(0, Math.min(1, ((p.rating || 4) - 3.5) / 1.5)),
    content: Math.min(1, (p.creatorCount || 0) / Math.max(1, p.videoCount || 1) * 4),
  };
  const total =
    parts.growth * 30 + parts.sales * 20 + parts.margin * 20 + parts.competition * 15 + parts.rating * 10 + parts.content * 5;
  return { score: Math.round(total), margin: Math.round(margin * 1000) / 10, parts };
}

function grade(s) {
  return s >= 75 ? 'S' : s >= 62 ? 'A' : s >= 50 ? 'B' : 'C';
}

function list({ q, category, market, sort = 'score', minScore, favorite } = {}) {
  const all = db.products.all();
  let items = all.map((p) => {
    const s = score(p, all);
    return { ...p, score: s.score, margin: s.margin, grade: grade(s.score), scoreParts: s.parts };
  });
  if (q) {
    const k = q.toLowerCase();
    items = items.filter((p) => `${p.name} ${p.nameCn} ${p.category} ${(p.tags || []).join(' ')}`.toLowerCase().includes(k));
  }
  if (category) items = items.filter((p) => p.category === category);
  if (market) items = items.filter((p) => p.market === market);
  if (minScore) items = items.filter((p) => p.score >= Number(minScore));
  if (favorite === 'true' || favorite === true) items = items.filter((p) => p.favorite);
  const sorters = {
    score: (a, b) => b.score - a.score,
    growth: (a, b) => b.salesGrowth - a.salesGrowth,
    sales: (a, b) => b.sales7d - a.sales7d,
    margin: (a, b) => b.margin - a.margin,
    competition: (a, b) => a.competition - b.competition,
  };
  items.sort(sorters[sort] || sorters.score);
  return items;
}

function getScored(idOrName) {
  return list().find((p) => p.id === idOrName) || list({ q: idOrName })[0];
}

function categories() {
  return [...new Set(db.products.all().map((p) => p.category))];
}

// CSV 导入：表头支持 name,nameCn,category,price,cost,commissionRate,sales7d,salesGrowth,videoCount,creatorCount,rating,reviews,competition,market
function importCSV(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (rows.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const parse = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (c === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = parse(rows[0]);
  const nums = ['price', 'cost', 'commissionRate', 'sales7d', 'salesGrowth', 'videoCount', 'creatorCount', 'rating', 'reviews', 'competition'];
  const created = [];
  for (const line of rows.slice(1)) {
    const cells = parse(line);
    const p = {};
    head.forEach((h, i) => (p[h] = nums.includes(h) ? Number(cells[i]) || 0 : cells[i] || ''));
    if (!p.name) continue;
    p.gmv7d = Math.round((p.sales7d || 0) * (p.price || 0));
    p.trend = Array.from({ length: 14 }, () => Math.round((p.sales7d || 0) / 7));
    p.emoji = p.emoji || '📦';
    p.category = p.category || '其他';
    p.market = p.market || 'US';
    p.source = 'import';
    created.push(db.products.insert(p));
  }
  return created.length;
}

function mockAnalysis(p) {
  const verdict = p.score >= 70 ? '强烈推荐' : p.score >= 55 ? '推荐测款' : '谨慎观望';
  return {
    verdict,
    summary: `「${p.nameCn}」近 7 天销量 ${p.sales7d.toLocaleString()}，环比 ${p.salesGrowth > 0 ? '+' : ''}${p.salesGrowth}%，综合评分 ${p.score}（${p.grade} 级）。毛利率约 ${p.margin}%，竞争度 ${p.competition}/100，${p.competition < 45 ? '处于蓝海阶段，适合快速切入' : '赛道已有一定竞争，需要差异化内容'}。`,
    sellingPoints: [`解决「${p.category}」场景下的具体痛点，前 3 秒可视化效果强`, `$${p.price} 属于冲动消费价格带，转化门槛低`, `适合 before/after 对比、开箱、真实测评类短视频`],
    audience: p.category.includes('美妆') ? '18-34 岁女性，关注变美、平价好物' : p.category.includes('宠物') ? '25-44 岁养宠人群，情感消费意愿强' : '20-40 岁注重效率与生活品质的年轻人',
    contentAngles: ['痛点开场：「你是不是也……」', '3 秒视觉冲击 + 使用前后对比', '达人真实测评 + 评论区答疑', '场景化剧情：送礼 / 宿舍 / 办公室'],
    risks: [p.competition > 65 ? '同款卖家多，需注意价格战' : '注意供应链稳定性和备货节奏', '提前确认品类是否需要资质认证（如 FDA/CE）', '避免夸大功效描述，符合平台广告规范'],
    pricing: `建议售价 $${(p.price * 0.95).toFixed(2)} - $${(p.price * 1.15).toFixed(2)}，可设置第二件半价提升客单价`,
    actions: ['先联系 10-20 位腰部达人寄样测款', '同步制作 3 条不同钩子的自营视频 A/B 测试', 'ROI 跑正后再投放 Spark Ads 放量'],
  };
}

async function analyze(productId) {
  const p = getScored(productId);
  if (!p) throw new Error('商品不存在');
  let result;
  if (llm.isMock()) result = mockAnalysis(p);
  else {
    const ctx = await rag.contextFor(`选品 ${p.category} ${p.nameCn} 风险 规则`, 3);
    result = await llm.completeJSON(
      `你是资深 TikTok Shop 选品专家。请基于以下商品数据给出选品分析。\n\n商品数据：${JSON.stringify({
        name: p.name, nameCn: p.nameCn, category: p.category, price: p.price, cost: p.cost, commissionRate: p.commissionRate,
        sales7d: p.sales7d, salesGrowth: p.salesGrowth, competition: p.competition, rating: p.rating, videoCount: p.videoCount,
        creatorCount: p.creatorCount, market: p.market, score: p.score, margin: p.margin,
      })}\n\n${ctx ? `内部知识库参考：\n${ctx}\n\n` : ''}输出 JSON：{"verdict":"强烈推荐|推荐测款|谨慎观望","summary":"一段总结","sellingPoints":["卖点"],"audience":"目标人群","contentAngles":["内容角度"],"risks":["风险"],"pricing":"定价建议","actions":["行动建议"]}`,
    );
  }
  db.products.update(p.id, { analysis: result, analyzedAt: db.now() });
  return result;
}

module.exports = { seedProducts, list, getScored, categories, importCSV, analyze, score };
