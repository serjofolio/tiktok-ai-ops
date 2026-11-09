// 测款作战室：把一个商品从「选中」带到「该加码还是该止损」
//   备战：研判 → 货源 → 成本 → 上架包 → 3 条不同开头的脚本，一键跑完，缺什么就说缺什么
//   计划：按单件账本算保本 CPA、预算和止损线
//   复盘：每天录入数据，程序（不是模型）判断加码、继续、优化还是止损，并指出漏斗卡在哪一步
const db = require('../db');
const settings = require('../settings');
const connectors = require('../connectors');
const products = require('./products');
const sourcing = require('./sourcing');
const listing = require('./listing');
const scripts = require('./scripts');
const growth = require('./growth');
const videogen = require('./videogen');

const jobs = db.collection('launch_jobs');
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// 下面三个数是常用经验线，页面上标明，也可以按商品改
const KILL_MULTIPLE = 2; // 花到保本 CPA 的 2 倍还没出单就停
const SCALE_CPA = 0.7; // CPA 低于保本 CPA 的 70% 才算有加码空间
const MIN_ORDERS = 5; // 少于 5 单不下加码或判死的结论
const LOW_CTR = 1; // 点击率低于 1% 优先怀疑开头

// ---------- 单件账本 ----------
function economics(p) {
  const pr = p.evaluation.profit;
  if (!pr) return null;
  const price = Number(p.launch?.price) || p.listing?.price?.suggested || pr.asp;
  const platform = (price * pr.platformFeeRate) / 100;
  const commission = (price * pr.commission) / 100;
  const returns = (price * pr.returnRate) / 100;
  const fixed = pr.fixedFee || 0;
  const hasCost = p.costCny != null;
  const cost = hasCost ? (p.costCny + (p.shippingCny || 0)) / pr.cnyRate : null;
  const own = hasCost ? price - platform - returns - fixed - cost : null; // 自己投放的单不付达人佣金
  return {
    currency: pr.currency, cnyRate: pr.cnyRate, price: r2(price), hasCost,
    rows: [
      ['platform', `平台费 ${pr.platformFeeRate}%${fixed ? ` + 每单 ${pr.currency}${fixed}` : ''}`, r2(platform + fixed)],
      ['returns', `退货预留 ${pr.returnRate}%`, r2(returns)],
      ...(hasCost ? [['cost', `采购 ¥${p.costCny} + 物流 ¥${p.shippingCny || 0}`, r2(cost)]] : []),
    ].map(([key, label, value]) => ({ key, label, value })),
    commission: r2(commission), commissionRate: pr.commission,
    ownOrder: r2(own), creatorOrder: hasCost ? r2(own - commission) : null,
    breakEvenRoas: own > 0 ? r2(price / own) : null,
    ceilingCny: pr.ceilingCny,
  };
}

function testPlan(p, econ) {
  const be = econ?.ownOrder;
  if (!(be > 0)) return null;
  const c = p.launch || {};
  const budget = Number(c.budget) || Math.ceil(be * 10);
  const killMultiple = Number(c.killMultiple) || KILL_MULTIPLE;
  return {
    budget, killMultiple, days: Number(c.planDays) || 7,
    breakEvenCpa: be, killSpend: r2(be * killMultiple), scaleCpa: r2(be * SCALE_CPA),
    expectedOrders: Math.floor(budget / be), stock: Math.max(10, Math.floor(budget / be) * 2),
    rules: [`花满 ${econ.currency}${r2(be * killMultiple)} 还没有一单：停`, `CPA 低于 ${econ.currency}${r2(be * SCALE_CPA)} 且至少 ${MIN_ORDERS} 单：每次加 20–30% 预算`, `CPA 高于保本 ${econ.currency}${be}：先按诊断改素材或详情页，改完还不行就停`],
  };
}

