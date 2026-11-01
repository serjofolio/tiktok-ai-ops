// 自动上品流水线：多个 Agent 接力，人只在关键节点确认
//   ① 选品数据 Agent：拉取 FastMoss 数据（接口开通前用最近一次导入 / 插件发送的数据）
//   ② 研判 Agent：六维评分 + AI 逐个研判
//   ③ 找货 Agent：对「可以上」的商品在 1688 关键词 + 以图搜货，比价矩阵 + 同款判断
//   ④ 采购 Agent：自动挑选同款度高、利润成立、比价得分最高的供应商
//   ⑤ 上架 Agent：生成本地语言上架包，违禁词与合规检查，按目标利润定价
//   ⑥ 人工确认：检查上架包（可设置为自动通过）
//   ⑦ 上品 Agent：推送到妙手 ERP / Webhook
const db = require('../db');
const settings = require('../settings');
const connectors = require('../connectors');
const products = require('./products');
const report = require('./report');
const sourcing = require('./sourcing');
const listing = require('./listing');

const runs = db.collection('pipeline_runs');
const active = new Map(); // runId → true（内存中执行中的流水线）
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const STAGES = [
  ['fetch', '选品数据', '拉取 FastMoss 商品数据'],
  ['analyze', 'AI 研判', '六维评分，逐个判断能不能上'],
  ['source', '1688 找货', '关键词 + 以图搜货，比价矩阵与同款判断'],
  ['choose', '选定供应商', '同款度高、利润成立、比价得分最高'],
  ['pack', '生成上架包', '本地语言标题描述、合规检查、定价'],
  ['review', '人工确认', '检查上架包后确认'],
  ['push', '推送 ERP', '一键上品到妙手 ERP / Webhook'],
];

function view(r) {
  if (!r) return null;
  const items = (r.items || []).map((it) => {
    const p = db.products.get(it.productId);
    return { ...it, name: p?.name || it.name, image: p?.image, listingStatus: p?.listing?.status || null, chosen: p?.sourcing?.chosen || null };
  });
  return { ...r, items, running: active.has(r.id) };
}

function patchRun(id, fn) {
  const r = runs.get(id);
  if (!r) return null;
  const next = fn(JSON.parse(JSON.stringify(r)));
  return runs.update(id, next);
}

const log = (id, text) => patchRun(id, (r) => ({ logs: [{ at: db.now(), text }, ...(r.logs || [])].slice(0, 200) }));
const stage = (id, key, status, detail) => patchRun(id, (r) => ({ stages: r.stages.map((s) => (s.key === key ? { ...s, status, detail: detail ?? s.detail, at: db.now() } : s)) }));
const item = (id, productId, patch) => patchRun(id, (r) => ({ items: r.items.map((x) => (x.productId === productId ? { ...x, ...patch } : x)) }));

