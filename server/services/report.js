// AI 选品报告：导入一批 FastMoss 数据后，由大模型做两件事
// 1. 市场研判：品型机会、价格带、竞争格局、主攻方向和避坑清单（统计数字由程序算好，AI 只做判断）
// 2. 逐个商品研判：能不能上、为什么（六个维度）、预估 1688 采购价、差异化切入点、下一步
// 报告在后台运行，前端轮询进度；每个商品的结论写回商品（p.ai）
const db = require('../db');
const ctx = require('../ctx');
const llm = require('../providers/llm');
const settings = require('../settings');
const products = require('./products');
const rag = require('./rag');

const reports = db.collection('reports');
const BATCH = 10; // 每次让模型研判的商品数
const MAX = 200;
const running = new Map(); // reportId → 进度（内存）

const pctOf = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const med = (arr) => {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

// 程序统计：品型、价格带、头部店铺、风险分布（给 AI 的事实底座，也直接展示在页面上）
function stats(all) {
  // 数据可疑（疑似刷单、价格异常）的商品不参与市场统计，避免扭曲品型、价格带和店铺占比
  const items = all.filter((p) => !p.evaluation.flags.some((f) => f.title === '数据可疑'));
  const excluded = all.length - items.length;
  const totalGmv = items.reduce((s, p) => s + (p.gmv || 0), 0);
  const cur = items[0]?.evaluation.metrics.currency || '';
  const byType = {};
  for (const p of items) {
    const t = p.evaluation.metrics.type;
    const g = (byType[t] = byType[t] || { type: t, count: 0, gmv: 0, sales7d: 0, momentum: [], asp: [], creators: [], verdicts: {} });
    g.count++;
    g.gmv += p.gmv || 0;
    g.sales7d += p.sales7d || 0;
    g.momentum.push(p.evaluation.metrics.momentum);
    g.asp.push(p.evaluation.metrics.asp);
    g.creators.push(p.creatorCount);
    g.verdicts[p.evaluation.ruleVerdict] = (g.verdicts[p.evaluation.ruleVerdict] || 0) + 1;
  }
  const types = Object.values(byType)
    .map((g) => ({ type: g.type, count: g.count, gmvShare: pctOf(g.gmv, totalGmv), sales7d: g.sales7d, medianMomentum: med(g.momentum), medianAsp: med(g.asp), medianCreators: med(g.creators), verdicts: g.verdicts }))
    .sort((a, b) => b.gmvShare - a.gmvShare);
  const aspAll = items.map((p) => p.evaluation.metrics.asp).filter(Number.isFinite).sort((a, b) => a - b);
  // 价格带：按成交均价的四分位切成 5 段，看商品数占比和销售额占比的差距
  const cuts = aspAll.length >= 5 ? [0.2, 0.4, 0.6, 0.8].map((q) => aspAll[Math.floor(q * (aspAll.length - 1))]) : [];
  const bands = [];
  if (cuts.length) {
    const edges = [0, ...cuts, Infinity];
    for (let i = 0; i < edges.length - 1; i++) {
      const lo = edges[i], hi = edges[i + 1];
      const inBand = items.filter((p) => (p.evaluation.metrics.asp ?? -1) >= lo && (p.evaluation.metrics.asp ?? -1) < hi);
      if (!inBand.length) continue;
      bands.push({ range: hi === Infinity ? `${cur}${Math.round(lo * 100) / 100} 以上` : `${cur}${Math.round(lo * 100) / 100}–${Math.round(hi * 100) / 100}`, count: inBand.length, countShare: pctOf(inBand.length, items.length), gmvShare: pctOf(inBand.reduce((s, p) => s + (p.gmv || 0), 0), totalGmv) });
    }
  }
  const shops = {};
  for (const p of items) if (p.shop) (shops[p.shop] = shops[p.shop] || { shop: p.shop, count: 0, gmv: 0 }), shops[p.shop].count++, (shops[p.shop].gmv += p.gmv || 0);
  const topShops = Object.values(shops).sort((a, b) => b.gmv - a.gmv).slice(0, 6).map((s) => ({ ...s, gmvShare: pctOf(s.gmv, totalGmv), gmv: Math.round(s.gmv) }));
  const brandGmv = items.filter((p) => p.evaluation.metrics.brand).reduce((s, p) => s + (p.gmv || 0), 0);
  const flags = {};
  for (const p of items) for (const f of p.evaluation.flags) if (f.level !== 'info') flags[f.title] = (flags[f.title] || 0) + 1;
  const verdicts = {};
  for (const p of items) verdicts[p.evaluation.ruleVerdict] = (verdicts[p.evaluation.ruleVerdict] || 0) + 1;
  const markets = [...new Set(items.map((p) => p.evaluation.metrics.market))];
  return {
    count: all.length, excluded, currency: cur, markets, categories: [...new Set(items.map((p) => p.category).filter(Boolean))],
    totalGmv7d: Math.round(totalGmv), medianAsp: med(aspAll), types, bands, topShops, brandGmvShare: pctOf(brandGmv, totalGmv), flags, ruleVerdicts: verdicts,
    newcomers: items.filter((p) => (p.evaluation.metrics.ageDays ?? 9999) <= 180).length,
  };
}

const row = (p, i) => {
  const ev = p.evaluation;
  return {
    i, ...products.brief(p),
    规则评分: ev.score, 规则结论: ev.ruleVerdict,
    维度: Object.fromEntries(ev.dims.map((d) => [d.label, d.score])),
    利润倒推: ev.profit ? `成本上限 ¥${ev.profit.ceilingCny}` : null,
    风险: ev.flags.filter((f) => f.level !== 'info').map((f) => f.title),
    数据解读: ev.flags.filter((f) => f.level === 'info').map((f) => f.detail),
  };
};

function persona() {
  const s = settings.get();
  const mode = s.selection?.storeMode === 'local' ? '本土店' : '中国跨境卖家（从 1688 采购、跨境直邮或海外仓）';
  return `你是资深 TikTok Shop 选品操盘手，服务对象是${mode}。你用数据说话：每个判断都引用给出的具体数字；数据里没有的信息不编造，估算必须写明“估算”。`;
}

async function overview(st, items, kb) {
  const top = items.slice(0, 40).map((p, i) => row(p, i + 1));
  return llm.completeJSON(
    `下面是从 FastMoss 导出的一批商品（${st.markets.join('/')} 站，${st.categories.join('、') || '未标类目'}，共 ${st.count} 个）。统计数字已由程序算好，请据此做市场研判，回答「这个类目现在该卖什么、不该卖什么」。

【整体统计】${JSON.stringify({ 商品数: st.count, 因数据可疑未计入统计: st.excluded, 近7天总销售额: `${st.currency}${st.totalGmv7d}`, 成交均价中位数: `${st.currency}${st.medianAsp}`, 品牌卖家销售额占比: `${st.brandGmvShare}%`, 上架180天内的新品数: st.newcomers, 风险标记统计: st.flags })}
【品型分布】（gmvShare=销售额占比%，medianMomentum=近7天÷近28天周均的中位数，>1 在上升）${JSON.stringify(st.types)}
【价格带】（countShare=商品数占比%，gmvShare=销售额占比%）${JSON.stringify(st.bands)}
【头部店铺】${JSON.stringify(st.topShops)}
【商品明细（按评分排序的前 ${top.length} 个）】${JSON.stringify(top)}
${kb ? `\n【选品方法参考】\n${kb}\n` : ''}
只输出 JSON：
{
 "summary": "3-5 句话的市场结论：需求在哪、趋势、竞争格局、对新卖家的整体判断",
 "segments": [{"type": "品型", "verdict": "机会 | 可做 | 红海 | 回落 | 避开", "why": "依据（引用占比、趋势倍数、达人数等）"}],
 "priceInsight": "价格带结论：哪个价格带销售额占比明显高于商品数占比（买家真正愿意付的价），建议入场价",
 "competition": "竞争格局：品牌和头部店铺占比、新品能否进入",
 "opportunities": [{"title": "机会方向（简短）", "what": "具体卖什么：品型 + 规格/款式", "why": "数据依据", "entryPrice": "建议售价（带币种）", "differentiation": "差异化切入点", "sourcing": "1688 中文搜索关键词", "refs": [商品明细里的 i 编号]}],
 "avoid": [{"what": "不要做什么", "why": "原因（合规、品牌、价格、趋势等）"}],
 "nextSteps": ["接下来 7 天的具体动作，按顺序"]
}`,
    { system: persona() + '只输出 JSON。', maxTokens: 6000, timeoutMs: 300000 },
  );
}

async function judgeBatch(items, offset) {
  const rows = items.map((p, k) => row(p, offset + k + 1));
  const out = await llm.completeJSON(
    `逐个研判下面 ${rows.length} 个 TikTok Shop 商品能不能上。每个商品都有程序算好的六维评分（0-100）和风险标记，你要结合数据给出自己的结论，可以和规则结论不同，但要说明理由。

判断要点：
- 需求：近7天销量/销售额是否足够；趋势：趋势倍数 >1.15 在上升、<0.85 在回落，结合上架天数看生命周期；
- 达人：带货达人数、出单率高说明寄样招达人容易复制；没有达人却有销量说明不是内容驱动；
- 竞争：品牌官方店、头部店铺扎堆、达人和视频过多都意味着难进入；新上架就进头部说明还有机会；
- 利润：按「成本上限」（为达到目标净利，采购+物流最多能花多少人民币）对比你对 1688 同类货源价格的估算，判断利润是否成立；
- 风险：定邀类目、带电、品牌/IP、认证、数据可疑（刷单或价格异常）等直接影响能否上。

商品：${JSON.stringify(rows)}

只输出 JSON：{"items": [{"i": 编号, "verdict": "可以上 | 谨慎测试 | 不建议上", "score": 0-100, "headline": "一句话结论（20 字内）",
"reasons": {"需求": "", "趋势": "", "达人": "", "竞争": "", "利润": "", "风险": ""}, "est1688": "预估 1688 采购价区间（¥，估算）", "kw1688": "1688 中文搜索关键词（具体到款式规格）", "profitOk": true/false, "angle": "如果要做，差异化切入点 / 做什么款；不建议的写替代方向", "nextStep": "下一步动作"}]}
每个 reasons 字段一句话，必须引用数据。`,
    { system: persona() + '只输出 JSON。', maxTokens: 8000, timeoutMs: 300000 },
  );
  return Array.isArray(out.items) ? out.items : Array.isArray(out) ? out : [];
}

// 有限并发执行
async function pool(tasks, n) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) {
      const k = i++;
      results[k] = await tasks[k]();
    }
  }));
  return results;
}

