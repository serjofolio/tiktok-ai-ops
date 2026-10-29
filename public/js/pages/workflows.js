import { api, icon, esc, toast, withLoading, $, $$, empty, statusBadge, timeAgo, copy, confirmBox, fmtNum, monogram } from '../lib.js';
import { mountPlayer } from '../player.js';

const STEP_ICON = { select: 'target', script: 'script', images: 'image', video: 'video', publish: 'zap' };

export async function render(view, [runId]) {
  const [wf, { items: products }] = await Promise.all([api('/workflows'), api('/products')]);
  const runs = wf.items;
  let currentId = runId || runs[0]?.id;
  let timer = null, dispose = null;
  const favs = products.filter((p) => p.favorite);

  view.innerHTML = `<div class="split">
    <div class="col sticky">
      <div class="card card-pad col">
        <h3 style="font-size:15px">${icon('zap')} 一键工作流</h3>
        <p class="muted small" style="margin:0">选品 → AI 脚本 → 分镜生图 → 图生视频 → 发布素材包，全自动串联</p>
        <label class="field">商品<select class="input" id="pid"><option value="">AI 自动选品（评分最高且未做过的）</option>${products.map((p) => `<option value="${p.id}">${esc(p.nameCn)} · ${p.score}分</option>`).join('')}</select></label>
        <label class="field" id="catf">限定品类（自动选品时）<select class="input" id="cat"><option value="">不限</option>${[...new Set(products.map((p) => p.category))].map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
        <div class="grid g2">
          <label class="field">脚本风格<select class="input" id="style">${Object.entries(wf.styles).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
          <label class="field">时长<select class="input" id="dur"><option value="15">15 秒</option><option value="20" selected>20 秒</option><option value="30">30 秒</option></select></label>
          <label class="field">口播语言<select class="input" id="lang"><option>English</option><option>中文</option><option>Español</option><option>Bahasa Indonesia</option></select></label>
          <label class="field">分镜数量<select class="input" id="ic"><option value="0">按脚本</option><option>3</option><option>4</option><option>5</option></select></label>
        </div>
        <label class="field">画面风格<input class="input" id="istyle" placeholder="如：soft pastel, lifestyle, UGC feel"></label>
        <label class="check"><input type="checkbox" id="vid" checked>生成视频（图生视频 + 合成成片）</label>
        <button class="btn grad block lg" id="go" data-loading="启动中…">${icon('zap')}启动工作流</button>
        ${favs.length ? `<button class="btn ghost block" id="batch" data-loading="批量启动中…">${icon('layers', 16)}批量运行选品池（${favs.length} 个商品）</button>` : ''}
      </div>
      <div class="card"><div class="card-head"><h3>运行记录</h3><span class="muted small">${runs.length}</span></div><div class="col" id="hist" style="padding:8px;max-height:380px;overflow:auto;gap:2px"></div></div>
    </div>
    <div id="detail"></div>
  </div>`;

  $('#pid', view).onchange = (e) => ($('#catf', view).style.display = e.target.value ? 'none' : '');
  const opts = () => ({
    productId: $('#pid', view).value || undefined,
    category: $('#cat', view).value || undefined,
    style: $('#style', view).value,
    duration: Number($('#dur', view).value),
    language: $('#lang', view).value,
    imageCount: Number($('#ic', view).value) || undefined,
    imageStyle: $('#istyle', view).value || undefined,
    generateVideo: $('#vid', view).checked,
  });
  $('#go', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    const r = await api('/workflows', { method: 'POST', body: opts() });
    runs.unshift(r);
    select(r.id);
    toast('工作流已启动', 'success');
  });
  const batch = $('#batch', view);
  if (batch) batch.onclick = (e) => withLoading(e.currentTarget, async () => {
    const { productId, ...o } = opts();
    const r = await api('/workflows/batch', { method: 'POST', body: { productIds: favs.map((p) => p.id), options: o } });
    runs.unshift(...r.items);
    select(r.items[0].id);
    toast(`已批量启动 ${r.items.length} 个工作流`, 'success');
  });

  function renderHist() {
    $('#hist', view).innerHTML = runs.length
      ? runs.map((r) => `<div class="list-item ${r.id === currentId ? 'on' : ''}" data-id="${r.id}"><div style="flex:1;min-width:0"><b class="small" style="display:block">${esc(r.outputs?.productName || 'AI 自动选品')}</b><span class="muted small">${timeAgo(r.createdAt)}</span></div>${statusBadge(r.status)}</div>`).join('')
      : '<p class="muted small" style="padding:10px">暂无运行记录</p>';
    $$('#hist .list-item', view).forEach((el) => (el.onclick = () => select(el.dataset.id)));
  }

  function select(id) {
    currentId = id;
    if (location.hash !== `#/workflows/${id}`) history.replaceState(null, '', `#/workflows/${id}`);
    renderHist();
    load(true);
  }

  async function load(fresh) {
    clearTimeout(timer);
    const box = $('#detail', view);
    if (!currentId) return (box.innerHTML = `<div class="card">${empty('配置参数后点击「启动工作流」，AI 将自动完成从选品到成片的全部步骤', 'flow')}</div>`);
    const d = await api(`/workflows/${currentId}`).catch(() => null);
    if (!d) return (box.innerHTML = `<div class="card">${empty('工作流不存在', 'flow')}</div>`);
    const idx = runs.findIndex((r) => r.id === d.id);
    if (idx >= 0 && (runs[idx].status !== d.status || runs[idx].outputs?.productName !== d.outputs?.productName)) {
      runs[idx] = d;
      renderHist();
    }
    const sig = JSON.stringify([d.status, d.steps.map((s) => s.status + s.progress)]);
    if (fresh || box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      dispose?.();
      dispose = null;
      box.innerHTML = detailHTML(d);
      bind(box, d);
    }
    if (d.status === 'running') timer = setTimeout(() => load(false), 1200);
  }

  function bind(box, d) {
    const pl = $('#wf-player', box);
    if (pl && d.video) mountPlayer(pl, d.video).then((fn) => (dispose = fn));
    $$('[data-copy]', box).forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    const rm = $('#rm', box);
    if (rm) rm.onclick = async () => {
      if (!(await confirmBox('确定删除这条运行记录？'))) return;
      await api(`/workflows/${d.id}`, { method: 'DELETE' });
      runs.splice(runs.findIndex((r) => r.id === d.id), 1);
      currentId = runs[0]?.id;
      renderHist();
      load(true);
    };
    const rerun = $('#rerun', box);
    if (rerun) rerun.onclick = (e) => withLoading(e.currentTarget, async () => {
      const r = await api('/workflows', { method: 'POST', body: { ...d.options, productId: d.outputs?.productId || d.options.productId } });
      runs.unshift(r);
      select(r.id);
    });
  }

  renderHist();
  await load(true);
  return () => { clearTimeout(timer); dispose?.(); };
}