async function execute(id) {
  const r = runs.get(id);
  const cfg = r.config;
  try {
    // ① 选品数据
    stage(id, 'fetch', 'running');
    const fm = connectors.active('product')[0];
    const all = db.products.all().filter((p) => p.status !== 'dropped');
    const last = all.filter((p) => p.batchId).sort((a, b) => String(b.dataAt).localeCompare(String(a.dataAt)))[0];
    if (!all.length) throw err('选品库还没有数据：先在「智能选品」导入 FastMoss 导出文件');
    const batch = cfg.scope === 'all' || !last ? all : all.filter((p) => p.batchId === last.batchId);
    const inBatch = new Set(batch.map((p) => p.id));
    const scopeText = cfg.scope === 'all' || !last ? `整个选品库 ${batch.length} 个商品` : `最近一次导入的 ${batch.length} 个商品（${String(last.dataAt).slice(0, 10)}）`;
    stage(id, 'fetch', 'done', `${fm ? 'FastMoss 接口待文档，' : ''}使用${scopeText}`);
    log(id, `选品数据：${scopeText}`);

    // ② AI 研判：这批商品还没研判过才重新跑
    stage(id, 'analyze', 'running');
    const needAi = batch.filter((p) => !p.ai).length;
    if (needAi && settings.activeProvider()) {
      log(id, `研判 Agent：${needAi} 个商品待研判，开始生成 AI 选品报告`);
      const rep = report.start({ ids: batch.map((p) => p.id) });
      await report.wait(rep.id);
    }
    const ranked = products.list({ sort: 'score' }).filter((p) => inBatch.has(p.id));
    const go = ranked.filter((p) => p.evaluation.verdict === '可以上').slice(0, cfg.topN);
    stage(id, 'analyze', 'done', `可以上 ${ranked.filter((p) => p.evaluation.verdict === '可以上').length} 个，取评分最高的 ${go.length} 个进入找货`);
    if (!go.length) throw err('这批商品没有「可以上」的，流水线结束。可以换一个类目或站点重新导入');
    patchRun(id, () => ({ items: go.map((p) => ({ productId: p.id, name: p.name, stage: 'source', status: 'pending', note: '' })) }));

    // ③ 找货
    stage(id, 'source', 'running');
    const hasApi = connectors.active('sourcing').length > 0;
    let sourced = 0;
    for (const p of go) {
      if (!hasApi) {
        item(id, p.id, { stage: 'source', status: 'waiting', note: '没有 1688 接口：用浏览器插件在 1688 搜索页一键采集货源' });
        continue;
      }
      try {
        const s = await sourcing.search(p.id);
        sourced++;
        item(id, p.id, { stage: 'choose', status: 'pending', note: `找到 ${s.offers.length} 个货源（关键词「${s.keyword}」）` });
        log(id, `找货 Agent：${p.name.slice(0, 30)} → ${s.offers.length} 个货源`);
      } catch (e) {
        item(id, p.id, { status: 'error', note: e.message });
        log(id, `找货失败：${p.name.slice(0, 30)}：${e.message}`);
      }
    }
    stage(id, 'source', hasApi ? 'done' : 'waiting', hasApi ? `${sourced}/${go.length} 个商品找到货源` : '没有 1688 接口：用浏览器插件采集后点「继续」');
    await chooseAndPack(id);
  } catch (e) {
    patchRun(id, (x) => ({ status: 'error', error: e.message, stages: x.stages.map((s) => (s.status === 'running' ? { ...s, status: 'error', detail: e.message } : s)) }));
    log(id, `流水线中止：${e.message}`);
  } finally {
    active.delete(id);
  }
}

// ④⑤⑥⑦：插件补完货源后也从这里继续
async function chooseAndPack(id) {
  const r = runs.get(id);
  const cfg = r.config;
  stage(id, 'choose', 'running');
  let chosen = 0;
  for (const it of r.items) {
    const p = products.get(it.productId);
    if (!p) continue;
    if (p.sourcing?.chosen) {
      chosen++;
      continue;
    }
    const offers = p.sourcing?.offers || [];
    if (!offers.length) continue;
    const best = offers.find((o) => (o.match ?? 70) >= cfg.minMatch && o.profitOk !== false && o.status === 'published');
    if (best) {
      sourcing.choose(p.id, best.offerId || best.url);
      chosen++;
      item(id, p.id, { stage: 'pack', status: 'pending', note: `选定供应商：¥${best.price}${best.match != null ? `，同款度 ${best.match}` : ''}，到手成本 ¥${best.landedCny}` });
      log(id, `采购 Agent：${p.name.slice(0, 30)} 选定 ¥${best.price} 的货源`);
    } else item(id, p.id, { stage: 'choose', status: 'waiting', note: '没有同时满足「同款、利润成立、在售」的货源，请人工挑选' });
  }
  stage(id, 'choose', chosen ? 'done' : 'waiting', `${chosen}/${r.items.length} 个商品选定供应商`);

  stage(id, 'pack', 'running');
  let packed = 0;
  for (const it of runs.get(id).items) {
    const p = db.products.get(it.productId);
    if (!p?.sourcing?.chosen) continue;
    if (p.listing && p.listing.status !== 'draft') {
      packed++;
      continue;
    }
    try {
      await listing.build(p.id);
      if (cfg.autoApprove) listing.update(p.id, { status: 'approved' });
      packed++;
      item(id, p.id, { stage: 'review', status: cfg.autoApprove ? 'done' : 'waiting', note: cfg.autoApprove ? '上架包已生成并自动确认' : '上架包已生成，等你确认' });
      log(id, `上架 Agent：${p.name.slice(0, 30)} 上架包已生成`);
    } catch (e) {
      item(id, p.id, { status: 'error', note: `上架包生成失败：${e.message}` });
    }
  }
  stage(id, 'pack', packed ? 'done' : 'waiting', `${packed} 个上架包`);
  const approved = runs.get(id).items.filter((it) => ['approved', 'pushed'].includes(db.products.get(it.productId)?.listing?.status)).length;
  stage(id, 'review', approved && approved >= packed ? 'done' : packed ? 'waiting' : 'pending', cfg.autoApprove ? '自动确认' : `已确认 ${approved}/${packed}`);
  if (approved) await pushApproved(id);
  const end = runs.get(id);
  const waiting = end.stages.some((s) => s.status === 'waiting');
  patchRun(id, () => ({ status: waiting ? 'waiting' : 'done', finishedAt: db.now() }));
}