async function run(report, items) {
  const prog = running.get(report.id);
  const model = settings.activeProvider();
  const kb = await rag.contextFor('TikTok Shop 选品方法论 硬指标 饱和信号 测款', 3).catch(() => '');
  const st = stats(items);
  reports.update(report.id, { stats: st, model: model ? `${model.name} · ${model.model}` : '' });
  const batches = [];
  for (let k = 0; k < items.length; k += BATCH) batches.push([items.slice(k, k + BATCH), k]);
  prog.total = batches.length + 1;
  const errors = [];
  const tasks = [
    async () => {
      try {
        const ov = await overview(st, items, kb);
        reports.update(report.id, { overview: ov });
      } catch (e) {
        errors.push('市场研判：' + e.message);
      }
      prog.done++;
    },
    ...batches.map(([chunk, offset]) => async () => {
      try {
        const res = await judgeBatch(chunk, offset);
        for (const r of res) {
          const p = items[Number(r.i) - 1];
          if (!p || !['可以上', '谨慎测试', '不建议上'].includes(r.verdict)) continue;
          db.products.update(p.id, { ai: { ...r, i: undefined, reportId: report.id, at: db.now(), model: model?.model } });
          prog.judged++;
        }
      } catch (e) {
        errors.push(`第 ${offset + 1}–${offset + chunk.length} 个商品：${e.message}`);
      }
      prog.done++;
    }),
  ];
  await pool(tasks, 3);
  reports.update(report.id, { status: errors.length && !prog.judged ? 'error' : 'done', errors, judged: prog.judged, finishedAt: db.now() });
  running.delete(report.id);
}

