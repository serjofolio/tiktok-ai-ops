// 增长榜：选出指定时间窗（默认 10 天）内销量和 GMV 增长最快的商品
// FastMoss 导出只有近 7 天、近 28 天和累计，没有任意 N 天，所以按数据质量分三档，每个商品都标明用的是哪一档：
//   daily    实测：FastMoss 接口返回的逐日销量，直接加总
//   snapshot 实测：两次导入之间累计销量的差值，折算到时间窗长度
//   estimate 估算：只有一次数据，用近 7 天日均和前 21 天日均对比
const products = require('./products');
const selection = require('./selection');

const DAY = 86400e3;
// 按日期算间隔：同一天早晚导入的差别不算
const days = (a, b) => (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY;
const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const rate = (cur, prev) => (cur == null || !prev ? null : Math.round(((cur - prev) / prev) * 1000) / 10);

function fromDaily(list, W) {
  if (!Array.isArray(list) || list.length < Math.min(W, 3)) return null;
  const sorted = [...list].sort((a, b) => a.dt.localeCompare(b.dt));
  const cur = sorted.slice(-W);
  const prev = sorted.slice(-2 * W, -W);
  const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] || 0), 0);
  const full = prev.length >= W;
  return {
    grade: 'daily',
    units: { cur: sum(cur, 'units'), prev: full ? sum(prev, 'units') : null },
    gmv: { cur: sum(cur, 'gmv'), prev: full ? sum(prev, 'gmv') : null },
    spark: sorted.slice(-2 * W).map((d) => d.units || 0),
    note: full ? `FastMoss 逐日数据：近 ${W} 天对比再往前 ${W} 天` : `FastMoss 逐日数据只有 ${sorted.length} 天，不够和前 ${W} 天对比`,
  };
}

// 取一个指标在两次快照之间的增量：优先用累计值之差；没有累计值、又隔了至少 6 天时用两份「近 7 天」对比
function gain(now, then, gap, totalKey, recentKey) {
  if (now[totalKey] != null && then[totalKey] != null && now[totalKey] >= then[totalKey]) return (now[totalKey] - then[totalKey]) / gap;
  if (gap >= 6 && now[recentKey] != null) return now[recentKey] / 7;
  return null;
}

function fromSnapshots(snaps, W) {
  if (!Array.isArray(snaps) || snaps.length < 2) return null;
  const now = snaps.at(-1);
  const minGap = Math.max(3, W * 0.5);
  const earlier = snaps.slice(0, -1).filter((s) => days(s.at, now.at) >= minGap);
  if (!earlier.length) return null;
  const then = earlier.reduce((best, s) => (Math.abs(days(s.at, now.at) - W) < Math.abs(days(best.at, now.at) - W) ? s : best));
  const gap = days(then.at, now.at);
  const uDaily = gain(now, then, gap, 'salesTotal', 'sales7d');
  const gDaily = gain(now, then, gap, 'gmvTotal', 'gmv');
  if (uDaily == null && gDaily == null) return null;
  // 上一周期：再往前还有快照就用真实差值，否则用较早那次数据里的 28 天日均当基线
  const older = snaps.filter((s) => days(s.at, then.at) >= minGap).at(-1);
  let uPrev = older ? gain(then, older, days(older.at, then.at), 'salesTotal', 'sales7d') : null;
  let gPrev = older ? gain(then, older, days(older.at, then.at), 'gmvTotal', 'gmv') : null;
  if (uPrev == null && then.sales28d != null) uPrev = then.sales28d / 28;
  if (gPrev == null && then.gmv28d != null) gPrev = then.gmv28d / 28;
  return {
    grade: 'snapshot',
    units: { cur: uDaily == null ? null : uDaily * W, prev: uPrev == null ? null : uPrev * W },
    gmv: { cur: gDaily == null ? null : gDaily * W, prev: gPrev == null ? null : gPrev * W },
    spark: [],
    note: `两次导入算出：${then.at.slice(0, 10)} → ${now.at.slice(0, 10)}（隔 ${Math.round(gap)} 天${Math.round(gap) === W ? '' : `，已折算成 ${W} 天`}）`,
    lead: {
      gap: Math.round(gap),
      creators: now.creatorCount != null && then.creatorCount != null ? now.creatorCount - then.creatorCount : null,
      videos: now.videoCount != null && then.videoCount != null ? now.videoCount - then.videoCount : null,
    },
  };
}

