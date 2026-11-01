// 智能选品：导入 FastMoss 数据 → 六维评估（需求 / 趋势 / 达人 / 竞争 / 利润 / 风险）→ AI 选品报告与逐个研判 → 单品深度分析 → 测款 → 视频脚本
import { api, icon, esc, fmtNum, modal, toast, withLoading, $, $$, empty, confirmBox } from '../lib.js';

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
  const state = { q: '', verdict: '', status: '', sort: 'score' };
  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">智能选品 · FastMoss 数据 × AI 研判</div>
    <h2>导入数据，<em>AI</em> 告诉你<br>哪些能上、为什么</h2>
    <p>从 FastMoss 导出商品数据拖进来：系统按需求、趋势、达人、竞争、利润、风险六个维度给每个商品打分，AI 再逐个研判能不能上、为什么、做什么款，并写出这个类目的市场报告。</p>
    <div class="actions">
      <button class="btn lg primary-glow" id="import">${icon('upload')}导入 FastMoss 数据</button>
      <button class="btn ghost lg" id="add">${icon('plus')}手动添加</button>
      <a class="btn ghost lg" href="https://www.fastmoss.com/zh/e-commerce/search" target="_blank" rel="noopener">${icon('link')}打开 FastMoss</a>
    </div>
  </section>
  <section id="report"></section>
  <section class="terrain terrain-card" id="terrain"><div class="copy"><h2>市场地形</h2><p>每个方块是一个商品，高度是综合评分，骨白色是「可以上」。点击方块查看详情。</p></div></section>
  <section data-reveal>
    <div class="section-title"><h3>选品库</h3><span class="muted small" id="summary"></span><div class="spacer"></div>
      <button class="btn sm ghost" id="method">${icon('layers', 14)}评估方法</button><button class="btn sm ghost" id="assume">${icon('settings', 14)}利润测算参数</button></div>
    <div class="toolbar">
      <div class="input-icon">${icon('search', 16)}<input class="input" id="q" placeholder="搜索商品、品型、店铺"></div>
      <div class="seg" id="tabs"><button data-v="" class="on">全部</button><button data-v="可以上">可以上</button><button data-v="谨慎测试">谨慎测试</button><button data-v="不建议上">不建议上</button><button data-s="testing">测款中</button><button data-s="dropped">已放弃</button></div>
      <select class="input" id="sort" style="width:150px"><option value="score">综合评分</option><option value="gmv">7 天销售额</option><option value="sales">7 天销量</option><option value="trend">增长最快</option><option value="profit">利润空间最大</option><option value="recent">最近导入</option></select>
    </div>
    <div id="list"></div>
  </section>`;

  let all = [];
  let assumptions = {};
  let markets = {};
  let report = null;
  let poll = null;
  const PAGE = 100;
  let shown = PAGE;

  async function load() {
    const d = await api(`/products?${new URLSearchParams({ q: state.q, sort: state.sort, verdict: state.verdict, status: state.status })}`);
    assumptions = d.assumptions;
    markets = d.markets;
    all = d.items;
    if (!state.q && !state.verdict && !state.status) countAll(all);
    const items = all.slice(0, shown);
    const box = $('#list', view);
    if (!all.length && !state.q && !state.verdict && !state.status) return (box.innerHTML = onboarding());
    if (!items.length) return (box.innerHTML = `<div class="card">${empty('没有符合条件的商品', 'search')}</div>`);
    const more = all.length > items.length ? `<div class="row mt" style="justify-content:center"><button class="btn ghost" id="more">显示更多（还有 ${all.length - items.length} 个）</button></div>` : '';
    box.innerHTML = `<div class="table-wrap"><table class="ptable"><thead><tr><th>商品</th><th class="r">成交均价</th><th class="r">7 天销量</th><th>趋势</th><th class="r">达人 · 出单率</th><th class="r" title="想达到目标净利，采购 + 物流最多能花多少人民币">成本上限</th><th>六维评分</th><th>结论</th></tr></thead><tbody>
      ${items.map(rowHTML).join('')}</tbody></table></div>${more}`;
    const mb = box.querySelector('#more');
    if (mb) mb.onclick = () => { shown += PAGE; load(); };
    $$('.prow', box).forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('[data-stop]') && openDetail(tr.dataset.id)));
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
      <td><div class="pcell">${thumb(p)}<div style="min-width:0"><b class="pname">${esc(p.name)}</b>
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
      <p class="muted small">建议一次导出同一个站点、同一个类目的 50–200 个商品：同批对比，排名和品型分析才有意义。</p>
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
          <div class="row" style="gap:8px;flex-wrap:wrap">${o.sourcing ? `<a class="chip click" target="_blank" rel="noopener" href="https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(o.sourcing)}">${icon('search', 12)}1688：${esc(o.sourcing)}</a>` : ''}${(o.refs || []).slice(0, 3).map(refName).join('')}</div></div>`).join('')}</div>` : ''}
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
      body: `<div id="imp"><div class="grid g2">
        <div class="dropzone" id="dz">${icon('upload', 30)}<p><b>拖入 FastMoss 导出的 Excel / CSV</b><br><span class="small">商品搜索 → 导出，原文件直接拖进来</span></p><input type="file" id="file" accept=".xlsx,.csv,text/csv" hidden></div>
        <div class="field">或者粘贴表格（在 FastMoss 页面选中表格 → Ctrl+C）<textarea class="input" id="paste" rows="7" placeholder="商品名称	售价	7天销量	28天销量	带货达人总数 …"></textarea><button class="btn sm ghost" id="parse" data-loading="识别中…" style="align-self:flex-start">识别粘贴内容</button></div>
      </div></div>`,
      onMount(el) {
        const dz = $('#dz', el), file = $('#file', el);
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
            <label class="row mt small" style="gap:8px"><input type="checkbox" id="autoai" checked> 导入后自动生成 AI 选品报告（需要已接入大模型）</label>
            <div class="row mt" style="justify-content:flex-end"><button class="btn lg primary-glow" id="commit" data-loading="导入中…">${icon('check')}确认导入 ${pv.total} 个商品</button></div>`;
          $('#commit', el).onclick = (e) => withLoading(e.currentTarget, async () => {
            const mapping = Object.fromEntries($$('[data-f]', el).map((s) => [s.dataset.f, s.value === '' ? '' : Number(s.value)]));
            const r = await api('/products/import/commit', { method: 'POST', body: { token: pv.token, mapping } });
            const auto = $('#autoai', el).checked;
            toast(`新增 ${r.created} 个，更新 ${r.updated} 个，已完成六维评分`, 'success');
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
    const m = modal({ title: esc(p.name.length > 70 ? p.name.slice(0, 70) + '…' : p.name), wide: true, body: '<div id="pd"></div>', footer: '<div id="pf" class="row" style="width:100%"></div>' });
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
            <div class="ext-links"><a href="${esc(p.fastmossLink)}" target="_blank" rel="noopener">${icon('link', 13)}FastMoss 详情</a>${p.tiktokUrl ? `<a href="${esc(p.tiktokUrl)}" target="_blank" rel="noopener">${icon('link', 13)}TikTok 商品页</a>` : ''}${p.shopUrl ? `<a href="${esc(p.shopUrl)}" target="_blank" rel="noopener">${icon('link', 13)}店铺分析</a>` : ''}<a href="https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw1688(p))}" target="_blank" rel="noopener">${icon('search', 13)}1688 找同款</a></div>
          </div></div>
        <div class="seg pd-tabs" id="pdtabs">${[['analysis', '分析'], ['source', `1688 找货${p.sourcing?.offers?.length ? ` · ${p.sourcing.offers.length}` : ''}`], ['listing', `上架包${p.listing ? ` · ${LISTING_STATUS[p.listing.status] || ''}` : ''}`]].map(([k, t]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
        ${tab === 'source' ? sourceHTML(p) : tab === 'listing' ? listingHTML(p) : `
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
        <a class="btn primary-glow" href="#/scripts/new/${p.id}" data-close>${icon('script', 15)}生成视频脚本</a>`;
      bind();
    };

    const save = async (body) => {
      p = await api(`/products/${p.id}`, { method: 'PATCH', body });
      load();
    };
    let tmr;
    function bind() {
      $$('#pdtabs button', root).forEach((b) => (b.onclick = async () => {
        tab = b.dataset.tab;
        if (tab === 'source' && !links) links = await api(`/products/${p.id}/sourcing/links`).catch(() => ({}));
        if (tab === 'listing') erps = (await api('/connectors').catch(() => ({ items: [] }))).items.filter((c) => c.kind === 'erp' && c.enabled !== false && c.status !== 'pending');
        draw();
      }));
      bindFoot();
      if (tab === 'source') return bindSource();
      if (tab === 'listing') return bindListing();
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
          ${L.keyword ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(L.keyword)}">${icon('link', 14)}在 1688 打开</a>` : ''}${L.image ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(L.image)}">${icon('image', 14)}1688 以图搜</a>` : ''}</div>
        <p class="small muted">按商品主图以图搜 + 关键词搜，合并后按比价矩阵排序：阶梯价 30%、库存深度 20%、发货地 15%、单件重量 15%、SKU 丰富度 10%、商品状态 10%；AI 判断同款度。${ceil != null ? `这个商品要赚到目标利润，<b>采购 + 物流不能超过 ¥${Math.max(0, ceil)}</b>。` : ''}</p>
        ${L.hasApi === false ? `<div class="src-hint">${icon('sparkles', 15)}<div><b>还没接 1688 接口也能找货：</b>点上面「在 1688 打开」或「1688 以图搜」，用浏览器插件「运营台助手」在结果页一键发送货源；或者在下面手动添加。接口：<a href="#/providers" data-close style="color:var(--lime)">接入配置 → 数据源与 ERP</a>（官方 / 第三方数据接口二选一）。</div></div>` : ''}
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
