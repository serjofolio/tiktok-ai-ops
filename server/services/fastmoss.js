// FastMoss 开放接口：按类目 + 站点拉候选商品（/product/v1/search 或热销榜），再按需拉每个商品的逐日销量（/product/v1/salesTrend）
// 不占用网页导出次数；按调用次数计费，所以先算好调用次数告诉用户。后台运行，前端轮询进度
const db = require('../db');
const connectors = require('../connectors');
const products = require('./products');

const jobs = db.collection('fastmoss_jobs');
const running = new Set();
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connector() {
  const c = connectors.active('product')[0];
  if (!c) throw err('还没有接入 FastMoss 开放接口：到「接入配置 → 数据源与 ERP」添加 FastMoss 并填密钥');
  return c;
}
const client = (c) => connectors.adapter(c);

// 类目树：一天缓存一次（FastMoss 接口按次计费）
const categoryCache = new Map();
async function categories() {
  const c = connector();
  const hit = categoryCache.get(c.id);
  if (hit && Date.now() - hit.at < 86400e3) return hit.data;
  const list = await client(c).call(c, '/product/v1/categoryInfo', { lang: 'ZH_CN' });
  const walk = (nodes, level, parent) => (nodes || []).map((n) => ({ id: n.c_code, name: n.c_name, level, path: parent ? `${parent} › ${n.c_name}` : n.c_name, sub: walk(n.sub, level + 1, parent ? `${parent} › ${n.c_name}` : n.c_name) }));
  const data = { items: walk(list, 1, '') };
  categoryCache.set(c.id, { at: Date.now(), data });
  return data;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = products.parseNum(v);
  return n === null ? undefined : n;
};

// 接口返回的一条商品 → 选品库字段（字段名按官方文档）
function toProduct(x) {
  const cat = x.category || {};
  const path = [cat.l1?.name, cat.l2?.name, cat.l3?.name].filter(Boolean);
  const priceText = String(x.price ?? x.real_price ?? '').trim();
  const range = products.parseRange(priceText);
  const launched = Number(x.ctime);
  const p = {
    name: String(x.title || '').trim(),
    productId: String(x.product_id ?? ''),
    market: x.region || '',
    category: path[0] || (typeof x.category === 'string' ? x.category : '') || '',
    categoryPath: path.join(' › '),
    shop: x.shop?.name || '',
    image: x.cover || '',
    priceText,
    price: num(x.floor_price) ?? range?.min,
    priceMin: range?.min ?? num(x.floor_price),
    priceMax: range?.max ?? num(x.floor_price),
    commissionRate: num(x.commission_rate),
    creatorConvRate: num(x.creator_order_rate),
    sales7d: num(x.day7_units_sold),
    gmv: num(x.day7_gmv),
    sales28d: num(x.day28_units_sold),
    salesTotal: num(x.total_units_sold),
    gmvTotal: num(x.total_gmv),
    creatorCount: num(x.creator_count),
    videoCount: num(x.video_count),
    rating: num(x.product_rating),
    growth: num(x.growth_rate),
    tiktokUrl: x.tiktok_url || '',
    fastmossUrl: x.fastmoss_url || '',
    listingStatus: x.off_shelves === 1 ? '已下架' : x.off_shelves === 0 ? '在售' : '',
    launchDate: launched > 1e9 ? new Date(launched * (launched > 1e11 ? 1 : 1000)).toISOString().slice(0, 19).replace('T', ' ') : undefined,
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''));
}