function fromSingleExport(p, W) {
  const m = p.evaluation.metrics;
  const s7 = p.sales7d, s28 = p.sales28d;
  if (s7 == null) return null;
  // 上架不足 28 天的，前期日均按实际在售天数算；上架不足 7 天的没有可比的前期
  const priorDays = m.ageDays && m.ageDays < 28 ? Math.max(0, m.ageDays - 7) : 21;
  const prior = (total, recent) => (total != null && priorDays > 0 ? Math.max(0, total - recent) / priorDays : null);
  const uPrior = prior(s28, s7);
  const gPrior = p.gmv != null ? prior(p.gmv28d, p.gmv) : null;
  const est = {
    grade: 'estimate',
    units: { cur: (s7 / 7) * W, prev: uPrior == null ? null : uPrior * W },
    gmv: { cur: p.gmv != null ? (p.gmv / 7) * W : null, prev: gPrior == null ? null : gPrior * W },
    spark: [],
    note: `只有一次数据，用近 7 天日均和前 ${priorDays || 21} 天日均估算，不是真实的 ${W} 天数据`,
  };
  if (est.units.prev == null && p.growth != null && p.growth > -100) {
    est.units.prev = est.units.cur / (1 + p.growth / 100);
    est.note = `只有一次数据，用导出表里的销量环比（${p.growth}%）估算`;
  }
  return est;
}

function forProduct(p, W) {
  return fromDaily(p.daily, W) || fromSnapshots(p.snapshots, W) || fromSingleExport(p, W);
}

// 百分位：每个指标在这批商品里排第几，用来把销量、GMV、增长率合成一个综合分
function percentile(values) {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return (v) => {
    if (v == null || !sorted.length) return 0;
    let lo = 0;
    while (lo < sorted.length && sorted[lo] < v) lo++;
    return sorted.length === 1 ? 1 : lo / (sorted.length - 1);
  };
}

const WINDOWS = [3, 7, 10, 14, 30];

// filters：group / category / type / market / batch / date / q（和选品库同一套）
function board({ window: win, sort = 'composite', minUnits, limit, includeSuspicious, ...filters } = {}) {
  const W = WINDOWS.includes(Number(win)) ? Number(win) : 10;
  const floor = minUnits === undefined || minUnits === '' ? 0 : Number(minUnits);
  const all = products.list(filters).filter((p) => p.status !== 'dropped');
  const rows = [];
  let excluded = 0;
  for (const p of all) {
    if (!includeSuspicious && p.evaluation.flags.some((f) => f.title === '数据可疑')) {
      excluded++;
      continue;
    }
    const g = forProduct(p, W);
    if (!g || (g.units.cur ?? 0) < floor) continue;
    // 不同站点币种不同，GMV 统一折成人民币再比较
    const cny = selection.marketProfile(p.evaluation.metrics.market).cnyRate;
    const cur = (x) => (x == null ? null : x * cny);
    rows.push({
      id: p.id, name: p.name, image: p.image, shop: p.shop, category: p.category, market: p.evaluation.metrics.market, currency: p.evaluation.metrics.currency,
      type: p.evaluation.metrics.type, verdict: p.evaluation.verdict, stage: p.evaluation.stage, fastmossLink: p.fastmossLink, asp: p.evaluation.metrics.asp,
      grade: g.grade, note: g.note, spark: g.spark, lead: g.lead || null,
      units: { cur: round(g.units.cur), prev: round(g.units.prev), gain: g.units.cur == null ? null : round(g.units.cur - (g.units.prev ?? 0)), rate: rate(g.units.cur, g.units.prev) },
      gmv: { cur: round(g.gmv.cur), prev: round(g.gmv.prev), gainCny: g.gmv.cur == null ? null : round(cur(g.gmv.cur) - (cur(g.gmv.prev) ?? 0)), rate: rate(g.gmv.cur, g.gmv.prev) },
    });
  }
  const pUnits = percentile(rows.map((r) => r.units.gain));
  const pGmv = percentile(rows.map((r) => r.gmv.gainCny));
  const pRateU = percentile(rows.map((r) => r.units.rate));
  const pRateG = percentile(rows.map((r) => r.gmv.rate));
  for (const r of rows) r.score = Math.round((0.35 * pUnits(r.units.gain) + 0.35 * pGmv(r.gmv.gainCny) + 0.15 * pRateU(r.units.rate) + 0.15 * pRateG(r.gmv.rate)) * 100);
  const key = { composite: (r) => r.score, units: (r) => r.units.gain ?? -Infinity, gmv: (r) => r.gmv.gainCny ?? -Infinity, rate: (r) => r.units.rate ?? -Infinity, gmvRate: (r) => r.gmv.rate ?? -Infinity }[sort] || ((r) => r.score);
  rows.sort((a, b) => key(b) - key(a));
  const grades = { daily: 0, snapshot: 0, estimate: 0 };
  for (const r of rows) grades[r.grade]++;
  return { window: W, windows: WINDOWS, sort, total: rows.length, excluded, grades, items: rows.slice(0, Math.min(200, Number(limit) || 100)) };
}

module.exports = { board, forProduct, WINDOWS };
