// 写脚本：选商品 → 选风格、钩子、痛点 → 生成一条或多条 → 自检 → 生成视频
import { api, icon, esc, toast, withLoading, $, $$, empty, copy, timeAgo, confirmBox } from '../lib.js';
import { videoDialog } from './scripts-videos.js';
import { productPicker, nameText, zhName } from '../picker.js';

const PART = { Hook: '钩子', Problem: '痛点', Demo: '演示', Proof: '证明', Offer: '优惠', CTA: '行动号召', Story: '故事', Twist: '反转' };
const MODES = [['person', '真人出镜'], ['hands', '不露脸'], ['ai', 'AI 生成']];

export async function render(view, [first, second]) {
  const [{ items: products }, sd, pb] = await Promise.all([api('/products?sort=score'), api('/scripts'), api('/playbook')]);
  const rank = (p) => (p.status === 'testing' ? 0 : p.evaluation.verdict === '可以上' ? 1 : p.status === 'dropped' || p.evaluation.verdict === '不建议上' ? 3 : 2);
  const pool = products.slice().sort((a, b) => rank(a) - rank(b));
  const preset = first === 'new' ? second : '';
  let current = first && first !== 'new' ? sd.items.find((s) => s.id === first) : null;
  let style = 'pain', hookType = '', mode = 'person', pain = null, group = 'solve';

  view.innerHTML = `
  <div class="split">
    <div class="col">
      <div class="card card-pad col">
        <label class="field">商品<select class="input" id="pid">${pool.map((p) => `<option value="${p.id}" ${p.id === preset ? 'selected' : ''}>${esc(nameText(p))}</option>`).join('')}<option value="">手动填写商品…</option></select></label>
        <div class="col" id="manual" hidden><input class="input" id="mname" placeholder="商品名称，例如 Gold Clover Earrings"><textarea class="input" id="mdesc" rows="2" placeholder="卖点、材质、价格（只写真实信息）"></textarea></div>
        <div class="field"><div class="row" style="justify-content:space-between">风格<a class="small link-lime" href="#/scripts/playbook">看爆款方法论 →</a></div>
          <div class="seg seg-full" id="groups">${pb.groups.map((g) => `<button type="button" data-g="${g.id}" title="${esc(g.hint)}" class="${g.id === group ? 'on' : ''}">${esc(g.name)}</button>`).join('')}</div>
          <div class="preset-grid style-grid" id="styles"></div>
          <div class="style-detail" id="style-detail"></div></div>
        <label class="field">钩子（开头怎么抓人）<select class="input" id="hook"><option value="">自动：按风格选，多条时轮流用</option>${pb.hooks.map((h) => `<option value="${h.id}">${h.avoid ? '（少用）' : ''}${esc(h.name)}：${esc(h.formula)}</option>`).join('')}</select><span class="small muted" id="hook-tip"></span></label>
        <div class="field"><div class="row" style="justify-content:space-between">主打痛点或渴望<button type="button" class="btn sm ghost" id="mine" data-loading="AI 正在分析…">${icon('sparkles', 13)}AI 挖痛点</button></div>
          <div class="pains" id="pains"></div>
          <input class="input" id="pain-text" placeholder="也可以自己写，例如：戴两周就变色"></div>
        <div class="field">怎么拍<div class="seg seg-full" id="modes">${MODES.map(([k, t]) => `<button type="button" data-m="${k}" class="${k === mode ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        <div class="grid g3">
          <label class="field">时长<select class="input" id="dur"><option value="15">15 秒</option><option value="20" selected>20 秒</option><option value="30">30 秒</option><option value="45">45 秒</option><option value="60">60 秒</option></select></label>
          <label class="field">语言<select class="input" id="lang"><option>English</option><option>中文</option><option>Bahasa Melayu</option><option>Bahasa Indonesia</option><option>Español</option><option>ภาษาไทย</option><option>Tiếng Việt</option><option>日本語</option></select></label>
          <label class="field">几条<select class="input" id="count"><option value="1">1 条</option><option value="3" selected>3 条</option><option value="5">5 条</option></select></label>
        </div>
        <details class="more"><summary>对标文案和额外要求</summary><div class="col mt">
          <label class="field">对标视频文案<textarea class="input" id="bench" rows="3" placeholder="把爆款的口播或字幕贴进来。要更详细的拆解，用「爆款拆解」上传视频"></textarea></label>
          <label class="field">额外要求<input class="input" id="extra" placeholder="例如：宿舍场景，强调性价比"></label>
          <label class="switch"><input type="checkbox" id="kb" checked><span></span>参考知识库</label></div></details>
        <button class="btn lg primary-glow block" id="gen" data-loading="AI 正在写脚本…">${icon('sparkles')}生成脚本</button>
        <div class="small muted" id="gen-progress"></div>
      </div>
      <div class="card"><div class="card-head"><h3>历史脚本</h3><span class="muted small">${sd.items.length}</span></div><div class="col" id="hist" style="padding:8px;max-height:360px;overflow:auto;gap:2px"></div></div>
    </div>
    <div id="viewer"></div>
  </div>`;

  const selectedProduct = () => pool.find((p) => p.id === $('#pid', view).value) || null;
  const picks = () => (selectedProduct()?.evaluation.metrics.group === '首饰' || /earring|necklace|bracelet|jewel|耳环|项链|手链|戒指|首饰/i.test($('#mname', view).value) ? pb.jewelryPicks : []);

  function renderStyles() {
    const rec = picks();
    const list = pb.styles.filter((s) => s.group === group);
    $('#styles', view).innerHTML = list.map((s) => `<div class="preset ${s.id === style ? 'on' : ''}" data-k="${s.id}" title="${esc(s.tagline)}">${rec.includes(s.id) ? '<i class="rec">推荐</i>' : ''}${esc(s.name)}</div>`).join('');
    $$('#styles .preset', view).forEach((el) => (el.onclick = () => { style = el.dataset.k; renderStyles(); }));
    const s = pb.styles.find((x) => x.id === style);
    $('#style-detail', view).innerHTML = s ? `<b>${esc(s.tagline)}</b><div class="beats">${s.beats.map((b) => `<span>${esc(b)}</span>`).join('')}</div><div class="small muted">适合：${esc(s.fit)}</div><div class="small muted">例子：${esc(s.example)}</div><div class="small" style="color:var(--warn)">注意：${esc(s.risk)}</div>` : '';
  }
  $$('#groups button', view).forEach((b) => (b.onclick = () => { group = b.dataset.g; $$('#groups button', view).forEach((x) => x.classList.toggle('on', x === b)); renderStyles(); }));
  $$('#modes button', view).forEach((b) => (b.onclick = () => { mode = b.dataset.m; $$('#modes button', view).forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#hook', view).onchange = (e) => {
    hookType = e.target.value;
    const h = pb.hooks.find((x) => x.id === hookType);
    $('#hook-tip', view).textContent = h ? `例：${h.examples[0].text}　注意：${h.trap}` : '';
  };

  function renderPains(data) {
    const box = $('#pains', view);
    box.innerHTML = (data?.pains || []).map((p, i) => `<button type="button" class="pain ${pain === p ? 'on' : ''}" data-i="${i}"><b>${esc(p.pain)}</b><small>${esc(p.level || '')}${p.evidence ? ` · ${esc(p.evidence)}` : ''}${p.hookSpoken ? ` · ${esc(p.hookSpoken)}` : ''}</small></button>`).join('');
    $$('.pain', box).forEach((b) => (b.onclick = () => { const p = data.pains[Number(b.dataset.i)]; pain = pain === p ? null : p; $('#pain-text', view).value = ''; renderPains(data); }));
  }
  const productBody = () => {
    const id = $('#pid', view).value;
    return id ? { productId: id } : { productName: $('#mname', view).value, productDesc: $('#mdesc', view).value };
  };
  $('#pid', view).onchange = () => { const manual = !$('#pid', view).value; $('#manual', view).hidden = !manual; pain = null; renderPains(null); renderStyles(); loadSavedPains(); };
  if (!pool.length) { $('#pid', view).value = ''; $('#manual', view).hidden = false; }
  const picker = productPicker($('#pid', view), pool);
  $('#mname', view).oninput = renderStyles;
  $('#mine', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    const data = await api('/scripts/pains', { method: 'POST', body: { ...productBody(), language: $('#lang', view).value } });
    pain = null;
    renderPains(data);
    toast('选一个痛点，脚本会围绕它来写', 'success');
  });
  async function loadSavedPains() {
    const id = $('#pid', view).value;
    if (!id) return;
    const p = await api(`/products/${id}`).catch(() => null);
    if (p?.pains && $('#pid', view).value === id) renderPains(p.pains);
  }

  function renderHist() {
    $('#hist', view).innerHTML = sd.items.length
      ? sd.items.map((s) => `<div class="list-item ${s.id === current?.id ? 'on' : ''}" data-id="${s.id}"><div style="min-width:0;flex:1"><b class="small" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</b><span class="muted small">${esc(s.hookName || s.style || '')}${s.check ? ` · 自检 ${s.check.score}` : ''} · ${timeAgo(s.createdAt)}</span></div></div>`).join('')
      : '<p class="muted small" style="padding:10px">还没有脚本</p>';
    $$('#hist .list-item', view).forEach((el) => (el.onclick = () => { current = sd.items.find((s) => s.id === el.dataset.id); renderHist(); renderViewer(); }));
  }

  const hookAlt = (h, i) => (typeof h === 'string' ? `<div><em>备选 ${String.fromCharCode(65 + i)}</em>${esc(h)}</div>` : `<div><em>${esc(h.type || `备选 ${String.fromCharCode(65 + i)}`)}</em>${esc(h.spoken || '')}${h.text ? `<span class="muted"> · 屏幕字：${esc(h.text)}</span>` : ''}${h.frame ? `<span class="muted"> · 第一帧：${esc(h.frame)}</span>` : ''}</div>`);

  function renderViewer() {
    const box = $('#viewer', view);
    if (!current) return (box.innerHTML = `<div class="card">${empty('选好商品和风格，点「生成脚本」', 'script')}</div>`);
    const s = current;
    const st = s.strategy || {};
    const failed = s.check?.items?.filter((x) => !x.pass) || [];
    box.innerHTML = `<div class="card">
      <div class="card-head"><h3>${esc(s.title)}</h3><div class="spacer"></div>
        <a class="btn sm ghost" href="#/scripts/create/${s.id}" title="把分镜导进 AI 出片：可以改、插镜头、删镜头，每个镜头配首帧">${icon('wand', 14)}改分镜再出片</a><button class="btn sm primary-glow" id="to-video">${icon('video', 14)}生成视频</button><button class="icon-btn" id="cp" title="复制全文">${icon('copy', 16)}</button><button class="icon-btn" id="dl" title="导出 TXT">${icon('download', 16)}</button><a class="icon-btn" href="/api/scripts/${s.id}/srt" title="下载字幕 SRT（剪映 / CapCut 可导入）">${icon('file', 16)}</a><button class="icon-btn danger" id="rm" title="删除">${icon('trash', 16)}</button></div>
      <div class="card-pad col">
        <div class="row"><span class="chip" title="${esc(s.productName || '')}">${esc(zhName(pool.find((p) => p.id === s.productId)) || s.productName || '')}</span><span class="chip">${esc(s.style || '')}</span>${s.hookName ? `<span class="chip">钩子 · ${esc(s.hookName)}</span>` : ''}<span class="chip">${s.duration} 秒</span><span class="chip">${esc(s.language || '')}</span>${s.bgm ? `<span class="chip">声音 · ${esc(s.bgm)}</span>` : ''}${s.viralId ? `<a class="chip click" href="#/scripts/viral/${s.viralId}">学自：${esc(s.viralTitle || '爆款视频')}</a>` : ''}</div>
        ${s.check ? `<div class="check-box ${s.check.score >= 85 ? 'good' : ''}"><div class="row"><b>上线前自检 ${s.check.score} 分</b><span class="muted small">程序按平台规则和方法论检查，不代表一定会爆</span></div>${failed.length ? `<ul>${failed.map((x) => `<li class="${x.level === 'fail' ? 'down' : ''}"><b>${esc(x.label)}</b>：${esc(x.note)}</li>`).join('')}</ul>` : '<p class="small up" style="margin:6px 0 0">全部通过</p>'}</div>` : ''}
        ${s.angle || st.pain ? `<div class="hit strategy"><b>${esc(s.angle || '')}</b><dl class="kv small">${st.audience ? `<dt>给谁看</dt><dd>${esc(st.audience)}</dd>` : ''}${st.pain ? `<dt>抓什么</dt><dd>${esc(st.pain)}</dd>` : ''}${st.whyItWorks ? `<dt>为什么有效</dt><dd>${esc(st.whyItWorks)}</dd>` : ''}${st.proof ? `<dt>怎么证明</dt><dd>${esc(st.proof)}</dd>` : ''}${st.objection ? `<dt>回答的顾虑</dt><dd>${esc(st.objection)}</dd>` : ''}</dl></div>` : ''}
        <div class="hook-box"><span>开头的第一句话</span><b>${esc(s.hook)}</b>${s.hookText || s.hookFrame ? `<div class="hook-3"><div><em>屏幕字</em>${esc(s.hookText || '—')}</div><div><em>第一帧</em>${esc(s.hookFrame || '—')}</div></div>` : ''}${s.hookAlternatives?.length ? `<div class="alts">${s.hookAlternatives.map(hookAlt).join('')}</div>` : ''}</div>
        <div class="timeline">${(s.scenes || []).map((sc) => `<div class="scene2"><div class="t"><b>${sc.n}</b><span>${esc(sc.time || '')}</span><i>${esc(PART[sc.part] || sc.part || '')}</i></div>
          <div class="c"><div class="vo">${esc(sc.voiceover || '')}</div>
            <div class="meta"><b>字幕</b>${esc(sc.caption || '')}</div><div class="meta"><b>画面</b>${esc(sc.visual || '')}</div>
            <div class="meta"><b>镜头</b>${esc(sc.shot || '')}${sc.props ? ` · <b>道具</b>${esc(sc.props)}` : ''}${sc.productVisible ? ' · <span class="tag-type">有商品</span>' : ''}</div>
            ${sc.retention ? `<div class="meta"><b>留人</b>${esc(sc.retention)}</div>` : ''}</div></div>`).join('')}</div>
        <div class="grid g2"><div class="hit"><div class="muted small">发布文案</div>${esc(s.caption || '')}</div><div class="hit"><div class="muted small">结尾行动号召</div>${esc(s.cta || '')}</div></div>
        <div class="tag-list">${(s.hashtags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
        ${s.shootingTips?.length ? `<div class="hit"><div class="muted small">拍摄注意</div><ul style="margin:6px 0 0;padding-left:18px">${s.shootingTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${s.testPlan ? `<div class="hit"><div class="muted small">发出去看什么数据</div>${esc(s.testPlan)}</div>` : ''}
      </div></div>`;
    const text = () => `${s.title}\n商品：${s.productName}\n\n第一句话：${s.hook}\n屏幕字：${s.hookText || ''}\n第一帧：${s.hookFrame || ''}\n${(s.hookAlternatives || []).map((h, i) => `备选${String.fromCharCode(65 + i)}：${typeof h === 'string' ? h : `${h.spoken || ''}（屏幕字：${h.text || ''}）`}`).join('\n')}\n\n${(s.scenes || []).map((x) => `【${x.n}】${x.time} ${PART[x.part] || x.part || ''}\n口播：${x.voiceover}\n字幕：${x.caption}\n画面：${x.visual}\n镜头：${x.shot}${x.retention ? `\n留人：${x.retention}` : ''}`).join('\n\n')}\n\n发布文案：${s.caption}\n${(s.hashtags || []).join(' ')}\n行动号召：${s.cta}`;
    $('#cp', box).onclick = () => copy(text());
    $('#dl', box).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain;charset=utf-8' })); a.download = `${s.title}.txt`; a.click(); };
    $('#to-video', box).onclick = () => videoDialog(s);
    $('#rm', box).onclick = async () => {
      if (!(await confirmBox('删除这个脚本？'))) return;
      await api(`/scripts/${s.id}`, { method: 'DELETE' });
      sd.items.splice(sd.items.indexOf(s), 1);
      current = sd.items[0] || null;
      renderHist();
      renderViewer();
    };
  }

  $('#gen', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    const count = Number($('#count', view).value);
    const typed = $('#pain-text', view).value.trim();
    const avoid = [];
    const progress = $('#gen-progress', view);
    try {
      for (let i = 0; i < count; i++) {
        progress.textContent = count > 1 ? `正在写第 ${i + 1}/${count} 条，每条约半分钟…` : '';
        const s = await api('/scripts/generate', { method: 'POST', body: { ...productBody(), style, hookType, mode, variant: i, avoid, pain: pain || (typed ? { pain: typed } : undefined), duration: Number($('#dur', view).value), language: $('#lang', view).value, benchmark: $('#bench', view).value, extra: $('#extra', view).value, useKb: $('#kb', view).checked } });
        avoid.push(s.hook);
        sd.items.unshift(s);
        current = s;
        renderHist();
        renderViewer();
      }
      toast(count > 1 ? `写好了 ${count} 条，开头各不相同，可以 A/B 测试` : '脚本生成完成', 'success');
    } finally {
      progress.textContent = '';
    }
  });

  if (!current && !preset) current = sd.items[0] || null;
  if (first && first !== 'new' && current?.productId && pool.some((p) => p.id === current.productId)) { $('#pid', view).value = current.productId; picker.sync(); }
  renderStyles();
  renderHist();
  renderViewer();
  loadSavedPains();
}
