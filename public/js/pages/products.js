// 智能选品：选品思路 → 导入 FastMoss 数据 → 硬指标 + 利润测算 → AI 选品分析 → 测款 → 生成视频脚本
import { api, icon, esc, fmtNum, modal, toast, withLoading, $, $$, empty, confirmBox } from '../lib.js';

const STATUS = { candidate: '候选', testing: '测款中', dropped: '已放弃' };
const VERDICT_CLS = { 推荐测款: 'v-go', 再观察: 'v-watch', 建议放弃: 'v-drop', 数据不足: 'v-na' };
const verdict = (v) => `<span class="verdict ${VERDICT_CLS[v] || 'v-na'}">${esc(v || '未评估')}</span>`;
const pct = (v) => (v == null ? '<span class="muted">—</span>' : `<span class="${v >= 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}%</span>`);
const num = (v) => (v == null ? '<span class="muted">—</span>' : fmtNum(v));
const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

const STEPS = [
  ['找潜力趋势', '定一个站点、一个细分类目和价格带。看近 7/28 天销量是否在涨、排名是否上升，持续增长比一次性爆发更可信。', '趋'],
  ['数据工具筛选', '在 FastMoss 按国家、类目、价格、时间筛出 10–20 个候选：近期有销量、多个达人在带、不止一家店在卖、近期有带货视频。', '筛'],
  ['竞品分析', '看销量是否集中在一家店或一个达人；对比价格、主图、套装、评价；读差评找改进点，找到差异化切入点。', '竞'],
  ['判断能否卖', '扣除采购、物流、平台佣金、达人佣金、广告、退货后净利率 ≥ 20%；需求下滑、差评集中、物流难、政策风险高的直接淘汰。', '判'],
  ['生成测试方案', '少量备货，寄样一批相关达人，同时自营多条不同角度视频；上线前定好预算、成功标准和止损线，每次只测 1–2 个品。', '测'],
  ['带货视频脚本', '拆对标视频的钩子 → 痛点 → 演示 → 证明 → 行动号召，前 3 秒决定完播；一键生成后直接开拍。', '拍'],
];
const CRITERIA = [['销量', '在增长'], ['利润', '要够'], ['卖点', '能拍出来'], ['对标视频', '足够多'], ['自己', '也想买']];