async function pushApproved(id) {
  const r = runs.get(id);
  const erp = r.config.connectorId ? connectors.get(r.config.connectorId) : connectors.active('erp')[0];
  if (!erp) {
    stage(id, 'push', 'waiting', '还没有可用的 ERP：添加妙手 ERP 或通用 Webhook 后点「继续」');
    return;
  }
  stage(id, 'push', 'running');
  let ok = 0, total = 0;
  for (const it of r.items) {
    const p = db.products.get(it.productId);
    if (p?.listing?.status === 'pushed') {
      ok++;
      total++;
      continue;
    }
    if (p?.listing?.status !== 'approved') continue;
    total++;
    try {
      await listing.push(p.id, erp.id);
      ok++;
      item(id, p.id, { stage: 'push', status: 'done', note: `已推送到 ${erp.name}` });
      log(id, `上品 Agent：${p.name.slice(0, 30)} → ${erp.name}`);
    } catch (e) {
      item(id, p.id, { stage: 'push', status: 'error', note: e.message });
    }
  }
  stage(id, 'push', ok && ok === total ? 'done' : total ? 'error' : 'pending', `${ok}/${total} 个已推送到 ${erp.name}`);
}

function start(config = {}) {
  if ([...active.keys()].some((rid) => runs.get(rid))) throw err('已有一条流水线在运行，请等它结束', 409);
  const cfg = { scope: config.scope === 'all' ? 'all' : 'latest', topN: Math.min(20, Math.max(1, Number(config.topN) || 5)), minMatch: Math.min(95, Math.max(0, Number(config.minMatch) || 70)), autoApprove: !!config.autoApprove, connectorId: config.connectorId || '' };
  const r = runs.insert({ status: 'running', config: cfg, stages: STAGES.map(([key, label, desc]) => ({ key, label, desc, status: 'pending' })), items: [], logs: [] });
  active.set(r.id, true);
  execute(r.id);
  return view(runs.get(r.id));
}

// 插件补完货源、或人工确认上架包后继续
function resume(id) {
  const r = runs.get(id);
  if (!r) throw err('流水线不存在', 404);
  if (active.has(id)) throw err('流水线正在运行', 409);
  active.set(id, true);
  patchRun(id, () => ({ status: 'running' }));
  chooseAndPack(id)
    .catch((e) => patchRun(id, () => ({ status: 'error', error: e.message })))
    .finally(() => active.delete(id));
  return view(runs.get(id));
}

const latest = () => view(runs.all().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]);
const get = (id) => view(runs.get(id));

function recover() {
  for (const r of runs.all()) if (r.status === 'running') runs.update(r.id, { status: 'error', error: '服务重启，流水线中断，请点「继续」或重新运行' });
}

module.exports = { start, resume, latest, get, recover, STAGES };
