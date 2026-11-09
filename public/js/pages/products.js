// 智能选品：导入 FastMoss 数据 → 六维评估（需求 / 趋势 / 达人 / 竞争 / 利润 / 风险）→ AI 选品报告与逐个研判 → 单品深度分析 → 测款 → 视频脚本
import { api, icon, esc, fmtNum, fmtTime, modal, toast, withLoading, $, $$, empty, confirmBox, sparkline } from '../lib.js';
import { zhName } from '../picker.js';
import { mountVideos } from './product-videos.js';

const STATUS = { candidate: '候选', testing: '测款中', dropped: '已放弃' };
const LISTING_STATUS = { draft: '待确认', approved: '已确认', pushed: '已上品' };
const VCLS = { 可以上: 'v-go', 谨慎测试: 'v-watch', 不建议上: 'v-drop', 数据不足: 'v-na' };
const verdict = (v, extra = '') => `<span class="verdict ${VCLS[v] || 'v-na'}">${esc(v || '未评估')}${extra}</span>`;
const DIM_SHORT = { demand: '需求', trend: '趋势', content: '达人', competition: '竞争', profit: '利润', risk: '风险' };
const FLAG_ICON = { block: '✕', major: '!', minor: '·', info: 'i' };
const num = (v) => (v == null ? '<span class="muted">—</span>' : fmtNum(v));
const cur = (p) => p.evaluation?.metrics?.currency || '';
const money = (c, v) => (v == null ? '—' : `${c}${v >= 1e4 ? fmtNum(Math.round(v)) : Number(v).toFixed(2)}`);
const scoreCls = (s) => (s == null ? 'na' : s >= 65 ? 'hi' : s >= 45 ? 'mid' : 'lo');
const trendBadge = (m, stage) => (m == null ? '<span class="muted">—</span>' : `<span class="trend ${m >= 1.15 ? 'up' : m >= 0.9 ? 'flat' : 'down'}">${m >= 1.15 ? '▲' : m >= 0.9 ? '▶' : '▼'} ${m}×</span><div class="p-sub">${esc(stage || '')}</div>`);
// 1688 搜索链接必须带 charset=utf8，否则 1688 按 GBK 解码，中文关键词变乱码
const search1688 = (kw) => `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}&charset=utf8`;
const kw1688 = (p) => p.ai?.kw1688 || p.analysis?.sourcing?.match(/[「“"]([^」”"]{2,30})[」”"]/)?.[1] || p.evaluation.metrics.type;

const DIMS_EXPLAIN = [
  ['需求规模', '近 7 天销量（绝对量）+ 销售额在同批商品里的排名'],
  ['增长趋势', '近 7 天销量 ÷ 近 28 天周均：>1.15 上升、<0.85 回落；结合上架天数判断新品起量 / 长尾老品'],
  ['达人带货验证', '带货达人数、达人出单率、视频和直播数：出单率高说明寄样招达人容易复制'],
  ['竞争格局', '达人和视频是否过多、品牌官方店、头部店铺扎堆、同品型数量；新上架就进头部 = 还有机会'],
  ['利润空间', '用实际成交均价（7 天销售额 ÷ 销量）扣平台费、达人佣金、退货、广告，倒推采购 + 物流的人民币上限'],
  ['合规与风险', '定邀类目、带电、品牌/IP、认证、刷单或价格异常、低价引流款'],
];

export async function render(view, [openId, openTab]) {
  const state = { q: '', verdict: '', status: '', sort: 'score', date: '', batch: '', category: '', group: '', type: '', market: '', priceMin: '', priceMax: '', minSales: '' };
  const FILTERS = ['date', 'batch', 'category', 'group', 'type', 'market', 'priceMin', 'priceMax', 'minSales'];
  const hasFilter = () => FILTERS.some((k) => state[k] !== '');
  const today = () => new Date().toLocaleDateString('en-CA');
  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">智能选品 · FastMoss 数据 × AI 研判</div>
    <h2>导入数据，<em>AI</em> 告诉你<br>哪些能上、为什么</h2>
    <p>从 FastMoss 导出商品数据拖进来：系统按需求、趋势、达人、竞争、利润、风险六个维度给每个商品打分，AI 再逐个研判能不能上、为什么、做什么款，并写出这个类目的市场报告。</p>
    <div class="actions">
      <button class="btn lg primary-glow" id="import">${icon('upload')}导入 FastMoss 数据</button>
      <button class="btn ghost lg" id="pull">${icon('zap')}FastMoss 接口拉取</button>
      <button class="btn ghost lg" id="add">${icon('plus')}手动添加</button>
      <a class="btn ghost lg" href="https://www.fastmoss.com/zh/e-commerce/search" target="_blank" rel="noopener">${icon('link')}打开 FastMoss</a>
    </div>
  </section>
  <section id="report"></section>
  <section class="terrain terrain-card" id="terrain"><div class="copy"><h2>市场地形</h2><p>每个方块是一个商品，高度是综合评分，骨白色是「可以上」。点击方块查看详情。</p></div></section>
  <section data-reveal>
    <div class="section-title section-wrap"><h3>选品库</h3><div class="seg" id="panes"><button data-p="lib" class="on">全部商品</button><button data-p="growth">增长榜</button></div><span class="muted small" id="summary"></span><div class="spacer"></div>
      <button class="btn sm ghost" id="method">${icon('layers', 14)}评估方法</button><button class="btn sm ghost" id="assume">${icon('settings', 14)}利润测算参数</button></div>
    <div id="lib-pane">
    <div class="toolbar">
      <div class="input-icon">${icon('search', 16)}<input class="input" id="q" placeholder="搜索商品、品型、店铺"></div>
      <div class="seg" id="tabs"><button data-v="" class="on">全部</button><button data-v="可以上">可以上</button><button data-v="谨慎测试">谨慎测试</button><button data-v="不建议上">不建议上</button><button data-s="testing">测款中</button><button data-s="dropped">已放弃</button></div>
      <select class="input" id="sort" style="width:150px"><option value="score">综合评分</option><option value="gmv">7 天销售额</option><option value="sales">7 天销量</option><option value="trend">增长最快</option><option value="profit">利润空间最大</option><option value="recent">最近导入</option></select>
    </div>
    <div class="filters" id="filters"></div>
    <div id="bulkbar"></div>
    <div id="list"></div>
    </div>
    <div id="growth-pane" hidden></div>
  </section>`;

  let all = [];
  let assumptions = {};
  let markets = {};
  let report = null;
  let poll = null;
  let facets = { categories: [], types: [], markets: [], groups: [], dates: [], batches: [], total: 0 };
  let quota = null;
  const selected = new Set();
  const PAGE = 100;
  let shown = PAGE;

  async function load() {
    const d = await api(`/products?${new URLSearchParams({ ...state, facets: 1, today: today() })}`);
    assumptions = d.assumptions;
    markets = d.markets;
    all = d.items;
    facets = d.facets;
    quota = d.quota;
    renderFilters();
    if (!state.q && !state.verdict && !state.status && !hasFilter()) countAll(all);
    else $('#summary', view).textContent = `筛选出 ${all.length} 个，共 ${facets.total} 个`;
    for (const id of [...selected]) if (!all.some((p) => p.id === id)) selected.delete(id);
    renderBulk();
    const items = all.slice(0, shown);
    const box = $('#list', view);
    if (!facets.total) return (box.innerHTML = onboarding());
    if (!items.length) return (box.innerHTML = `<div class="card">${empty('没有符合条件的商品', 'search')}</div>`);
    const more = all.length > items.length ? `<div class="row mt" style="justify-content:center"><button class="btn ghost" id="more">显示更多（还有 ${all.length - items.length} 个）</button></div>` : '';
    box.innerHTML = `<div class="table-wrap"><table class="ptable"><thead><tr><th class="chk" data-stop><input type="checkbox" id="chk-all" aria-label="全选这一页"></th><th>商品</th><th class="r">成交均价</th><th class="r">7 天销量</th><th>趋势</th><th class="r">达人 · 出单率</th><th class="r" title="想达到目标净利，采购 + 物流最多能花多少人民币">成本上限</th><th>六维评分</th><th>结论</th></tr></thead><tbody>
      ${items.map(rowHTML).join('')}</tbody></table></div>${more}`;
    const mb = box.querySelector('#more');
    if (mb) mb.onclick = () => { shown += PAGE; load(); };
    $$('.prow', box).forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('[data-stop]') && openDetail(tr.dataset.id)));
    $$('[data-chk]', box).forEach((c) => (c.onchange = () => { c.checked ? selected.add(c.dataset.chk) : selected.delete(c.dataset.chk); renderBulk(); syncChkAll(); }));
    $('#chk-all', box).onchange = (e) => { for (const p of items) e.target.checked ? selected.add(p.id) : selected.delete(p.id); $$('[data-chk]', box).forEach((c) => (c.checked = e.target.checked)); renderBulk(); };
    syncChkAll();
  }
  const syncChkAll = () => { const boxes = $$('[data-chk]', view); const head = $('#chk-all', view); if (head) head.checked = boxes.length > 0 && boxes.every((c) => c.checked); };

  // ---------- 筛选 ----------
  const SOURCE = { file: '文件导入', paste: '粘贴导入', api: '接口拉取', plugin: '插件发送' };
  // 导入批次：导入时间精确到秒；补传的旧文件标出数据日期
  const batchLabel = (b) => `${fmtTime(b.at) || b.date} · ${b.fileName || SOURCE[b.source] || '导入'} · ${b.count} 个${b.dataDate && b.dataDate !== b.date ? `（数据日期 ${b.dataDate}）` : ''}`;
  const batchOptions = (cur) => `<option value="">导入批次：全部</option>${facets.batches.map((b) => `<option value="${esc(b.id)}" ${cur === b.id ? 'selected' : ''}>${esc(batchLabel(b))}</option>`).join('')}`;
  const categoryOptions = (cat, grp) => `<option value="">商品分类：全部</option>
    ${facets.groups.map((g) => `<option value="group:${esc(g.name)}" ${grp === g.name ? 'selected' : ''}>${esc(g.name)}（按类目和标题识别，${g.count}）</option>`).join('')}
    ${facets.categories.map((c) => `<option value="${esc(c.name)}" ${cat === c.name ? 'selected' : ''}>${esc(c.name)}（${c.count}）</option>`).join('')}`;
  const marketOptions = (cur) => `<option value="">站点：全部</option>${facets.markets.map((x) => `<option value="${esc(x.name)}" ${cur === x.name ? 'selected' : ''}>${esc(markets[x.name]?.name || x.name)}（${x.count}）</option>`).join('')}`;
  function renderFilters() {
    const box = $('#filters', view);
    if (!box) return;
    if (!facets.total) return (box.innerHTML = '');
    const pick = (k, label, opts) => `<select class="input" data-f="${k}" aria-label="${label}"><option value="">${label}：全部</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${state[k] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    box.innerHTML = `${pick('date', '导入日期', facets.dates.map((d) => [d.date, `${d.date}（${d.count}）`]))}
      ${pick('batch', '导入批次', facets.batches.map((b) => [b.id, batchLabel(b)]))}
      <select class="input" id="f-cat" aria-label="商品分类">${categoryOptions(state.category, state.group)}</select>
      ${pick('type', '品型', facets.types.map((t) => [t.name, `${t.name}（${t.count}）`]))}
      <select class="input" data-f="market" aria-label="站点">${marketOptions(state.market)}</select>
      <input class="input num" data-n="priceMin" type="number" min="0" step="any" placeholder="成交价从" value="${esc(state.priceMin)}" aria-label="最低成交价"><input class="input num" data-n="priceMax" type="number" min="0" step="any" placeholder="到" value="${esc(state.priceMax)}" aria-label="最高成交价">
      <input class="input num" data-n="minSales" type="number" min="0" placeholder="7 天销量≥" value="${esc(state.minSales)}" aria-label="最低 7 天销量">
      ${hasFilter() ? `<button class="btn sm ghost" id="f-clear">${icon('x', 13)}清除筛选</button>` : ''}`;
    const again = () => { shown = PAGE; load().then(remountTerrain); };
    $$('[data-f]', box).forEach((s) => (s.onchange = () => { state[s.dataset.f] = s.value; again(); }));
    $$('[data-n]', box).forEach((s) => (s.onchange = () => { state[s.dataset.n] = s.value; again(); }));
    $('#f-cat', box).onchange = (e) => { const v = e.target.value; state.group = v.startsWith('group:') ? v.slice(6) : ''; state.category = v.startsWith('group:') ? '' : v; again(); };
    const clear = $('#f-clear', box);
    if (clear) clear.onclick = () => { for (const k of FILTERS) state[k] = ''; again(); };
  }

  // ---------- 批量操作 ----------
  function renderBulk() {
    const box = $('#bulkbar', view);
    if (!box) return;
    if (!selected.size) return (box.innerHTML = '');
    box.innerHTML = `<div class="bulkbar"><b>已选 ${selected.size} 个</b>
      ${all.length > selected.size ? `<button class="btn sm ghost" data-b="all">全选筛选结果（${all.length} 个）</button>` : ''}
      <div class="spacer"></div>
      <button class="btn sm" data-b="report">${icon('sparkles', 14)}AI 研判选中的</button>
      <button class="btn sm ghost" data-b="testing">标记测款</button>
      <button class="btn sm ghost" data-b="dropped">放弃</button>
      <button class="btn sm ghost danger" data-b="delete">${icon('trash', 14)}删除</button>
      <button class="icon-btn" data-b="none" title="取消选择">${icon('x', 15)}</button></div>`;
    $$('[data-b]', box).forEach((b) => (b.onclick = async () => {
      const act = b.dataset.b;
      const ids = [...selected];
      if (act === 'all') { for (const p of all) selected.add(p.id); $$('[data-chk]', view).forEach((c) => (c.checked = true)); renderBulk(); syncChkAll(); return; }
      if (act === 'none') { selected.clear(); $$('[data-chk]', view).forEach((c) => (c.checked = false)); renderBulk(); syncChkAll(); return; }
      if (act === 'report') { await startReport(ids); $('#report', view).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (act === 'delete' && !(await confirmBox(`删除选中的 ${ids.length} 个商品？删除后找不回来，它们的货源和上架包也会一起删除。`))) return;
      const r = await api('/products/bulk', { method: 'POST', body: act === 'delete' ? { ids, action: 'delete' } : { ids, action: 'status', status: act } });
      selected.clear();
      toast(act === 'delete' ? `已删除 ${r.count} 个商品` : `已更新 ${r.count} 个商品`, 'success');
      await load();
      remountTerrain();
    }));
  }

  // ---------- 增长榜 ----------
  const growthState = { window: '10', sort: 'composite', category: '', group: '', market: '', batch: '', verdict: '', minUnits: '', rising: '' };
  const GRADE = { daily: ['实测·逐日', 'v-go'], snapshot: ['实测·两次导入', 'v-go'], estimate: ['估算', 'v-na'] };
  const pct = (v) => (v == null ? '<span class="muted">—</span>' : `<b class="${v >= 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}%</b>`);
  async function loadGrowth() {
    const box = $('#growth-pane', view);
    const d = await api(`/products/growth?${new URLSearchParams(growthState)}`);
    const W = d.window;
    const sel = (k, opts) => `<select class="input" data-g="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${growthState[k] === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const hint = d.grades.estimate
      ? `<div class="note-card"><b>${d.grades.estimate} 个商品只有一次数据，增长是估算的。</b>想看真实的 ${W} 天增长，三个办法选一个：隔 ${Math.max(7, W)} 天左右再导入同一类目；把电脑里以前导出的文件补传进来（导入时选当时的日期）；或者接入 FastMoss 接口，直接拿每天的销量。</div>`
      : '';
    box.innerHTML = `<div class="filters">
        ${sel('window', d.windows.map((x) => [String(x), `近 ${x} 天`]))}
        <select class="input" id="g-cat" aria-label="商品分类">${categoryOptions(growthState.category, growthState.group)}</select>
        <select class="input" data-g="market" aria-label="站点">${marketOptions(growthState.market)}</select>
        <select class="input" data-g="batch" aria-label="导入批次">${batchOptions(growthState.batch)}</select>
        ${sel('verdict', [['', '结论：全部'], ['可以上', '只看可以上'], ['谨慎测试', '只看谨慎测试'], ['不建议上', '只看不建议上']])}
        ${sel('sort', [['composite', '综合：销量和 GMV 都涨得快'], ['units', '销量增量最大'], ['gmv', 'GMV 增量最大'], ['rate', '销量增长率最高'], ['gmvRate', 'GMV 增长率最高']])}
        <input class="input num" id="g-min" type="number" min="0" placeholder="${W} 天销量≥" value="${esc(growthState.minUnits)}" aria-label="最低销量">
        <label class="switch" title="销量增长率和 GMV 增长率都大于 0 才显示"><input type="checkbox" id="g-rising" ${growthState.rising ? 'checked' : ''}><span></span>只看销量和 GMV 都在涨</label>
        ${d.items.length ? `<button class="btn sm" id="g-ai">${icon('sparkles', 14)}AI 研判前 20 个</button>` : ''}
      </div>
      ${hint}
      <p class="muted small" style="margin:0 0 10px">共 ${d.total} 个商品：实测 ${d.grades.daily + d.grades.snapshot} 个，估算 ${d.grades.estimate} 个${d.flat ? `；${d.flat} 个销量或 GMV 没涨，已隐藏` : ''}${d.excluded ? `；另有 ${d.excluded} 个数据可疑（疑似刷单），已排除` : ''}。「前期」是再往前 ${W} 天。不同币种的 GMV 按人民币比较。</p>
      ${d.items.length ? `<div class="table-wrap"><table class="ptable growth"><thead><tr><th>#</th><th>商品</th><th class="r">${W} 天销量<div class="p-sub">前期</div></th><th class="r">销量增长</th><th class="r">${W} 天 GMV<div class="p-sub">前期</div></th><th class="r">GMV 增长</th><th title="达人和视频增量通常比销量早一周左右动（FastMoss 的判断方法）">达人 · 视频增量</th><th>数据</th><th>结论</th></tr></thead><tbody>
        ${d.items.map((r, i) => `<tr class="prow" data-id="${r.id}"><td class="muted">${i + 1}</td>
          <td><div class="pcell">${r.image ? `<img class="pthumb" src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pthumb ph">${esc((r.type || '?').slice(0, 1))}</span>`}<div style="min-width:0"><b class="pname">${esc(zhName(r) || r.name)}</b>${zhName(r) ? `<span class="pname-en" title="${esc(r.name)}">${esc(r.name)}</span>` : ''}<div class="p-sub"><span class="tag-type">${esc(r.type)}</span>${esc(r.shop || '')}${r.fastmossLink ? ` <a class="mini-link" data-stop href="${esc(r.fastmossLink)}" target="_blank" rel="noopener" title="在 FastMoss 看这个商品的带货视频">FastMoss ↗</a>` : ''}</div>${r.spark?.length ? sparkline(r.spark, { w: 110, h: 24 }) : ''}</div></div></td>
          <td class="r">${fmtNum(r.units.cur)}<div class="p-sub">${r.units.prev == null ? '—' : fmtNum(r.units.prev)}</div></td><td class="r">${pct(r.units.rate)}<div class="p-sub">${r.units.gain == null ? '' : `${r.units.gain >= 0 ? '+' : ''}${fmtNum(r.units.gain)} 件`}</div></td>
          <td class="r money">${r.gmv.cur == null ? '—' : esc(r.currency) + fmtNum(r.gmv.cur)}<div class="p-sub">${r.gmv.prev == null ? '—' : esc(r.currency) + fmtNum(r.gmv.prev)}</div></td><td class="r">${pct(r.gmv.rate)}<div class="p-sub">${r.gmv.gainCny == null ? '' : `${r.gmv.gainCny >= 0 ? '+' : '-'}¥${fmtNum(Math.abs(r.gmv.gainCny))}`}</div></td>
          <td class="small">${r.lead && (r.lead.creators != null || r.lead.videos != null) ? `达人 ${r.lead.creators > 0 ? '+' : ''}${r.lead.creators ?? '—'}<div class="p-sub">视频 ${r.lead.videos > 0 ? '+' : ''}${r.lead.videos ?? '—'}</div>` : '<span class="muted">要两次数据</span>'}</td>
          <td title="${esc(r.note)}"><span class="verdict ${GRADE[r.grade][1]}" style="font-size:11px">${GRADE[r.grade][0]}</span></td>
          <td class="vcell">${verdict(r.verdict)}${r.reason && r.verdict !== '可以上' ? `<div class="v-reason">${esc(r.reason)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('这个条件下没有商品，放宽筛选或先导入数据', 'search')}</div>`}`;
    $$('[data-g]', box).forEach((s) => (s.onchange = () => { growthState[s.dataset.g] = s.value; loadGrowth(); }));
    $('#g-cat', box).onchange = (e) => { const v = e.target.value; growthState.group = v.startsWith('group:') ? v.slice(6) : ''; growthState.category = v.startsWith('group:') ? '' : v; loadGrowth(); };
    $('#g-min', box).onchange = (e) => { growthState.minUnits = e.target.value; loadGrowth(); };
    $('#g-rising', box).onchange = (e) => { growthState.rising = e.target.checked ? '1' : ''; loadGrowth(); };
    const ai = $('#g-ai', box);
    if (ai) ai.onclick = async () => { await startReport(d.items.slice(0, 20).map((x) => x.id)); $('#report', view).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $$('.prow', box).forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('[data-stop]') && openDetail(tr.dataset.id)));
  }
  $$('#panes button', view).forEach((b) => (b.onclick = () => {
    $$('#panes button', view).forEach((x) => x.classList.toggle('on', x === b));
    const growth = b.dataset.p === 'growth';
    $('#lib-pane', view).hidden = growth;
    $('#growth-pane', view).hidden = !growth;
    if (growth) loadGrowth();
  }));

  // ---------- FastMoss 开放接口拉取 ----------
  async function pullDialog() {
    let cats = null, problem = '';
    try {
      cats = (await api('/fastmoss/categories')).items;
    } catch (e) {
      problem = e.message;
    }
    if (!cats) {
      modal({ title: 'FastMoss 接口拉取', body: `<p>${esc(problem)}</p><p class="muted small">FastMoss 现在有官方开放接口：按类目拉商品、还能拿每天的销量，<b>不占每周的导出次数</b>。按调用次数计费，官网写每次 $0.01 起（空结果不收费，以控制台账单为准），可以先申请试用额度。</p>`, footer: `<a class="btn ghost" href="https://developers.fastmoss.com/api/overview" target="_blank" rel="noopener">去开通 ↗</a><a class="btn" href="#/providers" data-close>去接入配置填密钥</a>` });
      return;
    }
    const flat = [];
    const walk = (nodes, depth) => { for (const n of nodes || []) { flat.push({ ...n, depth }); if (depth < 2) walk(n.sub, depth + 1); } };
    walk(cats, 0);
    modal({
      title: 'FastMoss 接口拉取', wide: true,
      body: `<form class="grid g3" id="pf">
        <label class="field">站点<select class="input" name="region">${['US', 'MY', 'ID', 'TH', 'VN', 'PH', 'SG', 'GB', 'MX', 'ES', 'DE', 'FR', 'IT', 'JP', 'BR'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label class="field" style="grid-column:span 2">类目<select class="input" name="cat"><option value="">不限类目</option>${flat.map((c) => `<option value="${c.id}|${c.level}|${esc(c.name)}" ${/珠宝|首饰/.test(c.name) && !c.depth ? 'selected' : ''}>${'　'.repeat(c.depth)}${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field">关键词（可选）<input class="input" name="keywords" placeholder="earrings"></label>
        <label class="field">候选来源<select class="input" name="source"><option value="search">近 7 天销量最高</option><option value="rank">热销榜：按增长率</option></select></label>
        <label class="field">拉多少个商品<select class="input" name="limit"><option>20</option><option selected>50</option><option>100</option><option>200</option></select></label>
        <label class="field">近 7 天销量至少<input class="input" name="minSales7d" type="number" min="0" placeholder="不限"></label>
        <label class="field">算增长的时间窗<select class="input" name="window"><option value="7">7 天</option><option value="10" selected>10 天</option><option value="14">14 天</option></select></label>
        <label class="switch" style="align-self:end"><input type="checkbox" name="withTrend" checked><span></span>同时拉逐日销量</label></form>
        <p class="small" id="cost" style="margin:14px 0 0"></p><div id="pull-progress"></div>`,
      footer: `<button class="btn ghost" data-close>关闭</button><button class="btn primary-glow" id="go" data-loading="拉取中…">${icon('zap', 15)}开始拉取</button>`,
      onMount(el) {
        const f = $('#pf', el);
        const est = () => {
          const n = Number(f.limit.value);
          const calls = Math.ceil(n / Math.min(100, n)) + (f.withTrend.checked ? n : 0);
          $('#cost', el).innerHTML = `预计调用 <b>${calls} 次</b>（官网写 $0.01/次起，大约 <b>$${(calls * 0.01).toFixed(2)} 起</b>，以 FastMoss 控制台账单为准）。逐日销量每个商品多调 1 次，算出来的增长才是实测。`;
        };
        f.onchange = est;
        est();
        $('#go', el).onclick = (e) => withLoading(e.currentTarget, async () => {
          const [categoryId, categoryLevel, categoryName] = (f.cat.value || '').split('|');
          await api('/fastmoss/pull', { method: 'POST', body: { region: f.region.value, categoryId, categoryLevel, categoryName, keywords: f.keywords.value, source: f.source.value, limit: Number(f.limit.value), minSales7d: Number(f.minSales7d.value) || 0, window: Number(f.window.value), withTrend: f.withTrend.checked, today: today() } });
          for (;;) {
            const j = await api('/fastmoss/jobs/latest');
            $('#pull-progress', el).innerHTML = `<p class="small mt">${esc(j.step || '')}：候选 ${j.fetched || 0} 个${j.trendDone != null ? `，逐日销量 ${j.trendDone}/${j.count}` : ''}</p>`;
            if (j.status === 'error') throw new Error(j.error);
            if (j.status === 'done') {
              toast(`拉取完成：新增 ${j.created}，更新 ${j.updated}${j.warning ? `。${j.warning}` : ''}`, 'success');
              break;
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
          await load();
          remountTerrain();
        });
      },
    });
  }

  function countAll(items) {
    const c = (v) => items.filter((p) => p.evaluation.verdict === v).length;
    $('#summary', view).textContent = `${items.length} 个商品 · 可以上 ${c('可以上')} · 谨慎测试 ${c('谨慎测试')} · 不建议上 ${c('不建议上')} · 测款中 ${items.filter((p) => p.status === 'testing').length}`;
  }

  function rowHTML(p) {
    const ev = p.evaluation, m = ev.metrics, c = cur(p);
    const flags = ev.flags.filter((f) => f.level === 'block' || f.level === 'major');
    const range = p.priceMin != null && p.priceMax != null && p.priceMax > p.priceMin ? `<div class="p-sub">标价 ${c}${p.priceMin}–${p.priceMax}</div>` : '';
    const ai = p.ai;
    return `<tr class="prow" data-id="${p.id}">
      <td class="chk" data-stop><input type="checkbox" data-chk="${p.id}" ${selected.has(p.id) ? 'checked' : ''} aria-label="选择这个商品"></td>
      <td><div class="pcell">${thumb(p)}<div style="min-width:0"><b class="pname">${p.sample ? '<span class="tag-sample">示例</span>' : ''}${esc(zhName(p) || p.name)}</b>${zhName(p) ? `<span class="pname-en" title="${esc(p.name)}">${esc(p.name)}</span>` : ''}
        <div class="p-sub"><span class="tag-type">${esc(m.type)}</span>${esc([p.shop, STATUS[p.status] && p.status !== 'candidate' ? STATUS[p.status] : ''].filter(Boolean).join(' · '))} <a class="mini-link" data-stop href="${esc(p.fastmossLink)}" target="_blank" rel="noopener">FastMoss ↗</a></div>
        ${flags.length ? `<div class="flags-inline">${flags.slice(0, 3).map((f) => `<span class="flag ${f.level}">${esc(f.title)}</span>`).join('')}</div>` : ''}</div></div></td>
      <td class="r money">${money(c, m.asp)}${range}</td>
      <td class="r">${num(p.sales7d)}<div class="p-sub">${p.gmv != null ? money(c, p.gmv) : ''}</div></td>
      <td>${trendBadge(m.momentum, ev.stage)}</td>
      <td class="r">${num(p.creatorCount)}<div class="p-sub">${p.creatorConvRate != null ? `出单 ${p.creatorConvRate}%` : ''}</div></td>
      <td class="r">${ev.profit ? (ev.profit.margin != null ? `<span class="${ev.profit.margin >= ev.profit.targetMargin ? 'up' : 'down'}">净利 ${ev.profit.margin}%</span>` : `<b class="${ev.profit.ceilingCny >= 8 ? 'up' : ev.profit.ceilingCny >= 5 ? '' : 'down'}">¥${Math.max(0, ev.profit.ceilingCny)}</b>`) : '—'}</td>
      <td>${dimBars(ev)}</td>
      <td class="vcell">${verdict(ev.verdict, ai ? '<i class="ai-dot" title="AI 研判">AI</i>' : '')}<div class="headline">${esc(ai?.headline || ev.headline)}</div></td></tr>`;
  }

  const thumb = (p) => (p.image ? `<img class="pthumb" src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pthumb ph',textContent:'${esc((p.evaluation.metrics.type || '?').slice(0, 1))}'}))">` : `<span class="pthumb ph">${esc((p.evaluation.metrics.type || '?').slice(0, 1))}</span>`);
  const dimBars = (ev) => `<div class="dimbars" title="${ev.dims.map((d) => `${d.label} ${d.score ?? '—'}`).join('\n')}"><b class="sc ${scoreCls(ev.score)}">${ev.score ?? '—'}</b>${ev.dims.map((d) => `<i class="${scoreCls(d.score)}" style="--h:${d.score ?? 4}%"><em>${DIM_SHORT[d.key]}</em></i>`).join('')}</div>`;

  function onboarding() {
    return `<div class="card card-pad onboard">
      <h3>从 FastMoss 导入第一批候选品</h3>
      <ol>
        <li>FastMoss →「商品」→「商品搜索」：选国家（如马来西亚）、商品分类、日期「近 7 天」，可再按价格、销量筛；</li>
        <li>点列表右上角「导出」，得到 Excel 文件（直接用，不用改表头）；</li>
        <li>点「导入 FastMoss 数据」拖进来，系统自动识别全部字段，并开始 AI 选品研判。</li>
      </ol>
      <p class="muted small">导出次数有限：每次按大类目多导一些（不用细分筛选），导进来以后在这里随便筛。隔 7–10 天再导一次同一类目，「增长榜」就能算出真实增长。</p>
      <button class="btn" id="import2">${icon('upload', 15)}导入 FastMoss 数据</button></div>`;
  }

  // ---------- AI 选品报告 ----------
  async function loadReport() {
    const was = report?.status === 'running' ? report.progress?.judged ?? -1 : null;
    report = await api('/reports/latest').catch(() => ({}));
    if (!report?.id) report = null;
    drawReport();
    // 研判结果陆续写回商品：有新进展或报告刚完成时刷新列表
    if (was !== null && (report?.status !== 'running' || (report.progress?.judged ?? -1) !== was)) load();
    clearTimeout(poll);
    if (report?.status === 'running') poll = setTimeout(() => view.isConnected && loadReport(), 2500);
  }

  function drawReport() {
    const box = $('#report', view);
    if (!box) return;
    if (!report) {
      box.innerHTML = all.length ? `<div class="card card-pad rp-empty"><div><b>${icon('sparkles', 16)} AI 选品报告</b><p class="muted small" style="margin:6px 0 0">让 AI 读完这批数据：这个类目该卖什么、不该卖什么，每个商品能不能上、为什么。</p></div><button class="btn primary-glow" id="gen">${icon('sparkles', 15)}生成 AI 选品报告</button></div>` : '';
      bindGen();
      return;
    }
    const ov = report.overview || {};
    const st = report.stats || {};
    const prog = report.progress;
    const running = report.status === 'running';
    const types = (st.types || []).map((t) => ({ ...t, ai: (ov.segments || []).find((s) => s.type === t.type) }));
    const maxShare = Math.max(1, ...(st.bands || []).map((b) => Math.max(b.countShare, b.gmvShare)));
    const byId = new Map((report.items || []).map((x) => [x.id, x]));
    const refName = (i) => { const p = byId.get(report.ids?.[i - 1]); return p ? `<a href="javascript:;" class="ref" data-open="${p.id}">${esc(p.name.slice(0, 26))}…</a>` : ''; };
    const counts = { 可以上: 0, 谨慎测试: 0, 不建议上: 0 };
    for (const p of report.items || []) if (counts[p.verdict] != null) counts[p.verdict]++;
    box.innerHTML = `<div class="card rp">
      <div class="rp-head"><div><div class="kicker-s">AI 选品报告</div><h3>${esc(report.title || '选品报告')}</h3>
        <div class="muted small">${running ? '正在生成…' : report.status === 'error' ? '生成失败' : `生成于 ${esc((report.finishedAt || report.createdAt || '').slice(0, 16).replace('T', ' '))}`}${report.model ? ` · ${esc(report.model)}` : ''}${st.markets ? ` · ${esc(st.markets.join('/'))} 站` : ''}</div></div>
        <div class="spacer"></div>${running ? '' : `<button class="btn sm ghost" id="gen">${icon('refresh', 14)}重新生成</button>`}</div>
      ${running ? `<div class="rp-progress"><div class="bar"><i style="width:${prog ? Math.round((prog.done / prog.total) * 100) : 5}%"></i></div><span>${prog ? `已完成 ${prog.done}/${prog.total} 步 · 已研判 ${prog.judged}/${report.count} 个商品` : '准备中'}（模型思考需要一两分钟，可以先看下面的规则评分）</span></div>` : ''}
      ${report.errors?.length ? `<div class="rp-err">${report.errors.map(esc).join('<br>')}</div>` : ''}
      <div class="rp-verdicts">${Object.entries(counts).map(([v, n]) => `<button class="rv ${VCLS[v]}" data-filter="${v}"><b>${n}</b><span>${v}</span></button>`).join('')}
        <div class="rp-kpis">${st.count ? `<div><small>近 7 天总销售额</small><b>${esc(st.currency)}${fmtNum(st.totalGmv7d)}</b></div><div><small>成交均价中位数</small><b>${esc(st.currency)}${st.medianAsp}</b></div><div><small>品牌卖家销售额占比</small><b>${st.brandGmvShare}%</b></div><div><small>上架半年内的新品</small><b>${st.newcomers} 个</b></div>` : ''}</div></div>
      ${st.excluded ? `<p class="muted small" style="margin:10px 0 0">有 ${st.excluded} 个商品数据可疑（疑似刷单或价格异常），没有计入下面的品型、价格带和店铺统计。</p>` : ''}
      ${ov.summary ? `<p class="rp-summary">${esc(ov.summary)}</p>` : ''}
      ${ov.opportunities?.length ? `<h4 class="rp-h">${icon('target', 16)}机会方向</h4><div class="opps">${ov.opportunities.map((o, k) => `<div class="opp" style="--d:${k * 0.08}s"><div class="opp-n">0${k + 1}</div><b>${esc(o.title)}</b><p class="what">${esc(o.what || '')}</p><p class="small">${esc(o.why || '')}</p>
          <dl class="kv small"><dt>建议售价</dt><dd>${esc(o.entryPrice || '—')}</dd><dt>差异化</dt><dd>${esc(o.differentiation || '—')}</dd></dl>
          <div class="row" style="gap:8px;flex-wrap:wrap">${o.sourcing ? `<a class="chip click" target="_blank" rel="noopener" href="${search1688(o.sourcing)}">${icon('search', 12)}1688：${esc(o.sourcing)}</a>` : ''}${(o.refs || []).slice(0, 3).map(refName).join('')}</div></div>`).join('')}</div>` : ''}
      <div class="rp-grid">
        <div><h4 class="rp-h">${icon('layers', 16)}品型地图</h4><div class="table-wrap"><table class="seg-table"><thead><tr><th>品型</th><th class="r">商品</th><th class="r">销售额占比</th><th class="r">趋势</th><th class="r">均价</th><th>AI 判断</th></tr></thead><tbody>
          ${types.map((t) => `<tr><td><b>${esc(t.type)}</b></td><td class="r">${t.count}</td><td class="r"><span class="share" style="--w:${Math.min(100, t.gmvShare)}%">${t.gmvShare}%</span></td><td class="r">${t.medianMomentum != null ? `<span class="trend ${t.medianMomentum >= 1.15 ? 'up' : t.medianMomentum >= 0.9 ? 'flat' : 'down'}">${t.medianMomentum}×</span>` : '—'}</td><td class="r">${esc(st.currency)}${t.medianAsp ?? '—'}</td>
            <td>${t.ai ? `<span class="segv ${esc(t.ai.verdict)}">${esc(t.ai.verdict)}</span><div class="p-sub">${esc(t.ai.why || '')}</div>` : '<span class="muted small">—</span>'}</td></tr>`).join('')}</tbody></table></div></div>
        <div><h4 class="rp-h">${icon('chart', 16)}价格带：买家真正付多少钱</h4>
          <div class="bands">${(st.bands || []).map((b) => `<div class="band"><span class="lbl">${esc(b.range)}</span><div class="bb"><i class="c" style="width:${(b.countShare / maxShare) * 100}%"></i><i class="g" style="width:${(b.gmvShare / maxShare) * 100}%"></i></div><span class="nums">${b.countShare}% / <b>${b.gmvShare}%</b></span></div>`).join('')}
          <div class="legend small muted"><span><i class="c"></i>商品数占比</span><span><i class="g"></i>销售额占比</span></div></div>
          ${ov.priceInsight ? `<p class="small">${esc(ov.priceInsight)}</p>` : ''}
          ${ov.competition ? `<h4 class="rp-h">${icon('bot', 16)}竞争格局</h4><p class="small">${esc(ov.competition)}</p>` : ''}
          ${st.topShops?.length ? `<div class="shops">${st.topShops.map((s) => `<span class="chip">${esc(s.shop)} · ${s.gmvShare}%</span>`).join('')}</div>` : ''}</div>
      </div>
      ${ov.avoid?.length || ov.nextSteps?.length ? `<div class="rp-grid">
        ${ov.avoid?.length ? `<div><h4 class="rp-h">${icon('x', 16)}不要碰</h4><ul class="avoid">${ov.avoid.map((a) => `<li><b>${esc(a.what)}</b><span>${esc(a.why)}</span></li>`).join('')}</ul></div>` : '<div></div>'}
        ${ov.nextSteps?.length ? `<div><h4 class="rp-h">${icon('flow', 16)}接下来 7 天</h4><ol class="steps-ol">${ov.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}</div>` : ''}
    </div>`;
    bindGen();
    $$('[data-filter]', box).forEach((b) => (b.onclick = () => { $$('#tabs button', view).find((x) => x.dataset.v === b.dataset.filter)?.click(); $('#list', view).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    $$('[data-open]', box).forEach((a) => (a.onclick = () => openDetail(a.dataset.open)));
  }

  function bindGen() {
    const b = $('#gen', view);
    if (b) b.onclick = (e) => withLoading(e.currentTarget, () => startReport(report?.ids));
  }

  async function startReport(ids) {
    try {
      report = await api('/reports', { method: 'POST', body: { ids } });
      drawReport();
      loadReport();
    } catch (e) {
      if (/接入|模型|供应商/.test(e.message)) toast('先在「接入配置」接入大模型，才能生成 AI 选品报告；规则评分已经可以用', 'error');
      else throw e;
    }
  }

  // ---------- 导入 ----------
  function importDialog() {
    const m = modal({
      title: '导入 FastMoss 数据', wide: true,
      body: `<div id="imp"><div class="quota-line small">${quota ? `本周已导入 <b>${quota.used}</b> 个文件，你填的每周额度 <input class="input num" id="quota" type="number" min="1" value="${quota.limit}" aria-label="每周导出额度"> 次（按导入的文件数估算，FastMoss 的实际次数以它页面为准）` : ''}</div><div class="grid g2">
        <div class="dropzone" id="dz">${icon('upload', 30)}<p><b>拖入 FastMoss 导出的 Excel / CSV</b><br><span class="small">商品搜索 → 导出，原文件直接拖进来</span></p><input type="file" id="file" accept=".xlsx,.csv,text/csv" hidden></div>
        <div class="field">或者粘贴表格（在 FastMoss 页面选中表格 → Ctrl+C）<textarea class="input" id="paste" rows="7" placeholder="商品名称	售价	7天销量	28天销量	带货达人总数 …"></textarea><button class="btn sm ghost" id="parse" data-loading="识别中…" style="align-self:flex-start">识别粘贴内容</button></div>
      </div></div>`,
      onMount(el) {
        const dz = $('#dz', el), file = $('#file', el);
        const qi = $('#quota', el);
        if (qi) qi.onchange = () => api('/selection', { method: 'PUT', body: { exportQuota: Number(qi.value) || 5 } }).catch((e) => toast(e.message, 'error'));
        const go = (form, body) => withLoading($('#parse', el), async () => showMapping(await api('/products/import/preview', form ? { method: 'POST', form } : { method: 'POST', body })));
        const sendFile = (f) => { if (!f) return; const form = new FormData(); form.append('file', f); dz.innerHTML = `<span class="spinner"></span><p>正在读取 ${esc(f.name)}…</p>`; go(form); };
        dz.onclick = () => file.click();
        file.onchange = () => sendFile(file.files[0]);
        dz.ondragover = (e) => (e.preventDefault(), dz.classList.add('drag'));
        dz.ondragleave = () => dz.classList.remove('drag');
        dz.ondrop = (e) => { e.preventDefault(); sendFile(e.dataTransfer.files[0]); };
        $('#parse', el).onclick = () => { const t = $('#paste', el).value; if (!t.trim()) return toast('请先粘贴表格内容', 'error'); go(null, { text: t }); };
        function showMapping(pv) {
          const opts = (sel) => `<option value="">— 不导入 —</option>${pv.headers.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(h || `第 ${i + 1} 列`)}</option>`).join('')}`;
          const recognized = Object.keys(pv.mapping).length;
          $('#imp', el).innerHTML = `<p style="margin-top:0">读到 <b>${pv.total}</b> 个商品，自动识别了 <b>${recognized}</b> 列。${pv.missing?.length ? `<span class="down">缺少：${pv.missing.map(esc).join('、')}，相关维度会显示「数据不足」。</span>` : '<span class="up">关键字段齐全。</span>'}</p>
            <details class="map-details"><summary>查看 / 调整列对应关系</summary><div class="map-grid">${Object.entries(pv.fields).map(([k, label]) => `<label class="field">${esc(label)}${k === 'name' ? ' *' : ''}<select class="input" data-f="${k}">${opts(pv.mapping[k])}</select></label>`).join('')}</div></details>
            <div class="section-title"><h3 style="font-size:14px">前 ${pv.sample.length} 行预览</h3></div>
            <div class="table-wrap"><table><thead><tr>${pv.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${pv.sample.map((r) => `<tr>${pv.headers.map((_, i) => `<td>${esc(String(r[i] ?? '').slice(0, 60))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
            <label class="field mt" style="max-width:320px">这份数据是哪天导出的<input class="input" id="data-date" type="date" value="${today()}" max="${today()}"><span class="muted small">以前导出的文件选当时的日期：不覆盖最新数据，只用来算增长</span></label>
            <label class="row mt small" style="gap:8px"><input type="checkbox" id="autoai" checked> 导入后自动生成 AI 选品报告（需要已接入大模型）</label>
            <div class="row mt" style="justify-content:flex-end"><button class="btn lg primary-glow" id="commit" data-loading="导入中…">${icon('check')}确认导入 ${pv.total} 个商品</button></div>`;
          $('#commit', el).onclick = (e) => withLoading(e.currentTarget, async () => {
            const mapping = Object.fromEntries($$('[data-f]', el).map((s) => [s.dataset.f, s.value === '' ? '' : Number(s.value)]));
            const r = await api('/products/import/commit', { method: 'POST', body: { token: pv.token, mapping, dataDate: $('#data-date', el).value, today: today() } });
            const auto = $('#autoai', el).checked && r.created + r.updated > 0;
            toast(`新增 ${r.created} 个，更新 ${r.updated} 个${r.history ? `，补了 ${r.history} 个商品的历史数据` : ''}`, 'success');
            m.close();
            await load();
            remountTerrain();
            if (auto) startReport(r.ids);
            else drawReport();
          });
        }
      },
    });
  }

  // ---------- 手动添加 ----------
  function addDialog() {
    const f = (k, l, ph = '', type = 'text') => `<label class="field">${l}<input class="input" name="${k}" type="${type}" step="any" placeholder="${ph}"></label>`;
    modal({
      title: '手动添加商品', wide: true,
      body: `<form class="grid g3" id="mf">${f('name', '商品名称 *', 'Mini Desk Fan')}${f('fastmossUrl', 'FastMoss 链接', 'https://www.fastmoss.com/...')}${f('tiktokUrl', 'TikTok 商品链接')}
        <label class="field">站点<select class="input" name="market">${Object.entries(markets).map(([k, v]) => `<option value="${k}" ${k === 'MY' ? 'selected' : ''}>${esc(v.name)}（${esc(v.currency)}）</option>`).join('')}</select></label>
        ${f('price', '售价（当地币种）', '15.99', 'number')}${f('category', '类目')}${f('sales7d', '近 7 天销量', '', 'number')}${f('gmv', '近 7 天销售额', '', 'number')}${f('sales28d', '近 28 天销量', '', 'number')}
        ${f('creatorCount', '带货达人数', '', 'number')}${f('creatorConvRate', '达人出单率 %', '', 'number')}${f('videoCount', '带货视频数', '', 'number')}${f('commissionRate', '佣金比例 %', '', 'number')}${f('shop', '店铺')}${f('launchDate', '上架时间', '2026-09-01', 'date')}</form>`,
      footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="ok" data-loading="保存中…">保存</button>`,
      onMount(el, close) {
        $('#ok', el).onclick = (e) => withLoading(e.currentTarget, async () => {
          const body = Object.fromEntries(new FormData($('#mf', el)));
          if (!body.name.trim()) throw new Error('请填写商品名称');
          const p = await api('/products', { method: 'POST', body });
          close();
          await load();
          remountTerrain();
          openDetail(p.id);
        });
      },
    });
  }

  // ---------- 利润测算参数 ----------
  function assumeDialog() {
    const a = assumptions;
    const used = [...new Set(all.map((p) => p.evaluation.metrics.market))];
    const codes = used.length ? used : ['MY'];
    const f = (k, l, tip) => `<label class="field">${l}<input class="input" name="${k}" type="number" step="0.5" value="${a[k] ?? ''}"><span class="small muted">${tip}</span></label>`;
    modal({
      title: '利润测算参数', wide: true,
      body: `<form id="af" class="col">
        <div class="grid g2">
          <label class="field">店铺类型<select class="input" name="storeMode"><option value="crossborder" ${a.storeMode !== 'local' ? 'selected' : ''}>跨境店（从中国发货）</option><option value="local" ${a.storeMode === 'local' ? 'selected' : ''}>本土店（当地发货）</option></select><span class="small muted">影响定邀类目判断和「客单价太低」的门槛</span></label>
          <div class="field">已获得的定邀资质<label class="row small" style="gap:8px"><input type="checkbox" name="inv_charger" ${a.invited?.charger ? 'checked' : ''}> 充电器 / 数据线 / 适配器</label><label class="row small" style="gap:8px"><input type="checkbox" name="inv_powerbank" ${a.invited?.powerbank ? 'checked' : ''}> 充电宝（含马来西亚本地仓）</label></div>
        </div>
        <div class="grid g4">${f('targetMargin', '目标净利率 %', '低于它利润维度扣分')}${f('creatorRate', '默认达人佣金 %', '商品有佣金比例时以商品为准')}${f('returnRate', '退货/售后预留 %', '')}${f('adRate', '广告/样品预留 %', '')}</div>
        <div class="table-wrap"><table><thead><tr><th>站点</th><th>平台费率 %</th><th>每单固定费</th><th>1 单位当地币 = ¥</th><th>说明</th></tr></thead><tbody>
          ${codes.map((c) => { const mk = markets[c] || {}; return `<tr><td><b>${esc(mk.name || c)}</b></td><td><input class="input" data-m="${c}" data-k="platformFeeRate" type="number" step="0.01" value="${mk.platformFeeRate ?? ''}"></td><td><input class="input" data-m="${c}" data-k="fixedFee" type="number" step="0.01" value="${mk.fixedFee ?? 0}"></td><td><input class="input" data-m="${c}" data-k="cnyRate" type="number" step="0.0001" value="${mk.cnyRate ?? ''}"></td><td class="small muted">${esc(mk.note || '')}</td></tr>`; }).join('')}</tbody></table></div>
      </form>`,
      footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="ok">保存并重算</button>`,
      onMount(el, close) {
        $('#ok', el).onclick = (e) => withLoading(e.currentTarget, async () => {
          const fd = Object.fromEntries(new FormData($('#af', el)));
          const mk = {};
          for (const i of $$('[data-m]', el)) (mk[i.dataset.m] = mk[i.dataset.m] || {})[i.dataset.k] = i.value;
          await api('/selection', { method: 'PUT', body: { storeMode: fd.storeMode, targetMargin: fd.targetMargin, creatorRate: fd.creatorRate, returnRate: fd.returnRate, adRate: fd.adRate, invited: { charger: !!fd.inv_charger, powerbank: !!fd.inv_powerbank }, markets: mk } });
          close();
          await load();
          toast('已按新参数重新评估（AI 结论不变，可重新生成报告）', 'success');
        });
      },
    });
  }

  function methodDialog() {
    modal({
      title: '六维评估怎么算的', wide: true,
      body: `<div class="method">${DIMS_EXPLAIN.map(([t, d], i) => `<div class="mstep"><span>0${i + 1}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
        <p class="small muted">综合评分 = 需求 20% + 趋势 25% + 达人 15% + 竞争 15% + 利润 15% + 风险 10%，人工判断「卖点能拍出来」「自己想买」再加减分。结论规则：有不能上的硬伤（定邀类目、带电、品牌/IP、刷单数据、客单价太低）直接「不建议上」；评分 ≥ 64、趋势在涨、利润成立且没有重大风险才是「可以上」；其余为「谨慎测试」。接入大模型后 AI 会在这个基础上逐个复核，结论以 AI 为准，规则结论保留作对照。</p>
        <p class="small muted">数据来源说明：FastMoss 的销量和销售额是第三方估算值，适合比较方向和趋势，不等于后台真实数据。</p></div>`,
    });
  }

  // ---------- 商品详情 ----------
  async function openDetail(id, tab = 'analysis') {
    let p = await api(`/products/${id}`);
    let links = null;
    let erps = [];
    if (tab === 'source') links = await api(`/products/${id}/sourcing/links`).catch(() => ({}));
    if (tab === 'listing') erps = (await api('/connectors').catch(() => ({ items: [] }))).items.filter((c) => c.kind === 'erp' && c.enabled !== false && c.status !== 'pending');
    // 等数据期间已经切到别的页面（或同一页面被重新渲染）：不再弹出，避免叠出两个详情
    if (!view.isConnected) return;
    const m = modal({ title: esc(zhName(p) || (p.name.length > 70 ? p.name.slice(0, 70) + '…' : p.name)), wide: true, body: '<div id="pd"></div>', footer: '<div id="pf" class="row" style="width:100%"></div>' });
    const root = $('#pd', m.el), foot = $('#pf', m.el);

    const draw = () => {
      const ev = p.evaluation, mt = ev.metrics, pr = ev.profit, a = p.analysis, j = p.judgement || {}, ai = p.ai, c = cur(p);
      root.innerHTML = `
        <div class="pd-top">${p.image ? `<img class="pd-img" src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
          <div class="pd-head">
            <div class="row" style="gap:10px;flex-wrap:wrap">${verdict(ev.verdict, ai ? '<i class="ai-dot">AI</i>' : '')}<span class="score-big ${scoreCls(ai?.score ?? ev.score)}">${ai?.score ?? ev.score ?? '—'}<small> 分</small></span>
              ${ev.aiOverruled ? `<span class="muted small">AI 判「${esc(ai.verdict)}」，但有硬伤（${esc(ev.flags.find((f) => f.level === 'block').title)}），按「不建议上」处理</span>` : ai && ai.verdict !== ev.ruleVerdict ? `<span class="muted small">规则结论：${esc(ev.ruleVerdict)}（${ev.score} 分）</span>` : ''}</div>
            <p class="pd-headline">${esc(ai?.headline || ev.headline)}</p>
            <div class="pd-facts"><span>${esc(mt.type)}</span><span>${esc(p.shop || '—')}</span><span>${esc(mt.market)} 站</span>${mt.ageDays != null ? `<span>上架 ${mt.ageDays} 天</span>` : ''}${p.commissionRate != null ? `<span>佣金 ${p.commissionRate}%</span>` : ''}</div>
            <div class="ext-links"><a href="${esc(p.fastmossLink)}" target="_blank" rel="noopener">${icon('link', 13)}FastMoss 详情</a>${p.tiktokUrl ? `<a href="${esc(p.tiktokUrl)}" target="_blank" rel="noopener" data-tt title="TikTok 只对当地网络开放：国内网络打开会显示 403 Forbidden，需要马来西亚网络（店铺环境 / 马来西亚节点）">${icon('link', 13)}TikTok 商品页</a>` : ''}${p.shopUrl ? `<a href="${esc(p.shopUrl)}" target="_blank" rel="noopener">${icon('link', 13)}店铺分析</a>` : ''}<a href="${search1688(kw1688(p))}" target="_blank" rel="noopener">${icon('search', 13)}1688 找同款</a></div>
          </div></div>
        <div class="seg pd-tabs" id="pdtabs">${[['analysis', '分析'], ['source', `1688 找货${p.sourcing?.offers?.length ? ` · ${p.sourcing.offers.length}` : ''}`], ['listing', `上架包${p.listing ? ` · ${LISTING_STATUS[p.listing.status] || ''}` : ''}`], ['videos', '爆款视频']].map(([k, t]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
        ${tab === 'source' ? sourceHTML(p) : tab === 'listing' ? listingHTML(p) : tab === 'videos' ? '<div id="pv-box"></div>' : `
        ${ai ? `<div class="ai-box"><div class="row"><b>${icon('sparkles', 15)}AI 研判</b><span class="muted small">${esc(ai.model || '')} · ${esc((ai.at || '').slice(0, 10))}</span></div>
          <div class="ai-reasons">${Object.entries(ai.reasons || {}).filter(([, v]) => v).map(([k, v]) => `<div><span>${esc(k)}</span><p>${esc(v)}</p></div>`).join('')}</div>
          <dl class="kv"><dt>1688 采购价</dt><dd>${esc(ai.est1688 || '—')}${ai.profitOk === false ? ' <span class="down">（按估价利润不成立）</span>' : ai.profitOk ? ' <span class="up">（利润成立）</span>' : ''}</dd><dt>怎么做</dt><dd>${esc(ai.angle || '—')}</dd><dt>下一步</dt><dd>${esc(ai.nextStep || '—')}</dd></dl></div>` : ''}
        <div class="dim-grid">${ev.dims.map((d) => `<div class="dim ${scoreCls(d.score)}"><div class="dim-top"><b>${esc(d.label)}</b><span class="dim-score">${d.score ?? '—'}</span></div><div class="dim-bar"><i style="width:${d.score ?? 0}%"></i></div><p>${esc(d.summary)}</p>${d.evidence?.length ? `<ul>${d.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
        ${ev.flags.length ? `<div class="flag-list">${ev.flags.map((f) => `<div class="fl ${f.level}"><i>${FLAG_ICON[f.level]}</i><div><b>${esc(f.title)}</b><span>${esc(f.detail)}</span></div></div>`).join('')}</div>` : ''}
        <div class="drawer-grid">
          <div class="col">
            <div class="hit"><b>利润测算</b><span class="muted small">（${esc(mt.market)} 站：平台 ${pr?.platformFeeRate ?? '—'}%${pr?.fixedFee ? ` + 每单 ${c}${pr.fixedFee}` : ''}，汇率 1 ${esc(c)} = ¥${pr?.cnyRate ?? '—'}）</span>
              <div class="grid g2" style="margin-top:10px">
                <label class="field">1688 采购价 ¥<input class="input" id="cost" type="number" step="0.01" value="${p.costCny ?? ''}" placeholder="例如 6.5"></label>
                <label class="field">物流 ¥ / 件（头程 + 尾程）<input class="input" id="ship" type="number" step="0.01" value="${p.shippingCny ?? ''}" placeholder="例如 4"></label></div>
              ${pr ? `<table class="profit-table"><tbody>
                <tr><td>成交均价</td><td class="r money">${money(c, pr.asp)}</td></tr>
                <tr><td class="muted">− 平台费 ${pr.platformFeeRate}%${pr.fixedFee ? ` + 每单 ${c}${pr.fixedFee}` : ''}</td><td class="r money">${money(c, (pr.asp * pr.platformFeeRate) / 100 + pr.fixedFee)}</td></tr>
                <tr><td class="muted">− 达人佣金 ${pr.commission}%</td><td class="r money">${money(c, (pr.asp * pr.commission) / 100)}</td></tr>
                <tr><td class="muted">− 退货 ${pr.returnRate}% / 广告 ${pr.adRate}%</td><td class="r money">${money(c, (pr.asp * (pr.returnRate + pr.adRate)) / 100)}</td></tr>
                ${pr.margin != null ? `<tr><td class="muted">− 采购 + 物流（¥${pr.costCny + pr.shippingCny}）</td><td class="r money">${money(c, pr.costLocal)}</td></tr>
                <tr class="total"><td>单件净利 · 净利率</td><td class="r money ${pr.margin >= pr.targetMargin ? 'up' : 'down'}">${money(c, pr.unitProfit)}（¥${pr.unitProfitCny}）· ${pr.margin}%</td></tr>`
                  : `<tr class="total"><td>要赚 ${pr.targetMargin}% 净利，采购 + 物流最多</td><td class="r money ${pr.ceilingCny >= 8 ? 'up' : 'down'}">${money(c, Math.max(0, pr.ceiling))}（¥${Math.max(0, pr.ceilingCny)}）</td></tr>`}</tbody></table>` : '<p class="small muted">缺少售价，无法测算。</p>'}
            </div>
            <div class="hit"><b>人工判断</b>
              <div class="judge"><span>卖点能在 3 秒内拍出来？</span><div class="seg" data-j="visual"><button data-v="true" class="${j.visual === true ? 'on' : ''}">能</button><button data-v="false" class="${j.visual === false ? 'on' : ''}">不能</button></div></div>
              <div class="judge"><span>自己看到也想买？</span><div class="seg" data-j="wantBuy"><button data-v="true" class="${j.wantBuy === true ? 'on' : ''}">想</button><button data-v="false" class="${j.wantBuy === false ? 'on' : ''}">不想</button></div></div>
              <textarea class="input" id="notes" rows="2" placeholder="备注：对标视频的感受、供应商信息…">${esc(j.notes || '')}</textarea></div>
            <div class="hit"><b>买家评论 / 差评</b><span class="muted small">（可选）在 FastMoss 商品详情「商品评论」里复制差评粘贴到这里，深度分析会提炼痛点和改良机会</span>
              <textarea class="input" id="reviews" rows="4" placeholder="粘贴评论原文，多条即可…">${esc(p.reviewsText || '')}</textarea></div>
          </div>
          <div class="col">
            <div class="hit"><div class="row"><b>AI 深度分析</b><span class="muted small">${p.analyzedAt ? '更新于 ' + esc(p.analyzedAt.slice(0, 10)) : ''}</span><div class="spacer"></div><button class="btn sm" id="ai" data-loading="分析中…">${icon('sparkles', 14)}${a ? '重新分析' : '深度分析'}</button></div>
              ${a ? analysisHTML(a) : '<p class="small muted" style="margin:8px 0 0">在批量研判的基础上做单品深挖：目标人群、卖点怎么拍、竞品切入点、评论痛点、1688 找货关键词和采购价上限、测款方案（备货、达人、预算、成功标准、止损线）。</p>'}</div>
          </div>
        </div>`}`;
      foot.innerHTML = `<button class="btn ghost danger" id="del">${icon('trash', 14)}删除</button><div class="spacer"></div>
        ${p.status !== 'dropped' ? '<button class="btn ghost" data-st="dropped">放弃</button>' : '<button class="btn ghost" data-st="candidate">恢复为候选</button>'}
        ${p.status !== 'testing' ? `<button class="btn ghost" data-st="testing">${icon('flow', 14)}标记测款中</button>` : ''}
        <a class="btn ghost" href="#/scripts/new/${p.id}" data-close>${icon('script', 15)}生成视频脚本</a>
        <a class="btn primary-glow" href="#/launch/${p.id}" data-close>${icon('zap', 15)}进作战室</a>`;
      bind();
    };

    const save = async (body) => {
      p = await api(`/products/${p.id}`, { method: 'PATCH', body });
      load();
    };
    let tmr;
    function bind() {
      const tt = $('[data-tt]', root);
      if (tt) tt.onclick = () => {
        navigator.clipboard?.writeText(tt.href).catch(() => {});
        toast('如果打开是「403 Forbidden」：TikTok 只对当地网络开放，请换马来西亚网络（店铺环境 / 马来西亚节点）。链接已复制，可以粘贴到店铺环境的浏览器里打开', 'info');
      };
      $$('#pdtabs button', root).forEach((b) => (b.onclick = async () => {
        tab = b.dataset.tab;
        if (tab === 'source' && !links) links = await api(`/products/${p.id}/sourcing/links`).catch(() => ({}));
        if (tab === 'listing') erps = (await api('/connectors').catch(() => ({ items: [] }))).items.filter((c) => c.kind === 'erp' && c.enabled !== false && c.status !== 'pending');
        draw();
      }));
      bindFoot();
      if (tab === 'source') return bindSource();
      if (tab === 'listing') return bindListing();
      if (tab === 'videos') return mountVideos($('#pv-box', root), p);
      const deb = () => { clearTimeout(tmr); tmr = setTimeout(async () => { await save({ costCny: $('#cost', root).value, shippingCny: $('#ship', root).value }); draw(); }, 700); };
      $('#cost', root).oninput = deb;
      $('#ship', root).oninput = deb;
      $$('[data-j]', root).forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = async () => { await save({ judgement: { [seg.dataset.j]: b.dataset.v === 'true' } }); draw(); })));
      $('#notes', root).onchange = (e) => save({ judgement: { notes: e.target.value } });
      $('#reviews', root).onchange = (e) => save({ reviewsText: e.target.value }).then(() => toast('评论已保存，深度分析时会用到', 'success'));
      $('#ai', root).onclick = (e) => withLoading(e.currentTarget, async () => {
        if ($('#reviews', root).value !== (p.reviewsText || '')) await save({ reviewsText: $('#reviews', root).value });
        await api(`/products/${p.id}/analyze`, { method: 'POST' });
        p = await api(`/products/${p.id}`);
        draw();
        toast('分析完成', 'success');
      });
    }

    // ---------- 1688 找货 ----------
    function sourceHTML(p) {
      const s = p.sourcing || {}, offers = s.offers || [], ceil = p.evaluation.profit?.ceilingCny;
      const L = links || {};
      return `<div class="src">
        <div class="src-bar"><label class="field" style="flex:1;min-width:220px">1688 搜索词<input class="input" id="kw" value="${esc(s.keyword || L.keyword || '')}" placeholder="例如：睡眠耳机 无线 隐形"></label>
          <button class="btn" id="src-go" data-loading="搜货中…（关键词 + 以图搜，约半分钟）">${icon('search', 15)}用 API 搜货</button>
          ${L.autoKeywordUrl ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(L.autoKeywordUrl)}" title="装了运营台助手插件：自动搜索、采集结果、打开前 3 个详情补数据">${icon('search', 14)}插件自动搜</a>` : ''}${L.autoImageUrl ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(L.autoImageUrl)}" title="装了运营台助手插件：自动上传主图以图搜、采集结果、补详情">${icon('image', 14)}插件自动以图搜</a>` : ''}</div>
        <p class="small muted">按商品主图以图搜 + 关键词搜，合并后按比价矩阵排序：阶梯价 30%、库存深度 20%、发货地 15%、单件重量 15%、SKU 丰富度 10%、商品状态 10%；AI 判断同款度。${ceil != null ? `这个商品要赚到目标利润，<b>采购 + 物流不能超过 ¥${Math.max(0, ceil)}</b>。` : ''}</p>
        ${L.hasApi === false ? `<div class="src-hint">${icon('sparkles', 15)}<div><b>还没接 1688 接口也能找货：</b>装好浏览器插件「运营台助手」后点上面「插件自动搜」或「插件自动以图搜」，插件会自动打开 1688 搜索、采集结果、打开前 3 个详情页补阶梯价和重量，全部送回这里打分；也可以在下面手动添加。接口：<a href="#/providers" data-close style="color:var(--lime)">接入配置 → 数据源与 ERP</a>（官方 / 第三方数据接口二选一）。</div></div>` : ''}
        ${s.errors?.length ? `<p class="small down">${s.errors.map(esc).join('；')}</p>` : ''}
        ${offers.length ? `<div class="table-wrap"><table class="src-table"><thead><tr><th>货源</th><th class="r">价格</th><th>阶梯价</th><th class="r">库存</th><th>发货地</th><th class="r">重量</th><th class="r">SKU</th><th class="r">同款度</th><th class="r">比价分</th><th class="r">到手成本</th><th></th></tr></thead><tbody>
          ${offers.map((o) => { const id = o.offerId || o.url, on = s.chosen === id; return `<tr class="${on ? 'chosen' : ''}"><td><div class="pcell" style="min-width:240px">${o.image ? `<img class="pthumb" src="${esc(o.image)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}<div style="min-width:0"><a class="pname" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a><div class="p-sub">${esc(o.shop || '')} · ${esc(o.source || '')}${o.matchNote ? ` · ${esc(o.matchNote)}` : ''}</div></div></div></td>
            <td class="r money">¥${o.price ?? '—'}${o.moq ? `<div class="p-sub">${o.moq} 件起批</div>` : ''}</td>
            <td class="small">${(o.priceRanges || []).slice(0, 3).map((r) => `≥${r.startQuantity ?? '?'}：¥${r.price}`).join('<br>') || '—'}</td>
            <td class="r">${o.amountOnSale != null ? fmtNum(o.amountOnSale) : '—'}</td><td class="small">${esc(o.sendGoodsAddress || '—')}</td>
            <td class="r">${o.unitWeight != null ? Math.round(o.unitWeight * 1000) + 'g' : '—'}</td><td class="r">${o.skuCount || '—'}</td>
            <td class="r">${o.match != null ? `<b class="${scoreCls(o.match)}">${o.match}</b>` : '—'}</td>
            <td class="r" title="${Object.entries(o.dims || {}).map(([k, v]) => `${{ price: '阶梯价', stock: '库存深度', origin: '发货地', weight: '单件重量', sku: 'SKU 丰富度', status: '商品状态' }[k]} ${v}`).join('\n')}"><b class="${scoreCls(o.matrix)}">${o.matrix ?? '—'}</b></td>
            <td class="r">${o.landedCny != null ? `<span class="${o.profitOk === false ? 'down' : o.profitOk ? 'up' : ''}">¥${o.landedCny}</span><div class="p-sub">含物流 ¥${o.shippingCny}</div>` : '—'}</td>
            <td>${on ? '<span class="verdict v-go">已选</span>' : `<button class="btn sm ghost" data-choose="${esc(id)}">选它</button>`}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
        <details class="map-details"${offers.length ? '' : ' open'}><summary>手动添加货源</summary>
          <form class="grid g3" id="mo"><label class="field">1688 链接 *<input class="input" name="url" placeholder="https://detail.1688.com/offer/….html"></label><label class="field">标题<input class="input" name="title"></label><label class="field">价格 ¥ *<input class="input" name="price" type="number" step="0.01"></label>
            <label class="field">起批量<input class="input" name="min_num" type="number"></label><label class="field">单件重量（克）<input class="input" name="weightG" type="number"></label><label class="field">发货地<input class="input" name="location" placeholder="广东 深圳"></label></form>
          <div class="row mt" style="justify-content:flex-end"><button class="btn sm" id="mo-add" data-loading="添加中…">${icon('plus', 14)}添加</button></div></details>
      </div>`;
    }

    function bindSource() {
      $('#src-go', root).onclick = (e) => withLoading(e.currentTarget, async () => {
        await api(`/products/${p.id}/sourcing/search`, { method: 'POST', body: { keyword: $('#kw', root).value.trim() } });
        p = await api(`/products/${p.id}`);
        draw();
        toast(`找到 ${p.sourcing.offers.length} 个货源`, 'success');
      });
      $$('[data-choose]', root).forEach((b) => (b.onclick = () => withLoading(b, async () => {
        p = await api(`/products/${p.id}/sourcing/choose`, { method: 'POST', body: { offerId: b.dataset.choose } });
        load();
        draw();
        toast('已选定供应商，采购价和物流已填进利润测算', 'success');
      })));
      $('#mo-add', root).onclick = (e) => withLoading(e.currentTarget, async () => {
        const f = Object.fromEntries(new FormData($('#mo', root)));
        if (!f.url || !f.price) throw new Error('请填写 1688 链接和价格');
        const offer = { detail_url: f.url, title: f.title || f.url, price: f.price, min_num: f.min_num || undefined, weight: f.weightG ? Number(f.weightG) / 1000 : undefined, location: f.location || undefined, num_iid: (f.url.match(/offer\/(\d+)/) || [])[1] };
        await api(`/products/${p.id}/sourcing/offers`, { method: 'POST', body: { offers: [offer], source: '手动添加' } });
        p = await api(`/products/${p.id}`);
        draw();
      });
    }

    // ---------- 上架包 ----------
    function listingHTML(p) {
      const L = p.listing, offer = p.sourcing?.offers?.find((o) => (o.offerId || o.url) === p.sourcing?.chosen);
      if (!L) return `<div class="card card-pad empty-ish"><p>${offer ? `已选定货源 <b>¥${offer.price}</b>（${esc(offer.title.slice(0, 40))}）。` : '<span class="down">还没选定 1688 货源</span>：上架包里的 SKU 会由 AI 推断，定价也算不出来。建议先到「1688 找货」选定供应商。'}</p>
        <p class="small muted">上架包包含：${esc(p.evaluation.metrics.market)} 站本地语言和英文标题、5 条卖点、分段描述、搜索词、SKU、按目标利润的定价，以及违禁词和合规检查。确认后可一键推送到妙手 ERP / Webhook。</p>
        <button class="btn primary-glow" id="pk-build" data-loading="生成中…（约半分钟）">${icon('sparkles', 15)}生成上架包</button></div>`;
      const k = L.pack, pr = L.price;
      return `<div class="pk">
        <div class="row" style="gap:10px;flex-wrap:wrap"><span class="verdict ${L.status === 'pushed' ? 'v-go' : L.status === 'approved' ? 'v-watch' : 'v-na'}">${LISTING_STATUS[L.status]}</span><span class="muted small">生成于 ${esc((L.at || '').slice(0, 16).replace('T', ' '))}${L.offer ? ` · 货源 ¥${L.offer.price}` : ' · 未选定货源'}</span><div class="spacer"></div>
          <a class="btn sm ghost" href="/api/listings/export?ids=${p.id}" download>${icon('download', 14)}导出 CSV</a><button class="btn sm ghost" id="pk-build" data-loading="重新生成中…">${icon('refresh', 14)}重新生成</button></div>
        ${L.compliance.issues.length || L.compliance.risks.length ? `<div class="flag-list" style="margin-top:12px">${L.compliance.issues.map((x) => `<div class="fl major"><i>!</i><div><b>违禁词</b><span>${esc(x)}</span></div></div>`).join('')}${L.compliance.risks.map((x) => `<div class="fl block"><i>✕</i><div><b>商品风险</b><span>${esc(x)}</span></div></div>`).join('')}</div>` : '<p class="small up">违禁词检查通过</p>'}
        <form class="col" id="pkf" style="margin-top:12px">
          <label class="field">本地语言标题<input class="input" name="titleLocal" value="${esc(k.titleLocal || '')}"></label>
          <label class="field">英文标题<input class="input" name="titleEn" value="${esc(k.titleEn || '')}"></label>
          <label class="field">卖点（每行一条）<textarea class="input" name="sellingPoints" rows="5">${esc((k.sellingPoints || []).join('\n'))}</textarea></label>
          <label class="field">描述<textarea class="input" name="description" rows="8">${esc(k.description || '')}</textarea></label>
          <label class="field">搜索词（逗号分隔）<input class="input" name="keywords" value="${esc((k.keywords || []).join(', '))}"></label>
          <div class="grid g2"><div class="field">SKU<div class="hit small">${(k.skus || []).map((x) => `<div><b>${esc(x.name)}</b> ${esc(x.spec || '')}</div>`).join('') || '—'}</div></div>
            <div class="field">定价（${esc(pr?.currency || p.evaluation.metrics.currency)}）<input class="input" name="price" type="number" step="0.01" value="${pr?.suggested ?? ''}"><span class="small muted">${pr ? `保本 + 目标利润至少 ${pr.currency}${pr.floor}，同类成交均价 ${pr.currency}${pr.competitorAsp}` : '选定货源后自动算出定价'}</span>${pr?.warn ? `<span class="small down">${esc(pr.warn)}</span>` : ''}</div></div>
          ${k.categoryHint ? `<p class="small muted" style="margin:0">类目建议：${esc(k.categoryHint)}</p>` : ''}${k.notes ? `<p class="small down" style="margin:0">上架前确认：${esc(k.notes)}</p>` : ''}
        </form>
        <div class="row mt" style="gap:8px;flex-wrap:wrap"><button class="btn ghost" id="pk-save" data-loading="保存中…">${icon('check', 14)}保存修改</button>
          ${L.status === 'draft' ? `<button class="btn" id="pk-approve" data-loading="确认中…">${icon('check', 14)}确认上架包</button>` : ''}
          <div class="spacer"></div>
          ${erps.length ? `<select class="input" id="pk-erp" style="width:auto">${erps.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button class="btn primary-glow" id="pk-push" data-loading="推送中…" ${L.status === 'draft' ? 'disabled title="先确认上架包"' : ''}>${icon('upload', 15)}推送到 ERP 上品</button>` : '<a class="btn ghost" href="#/providers" data-close>添加妙手 ERP / Webhook 后可一键上品</a>'}</div>
        ${L.pushes?.length ? `<div class="col mt">${L.pushes.map((x) => `<div class="small ${x.ok ? 'up' : 'down'}">${esc(x.at.slice(0, 16).replace('T', ' '))} · ${esc(x.connector)} · ${esc(x.message)}${x.remoteId ? ` · ${esc(x.remoteId)}` : ''}</div>`).join('')}</div>` : ''}
      </div>`;
    }

    function bindListing() {
      $('#pk-build', root).onclick = (e) => withLoading(e.currentTarget, async () => {
        p = await api(`/products/${p.id}/listing`, { method: 'POST' });
        load();
        draw();
      });
      const form = () => {
        const f = Object.fromEntries(new FormData($('#pkf', root)));
        return { pack: { titleLocal: f.titleLocal, titleEn: f.titleEn, sellingPoints: f.sellingPoints.split('\n').map((x) => x.trim()).filter(Boolean), description: f.description, keywords: f.keywords.split(/[,，]/).map((x) => x.trim()).filter(Boolean) }, price: f.price };
      };
      if (!$('#pkf', root)) return;
      $('#pk-save', root).onclick = (e) => withLoading(e.currentTarget, async () => {
        p = await api(`/products/${p.id}/listing`, { method: 'PATCH', body: form() });
        draw();
        toast('已保存', 'success');
      });
      const ap = $('#pk-approve', root);
      if (ap) ap.onclick = (e) => withLoading(e.currentTarget, async () => {
        p = await api(`/products/${p.id}/listing`, { method: 'PATCH', body: { ...form(), status: 'approved' } });
        load();
        draw();
        toast('上架包已确认，可以推送到 ERP', 'success');
      });
      const pu = $('#pk-push', root);
      if (pu) pu.onclick = (e) => withLoading(e.currentTarget, async () => {
        p = await api(`/products/${p.id}/listing/push`, { method: 'POST', body: { connectorId: $('#pk-erp', root).value } });
        load();
        draw();
        toast('已推送到 ERP，商品标记为「测款中」', 'success');
      });
    }

    function bindFoot() {
      $$('[data-st]', foot).forEach((b) => (b.onclick = async () => { await save({ status: b.dataset.st }); draw(); toast(`已标记为「${STATUS[b.dataset.st]}」`, 'success'); }));
      $('#del', foot).onclick = async () => {
        if (!(await confirmBox(`删除「${p.name}」？`))) return;
        await api(`/products/${p.id}`, { method: 'DELETE' });
        m.close();
        await load();
        remountTerrain();
      };
    }
    draw();
  }

  // 地形：WebGL 不可用时自动跳过
  let disposeTerrain = null;
  function remountTerrain() {
    disposeTerrain?.();
    const items = all.map((p) => ({ id: p.id, nameCn: p.name, score: p.ai?.score ?? p.evaluation.score ?? 0, grade: p.evaluation.verdict === '可以上' ? 'S' : p.evaluation.verdict === '谨慎测试' ? 'A' : 'B', category: p.evaluation.metrics.type || '' }));
    import('../fx/terrain.js').then(({ mountTerrain }) => { if (view.isConnected) disposeTerrain = mountTerrain(view.querySelector('#terrain'), { items, onPick: openDetail }); }).catch((e) => console.warn('[fx] 市场地形未加载：', e.message));
  }

  let t;
  $('#q', view).oninput = (e) => { clearTimeout(t); t = setTimeout(() => ((state.q = e.target.value), (shown = PAGE), load()), 250); };
  $$('#tabs button', view).forEach((b) => (b.onclick = () => {
    state.verdict = b.dataset.v || '';
    state.status = b.dataset.s || '';
    shown = PAGE;
    $$('#tabs button', view).forEach((x) => x.classList.toggle('on', x === b));
    load();
  }));
  $('#sort', view).onchange = (e) => ((state.sort = e.target.value), (shown = PAGE), load());
  $('#import', view).onclick = importDialog;
  $('#pull', view).onclick = pullDialog;
  $('#add', view).onclick = addDialog;
  $('#assume', view).onclick = assumeDialog;
  $('#method', view).onclick = methodDialog;
  view.addEventListener('click', (e) => e.target.closest('#import2') && importDialog());

  await load();
  await loadReport();
  remountTerrain();
  if (openId) openDetail(openId, openTab);
  return () => {
    clearTimeout(poll);
    disposeTerrain?.();
  };
}

function analysisHTML(a) {
  const list = (arr) => `<ul>${(arr || []).map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>`;
  const tp = a.testPlan || {};
  return `<div class="analysis">
    <div class="row">${verdict(a.verdict)}</div>
    <h4>理由</h4>${list(a.why)}
    <h4>目标人群</h4><p>${esc(a.audience || '—')}</p>
    <h4>卖点与拍法</h4><ul>${(a.sellingPoints || []).map((s) => `<li><b>${esc(s.point)}</b> — ${esc(s.howToShow)}</li>`).join('')}</ul>
    <h4>竞品与切入点</h4><p>${esc(a.competitors || '—')}</p>
    ${a.reviewInsights?.length ? `<h4>评论里的痛点与改良机会</h4>${list(a.reviewInsights)}` : ''}
    <h4>风险</h4>${list(a.risks)}
    <h4>1688 找货</h4><p>${esc(a.sourcing || '—')}</p>
    <h4>测款方案</h4><dl class="kv"><dt>备货</dt><dd>${esc(tp.inventory || '—')}</dd><dt>达人</dt><dd>${esc(tp.creators || '—')}</dd><dt>自营视频</dt><dd>${esc(tp.videos || '—')}</dd><dt>预算</dt><dd>${esc(tp.budget || '—')}</dd><dt>成功标准</dt><dd>${esc(tp.successMetrics || '—')}</dd><dt>止损线</dt><dd>${esc(tp.stopLoss || '—')}</dd></dl>
    <h4>对标视频角度</h4>${list(a.benchmarkAngles)}
  </div>`;
}
