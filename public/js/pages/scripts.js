import { api, icon, esc, toast, withLoading, $, $$, empty, copy, timeAgo, confirmBox, monogram } from '../lib.js';

const STYLE_META = { pain: '', unboxing: '', compare: '', story: '', tutorial: '', live: '' };

export async function render(view, [first, second]) {
  const [{ items: products }, sd] = await Promise.all([api('/products'), api('/scripts')]);
  const presetProduct = first === 'new' ? second : '';
  let current = first && first !== 'new' ? sd.items.find((s) => s.id === first) : sd.items[0];
  let style = 'pain';

  view.innerHTML = `<div class="split">
    <div class="col sticky">
      <div class="card card-pad col">
        <h3 style="font-size:15px">${icon('wand')} AI 写脚本</h3>
        <label class="field">选择商品<select class="input" id="pid">${products.map((p) => `<option value="${p.id}" ${p.id === presetProduct ? 'selected' : ''}>${esc(p.nameCn)}（${p.score}分）</option>`).join('')}</select></label>
        <div class="field">脚本风格<div class="preset-grid" id="styles">${Object.entries(sd.styles).map(([k, t]) => `<div class="preset ${k === style ? 'on' : ''}" data-k="${k}">${t.replace(/（.*）/, '')}</div>`).join('')}</div></div>
        <div class="grid g2">
          <label class="field">时长<select class="input" id="dur"><option value="15">15 秒</option><option value="20" selected>20 秒</option><option value="30">30 秒</option><option value="45">45 秒</option></select></label>
          <label class="field">口播语言<select class="input" id="lang"><option>English</option><option>中文</option><option>Español</option><option>Bahasa Indonesia</option><option>ภาษาไทย</option><option>Tiếng Việt</option></select></label>
        </div>
        <label class="field">额外要求（可选）<textarea class="input" id="extra" rows="2" placeholder="例如：面向宝妈人群，语气活泼，强调性价比"></textarea></label>
        <label class="check"><input type="checkbox" id="kb" checked>参考知识库中的爆款脚本公式（RAG）</label>
        <button class="btn grad block lg" id="gen" data-loading="AI 创作中…">${icon('sparkles')}生成脚本</button>
      </div>
      <div class="card"><div class="card-head"><h3>历史脚本</h3><span class="muted small">${sd.items.length}</span></div><div class="col" id="hist" style="padding:8px;max-height:340px;overflow:auto;gap:2px"></div></div>
    </div>
    <div id="viewer"></div>
  </div>`;

  $$('#styles .preset', view).forEach((el) => (el.onclick = () => { style = el.dataset.k; $$('#styles .preset', view).forEach((x) => x.classList.toggle('on', x === el)); }));

  function renderHist() {
    $('#hist', view).innerHTML = sd.items.length
      ? sd.items.map((s) => `<div class="list-item ${s.id === current?.id ? 'on' : ''}" data-id="${s.id}">${monogram(s.productName, 'sm')}<div style="min-width:0;flex:1"><b class="small" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</b><span class="muted small">${esc(s.style || '')} · ${timeAgo(s.createdAt)}</span></div></div>`).join('')
      : '<p class="muted small" style="padding:10px">暂无</p>';
    $$('#hist .list-item', view).forEach((el) => (el.onclick = () => { current = sd.items.find((s) => s.id === el.dataset.id); renderHist(); renderViewer(); }));
  }

  function renderViewer() {
    const box = $('#viewer', view);
    if (!current) return (box.innerHTML = `<div class="card">${empty('选择商品和风格，让 AI 为你创作第一条爆款脚本', 'script')}</div>`);
    const s = current;
    box.innerHTML = `<div class="card">
      <div class="card-head"><h3>${esc(s.title)}</h3><div class="spacer"></div>
        <button class="icon-btn" id="cp" title="复制脚本">${icon('copy', 16)}</button>
        <button class="icon-btn" id="dl" title="导出 TXT">${icon('download', 16)}</button>
        <button class="icon-btn danger" id="rm" title="删除">${icon('trash', 16)}</button></div>
      <div class="card-pad col">
        <div class="row"><span class="chip">${esc(s.style)}</span><span class="chip">${s.duration} 秒</span><span class="chip">${esc(s.language)}</span><span class="chip">${s.scenes.length} 个镜头</span>${s.bgm ? `<span class="chip">配乐 · ${esc(s.bgm)}</span>` : ''}</div>
        <div class="hit accent"><div class="muted small">黄金 3 秒钩子</div><div style="font-size:18px;font-weight:700">${esc(s.hook)}</div></div>
        ${s.scenes.map((sc) => `<div class="scene"><div class="scene-n">${sc.n}<small>${esc(sc.time || '')}</small></div><div><div class="row"><span class="chip">${esc(sc.shot || '')}</span><span class="chip">运镜 · ${esc(sc.motion || '')}</span></div>
          <div class="vo">${esc(sc.voiceover)}</div><div class="meta">字幕：${esc(sc.caption)}</div><div class="meta">画面：${esc(sc.visual)}</div><div class="meta" style="font-family:Consolas,monospace;font-size:11.5px">${esc(sc.imagePrompt || '')}</div></div></div>`).join('')}
        <div class="grid g2"><div class="hit"><div class="muted small">发布文案</div>${esc(s.caption)}</div><div class="hit"><div class="muted small">CTA</div>${esc(s.cta)}</div></div>
        <div class="tag-list">${(s.hashtags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
        <div class="row" style="justify-content:flex-end;border-top:1px solid var(--line);padding-top:14px">
          <span class="muted small" id="prog"></span>
          <button class="btn cyan" id="toimg" data-loading="生成分镜图…">${icon('image', 16)}生成分镜图并合成视频</button>
        </div>
      </div></div>`;
    const text = () => `${s.title}\n\n钩子：${s.hook}\n\n${s.scenes.map((x) => `【${x.n}】${x.time} ${x.shot}\n口播：${x.voiceover}\n字幕：${x.caption}\n画面：${x.visual}`).join('\n\n')}\n\n文案：${s.caption}\n${(s.hashtags || []).join(' ')}`;
    $('#cp', box).onclick = () => copy(text());
    $('#dl', box).onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain;charset=utf-8' }));
      a.download = `${s.title}.txt`;
      a.click();
    };
    $('#rm', box).onclick = async () => {
      if (!(await confirmBox('确定删除该脚本？'))) return;
      await api(`/scripts/${s.id}`, { method: 'DELETE' });
      sd.items.splice(sd.items.indexOf(s), 1);
      current = sd.items[0];
      renderHist();
      renderViewer();
    };
    $('#toimg', box).onclick = (e) => withLoading(e.currentTarget, async () => {
      const prog = $('#prog', box);
      const scenes = [];
      for (const sc of s.scenes) {
        prog.textContent = `正在生成镜头 ${sc.n}/${s.scenes.length}…`;
        const { items } = await api('/images/generate', { method: 'POST', body: { prompt: sc.imagePrompt || sc.visual, title: sc.caption, productId: s.productId } });
        scenes.push({ image: items[0].url, caption: sc.caption, voiceover: sc.voiceover, duration: Number(sc.duration) || 4, motion: sc.motion || 'zoom-in' });
      }
      prog.textContent = '';
      const v = await api('/videos/compose', { method: 'POST', body: { title: s.title, scenes } });
      toast('分镜成片已生成', 'success');
      location.hash = `#/videos/${v.id}`;
    });
  }

  $('#gen', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    const s = await api('/scripts/generate', { method: 'POST', body: { productId: $('#pid', view).value, style, duration: Number($('#dur', view).value), language: $('#lang', view).value, extra: $('#extra', view).value, useKb: $('#kb', view).checked } });
    sd.items.unshift(s);
    current = s;
    renderHist();
    renderViewer();
    toast('脚本生成完成', 'success');
  });

  renderHist();
  renderViewer();
}
