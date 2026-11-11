// 写脚本：选商品（选品库 / 只传素材 / 手动填）→ 选风格、钩子、痛点 → 生成一条或多条 → 自检 → 生成视频
// 只传素材时：看图模型先认出商品（可以改），脚本按它写；素材跟着脚本走，生成视频时当商品参考图
import { api, icon, esc, toast, withLoading, $, $$, empty, copy, timeAgo, confirmBox } from '../lib.js';
import { videoDialog } from './scripts-videos.js';
import { productPicker, nameText, zhName } from '../picker.js';
import { pasteInto } from '../paste.js';

const PART = { Hook: '钩子', Problem: '痛点', Demo: '演示', Proof: '证明', Offer: '优惠', CTA: '行动号召', Story: '故事', Twist: '反转' };
const MODES = [['person', '真人出镜'], ['hands', '不露脸'], ['ai', 'AI 生成']];
const SOURCES = [['lib', '选品库'], ['assets', '只传素材'], ['manual', '手动填写']];
const SRC_KEY = 'script-src';
// 正在写的脚本：一条要半分钟到一分钟，中途切到别的页面再回来，进度和写好的脚本照样显示（页面模块只加载一次，状态放在这里）
const gen = { running: false, text: '', subs: new Set() };
const emit = (ev = {}) => [...gen.subs].forEach((fn) => fn(ev));
const savedSrc = () => {
  try {
    return localStorage.getItem(SRC_KEY) || '';
  } catch {
    return '';
  }
};