// ---------- 数据汇总 ----------
function sumRows(rows, econ) {
  const t = { views: 0, clicks: 0, orders: 0, adSpend: 0, creatorOrders: 0 };
  for (const d of rows) {
    t.views += d.views || 0;
    t.clicks += d.clicks || 0;
    t.orders += d.orders || 0;
    t.adSpend += d.adSpend || 0;
    t.creatorOrders += d.creatorOrders ?? d.orders ?? 0; // 没填就全部按达人单扣佣金，宁可算少
  }
  t.adSpend = r2(t.adSpend);
  t.ctr = pct(t.clicks, t.views);
  t.cvr = pct(t.orders, t.clicks);
  t.cpc = t.clicks ? r2(t.adSpend / t.clicks) : null;
  t.cpa = t.orders ? r2(t.adSpend / t.orders) : null;
  if (econ?.hasCost) {
    t.margin = r2((t.orders - t.creatorOrders) * econ.ownOrder + t.creatorOrders * econ.creatorOrder);
    t.profit = r2(t.margin - t.adSpend);
    t.profitCny = r2(t.profit * econ.cnyRate);
    t.roas = t.adSpend ? r2((t.orders * econ.price) / t.adSpend) : null;
    t.breakEvenCpa = t.orders ? r2(t.margin / t.orders) : econ.ownOrder;
  }
  return t;
}

// 钱从哪里漏掉的。这里用保本算出「需要多高的转化率」，不套别人的行业均值
function diagnose(t, econ) {
  const out = [];
  const c = econ.currency;
  if (t.ctr != null && t.ctr < LOW_CTR) out.push({ stage: '开头', text: `点击率 ${t.ctr}%，低于经验线 ${LOW_CTR}%：看的人没有被打动，先换开头。只重录第一句话最省钱`, action: 'hook' });
  if (t.clicks >= 20 && t.cpc != null && t.breakEvenCpa > 0) {
    const need = pct(t.cpc, t.breakEvenCpa);
    if (t.cvr != null && t.cvr < need) out.push({ stage: '成交', text: `每次点击 ${c}${t.cpc}、每单最多能花 ${c}${t.breakEvenCpa}，转化率至少要 ${need}% 才保本，现在是 ${t.cvr}%。点了不买，先查价格、主图、评价和运费`, action: 'detail' });
    else if (t.cvr != null) out.push({ stage: '成交', text: `转化率 ${t.cvr}%，高于保本需要的 ${need}%，详情页没拖后腿`, ok: true });
  }
  return out;
}

