import { api, icon, esc, fmtNum, sparkline, modal, toast, withLoading, $, $$, empty, confirmBox, monogram } from '../lib.js';

const state = { q: '', category: '', sort: 'score', favorite: false, view: 'grid' };
const SORTS = [['score', '综合评分'], ['growth', '增长最快'], ['sales', '销量最高'], ['margin', '毛利最高'], ['competition', '竞争最低']];

export async function render(view, [openId]) {
  view.innerHTML = `
  <div class="toolbar">
    <div class="input-icon">${icon('search', 16)}<input class="input" id="q" placeholder="搜索商品名称 / 品类…" value="${esc(state.q)}"></div>
    <select class="input" id="cat" style="width:150px"><option value="">全部品类</option></select>
    <div class="seg" id="sort">${SORTS.map(([k, t]) => `<button data-k="${k}" class="${state.sort === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <button class="btn sm ghost ${state.favorite ? 'on' : ''}" id="fav">${icon('star', 15)}<span>${state.favorite ? '仅看选品池' : '选品池'}</span></button>
    <div class="spacer"></div>
    <div class="seg" id="vmode"><button data-v="grid" class="${state.view === 'grid' ? 'on' : ''}">卡片</button><button data-v="table" class="${state.view === 'table' ? 'on' : ''}">表格</button></div>
    <button class="btn sm ghost" id="import">${icon('upload', 15)}导入 CSV</button>
    <button class="btn sm" id="add">${icon('plus', 15)}添加商品</button>
  </div>
  <div class="muted small mb" id="summary"></div>
  <div id="list"></div>`;

  let categories = [];
  async function load() {
    const qs = new URLSearchParams({ q: state.q, category: state.category, sort: state.sort, favorite: state.favorite });
    const d = await api(`/products?${qs}`);
    categories = d.categories;
    const cat = $('#cat', view);
    if (cat.options.length <= 1) cat.innerHTML += categories.map((c) => `<option ${c === state.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#summary', view).innerHTML = `共 <b>${d.items.length}</b> 个商品 · S 级 ${d.items.filter((p) => p.grade === 'S').length} · A 级 ${d.items.filter((p) => p.grade === 'A').length} · 评分模型：增长 30% + 销量 20% + 毛利 20% + 竞争 15% + 口碑 10% + 内容潜力 5%`;
    const list = $('#list', view);
    if (!d.items.length) return (list.innerHTML = empty('没有找到符合条件的商品', 'search'));
    list.innerHTML = state.view === 'grid' ? grid(d.items) : table(d.items);
    $$('[data-id]', list).forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target.closest('.fav')) return;
        openDetail(el.dataset.id, load);
      }),
    );
    $$('.fav', list).forEach((b) =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const on = !b.classList.contains('on');
        await api(`/products/${b.dataset.fav}`, { method: 'PATCH', body: { favorite: on } });
        b.classList.toggle('on', on);
        toast(on ? '已加入选品池' : '已移出选品池', 'success');
      }),
    );
  }

  let t;
  $('#q', view).oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => ((state.q = e.target.value), load()), 250);
  };
  $('#cat', view).onchange = (e) => ((state.category = e.target.value), load());
  $$('#sort button', view).forEach((b) => (b.onclick = () => { state.sort = b.dataset.k; $$('#sort button', view).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $$('#vmode button', view).forEach((b) => (b.onclick = () => { state.view = b.dataset.v; $$('#vmode button', view).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#fav', view).onclick = (e) => {
    state.favorite = !state.favorite;
    e.currentTarget.classList.toggle('on', state.favorite);
    e.currentTarget.querySelector('span').textContent = state.favorite ? '仅看选品池' : '选品池';
    load();
  };
  $('#import', view).onclick = () => importDialog(load);
  $('#add', view).onclick = () => addDialog(categories, load);
  await load();
  if (openId) openDetail(openId, load);
}

function growth(p) {
  return `<span class="${p.salesGrowth >= 0 ? 'up' : 'down'}">${p.salesGrowth >= 0 ? '▲' : '▼'}${Math.abs(p.salesGrowth)}%</span>`;
}

function grid(items) {
  return `<div class="product-grid">${items.map((p) => `
    <div class="product" data-id="${p.id}">
      <button class="icon-btn fav ${p.favorite ? 'on' : ''}" data-fav="${p.id}" title="加入选品池">${icon('star', 16)}</button>
      <div class="product-top">${monogram(p.name)}<div style="min-width:0;padding-right:30px"><div class="p-name">${esc(p.nameCn)}</div><div class="p-sub">${esc(p.name)}</div><div class="row" style="margin-top:6px;gap:6px"><span class="chip">${esc(p.category)}</span><span class="chip">${p.market}</span></div></div></div>
      <div class="p-metrics"><div><small>售价</small><b>$${p.price}</b></div><div><small>7日销量</small><b>${fmtNum(p.sales7d)}</b></div><div><small>环比</small><b>${growth(p)}</b></div><div><small>毛利率</small><b>${p.margin}%</b></div><div><small>竞争度</small><b>${p.competition}</b></div><div><small>评分</small><b>${p.rating}</b></div></div>
      ${sparkline(p.trend, { w: 240, h: 34 })}
      <div class="row" style="flex-wrap:nowrap"><span class="grade grade-${p.grade}">${p.grade}</span><div class="score-bar" style="flex:1"><i style="width:${p.score}%"></i></div><b>${p.score}</b></div>
    </div>`).join('')}</div>`;
}

function table(items) {
  return `<div class="card table-wrap"><table><thead><tr><th></th><th>商品</th><th>品类</th><th>售价</th><th>成本</th><th>毛利率</th><th>7日销量</th><th>增长</th><th>视频数</th><th>达人数</th><th>竞争度</th><th>评分</th></tr></thead><tbody>
  ${items.map((p) => `<tr data-id="${p.id}" style="cursor:pointer"><td><button class="icon-btn fav ${p.favorite ? 'on' : ''}" data-fav="${p.id}" style="position:static">${icon('star', 15)}</button></td>
  <td><div class="row" style="flex-wrap:nowrap">${monogram(p.name, 'sm')}<div><b>${esc(p.nameCn)}</b><div class="p-sub">${esc(p.name)}</div></div></div></td><td>${esc(p.category)}</td><td>$${p.price}</td><td>$${p.cost}</td><td>${p.margin}%</td><td>${fmtNum(p.sales7d)}</td><td>${growth(p)}</td><td>${fmtNum(p.videoCount)}</td><td>${fmtNum(p.creatorCount)}</td><td>${p.competition}</td>
  <td><div class="row" style="flex-wrap:nowrap"><span class="grade grade-${p.grade}">${p.grade}</span><b>${p.score}</b></div></td></tr>`).join('')}</tbody></table></div>`;
}

function analysisHTML(a) {
  if (!a) return `<div class="empty" style="padding:24px">${icon('sparkles', 32)}<p>点击「AI 选品分析」获取卖点、人群、内容角度与风险评估</p></div>`;
  const list = (arr) => `<ul style="margin:4px 0;padding-left:18px">${(arr || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `<div class="col">
    <div class="row"><span class="badge ${a.verdict === '强烈推荐' ? 'badge-ok' : a.verdict === '推荐测款' ? 'badge-run' : 'badge-muted'}" style="font-size:13px;padding:4px 12px">${esc(a.verdict)}</span></div>
    <p style="margin:0">${esc(a.summary)}</p>
    <div class="grid g2"><div class="hit"><b>核心卖点</b>${list(a.sellingPoints)}</div><div class="hit"><b>内容角度</b>${list(a.contentAngles)}</div>
    <div class="hit"><b>风险提示</b>${list(a.risks)}</div><div class="hit"><b>行动建议</b>${list(a.actions)}</div></div>
    <div class="hit"><b>目标人群：</b>${esc(a.audience)}<br><b>定价建议：</b>${esc(a.pricing)}</div></div>`;
}

async function openDetail(id, reload) {
  const p = await api(`/products/${id}`);
  const parts = [['增长趋势', p.scoreParts.growth, 30], ['销量基础', p.scoreParts.sales, 20], ['利润空间', p.scoreParts.margin, 20], ['竞争程度', p.scoreParts.competition, 15], ['用户口碑', p.scoreParts.rating, 10], ['内容潜力', p.scoreParts.content, 5]];
  modal({
    title: esc(p.nameCn),
    wide: true,
    body: `<div class="grid" style="grid-template-columns:300px minmax(0,1fr)">
      <div class="col">
        <div class="hit"><div class="muted small">${esc(p.name)}</div><div class="row mt" style="margin-top:10px"><span class="grade grade-${p.grade}" style="width:44px;height:44px;font-size:20px">${p.grade}</span><div><b style="font-size:28px">${p.score}</b><span class="muted"> / 100 综合评分</span></div></div></div>
        <div class="hit bars">${parts.map(([t, v, w]) => `<div class="bar-row"><span>${t}</span><div class="track"><i style="width:${v * 100}%"></i></div><span class="muted">${Math.round(v * w)}/${w}</span></div>`).join('')}</div>
        <dl class="kv hit"><dt>售价</dt><dd>$${p.price}</dd><dt>成本</dt><dd>$${p.cost}（含头程）</dd><dt>佣金</dt><dd>${p.commissionRate}%</dd><dt>毛利率</dt><dd>${p.margin}%</dd><dt>7日销量</dt><dd>${fmtNum(p.sales7d)}（${p.salesGrowth}%）</dd><dt>7日GMV</dt><dd>$${fmtNum(p.gmv7d)}</dd><dt>视频/达人</dt><dd>${fmtNum(p.videoCount)} / ${fmtNum(p.creatorCount)}</dd><dt>评分</dt><dd>${p.rating}（${fmtNum(p.reviews)} 评价）</dd></dl>
        <div class="hit">${sparkline(p.trend, { w: 260, h: 60 })}<div class="muted small">近 14 日销量趋势</div></div>
      </div>
      <div class="col"><div class="row"><h3 style="font-size:15px">AI 选品分析</h3><div class="spacer"></div><button class="btn sm cyan" id="an" data-loading="分析中…">${icon('sparkles', 15)}${p.analysis ? '重新分析' : 'AI 选品分析'}</button></div><div id="an-box">${analysisHTML(p.analysis)}</div></div>
    </div>`,
    footer: `${p.source !== 'demo' ? `<button class="btn ghost danger" id="del">${icon('trash', 15)}删除</button><div class="spacer"></div>` : ''}<a class="btn ghost" href="#/scripts/new/${p.id}" data-close>${icon('script', 15)}写脚本</a><button class="btn grad" id="wf" data-loading="启动中…">${icon('zap', 15)}一键生成视频</button>`,
    onMount(el, close) {
      $('#an', el).onclick = (e) => withLoading(e.currentTarget, async () => {
        const a = await api(`/products/${p.id}/analyze`, { method: 'POST' });
        $('#an-box', el).innerHTML = analysisHTML(a);
        toast('分析完成', 'success');
      });
      $('#wf', el).onclick = (e) => withLoading(e.currentTarget, async () => {
        const r = await api('/workflows', { method: 'POST', body: { productId: p.id } });
        close();
        location.hash = `#/workflows/${r.id}`;
      });
      const del = $('#del', el);
      if (del) del.onclick = async () => {
        if (!(await confirmBox(`确定删除商品「${p.nameCn}」？`))) return;
        await api(`/products/${p.id}`, { method: 'DELETE' });
        close();
        reload();
      };
    },
  });
}

