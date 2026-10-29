import { api, icon, esc, toast, withLoading, $, $$, md, modal, confirmBox, timeAgo, empty, statusBadge, fmtNum, monogram } from '../lib.js';

export async function render(view, [kbId]) {
  let { items: kbs } = await api('/kbs');
  let kb = kbs.find((k) => k.id === kbId) || kbs[0];
  let tab = 'docs';

  view.innerHTML = `<div class="split" style="grid-template-columns:300px minmax(0,1fr)">
    <div class="card sticky"><div class="card-head"><h3>${icon('book')}知识库</h3><div class="spacer"></div><button class="btn sm" id="new-kb">${icon('plus', 14)}新建</button></div><div id="kbs" style="padding:8px"></div>
      <div class="card-pad small muted" style="border-top:1px solid var(--line)">支持 PDF、Word（docx）、Markdown、TXT、CSV、HTML、JSON。文档自动切片并建立 BM25 中文索引；配置 Embedding 模型后启用向量 + 关键词混合检索。</div></div>
    <div class="col"><div class="seg" id="tabs" style="align-self:flex-start"><button data-t="docs" class="on">文档管理</button><button data-t="ask">知识问答</button><button data-t="search">检索测试</button></div><div id="pane"></div></div>
  </div>`;

  function renderKbs() {
    $('#kbs', view).innerHTML = kbs.length
      ? kbs.map((k) => `<div class="list-item ${k.id === kb?.id ? 'on' : ''}" data-id="${k.id}">${monogram(k.name, 'sm')}<div style="flex:1;min-width:0"><b>${esc(k.name)}</b><div class="muted small">${k.docCount || 0} 文档 · ${k.chunkCount || 0} 切片</div></div></div>`).join('')
      : '<p class="muted small" style="padding:10px">暂无知识库</p>';
    $$('#kbs .list-item', view).forEach((el) => (el.onclick = () => { kb = kbs.find((k) => k.id === el.dataset.id); history.replaceState(null, '', `#/knowledge/${kb.id}`); renderKbs(); renderPane(); }));
  }
  $$('#tabs button', view).forEach((b) => (b.onclick = () => { tab = b.dataset.t; $$('#tabs button', view).forEach((x) => x.classList.toggle('on', x === b)); renderPane(); }));

  async function refreshKbs() {
    kbs = (await api('/kbs')).items;
    kb = kbs.find((k) => k.id === kb?.id) || kbs[0];
    renderKbs();
  }

  async function renderPane() {
    const pane = $('#pane', view);
    if (!kb) return (pane.innerHTML = `<div class="card">${empty('先创建一个知识库，上传内部文档（运营 SOP、产品资料、话术库等）', 'book')}</div>`);
    if (tab === 'docs') return docsPane(pane);
    if (tab === 'ask') return askPane(pane);
    return searchPane(pane);
  }

  async function docsPane(pane) {
    const { items: docs } = await api(`/kbs/${kb.id}/docs`);
    pane.innerHTML = `<div class="card"><div class="card-head">${monogram(kb.name)}<div><h3>${esc(kb.name)}</h3><div class="muted small">${esc(kb.description || '')}</div></div><div class="spacer"></div><button class="btn sm ghost" id="paste">${icon('file', 14)}粘贴文本</button><button class="icon-btn danger" id="rm-kb" title="删除知识库">${icon('trash', 15)}</button></div>
      <div class="card-pad col"><div class="dropzone" id="dz">${icon('upload', 30)}<p style="margin:6px 0 0">点击或拖拽文件到这里上传（可多选）</p><input type="file" id="file" multiple hidden accept=".pdf,.docx,.md,.txt,.csv,.html,.htm,.json"></div>
      ${docs.length ? `<div class="table-wrap"><table><thead><tr><th>文档</th><th>来源</th><th>字数</th><th>切片</th><th>索引</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody>
      ${docs.map((d) => `<tr><td><a href="javascript:;" data-view="${d.id}"><b>${icon('file', 14)} ${esc(d.title)}</b></a></td><td><span class="chip">${{ builtin: '内置', upload: '上传', manual: '手动' }[d.source] || d.source}</span></td><td>${fmtNum(d.chars)}</td><td>${d.chunkCount || 0}</td><td>${d.embedded ? '<span class="badge badge-run">向量+BM25</span>' : '<span class="badge badge-muted">BM25</span>'}</td><td>${statusBadge(d.status)}</td><td class="muted small">${timeAgo(d.createdAt)}</td><td><button class="icon-btn danger" data-del="${d.id}">${icon('trash', 14)}</button></td></tr>`).join('')}</tbody></table></div>` : empty('知识库还没有文档')}
      </div></div>`;
    const dz = $('#dz', pane), file = $('#file', pane);
    const upload = async (files) => {
      if (!files?.length) return;
      const form = new FormData();
      [...files].forEach((f) => form.append('files', f));
      dz.innerHTML = `<span class="spinner"></span><p style="margin:6px 0 0">正在解析和索引 ${files.length} 个文件…</p>`;
      try {
        const r = await api(`/kbs/${kb.id}/docs`, { method: 'POST', form });
        toast(`已入库 ${r.items.length} 个文档`, 'success');
      } catch (e) { toast(e.message, 'error'); }
      await refreshKbs();
      docsPane(pane);
    };
    dz.onclick = () => file.click();
    file.onchange = () => upload(file.files);
    dz.ondragover = (e) => (e.preventDefault(), dz.classList.add('drag'));
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = (e) => { e.preventDefault(); upload(e.dataTransfer.files); };
    $('#paste', pane).onclick = () => modal({
      title: '粘贴文本入库', wide: true,
      body: `<div class="col"><label class="field">标题<input class="input" id="t" placeholder="如：店铺售后话术"></label><label class="field">内容（支持 Markdown）<textarea class="input" id="c" rows="12"></textarea></label></div>`,
      footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="ok" data-loading="索引中…">入库</button>`,
      onMount(el, close) {
        $('#ok', el).onclick = (e) => withLoading(e.currentTarget, async () => {
          await api(`/kbs/${kb.id}/docs`, { method: 'POST', body: { title: $('#t', el).value || '未命名文档', text: $('#c', el).value } });
          close();
          toast('已入库', 'success');
          await refreshKbs();
          docsPane(pane);
        });
      },
    });
    $('#rm-kb', pane).onclick = async () => {
      if (!(await confirmBox(`确定删除知识库「${kb.name}」及其全部文档？`))) return;
      await api(`/kbs/${kb.id}`, { method: 'DELETE' });
      kb = null;
      await refreshKbs();
      renderPane();
    };
    $$('[data-del]', pane).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('确定删除该文档？'))) return;
      await api(`/docs/${b.dataset.del}`, { method: 'DELETE' });
      await refreshKbs();
      docsPane(pane);
    }));
    $$('[data-view]', pane).forEach((b) => (b.onclick = async () => {
      const d = docs.find((x) => x.id === b.dataset.view);
      const { items } = await api(`/docs/${d.id}/chunks`);
      modal({ title: `${esc(d.title)} · ${items.length} 个切片`, wide: true, body: `<div class="col">${items.map((c) => `<div class="hit"><div class="hit-head"><span>#${c.index + 1}</span><span>${c.content.length} 字</span></div><div style="white-space:pre-wrap">${esc(c.content)}</div></div>`).join('')}</div>` });
    }));
  }

  function askPane(pane) {
    pane.innerHTML = `<div class="card card-pad col"><div class="row" style="flex-wrap:nowrap"><input class="input" id="q" placeholder="向「${esc(kb.name)}」提问，例如：视频前 3 秒怎么设计钩子？"><button class="btn" id="ask" data-loading="检索并生成中…">${icon('send', 15)}提问</button></div>
      <div class="row">${['爆款视频的前3秒怎么写？', '选品时毛利率要多少才合适？', '哪些品类需要资质认证？', 'Spark Ads 怎么放量？'].map((s) => `<span class="chip click">${s}</span>`).join('')}</div><div id="ans"></div></div>`;
    const go = (e) => withLoading($('#ask', pane), async () => {
      const q = $('#q', pane).value.trim();
      if (!q) return;
      const r = await api('/rag/ask', { method: 'POST', body: { question: q, kbIds: [kb.id] } });
      $('#ans', pane).innerHTML = `<div class="hit md" style="padding:18px">${md(r.answer)}</div>${r.citations.length ? `<h4 class="mt">引用来源</h4><div class="col">${r.citations.map((c) => `<details class="hit"><summary style="cursor:pointer"><b>[${c.n}] 《${esc(c.docTitle)}》</b> <span class="muted small">相关度 ${c.score}</span></summary><div style="white-space:pre-wrap;margin-top:8px" class="text-2">${esc(c.content)}</div></details>`).join('')}</div>` : ''}`;
    });
    $('#ask', pane).onclick = go;
    $('#q', pane).onkeydown = (e) => e.key === 'Enter' && !e.isComposing && go();
    $$('.chip.click', pane).forEach((c) => (c.onclick = () => { $('#q', pane).value = c.textContent; go(); }));
  }

  function searchPane(pane) {
    pane.innerHTML = `<div class="card card-pad col"><div class="row" style="flex-wrap:nowrap"><input class="input" id="q" placeholder="输入检索词，查看召回的切片与相关度"><select class="input" id="scope" style="width:160px"><option value="one">当前知识库</option><option value="all">全部知识库</option></select><button class="btn cyan" id="s">${icon('search', 15)}检索</button></div><div id="hits" class="col"></div></div>`;
    const go = () => withLoading($('#s', pane), async () => {
      const r = await api('/rag/search', { method: 'POST', body: { query: $('#q', pane).value, kbIds: $('#scope', pane).value === 'one' ? [kb.id] : undefined } });
      $('#hits', pane).innerHTML = r.items.length ? r.items.map((h, i) => `<div class="hit"><div class="hit-head"><b>#${i + 1} 《${esc(h.docTitle)}》</b><span>相关度 <b style="color:var(--cyan)">${h.score.toFixed(3)}</b></span></div><div class="score-bar" style="margin-bottom:8px"><i style="width:${Math.min(100, h.score * 100)}%"></i></div><div style="white-space:pre-wrap" class="text-2">${esc(h.content)}</div></div>`).join('') : empty('没有召回结果', 'search');
    });
    $('#s', pane).onclick = go;
    $('#q', pane).onkeydown = (e) => e.key === 'Enter' && !e.isComposing && go();
  }

  $('#new-kb', view).onclick = () => modal({
    title: '新建知识库',
    body: `<div class="col"><label class="field">名称<input class="input" id="n" placeholder="如：产品资料库"></label><label class="field">描述<input class="input" id="d" placeholder="用途说明"></label></div>`,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="ok">创建</button>`,
    onMount(el, close) {
      $('#ok', el).onclick = (e) => withLoading(e.currentTarget, async () => {
        const k = await api('/kbs', { method: 'POST', body: { name: $('#n', el).value, description: $('#d', el).value, icon: '' } });
        kb = k;
        await refreshKbs();
        renderPane();
        close();
      });
    },
  });

  renderKbs();
  renderPane();
}