function decide(econ, plan, rows) {
  if (!econ) return { code: 'blocked', label: '缺售价', title: '先补售价', why: '没有售价算不出账本。' };
  if (!econ.hasCost) return { code: 'blocked', label: '缺成本', title: '先定货源和成本', why: `没有采购价就不知道能花多少钱买一单。按目标利润，采购加物流不能超过 ¥${Math.max(0, econ.ceilingCny)}。` };
  if (econ.ownOrder <= 0) return { code: 'stop', label: '止损', title: '这个价格卖一单亏一单', why: `扣完费用和成本，每单还差 ${econ.currency}${r2(-econ.ownOrder)}，投得越多亏得越多。要么换便宜的货源，要么提价。` };
  if (!rows.length) return { code: 'ready', label: '待开测', title: '账本算好了，可以开测', why: `每单最多能花 ${econ.currency}${econ.ownOrder} 买流量，超过就亏。每天把数据录进来，这里会告诉你该怎么做。` };
  const t = sumRows(rows, econ);
  const c = econ.currency;
  const diagnosis = diagnose(t, econ);
  const small = t.orders < MIN_ORDERS;
  const recent = sumRows([...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(-3), econ);
  if (!t.adSpend) {
    return t.orders
      ? { code: 'keep', label: '继续', title: '没花广告费也在出单', why: `${t.orders} 单全部来自自然流或达人，已赚 ${c}${t.profit}。继续发视频，可以小额投放表现最好的一条。`, diagnosis }
      : { code: 'keep', label: '继续', title: '还没出单，也没花钱', why: '继续发视频或寄样。开始投放后把花费录进来才能算账。', diagnosis };
  }
  if (!t.orders) {
    if (t.adSpend >= plan.killSpend) return { code: 'stop', label: '止损', title: '花到止损线还没出单', why: `已经花了 ${c}${t.adSpend}，止损线是 ${c}${plan.killSpend}，一单没出。除非明确知道问题在哪，否则停掉。`, diagnosis };
    return { code: 'keep', label: '继续', title: '还在止损线以内', why: `已花 ${c}${t.adSpend}，还能再花 ${c}${r2(plan.killSpend - t.adSpend)}。到线还没出单就停。`, diagnosis };
  }
  const be = t.breakEvenCpa;
  if (t.cpa <= be * SCALE_CPA && !small) {
    if (recent.orders && recent.cpa > be) return { code: 'keep', label: '继续', title: '总账赚钱，但最近变贵了', why: `累计 CPA ${c}${t.cpa}，最近 3 条记录涨到 ${c}${recent.cpa}，超过保本 ${c}${be}。素材可能在疲劳，先别加预算，补新开头。`, diagnosis };
    return { code: 'scale', label: '加码', title: '有利润空间，可以加预算', why: `${t.orders} 单，CPA ${c}${t.cpa}，保本 ${c}${be}，每单还留 ${c}${r2(be - t.cpa)}。每次加 20–30% 预算，一次加太猛容易把成本打乱。`, diagnosis };
  }
  if (t.cpa <= be) return { code: 'keep', label: '继续', title: small ? '方向对，单量还太少' : '赚钱，但空间不大', why: `CPA ${c}${t.cpa}，保本 ${c}${be}。${small ? `才 ${t.orders} 单，偶然性大，凑够 ${MIN_ORDERS} 单再下结论。` : '先把 CPA 压到保本的七成以下再加预算。'}`, diagnosis };
  if (t.adSpend >= plan.killSpend * 3 && !small) return { code: 'stop', label: '止损', title: '持续亏钱，该停了', why: `CPA ${c}${t.cpa}，超过保本 ${c}${be}，累计亏 ${c}${r2(-t.profit)}。已经花了止损线 3 倍以上，继续投大概率还是亏。`, diagnosis };
  return { code: 'fix', label: '要优化', title: '现在亏钱，先改再投', why: `CPA ${c}${t.cpa}，超过保本 ${c}${be}。${small ? `才 ${t.orders} 单，` : ''}按下面的诊断改一处，再看数据。`, diagnosis };
}

// 素材榜：哪条脚本（开头）最能卖
function creativeBoard(p, econ) {
  const groups = new Map();
  for (const d of p.launch?.days || []) groups.set(d.scriptId || '', [...(groups.get(d.scriptId || '') || []), d]);
  const rows = [...groups.entries()].map(([scriptId, list]) => {
    const s = scriptId ? db.scripts.get(scriptId) : null;
    return { scriptId, title: s?.title || (scriptId ? '脚本已删除' : '未标记素材'), hook: s?.hook || '', ...sumRows(list, econ) };
  });
  const ranked = rows.filter((r) => r.scriptId && r.orders >= 3 && r.cpa != null).sort((a, b) => a.cpa - b.cpa);
  const best = ranked[0];
  if (best && (best.breakEvenCpa == null || best.cpa <= best.breakEvenCpa)) best.winner = true;
  return rows.sort((a, b) => (b.orders - a.orders) || ((a.cpa ?? 1e9) - (b.cpa ?? 1e9)));
}

// ---------- 备战清单 ----------
function checklist(p, econ) {
  const list = db.scripts.all().filter((s) => s.productId === p.id);
  const videos = videogen.list().filter((j) => j.productId === p.id && j.status === 'done');
  const hasLlm = !!settings.activeProvider();
  const s = p.sourcing || {};
  const L = p.listing;
  const days = p.launch?.days?.length || 0;
  const verdict = p.evaluation.verdict;
  const risk = p.evaluation.flags.find((f) => f.level === 'block');
  return [
    { key: 'analyze', label: '选品研判', done: !!(p.ai || p.analysis), warn: risk ? `${risk.title}：${risk.detail}` : '', note: p.ai || p.analysis ? `结论：${verdict}` : `规则结论：${verdict}${hasLlm ? '' : '（接入大模型后可以做 AI 深度分析）'}`, href: `#/products/${p.id}` },
    { key: 'source', label: '1688 货源', done: !!s.chosen, note: s.chosen ? `已选定，采购价 ¥${p.costCny}` : s.offers?.length ? `${s.offers.length} 个货源待挑选` : p.costCny != null ? `已手填采购价 ¥${p.costCny}` : '还没有货源', href: `#/products/${p.id}/source` },
    { key: 'profit', label: '单件账本', done: !!econ?.hasCost, note: econ?.hasCost ? (econ.ownOrder > 0 ? `每单最多能花 ${econ.currency}${econ.ownOrder}` : '这个价格不赚钱') : '要先有采购价', href: `#/products/${p.id}/source` },
    { key: 'listing', label: '上架包', done: !!L, note: L ? { draft: '已生成，等你确认', approved: '已确认，待推送', pushed: '已推送到 ERP' }[L.status] : '本地语言标题、卖点、定价和违禁词检查', href: `#/products/${p.id}/listing` },
    { key: 'scripts', label: '测款脚本', done: list.length >= 3, note: list.length ? `已有 ${list.length} 条${list.length < 3 ? '，建议 3 条不同开头对比' : ''}` : '官方建议同时测 3–5 条有明显差异的素材', href: `#/scripts/new/${p.id}` },
    { key: 'video', label: '视频素材', done: videos.length > 0, optional: true, note: videos.length ? `AI 已生成 ${videos.length} 条` : '实拍，或接入视频模型生成', href: '#/scripts/videos' },
    { key: 'push', label: '上架', done: L?.status === 'pushed', optional: true, note: L?.status === 'pushed' ? '已推送' : '确认上架包后推送 ERP，或手动上架', href: `#/products/${p.id}/listing` },
    { key: 'test', label: '测款数据', done: days > 0, note: days ? `已录入 ${days} 条` : '开测后每天录入', href: `#/launch/${p.id}/data` },
  ];
}

function view(p, withDetail = true) {
  const econ = economics(p);
  const plan = testPlan(p, econ);
  const rows = p.launch?.days || [];
  const decision = decide(econ, plan, rows);
  const totals = econ ? sumRows(rows, econ) : null;
  const base = { id: p.id, name: p.name, nameZh: p.nameZh || '', image: p.image, sample: !!p.sample, type: p.evaluation.metrics.type, market: p.evaluation.metrics.market, verdict: p.evaluation.verdict, started: !!p.launch, economics: econ, decision, totals, lastDate: [...rows].map((d) => d.date).sort().at(-1) || null };
  if (!withDetail) return base;
  const job = jobs.all().filter((j) => j.productId === p.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  let running = 0;
  const series = [...rows].sort((a, b) => a.date.localeCompare(b.date)).reduce((acc, d) => {
    const last = acc.at(-1);
    if (last?.date === d.date) { last.rows.push(d); return acc; }
    acc.push({ date: d.date, rows: [d] });
    return acc;
  }, []).map((g) => {
    const t = econ?.hasCost ? sumRows(g.rows, econ) : null;
    running += t?.profit || 0;
    return { date: g.date, profit: t?.profit ?? null, cumulative: r2(running), orders: g.rows.reduce((a, x) => a + (x.orders || 0), 0), spend: r2(g.rows.reduce((a, x) => a + (x.adSpend || 0), 0)) };
  });
  return { ...base, plan, thresholds: { killMultiple: KILL_MULTIPLE, scaleCpa: SCALE_CPA, minOrders: MIN_ORDERS, lowCtr: LOW_CTR }, checklist: checklist(p, econ), days: [...rows].sort((a, b) => b.date.localeCompare(a.date)), series, creatives: econ ? creativeBoard(p, econ) : [], scripts: db.scripts.all().filter((s) => s.productId === p.id).map(({ id, title, hook, check, hookName }) => ({ id, title, hook, hookName, score: check?.score ?? null })), job, hasLlm: !!settings.activeProvider(), hasSourcingApi: connectors.active('sourcing').length > 0, flags: p.evaluation.flags.filter((f) => f.level === 'block' || f.level === 'major') };
}

function need(id) {
  const p = products.get(id);
  if (!p) throw err('商品不存在', 404);
  return p;
}
const get = (id) => view(need(id));

function start(id) {
  const p = need(id);
  if (!p.launch) db.products.update(id, { launch: { startedAt: db.now(), days: [] } });
  return get(id);
}

function configure(id, body = {}) {
  const p = need(id);
  const launch = { startedAt: db.now(), days: [], ...(p.launch || {}) };
  for (const [k, key] of [['budget', 'budget'], ['killMultiple', 'killMultiple'], ['planDays', 'planDays'], ['price', 'price']]) {
    if (body[k] === undefined) continue;
    if (body[k] === '' || body[k] === null) {
      delete launch[key];
      continue;
    }
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n <= 0) throw err('请填大于 0 的数字');
    launch[key] = n;
  }
  db.products.update(id, { launch });
  return get(id);
}

const count = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw err(`${label}要填不小于 0 的数字`);
  return n;
};