function importDialog(reload) {
  const sample = 'name,nameCn,category,price,cost,commissionRate,sales7d,salesGrowth,videoCount,creatorCount,rating,reviews,competition,market\nMini Desk Fan,迷你桌面风扇,3C数码,15.99,4.5,15,5200,86,1200,240,4.6,3100,38,US';
  modal({
    title: '导入商品数据（CSV）',
    body: `<div class="col"><p class="muted small" style="margin:0">支持从 TikTok Shop 后台、FastMoss、Kalodata 等数据工具导出后整理为以下表头：</p>
      <div class="code">${esc(sample)}</div>
      <div class="dropzone" id="dz">${icon('upload', 28)}<p>点击或拖拽 CSV 文件到这里</p><input type="file" accept=".csv,text/csv" hidden id="file"></div>
      <label class="field">或直接粘贴 CSV 内容<textarea class="input" id="csv" rows="5" placeholder="${esc(sample.split('\n')[0])}"></textarea></label></div>`,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="go" data-loading="导入中…">导入</button>`,
    onMount(el, close) {
      const dz = $('#dz', el), file = $('#file', el);
      dz.onclick = () => file.click();
      dz.ondragover = (e) => (e.preventDefault(), dz.classList.add('drag'));
      dz.ondragleave = () => dz.classList.remove('drag');
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); readFile(e.dataTransfer.files[0]); };
      file.onchange = () => readFile(file.files[0]);
      function readFile(f) {
        if (!f) return;
        const r = new FileReader();
        r.onload = () => { $('#csv', el).value = r.result; dz.querySelector('p').textContent = `已读取：${f.name}`; };
        r.readAsText(f);
      }
      $('#go', el).onclick = (e) => withLoading(e.currentTarget, async () => {
        const r = await api('/products/import', { method: 'POST', body: { csv: $('#csv', el).value } });
        toast(`成功导入 ${r.imported} 个商品`, 'success');
        close();
        reload();
      });
    },
  });
}

function addDialog(categories, reload) {
  const f = (k, label, type = 'text', ph = '') => `<label class="field">${label}<input class="input" name="${k}" type="${type}" step="any" placeholder="${ph}"></label>`;
  modal({
    title: '添加商品',
    body: `<form class="grid g2" id="pf">${f('name', '英文名称 *', 'text', 'Mini Desk Fan')}${f('nameCn', '中文名称', 'text', '迷你桌面风扇')}
      <label class="field">品类<select class="input" name="category">${categories.map((c) => `<option>${esc(c)}</option>`).join('')}<option>其他</option></select></label>
      ${f('price', '售价 $', 'number')}${f('cost', '成本 $（含物流）', 'number')}${f('commissionRate', '达人佣金 %', 'number')}${f('sales7d', '7 日销量', 'number')}
      ${f('salesGrowth', '销量环比 %', 'number')}${f('competition', '竞争度 0-100', 'number')}${f('rating', '评分', 'number', '4.6')}${f('reviews', '评价数', 'number')}</form>`,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="save">保存</button>`,
    onMount(el, close) {
      $('#save', el).onclick = (e) => withLoading(e.currentTarget, async () => {
        const body = Object.fromEntries(new FormData($('#pf', el)));
        if (!body.nameCn) body.nameCn = body.name;
        await api('/products', { method: 'POST', body });
        toast('商品已添加', 'success');
        close();
        reload();
      });
    },
  });
}