// 调接口：被限流时等一会儿重试，其他错误直接抛出
async function call(c, path, body) {
  for (let i = 0; ; i++) {
    try {
      return await client(c).call(c, path, body);
    } catch (e) {
      if (e.fmCode !== 30003 || i >= 3) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

const REGIONS = ['US', 'GB', 'MX', 'ES', 'DE', 'IT', 'FR', 'PT', 'NL', 'BE', 'AT', 'PL', 'ID', 'VN', 'MY', 'TH', 'PH', 'BR', 'JP', 'SG'];

function planOf(cfg) {
  const pages = Math.ceil(cfg.limit / cfg.pagesize);
  return { pages, trendCalls: cfg.withTrend ? cfg.limit : 0, calls: pages + (cfg.withTrend ? cfg.limit : 0) };
}

async function fetchCandidates(c, cfg, progress) {
  const out = [];
  for (let page = 1; page <= planOf(cfg).pages; page++) {
    let data;
    if (cfg.source === 'rank') {
      const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
      data = await call(c, '/product/v1/rank/topSelling', { filter: { region: cfg.region, category_id: cfg.categoryId || undefined, date_info: { type: 'day', value: yesterday } }, orderby: [{ field: 'growth_rate', order: 'desc' }], page, pagesize: cfg.pagesize });
    } else {
      const levelKey = { 1: 'l1_category_id', 2: 'l2_category_id', 3: 'l3_category_id' }[cfg.categoryLevel] || 'l1_category_id';
      const filter = { region: cfg.region, off_shelves: 0 };
      if (cfg.categoryId) filter[levelKey] = cfg.categoryId;
      if (cfg.minSales7d) filter.day7_units_sold_range = { min: cfg.minSales7d };
      data = await call(c, '/product/v1/search', { keywords: cfg.keywords || undefined, filter, orderby: [{ field: 'day7_units_sold', order: 'desc' }], page, pagesize: cfg.pagesize });
    }
    const list = data?.list || [];
    out.push(...list);
    progress({ fetched: out.length });
    if (list.length < cfg.pagesize || out.length >= cfg.limit) break;
    await sleep(400);
  }
  return out.slice(0, cfg.limit);
}

async function execute(id, cfg) {
  const update = (patch) => jobs.update(id, patch);
  const c = connector();
  try {
    update({ status: 'running', step: '拉取候选商品' });
    const raw = await fetchCandidates(c, cfg, (x) => update(x));
    const rows = raw.map(toProduct).filter((p) => p.name);
    if (!rows.length) throw err('这个条件下没有商品，换个类目或站点试试');
    const r = products.upsert(rows, { source: 'api', fileName: cfg.label, today: cfg.today });
    update({ created: r.created, updated: r.updated, batchId: r.batchId, count: r.ids.length });
    db.activity.insert({ type: 'product', text: `FastMoss 接口拉取：新增 ${r.created}，更新 ${r.updated}` });
    if (cfg.withTrend) {
      update({ step: '拉取逐日销量' });
      let done = 0, failed = 0;
      for (const pid of r.ids) {
        const p = db.products.get(pid);
        if (!p?.productId) continue;
        try {
          const t = await call(c, '/product/v1/salesTrend', { filter: { product_id: p.productId, days: cfg.trendDays } });
          const seen = new Map((p.daily || []).map((d) => [d.dt, d]));
          for (const d of t?.list || []) seen.set(d.dt, { dt: d.dt, units: Number(d.units_sold) || 0, gmv: Number(d.gmv) || 0 });
          db.products.update(pid, { daily: [...seen.values()].sort((a, b) => a.dt.localeCompare(b.dt)).slice(-120) });
        } catch (e) {
          failed++;
          if (e.fmCode === 30001 || e.fmCode === 30002 || e.fmCode === 1002) {
            update({ warning: `逐日销量没拉完：${e.message}` });
            break;
          }
        }
        done++;
        update({ trendDone: done, trendFailed: failed });
        await sleep(300);
      }
    }
    update({ status: 'done', step: '完成', finishedAt: db.now() });
  } catch (e) {
    update({ status: 'error', error: e.message, finishedAt: db.now() });
  } finally {
    running.delete(id);
  }
}

function startPull(body) {
  connector();
  const region = String(body.region || '').toUpperCase();
  if (!REGIONS.includes(region)) throw err('请选择站点');
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 50));
  const windowDays = Math.min(14, Math.max(3, Number(body.window) || 10));
  const cfg = {
    region, limit, pagesize: Math.min(100, limit),
    source: body.source === 'rank' ? 'rank' : 'search',
    categoryId: Number(body.categoryId) || 0,
    categoryLevel: Number(body.categoryLevel) || 1,
    keywords: String(body.keywords || '').trim().slice(0, 80),
    minSales7d: Number(body.minSales7d) || 0,
    withTrend: body.withTrend !== false,
    trendDays: Math.min(28, windowDays * 2),
    today: body.today,
    label: `接口拉取 · ${region}${body.categoryName ? ` · ${String(body.categoryName).slice(0, 40)}` : ''}${body.keywords ? ` · ${String(body.keywords).slice(0, 30)}` : ''}`,
  };
  if ([...running].some((id) => jobs.get(id))) throw err('已有一个拉取任务在运行，请等它结束', 409);
  const job = jobs.insert({ status: 'running', step: '准备中', label: cfg.label, plan: planOf(cfg), fetched: 0, limit, withTrend: cfg.withTrend });
  running.add(job.id);
  execute(job.id, cfg);
  return job;
}

const latest = () => jobs.all().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;

function recover() {
  for (const j of jobs.all()) if (j.status === 'running') jobs.update(j.id, { status: 'error', error: '服务重启，任务中断，已拉到的数据已保存，可以重新拉取' });
}

module.exports = { categories, startPull, latest, recover, toProduct, REGIONS };
