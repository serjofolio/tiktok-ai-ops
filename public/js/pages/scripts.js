// 视频脚本：从选品库选商品（优先测款中、推荐测款），可贴对标视频，一键生成可直接开拍的带货脚本
import { api, icon, esc, toast, withLoading, $, $$, empty, copy, timeAgo, confirmBox } from '../lib.js';

const PART = { Hook: '钩子', Problem: '痛点', Demo: '演示', Proof: '证明', CTA: '行动号召' };

export async function render(view, [first, second]) {
  const [{ items: products }, sd] = await Promise.all([api('/products?sort=score'), api('/scripts')]);
  const rank = (p) => (p.status === 'testing' ? 0 : p.evaluation.verdict === '可以上' ? 1 : p.status === 'dropped' || p.evaluation.verdict === '不建议上' ? 3 : 2);
  const pool = products.slice().sort((a, b) => rank(a) - rank(b));
  const preset = first === 'new' ? second : '';
  let current = first && first !== 'new' ? sd.items.find((s) => s.id === first) : null;
  let style = 'pain';

  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">视频脚本 · 钩子 → 痛点 → 演示 → 证明 → 行动号召</div>
    <h2>选好的品，<em>一键</em>出可拍的脚本</h2>
    <p>脚本会用上这个商品的 FastMoss 数据和 AI 选品分析里的卖点、人群和对标角度。贴一段对标爆款视频的文案，生成的结构会更贴近已经被验证过的打法。</p>
  </section>
  <div class="split">
    <div class="col sticky">
      <div class="card card-pad col">
        ${pool.length ? `<label class="field">商品<select class="input" id="pid">${pool.map((p) => `<option value="${p.id}" ${p.id === preset ? 'selected' : ''}>${p.status === 'testing' ? '【测款中】' : p.evaluation.verdict === '可以上' ? '【可以上】' : ''}${esc(p.name)}</option>`).join('')}</select></label>` : `<div class="hit">选品库还是空的。<a href="#/products" style="color:var(--lime)">先去导入 FastMoss 数据 →</a></div>`}
        <div class="field">风格<div class="preset-grid" id="styles">${Object.entries(sd.styles).map(([k, t]) => `<div class="preset ${k === style ? 'on' : ''}" data-k="${k}">${esc(t.replace(/（.*）/, ''))}</div>`).join('')}</div></div>
        <div class="grid g2">
          <label class="field">时长<select class="input" id="dur"><option value="15">15 秒</option><option value="20" selected>20 秒</option><option value="30">30 秒</option><option value="45">45 秒</option></select></label>
          <label class="field">口播语言<select class="input" id="lang"><option>English</option><option>中文</option><option>Español</option><option>Bahasa Indonesia</option><option>ภาษาไทย</option><option>Tiếng Việt</option><option>日本語</option></select></label>
        </div>
        <label class="field">对标视频文案（可选）<textarea class="input" id="bench" rows="4" placeholder="把对标爆款视频的口播/字幕贴进来，或写下你的拆解：开头怎么吸引人、怎么演示、评论区在问什么…"></textarea></label>
        <label class="field">额外要求（可选）<input class="input" id="extra" placeholder="例如：真人出镜，宿舍场景，强调性价比"></label>
        <label class="switch"><input type="checkbox" id="kb" checked><span></span>参考知识库中的脚本方法</label>
        <button class="btn lg primary-glow block" id="gen" data-loading="AI 正在写脚本…" ${pool.length ? '' : 'disabled'}>${icon('sparkles')}一键生成脚本</button>
      </div>
      <div class="card"><div class="card-head"><h3>历史脚本</h3><span class="muted small">${sd.items.length}</span></div><div class="col" id="hist" style="padding:8px;max-height:360px;overflow:auto;gap:2px"></div></div>
    </div>
    <div id="viewer"></div>
  </div>`;

  $$('#styles .preset', view).forEach((el) => (el.onclick = () => { style = el.dataset.k; $$('#styles .preset', view).forEach((x) => x.classList.toggle('on', x === el)); }));

  function renderHist() {
    $('#hist', view).innerHTML = sd.items.length
      ? sd.items.map((s) => `<div class="list-item ${s.id === current?.id ? 'on' : ''}" data-id="${s.id}"><div style="min-width:0;flex:1"><b class="small" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</b><span class="muted small">${esc(s.productName || '')} · ${timeAgo(s.createdAt)}</span></div></div>`).join('')
      : '<p class="muted small" style="padding:10px">还没有脚本</p>';
    $$('#hist .list-item', view).forEach((el) => (el.onclick = () => { current = sd.items.find((s) => s.id === el.dataset.id); renderHist(); renderViewer(); }));
  }

  function renderViewer() {
    const box = $('#viewer', view);
    if (!current) return (box.innerHTML = `<div class="card">${empty('选一个商品，点「一键生成脚本」', 'script')}</div>`);
    const s = current;
    box.innerHTML = `<div class="card">
      <div class="card-head"><h3>${esc(s.title)}</h3><div class="spacer"></div>
        <button class="icon-btn" id="cp" title="复制全文">${icon('copy', 16)}</button><button class="icon-btn" id="dl" title="导出 TXT">${icon('download', 16)}</button><button class="icon-btn danger" id="rm" title="删除">${icon('trash', 16)}</button></div>
      <div class="card-pad col">
        <div class="row"><span class="chip">${esc(s.productName || '')}</span><span class="chip">${esc(s.style || '')}</span><span class="chip">${s.duration} 秒</span><span class="chip">${esc(s.language || '')}</span>${s.bgm ? `<span class="chip">配乐 · ${esc(s.bgm)}</span>` : ''}</div>
        <div class="hook-box"><span>前 3 秒钩子</span><b>${esc(s.hook)}</b>${s.hookAlternatives?.length ? `<div class="alts">${s.hookAlternatives.map((h, i) => `<div><em>备选 ${String.fromCharCode(65 + i)}</em>${esc(h)}</div>`).join('')}</div>` : ''}</div>
        <div class="timeline">${(s.scenes || []).map((sc) => `<div class="scene2"><div class="t"><b>${sc.n}</b><span>${esc(sc.time || '')}</span><i>${esc(PART[sc.part] || sc.part || '')}</i></div>
          <div class="c"><div class="vo">${esc(sc.voiceover || '')}</div>
            <div class="meta"><b>字幕</b>${esc(sc.caption || '')}</div><div class="meta"><b>画面</b>${esc(sc.visual || '')}</div>
            <div class="meta"><b>镜头</b>${esc(sc.shot || '')}${sc.props ? ` · <b>道具</b>${esc(sc.props)}` : ''}</div></div></div>`).join('')}</div>
        <div class="grid g2"><div class="hit"><div class="muted small">发布文案</div>${esc(s.caption || '')}</div><div class="hit"><div class="muted small">结尾行动号召</div>${esc(s.cta || '')}</div></div>
        <div class="tag-list">${(s.hashtags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
        ${s.shootingTips?.length ? `<div class="hit"><div class="muted small">拍摄注意</div><ul style="margin:6px 0 0;padding-left:18px">${s.shootingTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      </div></div>`;
    const text = () => `${s.title}\n商品：${s.productName}\n\n钩子：${s.hook}\n${(s.hookAlternatives || []).map((h, i) => `备选${String.fromCharCode(65 + i)}：${h}`).join('\n')}\n\n${(s.scenes || []).map((x) => `【${x.n}】${x.time} ${PART[x.part] || x.part || ''}\n口播：${x.voiceover}\n字幕：${x.caption}\n画面：${x.visual}\n镜头：${x.shot}${x.props ? `\n道具：${x.props}` : ''}`).join('\n\n')}\n\n文案：${s.caption}\n${(s.hashtags || []).join(' ')}`;
    $('#cp', box).onclick = () => copy(text());
    $('#dl', box).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain;charset=utf-8' })); a.download = `${s.title}.txt`; a.click(); };
    $('#rm', box).onclick = async () => {
      if (!(await confirmBox('删除这个脚本？'))) return;
      await api(`/scripts/${s.id}`, { method: 'DELETE' });
      sd.items.splice(sd.items.indexOf(s), 1);
      current = sd.items[0] || null;
      renderHist();
      renderViewer();
    };
  }

  const gen = $('#gen', view);
  if (gen) gen.onclick = (e) => withLoading(e.currentTarget, async () => {
    const s = await api('/scripts/generate', { method: 'POST', body: { productId: $('#pid', view).value, style, duration: Number($('#dur', view).value), language: $('#lang', view).value, benchmark: $('#bench', view).value, extra: $('#extra', view).value, useKb: $('#kb', view).checked } });
    sd.items.unshift(s);
    current = s;
    renderHist();
    renderViewer();
    toast('脚本生成完成', 'success');
  });

  if (!current && preset) current = null;
  else if (!current) current = sd.items[0] || null;
  renderHist();
  renderViewer();
}