// 开始一份报告（后台运行）；ids 为空时分析最近一次导入的那批商品
function start({ ids } = {}) {
  if (!settings.activeProvider()) throw llm.noLLM();
  let items = products.list({ sort: 'score' });
  if (ids?.length) {
    const set = new Set(ids);
    items = items.filter((p) => set.has(p.id));
  } else {
    const last = db.products.all().filter((p) => p.batchId).sort((a, b) => String(b.dataAt).localeCompare(String(a.dataAt)))[0];
    items = items.filter((p) => last && p.batchId === last.batchId);
  }
  if (!items.length) throw Object.assign(new Error('没有可以分析的商品，请先导入 FastMoss 数据'), { status: 400 });
  if ([...running.values()].some((r) => r.uid === ctx.user()?.id)) throw Object.assign(new Error('已有一份报告正在生成，请稍候'), { status: 409 });
  items = items.slice(0, MAX);
  const report = reports.insert({ status: 'running', count: items.length, ids: items.map((p) => p.id), title: `${[...new Set(items.map((p) => p.category).filter(Boolean))].join('、') || '选品'} · ${items.length} 个商品` });
  running.set(report.id, { uid: ctx.user()?.id, total: 1, done: 0, judged: 0 });
  // 后台执行：仍在当前用户的上下文里，读写的都是这个用户的数据
  run(report, items).catch((e) => {
    reports.update(report.id, { status: 'error', errors: [e.message], finishedAt: db.now() });
    running.delete(report.id);
  });
  return view(reports.get(report.id));
}

function view(r) {
  if (!r) return null;
  const prog = running.get(r.id);
  // 报告里每个商品的当前结论（AI 研判过的以 AI 为准），供页面统计和引用
  const set = new Set(r.ids || []);
  const items = products.list({ sort: 'score' }).filter((p) => set.has(p.id)).map((p) => ({ id: p.id, name: p.name, verdict: p.evaluation.verdict, ai: !!p.ai }));
  const order = new Map((r.ids || []).map((id, k) => [id, k]));
  items.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { ...r, items, progress: prog ? { total: prog.total, done: prog.done, judged: prog.judged } : null };
}

const latest = () => view(reports.all().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]);
const get = (id) => view(reports.get(id));

// 服务重启时中断的报告标记为失败
function recover() {
  for (const r of reports.all()) if (r.status === 'running' && !running.has(r.id)) reports.update(r.id, { status: 'error', errors: ['服务重启，报告中断，请重新生成'] });
}

module.exports = { start, latest, get, stats, recover };