// 同一天、同一条素材只留一行，重复录入等于修改
function addDay(id, body = {}) {
  const p = need(id);
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw err('日期格式不对');
  const scriptId = String(body.scriptId || '');
  if (scriptId && db.scripts.get(scriptId)?.productId !== id) throw err('这条脚本不属于这个商品');
  const row = {
    date, scriptId,
    views: count(body.views, '播放量'), clicks: count(body.clicks, '点击量'),
    orders: count(body.orders, '订单数') ?? 0, adSpend: count(body.adSpend, '广告花费') ?? 0,
    creatorOrders: count(body.creatorOrders, '达人单数'),
    note: String(body.note || '').slice(0, 200),
  };
  if (row.creatorOrders != null && row.creatorOrders > row.orders) throw err('达人单数不能超过订单数');
  const launch = { startedAt: db.now(), days: [], ...(p.launch || {}) };
  const old = launch.days.find((d) => d.date === date && (d.scriptId || '') === scriptId);
  const days = launch.days.filter((d) => d !== old);
  if (days.length >= 500) throw err('记录太多了');
  days.push({ id: old?.id || `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...row });
  db.products.update(id, { launch: { ...launch, days }, status: p.status === 'dropped' ? 'dropped' : 'testing' });
  return get(id);
}

function removeDay(id, dayId) {
  const p = need(id);
  db.products.update(id, { launch: { ...(p.launch || {}), days: (p.launch?.days || []).filter((d) => d.id !== dayId) } });
  return get(id);
}

// ---------- 一键备战：已有的不重做，能做的都做，做不了的写明原因 ----------
const active = new Set();
const STYLE_SET = { jewelry: ['styling', 'gift', 'price'], other: ['pain', 'demo', 'ugc'] };

function prepare(id, { force } = {}) {
  const p = need(id);
  if (active.has(id)) throw err('正在备战中', 409);
  const risk = p.evaluation.flags.find((f) => f.level === 'block');
  if (risk && !force) throw Object.assign(err(`这个商品有硬伤：${risk.title}。${risk.detail}`, 409), { code: 'risk' });
  if (!settings.activeProvider()) throw err('一键备战要用大模型：先到「接入配置」接入一个', 400);
  const job = jobs.insert({ productId: id, status: 'running', steps: [['analyze', 'AI 深度分析'], ['source', '1688 找货'], ['choose', '选定供应商'], ['listing', '生成上架包'], ['scripts', '写 3 条测款脚本']].map(([key, label]) => ({ key, label, status: 'pending', note: '' })) });
  active.add(id);
  runPrepare(job.id, id).finally(() => active.delete(id));
  return get(id);
}

async function runPrepare(jobId, id) {
  const step = (key, patch) => {
    const j = jobs.get(jobId);
    jobs.update(jobId, { steps: j.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  };
  const run = async (key, fn) => {
    step(key, { status: 'running' });
    try {
      const r = await fn();
      step(key, { status: r?.skip ? 'skipped' : 'done', note: r?.note || '' });
    } catch (e) {
      step(key, { status: 'error', note: e.message });
    }
  };
  await run('analyze', async () => {
    if (db.products.get(id).analysis) return { skip: true, note: '已经分析过' };
    const a = await products.analyze(id);
    return { note: `结论：${a.verdict || '已完成'}` };
  });
  await run('source', async () => {
    const p = db.products.get(id);
    if (p.sourcing?.offers?.length) return { skip: true, note: `已有 ${p.sourcing.offers.length} 个货源` };
    if (!connectors.active('sourcing').length) return { skip: true, note: '没有 1688 接口：用浏览器插件采集，或手动添加货源' };
    const s = await sourcing.search(id);
    return { note: `找到 ${s.offers.length} 个货源` };
  });
  await run('choose', async () => {
    const p = db.products.get(id);
    if (p.sourcing?.chosen) return { skip: true, note: '已选定供应商' };
    const offers = p.sourcing?.offers || [];
    if (!offers.length) return { skip: true, note: '没有货源可选' };
    const best = sourcing.pick(offers);
    if (!best) return { skip: true, note: '没有同时满足同款、利润成立和在售的货源，请人工挑选' };
    sourcing.choose(id, best.offerId || best.url);
    return { note: `选定 ¥${best.price} 的货源，到手成本 ¥${best.landedCny}` };
  });
  await run('listing', async () => {
    const p = db.products.get(id);
    if (p.listing) return { skip: true, note: '已有上架包，不覆盖你的修改' };
    await listing.build(id);
    return { note: '已生成，等你确认后才会推送' };
  });
  await run('scripts', async () => {
    const before = db.scripts.all().filter((s) => s.productId === id);
    if (before.length >= 3) return { skip: true, note: `已有 ${before.length} 条脚本` };
    const p = products.get(id);
    const styles = STYLE_SET[p.evaluation.metrics.group === '首饰' ? 'jewelry' : 'other'];
    const avoid = before.map((s) => s.hook);
    let made = 0;
    const errors = [];
    for (let i = before.length; i < 3; i++) {
      try {
        const s = await scripts.generate({ productId: id, style: styles[i], variant: i, avoid, mode: 'person', duration: 26 });
        avoid.push(s.hook);
        made++;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (!made) throw err(errors[0] || '脚本生成失败');
    return { note: `写好 ${made} 条${errors.length ? `，${errors.length} 条失败` : ''}` };
  });
  const j = jobs.get(jobId);
  const p = db.products.get(id);
  jobs.update(jobId, { status: 'done', finishedAt: db.now() });
  if (!p.launch) db.products.update(id, { launch: { startedAt: db.now(), days: [] } });
  db.activity.insert({ type: 'product', text: `一键备战：${p.name}（${j.steps.filter((s) => s.status === 'done').length} 步完成）` });
}

function recover() {
  for (const j of jobs.all()) if (j.status === 'running') jobs.update(j.id, { status: 'done', finishedAt: db.now(), steps: j.steps.map((s) => (['running', 'pending'].includes(s.status) ? { ...s, status: 'error', note: '服务重启，这一步中断了，再点一次备战会接着做' } : s)) });
}

// ---------- 全局看板 ----------
const COLUMN = { scale: 'scale', stop: 'stop', keep: 'testing', fix: 'testing' };

function board() {
  const all = products.list({ sort: 'score' }).filter((p) => p.status !== 'dropped');
  const items = all.filter((p) => p.launch || p.status === 'testing').map((p) => view(p, false));
  const columns = { prep: [], testing: [], scale: [], stop: [] };
  const sum = { spendCny: 0, profitCny: 0, orders: 0 };
  for (const it of items) {
    columns[(it.lastDate && COLUMN[it.decision.code]) || (it.decision.code === 'stop' ? 'stop' : 'prep')].push(it);
    if (it.totals) {
      sum.spendCny += (it.totals.adSpend || 0) * it.economics.cnyRate;
      sum.profitCny += it.totals.profitCny || 0;
      sum.orders += it.totals.orders || 0;
    }
  }
  const taken = new Set(items.map((x) => x.id));
  const next = growth.board({ window: 10, limit: 40 }).items.filter((r) => !taken.has(r.id) && r.verdict === '可以上' && !(r.units.rate < 0)).slice(0, 4);
  return { columns, summary: { active: items.length, orders: sum.orders, spendCny: Math.round(sum.spendCny), profitCny: Math.round(sum.profitCny) }, next };
}

// ---------- 今日行动：打开系统先看这个 ----------
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

function actions(today = new Date().toISOString().slice(0, 10)) {
  const out = [];
  const add = (rank, level, title, why, href, cta) => out.push({ rank, level, title, why, href, cta });
  const all = products.list({ sort: 'score' }).filter((p) => p.status !== 'dropped');
  const short = (s) => (s.length > 34 ? `${s.slice(0, 34)}…` : s);
  for (const p of all) {
    const go = `#/launch/${p.id}`;
    if (p.launch || p.status === 'testing') {
      const v = view(p, false);
      if (v.decision.code === 'stop') add(0, 'danger', `停掉「${short(p.name)}」`, v.decision.why, go, '看依据');
      else if (v.decision.code === 'scale') add(1, 'good', `给「${short(p.name)}」加预算`, v.decision.why, go, '看依据');
      else if (v.decision.code === 'fix') add(2, 'warn', `优化「${short(p.name)}」`, v.decision.diagnosis?.[0]?.text || v.decision.why, go, '看诊断');
      if (v.lastDate && daysBetween(v.lastDate, today) >= 2 && v.decision.code !== 'stop') add(3, 'warn', `补录「${short(p.name)}」的数据`, `最后一次录入是 ${v.lastDate}，已经隔了 ${daysBetween(v.lastDate, today)} 天，建议可能过期了。`, `${go}/data`, '去录入');
    }
    if (p.listing?.status === 'draft') add(4, 'info', `确认「${short(p.name)}」的上架包`, `合规提示 ${(p.listing.compliance?.issues?.length || 0) + (p.listing.compliance?.risks?.length || 0)} 条，确认后才能推送。`, `#/products/${p.id}/listing`, '去确认');
    else if (p.listing?.status === 'approved') add(5, 'info', `推送「${short(p.name)}」`, '上架包已确认，还没推送到 ERP。', `#/products/${p.id}/listing`, '去推送');
  }
  const taken = new Set(all.filter((p) => p.launch || p.status === 'testing').map((p) => p.id));
  const hot = growth.board({ window: 10, limit: 40 }).items.filter((r) => !taken.has(r.id) && r.verdict === '可以上' && !(r.units.rate < 0)).slice(0, 2);
  for (const r of hot) add(6, 'good', `开打「${short(r.name)}」`, `近 10 天销量约 ${r.units.cur} 件${r.units.rate != null ? `，增长 ${r.units.rate}%` : ''}（${r.grade === 'estimate' ? '估算' : '实测'}），结论「可以上」，还没开始备战。`, `#/launch/${r.id}`, '进作战室');
  const newest = all.map((p) => String(p.dataAt || '').slice(0, 10)).filter(Boolean).sort().at(-1);
  if (newest && daysBetween(newest, today) >= 7) add(7, 'info', '重新导入一次同类目', `最新数据是 ${newest}。隔 7–10 天再导一次同一类目，增长榜就能算出真实增长。`, '#/products', '去导入');
  if (all.length && !settings.activeProvider()) add(8, 'info', '接入大模型', '研判、上架包和脚本都要用。', '#/providers', '去接入');
  return out.sort((a, b) => a.rank - b.rank).slice(0, 6);
}

// ---------- 导出作战书 ----------
function exportMd(id) {
  const v = get(id);
  const e = v.economics, c = e?.currency || '', t = v.totals, d = v.decision;
  const lines = [`# 测款作战书：${v.name}`, '', `> ${v.sample ? '示例数据，数字是虚构的。' : ''}站点 ${v.market} · 选品结论 ${v.verdict}`, '', `## 当前判断：${d.label}`, `**${d.title}**`, '', d.why, ''];
  for (const x of d.diagnosis || []) lines.push(`- ${x.stage}：${x.text}`);
  if (e) {
    lines.push('', '## 单件账本', '', '| 项目 | 金额 |', '|---|---|', `| 售价 | ${c}${e.price} |`, ...e.rows.map((r) => `| ${r.label} | -${c}${r.value} |`), `| 自投单能花在流量上的钱（保本 CPA） | ${e.ownOrder == null ? '缺成本' : c + e.ownOrder} |`, `| 达人单再扣佣金 ${e.commissionRate}% | -${c}${e.commission} |`);
  }
  if (v.plan) lines.push('', '## 测款计划', '', `- 预算 ${c}${v.plan.budget}，周期 ${v.plan.days} 天，首批备货约 ${v.plan.stock} 件`, ...v.plan.rules.map((r) => `- ${r}`));
  if (t?.orders || t?.adSpend) lines.push('', '## 累计数据', '', `花费 ${c}${t.adSpend} · 订单 ${t.orders} · CPA ${t.cpa == null ? '—' : c + t.cpa} · ROAS ${t.roas ?? '—'} · 利润 ${c}${t.profit}（约 ¥${t.profitCny}）`);
  if (v.creatives.length) lines.push('', '## 素材榜', '', '| 素材 | 花费 | 订单 | CPA |', '|---|---|---|---|', ...v.creatives.map((x) => `| ${x.winner ? '★ ' : ''}${x.title} | ${c}${x.adSpend} | ${x.orders} | ${x.cpa == null ? '—' : c + x.cpa} |`));
  if (v.scripts.length) lines.push('', '## 脚本开头', '', ...v.scripts.map((s) => `- ${s.title}：${s.hook}`));
  return lines.join('\n') + '\n';
}

module.exports = { get, start, configure, addDay, removeDay, prepare, recover, board, actions, exportMd, economics, decide, sumRows, testPlan };