export async function render(view, [openId]) {
  const state = { q: '', status: '', sort: 'growth' };
  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">智能选品 · FastMoss 数据驱动</div>
    <h2>选<em>能卖</em>的品，<br>不选看起来火的品</h2>
    <p>导入 FastMoss 的真实数据，系统按硬指标逐项检查、算清每件利润，再由 AI 解释为什么选、怎么测款。选定的品一键生成带货视频脚本。</p>
    <div class="actions">
      <button class="btn lg primary-glow" id="import">${icon('upload')}导入 FastMoss 数据</button>
      <button class="btn ghost lg" id="add">${icon('plus')}手动添加</button>
      <a class="btn ghost lg" href="https://www.fastmoss.com/zh/e-commerce/search" target="_blank" rel="noopener">${icon('link')}打开 FastMoss</a>
    </div>
  </section>

  <section data-reveal>
    <div class="section-title" style="margin-top:0"><h3>选品思路</h3><span class="muted small">每个商品都按这套流程检查，结论会写在商品详情里</span></div>
    <div class="steps">${STEPS.map(([t, d, b]) => `<div class="step"><b>${t}</b><p>${d}</p><span class="big">${b}</span></div>`).join('')}</div>
    <div class="criteria">${CRITERIA.map(([a, b]) => `<span><b>${a}</b>${b}</span>`).join('')}<span><b>饱和信号</b>同款泛滥、价格战、所有视频同一个钩子、头部垄断</span></div>
  </section>

  <section class="terrain terrain-card" id="terrain"><div class="copy"><h2>市场地形</h2><p>亮色方块是选品库里的商品，高度代表通过的硬指标数量，骨白色为推荐测款。点击方块查看详情。</p></div></section>

  <section data-reveal>
    <div class="section-title"><h3>选品库</h3><span class="muted small" id="summary"></span><div class="spacer"></div><button class="btn sm ghost" id="assume">${icon('settings', 14)}利润测算参数</button></div>
    <div class="toolbar">
      <div class="input-icon">${icon('search', 16)}<input class="input" id="q" placeholder="搜索商品、类目、店铺"></div>
      <div class="seg" id="tabs"><button data-s="" class="on">全部</button><button data-s="go">推荐测款</button><button data-s="candidate">候选</button><button data-s="testing">测款中</button><button data-s="dropped">已放弃</button></div>
      <select class="input" id="sort" style="width:150px"><option value="growth">销量增长最快</option><option value="sales">销量最高</option><option value="margin">净利率最高</option><option value="videos">对标视频最多</option><option value="pass">指标通过最多</option><option value="recent">最近导入</option></select>
    </div>
    <div id="list"></div>
  </section>`;

  let all = [];
  let assumptions = {};
  // 商品多时分批渲染，避免一次画几千行卡顿
  const PAGE = 100;
  let shown = PAGE;
  async function load() {
    const d = await api(`/products?${new URLSearchParams({ q: state.q, sort: state.sort, status: ['candidate', 'testing', 'dropped'].includes(state.status) ? state.status : '' })}`);
    assumptions = d.assumptions;
    all = d.items;
    const matched = state.status === 'go' ? all.filter((p) => p.evaluation.verdict === '推荐测款') : all;
    const items = matched.slice(0, shown);
    $('#summary', view).textContent = `${all.length} 个商品 · 推荐测款 ${all.filter((p) => p.evaluation.verdict === '推荐测款').length} · 测款中 ${all.filter((p) => p.status === 'testing').length}`;
    const box = $('#list', view);
    if (!all.length && !state.q && !state.status) return (box.innerHTML = onboarding());
    if (!items.length) return (box.innerHTML = `<div class="card">${empty('没有符合条件的商品', 'search')}</div>`);
    const more = matched.length > items.length ? `<div class="row mt" style="justify-content:center"><button class="btn ghost" id="more">显示更多（还有 ${matched.length - items.length} 个）</button></div>` : '';
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>商品</th><th class="r">售价</th><th class="r">7 天销量</th><th class="r">环比</th><th class="r">视频 / 达人</th><th class="r">净利率</th><th>硬指标</th><th>结论</th><th></th></tr></thead><tbody>
      ${items.map((p) => `<tr class="prow" data-id="${p.id}">
        <td><b>${esc(p.name)}</b><div class="p-sub">${esc([p.category, p.shop, p.status && p.status !== 'candidate' ? STATUS[p.status] : ''].filter(Boolean).join(' · ') || '—')}</div></td>
        <td class="r money">${money(p.price)}</td><td class="r">${num(p.sales7d ?? p.salesTotal)}</td><td class="r">${pct(p.growth)}</td>
        <td class="r">${num(p.videoCount)} / ${num(p.creatorCount)}</td>
        <td class="r">${p.evaluation.profit ? `<span class="${p.evaluation.profit.margin >= assumptions.targetMargin ? 'up' : 'down'}">${p.evaluation.profit.margin}%</span>` : '<span class="muted small">待填成本</span>'}</td>
        <td><span class="dots">${p.evaluation.checks.map((c) => `<i class="${c.status}" title="${esc(c.title)}"></i>`).join('')}</span></td>
        <td>${verdict(p.evaluation.verdict)}</td>
        <td><a class="icon-btn" href="${esc(p.fastmossLink)}" target="_blank" rel="noopener" title="在 FastMoss 查看" data-stop>${icon('link', 14)}</a></td></tr>`).join('')}</tbody></table></div>${more}`;
    const mb = box.querySelector('#more');
    if (mb) mb.onclick = () => { shown += PAGE; load(); };
    $$('.prow', box).forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('[data-stop]') && openDetail(tr.dataset.id)));
  }

  function onboarding() {
    return `<div class="card card-pad onboard">
      <h3>从 FastMoss 导入第一批候选品</h3>
      <ol>
        <li>在 Chrome 里打开 FastMoss → <b>商品搜索</b>或<b>商品榜单</b>，按国家、类目、价格带、近 7 天筛选；</li>
        <li>点击列表右上角的<b>导出</b>，得到 Excel 文件（或直接选中表格内容 Ctrl+C 复制）；</li>
        <li>点「导入 FastMoss 数据」，拖入文件或粘贴，确认列对应关系即可。</li>
      </ol>
      <p class="muted small">建议导出时带上：商品名称、商品 ID/链接、售价、近 7 天销量、销量增长率、带货达人数、带货视频数、佣金率、类目、店铺。FastMoss 接口审批通过后，可在「接入配置」填写，改为自动拉取。</p>
      <button class="btn" id="import2">${icon('upload', 15)}导入 FastMoss 数据</button></div>`;
  }

  // ---------- 导入 ----------
  function importDialog() {
    const m = modal({
      title: '导入 FastMoss 数据', wide: true,
      body: `<div id="imp"><div class="grid g2">
        <div class="dropzone" id="dz">${icon('upload', 30)}<p><b>拖入 FastMoss 导出的 Excel / CSV</b><br><span class="small">支持 .xlsx .csv，点击选择文件</span></p><input type="file" id="file" accept=".xlsx,.csv,text/csv" hidden></div>
        <div class="field">或者粘贴表格（在 FastMoss 页面选中表格 → Ctrl+C）<textarea class="input" id="paste" rows="7" placeholder="商品名称	售价	近7天销量	销量增长率	带货达人数	带货视频数 …"></textarea><button class="btn sm ghost" id="parse" data-loading="识别中…" style="align-self:flex-start">识别粘贴内容</button></div>
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
          $('#imp', el).innerHTML = `<p style="margin-top:0">读到 <b>${pv.total}</b> 行。系统已自动识别列，请确认对应关系（<b>商品名称</b>必选，其余缺失的指标在详情里会提示补充）。</p>
            <div class="map-grid">${Object.entries(pv.fields).map(([k, label]) => `<label class="field">${esc(label)}${k === 'name' ? ' *' : ''}<select class="input" data-f="${k}">${opts(pv.mapping[k])}</select></label>`).join('')}</div>
            <div class="section-title"><h3 style="font-size:14px">前 ${pv.sample.length} 行预览</h3></div>
            <div class="table-wrap"><table><thead><tr>${pv.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${pv.sample.map((r) => `<tr>${pv.headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
            <div class="row mt" style="justify-content:flex-end"><button class="btn lg primary-glow" id="commit" data-loading="导入中…">${icon('check')}确认导入 ${pv.total} 个商品</button></div>`;
          $('#commit', el).onclick = (e) => withLoading(e.currentTarget, async () => {
            const mapping = Object.fromEntries($$('[data-f]', el).map((s) => [s.dataset.f, s.value === '' ? '' : Number(s.value)]));
            const r = await api('/products/import/commit', { method: 'POST', body: { token: pv.token, mapping } });
            toast(`新增 ${r.created} 个，更新 ${r.updated} 个`, 'success');
            m.close();
            await load();
            remountTerrain();
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
        ${f('category', '类目')}${f('price', '售价 $', '15.99', 'number')}${f('sales7d', '近 7 天销量', '', 'number')}${f('growth', '销量环比 %', '', 'number')}${f('videoCount', '带货视频数', '', 'number')}${f('creatorCount', '带货达人数', '', 'number')}${f('commissionRate', '佣金率 %', '', 'number')}${f('shop', '店铺')}${f('rating', '评分', '', 'number')}</form>`,
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

  // ---------- 利润参数 ----------
  function assumeDialog() {
    const a = assumptions;
    const f = (k, l, tip) => `<label class="field">${l}<input class="input" name="${k}" type="number" step="0.5" value="${a[k]}"><span class="small muted">${tip}</span></label>`;
    modal({
      title: '利润测算参数',
      body: `<form class="grid g2" id="af">${f('platformFeeRate', '平台佣金 %', 'TikTok Shop 按类目收取')}${f('creatorRate', '默认达人佣金 %', '商品数据有佣金率时以商品为准')}${f('returnRate', '退货/售后预留 %', '')}${f('adRate', '广告/样品预留 %', '')}${f('targetMargin', '净利率达标线 %', '低于这个值利润检查不通过')}</form>`,
      footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="ok">保存并重算</button>`,
      onMount(el, close) {
        $('#ok', el).onclick = (e) => withLoading(e.currentTarget, async () => {
          await api('/selection', { method: 'PUT', body: Object.fromEntries(new FormData($('#af', el))) });
          close();
          load();
          toast('已按新参数重新测算', 'success');
        });
      },
    });
  }

  // ---------- 商品详情 ----------
  async function openDetail(id) {
    let p = await api(`/products/${id}`);
    const kw = () => p.analysis?.sourcing?.match(/[「“"]([^」”"]{2,30})[」”"]/)?.[1] || p.name;
    const m = modal({ title: esc(p.name), wide: true, body: '<div id="pd"></div>', footer: '<div id="pf" class="row" style="width:100%"></div>' });
    const root = $('#pd', m.el), foot = $('#pf', m.el);

    const draw = () => {
      const ev = p.evaluation, pr = ev.profit, a = p.analysis, j = p.judgement || {};
      root.innerHTML = `
        <div class="row" style="margin-bottom:14px">${verdict(ev.verdict)}<span class="muted small">通过 ${ev.score.pass}/${ev.score.total} 项${ev.score.unknown ? `，${ev.score.unknown} 项待补充` : ''}</span><div class="spacer"></div>
          <div class="ext-links"><a href="${esc(p.fastmossLink)}" target="_blank" rel="noopener">${icon('link', 13)}FastMoss</a>${p.tiktokUrl ? `<a href="${esc(p.tiktokUrl)}" target="_blank" rel="noopener">${icon('link', 13)}TikTok 商品</a>` : ''}<a href="https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw())}" target="_blank" rel="noopener">${icon('search', 13)}1688 找货源</a></div></div>
        <div class="drawer-grid">
          <div class="col">
            <div class="hit"><dl class="kv">
              <dt>类目</dt><dd>${esc(p.category || '—')}</dd><dt>店铺</dt><dd>${esc(p.shop || '—')}${p.shopCount != null ? ` · ${p.shopCount} 家在售` : ''}</dd>
              <dt>售价</dt><dd class="money">${money(p.price)}</dd><dt>近 7 天销量</dt><dd>${num(p.sales7d)}（环比 ${pct(p.growth)}）</dd>
              <dt>近 28 天</dt><dd>${num(p.sales28d)}</dd><dt>销售额</dt><dd>${p.gmv != null ? '$' + fmtNum(p.gmv) : '—'}</dd>
              <dt>视频/达人</dt><dd>${num(p.videoCount)} 条 / ${num(p.creatorCount)} 位${p.liveCount != null ? ` / 直播 ${num(p.liveCount)}` : ''}</dd>
              <dt>佣金率</dt><dd>${p.commissionRate != null ? p.commissionRate + '%' : '—'}</dd><dt>评分</dt><dd>${p.rating ?? '—'}${p.reviews != null ? `（${fmtNum(p.reviews)} 评价）` : ''}</dd>
              <dt>数据时间</dt><dd class="small muted">${esc((p.dataAt || p.createdAt || '').slice(0, 10))} · ${p.source === 'fastmoss' ? 'FastMoss 导入' : '手动录入'}</dd></dl></div>
            <div class="hit"><b>利润测算</b><div class="grid g2" style="margin-top:10px">
              <label class="field">采购价 $（1688）<input class="input" id="cost" type="number" step="0.01" value="${p.cost ?? ''}" placeholder="例如 3.20"></label>
              <label class="field">物流 $（头程+尾程/件）<input class="input" id="ship" type="number" step="0.01" value="${p.shipping ?? ''}" placeholder="例如 2.50"></label></div>
              ${pr ? `<table class="profit-table"><tbody>
                <tr><td>售价</td><td class="r money">$${pr.price.toFixed(2)}</td></tr>
                <tr><td class="muted">− 平台佣金 ${ev.assumptions.platformFeeRate}%</td><td class="r money">$${pr.platformFee.toFixed(2)}</td></tr>
                <tr><td class="muted">− 达人佣金 ${pr.commission}%</td><td class="r money">$${pr.creatorFee.toFixed(2)}</td></tr>
                <tr><td class="muted">− 退货预留 ${ev.assumptions.returnRate}% / 广告预留 ${ev.assumptions.adRate}%</td><td class="r money">$${(pr.returnReserve + pr.adReserve).toFixed(2)}</td></tr>
                <tr><td class="muted">− 采购 + 物流</td><td class="r money">$${(pr.cost + pr.shipping).toFixed(2)}</td></tr>
                <tr class="total"><td>单件净利 · 净利率</td><td class="r money ${pr.margin >= ev.assumptions.targetMargin ? 'up' : 'down'}">$${pr.unitProfit.toFixed(2)} · ${pr.margin}%</td></tr></tbody></table>` : '<p class="small muted" style="margin:10px 0 0">填入采购价和物流成本后自动计算净利。</p>'}
            </div>
            <div class="hit"><b>人工判断</b>
              <div class="judge"><span>卖点能在 3 秒内拍出来？</span><div class="seg" data-j="visual"><button data-v="true" class="${j.visual === true ? 'on' : ''}">能</button><button data-v="false" class="${j.visual === false ? 'on' : ''}">不能</button></div></div>
              <div class="judge"><span>自己看到也想买？</span><div class="seg" data-j="wantBuy"><button data-v="true" class="${j.wantBuy === true ? 'on' : ''}">想</button><button data-v="false" class="${j.wantBuy === false ? 'on' : ''}">不想</button></div></div>
              <textarea class="input" id="notes" rows="2" placeholder="备注：看了对标视频的感受、差评要点、供应商信息…">${esc(j.notes || '')}</textarea></div>
          </div>
          <div class="col">
            <div class="check-list">${ev.checks.map((c) => `<div class="ck ${c.status}"><i>${{ pass: '✓', warn: '!', fail: '✕', unknown: '?' }[c.status]}</i><div><b>${esc(c.title)}</b><span>${esc(c.detail)}</span></div></div>`).join('')}</div>
            <div class="hit"><div class="row"><b>AI 选品分析</b><span class="muted small">${p.analyzedAt ? '更新于 ' + esc(p.analyzedAt.slice(0, 10)) : ''}</span><div class="spacer"></div><button class="btn sm" id="ai" data-loading="分析中…">${icon('sparkles', 14)}${a ? '重新分析' : '生成分析'}</button></div>
              ${a ? analysisHTML(a) : '<p class="small muted" style="margin:8px 0 0">AI 会结合上面的数据和知识库里的选品方法，说明为什么选这个品、目标人群、卖点怎么拍、竞品切入点、风险，以及具体的测款方案。</p>'}</div>
          </div>
        </div>`;
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
      const deb = () => { clearTimeout(tmr); tmr = setTimeout(async () => { await save({ cost: $('#cost', root).value, shipping: $('#ship', root).value }); draw(); }, 600); };
      $('#cost', root).oninput = deb;
      $('#ship', root).oninput = deb;
      $$('[data-j]', root).forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = async () => { await save({ judgement: { [seg.dataset.j]: b.dataset.v === 'true' } }); draw(); })));
      $('#notes', root).onchange = (e) => save({ judgement: { notes: e.target.value } });
      $('#ai', root).onclick = (e) => withLoading(e.currentTarget, async () => {
        await api(`/products/${p.id}/analyze`, { method: 'POST' });
        p = await api(`/products/${p.id}`);
        draw();
        toast('分析完成', 'success');
      });
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
    const items = all.map((p) => ({ id: p.id, nameCn: p.name, score: Math.round((p.evaluation.score.pass / p.evaluation.score.total) * 100), grade: p.evaluation.verdict === '推荐测款' ? 'S' : p.evaluation.score.pass >= 3 ? 'A' : 'B', category: p.category || '' }));
    import('../fx/terrain.js').then(({ mountTerrain }) => { if (view.isConnected) disposeTerrain = mountTerrain(view.querySelector('#terrain'), { items, onPick: openDetail }); }).catch((e) => console.warn('[fx] 市场地形未加载：', e.message));
  }

  let t;
  $('#q', view).oninput = (e) => { clearTimeout(t); t = setTimeout(() => ((state.q = e.target.value), (shown = PAGE), load()), 250); };
  $$('#tabs button', view).forEach((b) => (b.onclick = () => { state.status = b.dataset.s; $$('#tabs button', view).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#sort', view).onchange = (e) => ((state.sort = e.target.value), (shown = PAGE), load());
  $('#import', view).onclick = importDialog;
  $('#add', view).onclick = addDialog;
  $('#assume', view).onclick = assumeDialog;
  view.addEventListener('click', (e) => e.target.closest('#import2') && importDialog());

  await load();
  remountTerrain();
  if (openId) openDetail(openId);
  return () => disposeTerrain?.();
}

function analysisHTML(a) {
  const list = (arr) => `<ul>${(arr || []).map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>`;
  const tp = a.testPlan || {};
  return `<div class="analysis">
    <div class="row">${verdict(a.verdict)}</div>
    <h4>为什么选</h4>${list(a.why)}
    <h4>目标人群</h4><p>${esc(a.audience || '—')}</p>
    <h4>卖点与拍法</h4><ul>${(a.sellingPoints || []).map((s) => `<li><b>${esc(s.point)}</b> — ${esc(s.howToShow)}</li>`).join('')}</ul>
    <h4>竞品与切入点</h4><p>${esc(a.competitors || '—')}</p>
    <h4>风险</h4>${list(a.risks)}
    <h4>1688 找货</h4><p>${esc(a.sourcing || '—')}</p>
    <h4>测款方案</h4><dl class="kv"><dt>备货</dt><dd>${esc(tp.inventory || '—')}</dd><dt>达人</dt><dd>${esc(tp.creators || '—')}</dd><dt>自营视频</dt><dd>${esc(tp.videos || '—')}</dd><dt>预算</dt><dd>${esc(tp.budget || '—')}</dd><dt>成功标准</dt><dd>${esc(tp.successMetrics || '—')}</dd><dt>止损线</dt><dd>${esc(tp.stopLoss || '—')}</dd></dl>
    <h4>对标视频角度</h4>${list(a.benchmarkAngles)}
  </div>`;
}