function detailHTML(d) {
  const p = d.product, s = d.script, kit = d.outputs?.publishKit;
  const fullKit = kit ? `${kit.caption}\n\n${kit.hashtags.join(' ')}` : '';
  return `<div class="col">
    <div class="card">
      <div class="card-head"><h3>${icon('flow')}${esc(d.name)}</h3>${statusBadge(d.status)}<div class="spacer"></div><span class="muted small">${timeAgo(d.createdAt)}</span>
        ${d.status !== 'running' ? `<button class="btn sm ghost" id="rerun">${icon('refresh', 14)}再跑一次</button><button class="icon-btn danger" id="rm" title="删除">${icon('trash', 15)}</button>` : ''}</div>
      <div class="card-pad"><div class="pipeline">${d.steps.map((st, i) => `<div class="pipe-step"><div class="pipe-node ${st.status}"><div class="n">${st.status === 'running' ? '<span class="spinner"></span>' : st.status === 'done' ? icon('check', 16) : icon(STEP_ICON[st.key], 16)}</div><b>${esc(st.name)}</b><small>${esc(st.error || st.summary || (st.progress ? `进度 ${st.progress}` : st.desc))}</small></div>${i < d.steps.length - 1 ? `<div class="pipe-arrow">${icon('arrow', 16)}</div>` : ''}</div>`).join('')}</div>
      ${d.error ? `<div class="hit mt" style="border-color:var(--err);color:var(--err)">${esc(d.error)}</div>` : ''}</div>
    </div>
    ${p ? `<div class="grid" style="grid-template-columns:minmax(0,1fr) ${d.video ? '360px' : '0'}">
      <div class="col">
        <div class="card card-pad"><div class="row" style="flex-wrap:nowrap">${monogram(p.name, 'lg')}<div style="flex:1"><b style="font-size:16px">${esc(p.nameCn)}</b><div class="p-sub">${esc(p.name)} · ${esc(p.category)} · $${p.price} · 7日销量 ${fmtNum(p.sales7d)}</div></div><span class="grade grade-${p.grade}">${p.grade}</span><b style="font-size:22px">${p.score}</b></div>
        ${p.analysis ? `<p class="text-2 small" style="margin:12px 0 0">${esc(p.analysis.summary)}</p>` : ''}</div>
        ${s ? `<div class="card"><div class="card-head"><h3>${icon('script')}${esc(s.title)}</h3><div class="spacer"></div><a class="btn sm ghost" href="#/scripts/${s.id}">打开脚本 ${icon('arrow', 14)}</a></div>
          <div class="card-pad col"><div class="hit accent"><span class="muted small">钩子</span><div style="font-weight:700">${esc(s.hook)}</div></div>
          ${s.scenes.map((sc, i) => `<div class="scene" style="grid-template-columns:64px 1fr">${d.images[i] ? `<img src="${d.images[i].url}" style="width:64px;aspect-ratio:9/16;object-fit:cover;border-radius:8px">` : `<div class="scene-n">${sc.n}</div>`}<div><div class="row"><span class="chip">${sc.n} · ${esc(sc.time || '')}</span><span class="chip">${esc(sc.shot || '')}</span></div><div class="vo">${esc(sc.voiceover)}</div><div class="meta">${esc(sc.visual)}</div></div></div>`).join('')}</div></div>` : ''}
        ${kit ? `<div class="card"><div class="card-head"><h3>${icon('zap')}发布素材包</h3><div class="spacer"></div><button class="btn sm cyan" data-copy="${esc(fullKit)}">${icon('copy', 14)}复制文案</button></div>
          <div class="card-pad col"><div class="hit"><div class="muted small">标题</div><b>${esc(kit.title)}</b></div><div class="hit"><div class="muted small">发布文案</div>${esc(kit.caption)}</div>
          <div class="tag-list">${kit.hashtags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
          <div class="grid g2"><div class="hit small"><b>⏰ 最佳发布时间</b><br>${esc(kit.bestTime)}</div><div class="hit small"><b>配乐</b><br>${esc(kit.bgm || '')}</div></div>
          <div class="hit small"><b>发布前检查</b>${kit.checklist.map((c) => `<label class="check" style="margin-top:6px"><input type="checkbox">${esc(c)}</label>`).join('')}</div></div></div>` : ''}
      </div>
      ${d.video ? `<div><div class="card card-pad sticky"><h3 style="font-size:15px;margin-bottom:12px">${icon('video')} 成片预览</h3><div id="wf-player"></div></div></div>` : ''}
    </div>` : d.status === 'running' ? '<div class="skeleton" style="height:200px"></div>' : ''}
  </div>`;
}