export async function render(view, [first, second]) {
  const [{ items: products }, sd, pb, vd] = await Promise.all([api('/products?sort=score&pick=1'), api('/scripts'), api('/playbook'), api('/viral').catch(() => ({ items: [] }))]);
  // 拆解完的爆款：可以照着它的结构写（从拆解页点「用我的素材复刻」过来时已经选好）
  const virals = vd.items.filter((v) => v.status === 'done');
  const learnId = first === 'learn' ? second : '';
  const rank = (p) => (p.status === 'testing' ? 0 : p.evaluation.verdict === '可以上' ? 1 : p.status === 'dropped' || p.evaluation.verdict === '不建议上' ? 3 : 2);
  const pool = products.slice().sort((a, b) => rank(a) - rank(b));
  const preset = first === 'new' ? second : '';
  let current = first && first !== 'new' && first !== 'learn' ? sd.items.find((s) => s.id === first) : null;
  let style = 'pain', hookType = '', mode = 'person', pain = null, group = 'solve';
  // 从哪来：打开某个商品时是选品库；看只传素材写的脚本时回到素材；否则用上次的选择
  const fromAssets = current?.assetIds?.length && !current.productId ? current : null;
  let src = preset ? 'lib' : fromAssets || learnId ? 'assets' : SOURCES.some(([k]) => k === savedSrc()) ? savedSrc() : pool.length ? 'lib' : 'assets';
  let assets = fromAssets ? fromAssets.assetIds.map((id) => ({ id })) : [];
  let prof = fromAssets ? { name: fromAssets.productName || '', desc: fromAssets.productDesc || '', unknown: [] } : null;

  view.innerHTML = `
  <div class="split">
    <div class="col">
      <div class="card card-pad col">
        <div class="field"><span>商品从哪来</span><div class="seg seg-full" id="srcs" data-paste-hint="要用粘贴的图片写脚本：先把「商品从哪来」换成「只传素材」">${SOURCES.map(([k, t]) => `<button type="button" data-src="${k}" class="${k === src ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        <div id="src-lib"><select class="input" id="pid" aria-label="商品">${pool.map((p) => `<option value="${p.id}" ${p.id === preset ? 'selected' : ''}>${esc(nameText(p))}</option>`).join('')}</select>${pool.length ? '' : '<p class="small muted" style="margin:6px 0 0">选品库里还没有商品：可以「只传素材」，或者先到智能选品导入。</p>'}</div>
        <div class="col" id="manual" hidden><input class="input" id="mname" placeholder="商品名称，例如 Gold Clover Earrings"><textarea class="input" id="mdesc" rows="2" placeholder="卖点、材质、价格（只写真实信息）"></textarea></div>
        <div class="col" id="assets-box" hidden style="gap:10px">
          <div class="dropzone sm" id="adz">${icon('upload', 22)}<p><b>拖入商品图片或视频，或点击选择</b><br><span class="small">白底图、上身图、细节图都行，最多 12 个；视频自动截 3 帧。复制的图片可以直接 Ctrl+V 粘贴。AI 先看图认出商品，脚本照它写，生成视频时这些图当商品参考</span></p><input type="file" id="afile" data-paste-default multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden></div>
          <div class="row" style="gap:8px"><button type="button" class="btn sm ghost" id="apaste" data-loading="读取中…">${icon('copy', 14)}粘贴图片</button><span class="small muted">或者直接按 Ctrl+V</span></div>
          <div class="asset-row" id="athumbs"></div>
          <div id="aprof"></div>
        </div>
        <label class="field">照着哪条爆款写（可选）<select class="input" id="viral"><option value="">不学，按下面选的风格写</option>${virals.map((v) => `<option value="${v.id}" ${v.id === learnId ? 'selected' : ''}>${esc(String(v.title || '').slice(0, 40))}</option>`).join('')}</select><span class="small muted" id="viral-tip">${virals.length ? '' : '先到「爆款拆解」粘贴 TikTok 或 FastMoss 视频链接拆一条，这里就能选'}</span></label>
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
      <div class="card"><div class="card-head"><h3>历史脚本</h3><span class="muted small" id="hist-n">${sd.items.length}</span></div><div class="col" id="hist" style="padding:8px;max-height:360px;overflow:auto;gap:2px"></div></div>
    </div>
    <div id="viewer"></div>
  </div>`;

  const selectedProduct = () => (src === 'lib' ? pool.find((p) => p.id === $('#pid', view).value) || null : null);
  const typedName = () => (src === 'manual' ? $('#mname', view).value : src === 'assets' ? `${$('#aname', view)?.value || ''} ${$('#adesc', view)?.value || ''}` : '');
  const picks = () => (selectedProduct()?.evaluation.metrics.group === '首饰' || /earring|necklace|bracelet|jewel|耳环|耳钉|项链|手链|戒指|首饰|脚链/i.test(typedName()) ? pb.jewelryPicks : []);

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
    if (src === 'lib') {
      const id = $('#pid', view).value;
      if (!id) throw new Error('选品库里还没有商品：换成「只传素材」或「手动填写」');
      return { productId: id };
    }
    if (src === 'manual') return { productName: $('#mname', view).value, productDesc: $('#mdesc', view).value };
    return { productName: $('#aname', view)?.value || '', productDesc: $('#adesc', view)?.value || '', assetIds: assets.map((a) => a.id) };
  };
  function showSrc() {
    $$('#srcs button', view).forEach((b) => b.classList.toggle('on', b.dataset.src === src));
    $('#src-lib', view).hidden = src !== 'lib';
    $('#manual', view).hidden = src !== 'manual';
    $('#assets-box', view).hidden = src !== 'assets';
    pain = null;
    renderPains(null);
    renderStyles();
    loadSavedPains();
  }
  $$('#srcs button', view).forEach((b) => (b.onclick = () => {
    src = b.dataset.src;
    try {
      localStorage.setItem(SRC_KEY, src);
    } catch {}
    showSrc();
  }));
  $('#pid', view).onchange = () => { pain = null; renderPains(null); renderStyles(); loadSavedPains(); };
  const picker = productPicker($('#pid', view), pool);
  $('#mname', view).oninput = renderStyles;

  // ---------- 只传素材 ----------
  const drawAssets = () => {
    $('#athumbs', view).innerHTML = assets.map((a, i) => `<div class="asset sm"><img src="/api/media/${a.id}" alt=""><button type="button" class="icon-btn" data-ra="${i}" title="移除">${icon('x', 12)}</button></div>`).join('');
    $$('[data-ra]', view).forEach((b) => (b.onclick = () => { assets.splice(Number(b.dataset.ra), 1); drawAssets(); }));
  };
  const drawProf = (state = '') => {
    const box = $('#aprof', view);
    if (state === 'busy') return (box.innerHTML = '<div class="hit small"><span class="spinner"></span> AI 正在看图认商品…</div>');
    if (!prof) return (box.innerHTML = assets.length ? `<div class="hit small">${state ? `<div class="down" style="margin-bottom:6px">${esc(state)}</div>` : ''}<button type="button" class="btn sm" id="arec" data-loading="识别中…">${icon('sparkles', 13)}AI 看图认商品</button> <a class="link-lime" href="#/providers">接入看图模型 →</a></div>` : '');
    box.innerHTML = `<div class="hit ai-prof">
      <div class="row"><b>${icon('sparkles', 14)}AI 看图认出的商品</b>${prof.model ? `<span class="small muted">${esc(prof.model)}</span>` : ''}<div class="spacer"></div><button type="button" class="btn sm ghost" id="arec" data-loading="识别中…">${icon('refresh', 13)}重新识别</button></div>
      ${state ? `<div class="small down">${esc(state)}</div>` : ''}
      <label class="field">商品名<input class="input" id="aname" value="${esc(prof.name)}"></label>
      <label class="field">外观和卖点<span class="small muted">脚本照这里写，不对的直接改；真实材质、尺寸这些看图看不出来，写进来更准</span><textarea class="input" id="adesc" rows="5">${esc(prof.desc)}</textarea></label>
      ${prof.unknown?.length ? `<div class="small muted">图里看不出来、建议补充：${esc(prof.unknown.join('；'))}</div>` : ''}</div>`;
    $('#aname', view).oninput = renderStyles;
  };
  async function recognize() {
    if (!assets.length) throw new Error('先上传商品图片或视频');
    drawProf('busy');
    try {
      prof = await api('/scripts/recognize', { method: 'POST', body: { assetIds: assets.map((a) => a.id) } });
      drawProf();
      renderStyles();
    } catch (e) {
      drawProf(e.message);
      throw e;
    }
  }
  $('#aprof', view).addEventListener('click', (e) => {
    const b = e.target.closest('#arec');
    if (b) withLoading(b, recognize);
  });
  async function addFiles(files) {
    if (!files.length) return;
    const fd = new FormData();
    for (const x of files) fd.append('files', x);
    const dz = $('#adz', view);
    dz.classList.add('busy');
    try {
      assets = [...assets, ...(await api('/studio/assets', { method: 'POST', form: fd })).items].slice(0, 12);
      drawAssets();
    } finally {
      dz.classList.remove('busy');
    }
    // 第一次传素材自动认商品；已经认过的不覆盖用户改过的内容，要重认点「重新识别」
    if (!prof) await recognize().catch(() => {});
  }
  $('#apaste', view).onclick = (e) => withLoading(e.currentTarget, () => pasteInto($('#afile', view)));
  const adz = $('#adz', view);
  adz.onclick = (e) => { if (e.target.id !== 'afile') $('#afile', view).click(); };
  $('#afile', view).onchange = (e) => addFiles([...e.target.files]).catch((x) => toast(x.message, 'error')).finally(() => (e.target.value = ''));
  adz.ondragover = (e) => (e.preventDefault(), adz.classList.add('drag'));
  adz.ondragleave = () => adz.classList.remove('drag');
  adz.ondrop = (e) => { e.preventDefault(); adz.classList.remove('drag'); addFiles([...e.dataTransfer.files]).catch((x) => toast(x.message, 'error')); };
  // 只传素材时，写脚本和挖痛点之前先要认出商品
  async function ready() {
    if (src !== 'assets') return;
    if (!assets.length) throw new Error('先上传商品图片或视频');
    if (!$('#aname', view)?.value.trim()) await recognize();
  }

  $('#mine', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    await ready();
    const data = await api('/scripts/pains', { method: 'POST', body: { ...productBody(), language: $('#lang', view).value } });
    pain = null;
    renderPains(data);
    toast('选一个痛点，脚本会围绕它来写', 'success');
  });
  async function loadSavedPains() {
    const id = src === 'lib' ? $('#pid', view).value : '';
    if (!id) return;
    const p = await api(`/products/${id}`).catch(() => null);
    if (p?.pains && $('#pid', view).value === id) renderPains(p.pains);
  }

  function renderHist() {
    $('#hist-n', view).textContent = sd.items.length;
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
        ${s.assetIds?.length ? `<div class="hit src-assets"><div class="row"><b class="small">商品素材 ${s.assetIds.length} 张</b><span class="small muted">生成视频时当商品参考图，商品照着它画</span></div><div class="asset-row">${s.assetIds.map((id) => `<div class="asset sm"><img src="/api/media/${id}" alt="" loading="lazy"></div>`).join('')}</div></div>` : ''}
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

  // 写好一条就放进历史脚本并打开；这个页面已经切走了就不再更新它
  const onGen = (ev) => {
    if (!view.isConnected) return gen.subs.delete(onGen);
    if (ev.script && !sd.items.some((x) => x.id === ev.script.id)) {
      sd.items.unshift(ev.script);
      current = ev.script;
      renderHist();
      renderViewer();
    }
    $('#gen-progress', view).textContent = gen.text;
    $('#gen', view).disabled = gen.running;
  };
  gen.subs.add(onGen);

  $('#gen', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    if (gen.running) return toast('上一次的还在写，写好会自动出现在「历史脚本」里', 'info');
    await ready();
    const count = Number($('#count', view).value);
    const typed = $('#pain-text', view).value.trim();
    const avoid = [];
    const made = [];
    gen.running = true;
    try {
      for (let i = 0; i < count; i++) {
        gen.text = count > 1 ? `正在写第 ${i + 1}/${count} 条，每条约半分钟…` : '正在写，大约半分钟到一分钟，可以先去别的页面，写好会自动出现在「历史脚本」里';
        emit();
        const s = await api('/scripts/generate', { method: 'POST', body: { ...productBody(), viralId: $('#viral', view).value || undefined, style, hookType, mode, variant: i, avoid, pain: pain || (typed ? { pain: typed } : undefined), duration: Number($('#dur', view).value), language: $('#lang', view).value, benchmark: $('#bench', view).value, extra: $('#extra', view).value, useKb: $('#kb', view).checked } });
        avoid.push(s.hook);
        made.push(s);
        emit({ script: s });
      }
      // 人已经在别的页面：告诉他脚本放在哪
      const here = gen.subs.size > 0;
      if (here) toast(count > 1 ? `写好了 ${count} 条，开头各不相同，可以 A/B 测试` : '脚本生成完成', 'success');
      else toast(`脚本写好了：「${String(made[0].title || '').slice(0, 30)}」${made.length > 1 ? ` 等 ${made.length} 条` : ''}，在「视频脚本 → 写脚本」的「历史脚本」里`, 'success');
    } finally {
      gen.running = false;
      gen.text = '';
      emit();
    }
  });

  if (!current && !preset) current = sd.items[0] || null;
  if (first && first !== 'new' && current?.productId && pool.some((p) => p.id === current.productId)) { $('#pid', view).value = current.productId; picker.sync(); }
  // 选了爆款：风格和钩子跟着爆款走，时长默认跟原视频差不多
  const syncViral = () => {
    const v = virals.find((x) => x.id === $('#viral', view).value);
    $('#viral-tip', view).textContent = v ? '按这条爆款的结构、节奏和钩子写（下面的风格和钩子不用选），只学手法，不照抄台词和画面；第一条保留它的钩子类型，其余换开头' : virals.length ? '' : '先到「爆款拆解」粘贴 TikTok 或 FastMoss 视频链接拆一条，这里就能选';
    $('#styles', view).closest('.field').classList.toggle('dim', !!v);
    const sec = v?.probe?.duration;
    if (sec) {
      const opts = [...$('#dur', view).options].map((o) => Number(o.value));
      $('#dur', view).value = String(opts.reduce((a, b) => (Math.abs(b - sec) < Math.abs(a - sec) ? b : a)));
    }
  };
  $('#viral', view).onchange = syncViral;
  showSrc();
  drawAssets();
  drawProf();
  if (learnId) syncViral();
  renderStyles();
  renderHist();
  renderViewer();
  onGen({});
  loadSavedPains();
}
