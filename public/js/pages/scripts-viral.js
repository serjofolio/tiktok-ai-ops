// 爆款拆解：上传视频 → 详细分析 → 学习结构生成脚本
import { api, icon, esc, toast, withLoading, $, $$, empty, confirmBox, timeAgo } from '../lib.js';
import { productPicker, nameText } from '../picker.js';

const PART = { Hook: '钩子', Problem: '痛点', Demo: '演示', Proof: '证明', Offer: '优惠', CTA: '行动号召', Story: '故事', Twist: '反转' };
const SCORE = { hook: '钩子', retention: '留人', proof: '证明', conversion: '转化', shareability: '传播' };

export async function render(view, [openId]) {
  let data = await api('/viral');
  let current = openId || data.items[0]?.id || '';
  let poll = null;
  let alive = true;

  const caps = () => {
    const c = data.capabilities;
    const dot = (ok, yes, no) => `<span class="cap ${ok ? 'ok' : 'no'}">${ok ? icon('check', 12) : icon('x', 12)}${esc(ok ? yes : no)}</span>`;
    return `<div class="caps">${dot(c.llm, `写报告：${c.llm}`, '写报告：还没有接入大模型')}${dot(c.vision, `看画面：${c.vision}`, '看画面：没有模型')}${dot(c.asr, `听口播：${c.asr}`, '听口播：没有接入（只能从字幕读）')}<a class="small link-lime" href="#/providers">去接入配置 →</a></div>
      <p class="small muted" style="margin:6px 0 0">系统会先发一张测试图确认模型真的看得见。大模型不能看图时，到接入配置加一个看画面的模型（智谱 GLM-4.6V-Flash 官方标明免费）。</p>`;
  };

  view.innerHTML = `
  <div class="split">
    <div class="col">
      <div class="card card-pad col">
        <h3 style="margin:0;font-size:15px">上传爆款视频</h3>
        <div id="caps"></div>
        <div class="viral-link"><input class="input" id="v-link" placeholder="粘贴 TikTok 视频链接，直接拆解（不用先下载）"><button class="btn" id="v-link-go" data-loading="读取中…">${icon('sparkles', 14)}拆解</button></div>
        <div class="small muted" id="v-link-msg" style="margin-top:-4px">播放、点赞、评论这些数据会自动带上。也可以在下面上传自己存的视频：</div>
        <div class="dropzone" id="dz">${icon('upload', 28)}<p><b>拖入视频，或点击选择</b><br><span class="small">MP4 / MOV / WebM，${data.maxMb}MB 和 10 分钟以内</span></p><input type="file" id="file" accept="video/*" hidden></div>
        <details class="more"><summary>补充这条视频的数据（可选，分析更准）</summary><div class="col mt">
          <label class="field">标题<input class="input" id="v-title" placeholder="默认用文件名"></label>
          <label class="field">视频链接<input class="input" id="v-url" placeholder="https://www.tiktok.com/..."></label>
          <div class="grid g2"><label class="field">播放<input class="input" id="v-views" placeholder="2300000"></label><label class="field">点赞<input class="input" id="v-likes"></label><label class="field">评论<input class="input" id="v-comments"></label><label class="field">转发<input class="input" id="v-shares"></label></div>
          <label class="field">成交额<input class="input" id="v-gmv" placeholder="$105,152（FastMoss 能查到）"></label>
          <label class="field">备注<input class="input" id="v-notes" placeholder="比如：自然流量、投过广告、卖的是什么"></label>
          <label class="field">口播文字<textarea class="input" id="v-transcript" rows="3" placeholder="没接入语音转写时，可以把口播贴在这里"></textarea></label></div></details>
        <p class="small muted" style="margin:0">只用来学习结构。别人的视频不要直接重发，平台要求原创。已用存储 ${data.storage.usedMb} MB${data.storage.quotaMb ? ` / ${data.storage.quotaMb} MB` : ''}。</p>
      </div>
      <div class="card"><div class="card-head"><h3>拆解记录</h3></div><div class="col" id="vlist" style="padding:8px;max-height:360px;overflow:auto;gap:2px"></div></div>
    </div>
    <div id="vdetail"></div>
  </div>`;
  $('#caps', view).innerHTML = caps();

  function renderList() {
    $('#vlist', view).innerHTML = data.items.length
      ? data.items.map((v) => `<div class="list-item ${v.id === current ? 'on' : ''}" data-id="${v.id}"><div style="min-width:0;flex:1"><b class="small" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.title)}</b><span class="muted small">${v.status === 'running' ? esc(v.step) : v.status === 'error' ? '失败' : esc(v.keyReason || '已完成').slice(0, 26)} · ${timeAgo(v.createdAt)}</span></div></div>`).join('')
      : '<p class="muted small" style="padding:10px">还没有拆解过视频</p>';
    $$('#vlist .list-item', view).forEach((el) => (el.onclick = () => { current = el.dataset.id; renderList(); loadDetail(); }));
  }

  const frameSrc = (v, f) => `/api/viral/${v.id}/frames/${f}`;
  const list = (arr) => `<ul class="plain">${(arr || []).map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>`;
  const fmtT = (t) => (t == null ? '—' : `${t} 秒`);

  async function loadDetail() {
    clearTimeout(poll);
    const box = $('#vdetail', view);
    if (!current) return (box.innerHTML = `<div class="card">${empty('上传一条爆款视频，AI 会逐段拆解它为什么爆，再学它的结构写你的脚本', 'video')}</div>`);
    const v = await api(`/viral/${current}`).catch(() => null);
    if (!alive || !view.isConnected) return;
    if (!v) return (box.innerHTML = `<div class="card">${empty('这条记录不存在', 'search')}</div>`);
    if (v.status === 'running') {
      box.innerHTML = `<div class="card card-pad col"><div class="row"><span class="spinner"></span><b>${esc(v.step)}</b></div><p class="muted small" style="margin:0">一条视频通常要 1–3 分钟，可以先做别的，分析在后台进行。</p>${(v.frames || []).length ? `<div class="frame-strip">${v.frames.slice(0, 12).map((f) => `<img src="${frameSrc(v, f.file)}" alt="" loading="lazy">`).join('')}</div>` : ''}</div>`;
      poll = setTimeout(() => { if (alive && view.isConnected) refreshAll(); }, 3000);
      return;
    }
    if (v.status === 'error') {
      box.innerHTML = `<div class="card card-pad col"><b>${esc(v.title)}</b><p class="down">${esc(v.error)}</p><div class="row"><button class="btn" id="rerun" data-loading="提交中…">${icon('refresh', 14)}重新分析</button><button class="btn ghost" id="del">${icon('trash', 14)}删除</button></div></div>`;
      bindCommon(v, box);
      return;
    }
    const a = v.analysis || {};
    const m = v.measured || {};
    const h = a.hook || {};
    const nearest = (t) => (v.frames || []).reduce((best, f) => (best == null || Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best), null);
    box.innerHTML = `<div class="col viral-report">
      <div class="card"><div class="card-head"><h3>${esc(v.title)}</h3><div class="spacer"></div><a class="btn sm" href="#learn" id="to-learn">${icon('sparkles', 14)}学它写脚本</a><button class="icon-btn" id="rerun" title="重新分析" data-loading="…">${icon('refresh', 15)}</button><button class="icon-btn danger" id="del" title="删除">${icon('trash', 15)}</button></div>
        <div class="card-pad viral-top">${v.mediaId ? `<video src="/api/media/${v.mediaId}" controls preload="metadata" playsinline class="video-el"></video>` : '<div class="viral-nofile">示例报告没有视频文件<br>上传你的视频才会有真实分析</div>'}
          <div class="col" style="min-width:0"><div class="key-reason"><span>最关键的爆点</span><b>${esc(a.keyReason || '')}</b></div><p style="margin:0;line-height:1.75">${esc(a.summary || '')}</p>
            <div class="measure">${[['时长', `${m.duration} 秒`], ['镜头数', m.shotCount], ['平均每镜', fmtT(m.avgShotSeconds)], ['第一次切镜', fmtT(m.firstCutAt)], ['语速', m.speechPerSecond ? `${m.speechPerSecond} 词/秒` : '—']].map(([k, x]) => `<div><small>${k}</small><b>${esc(x)}</b></div>`).join('')}</div>
            <p class="small muted" style="margin:0">上面这些数字是程序测量的（切镜次数用画面变化检测，快速转场可能漏算）。</p></div></div>
        ${v.warnings?.length ? `<div class="card-pad" style="padding-top:0">${v.warnings.map((w) => `<div class="note-card warn">${esc(w)}</div>`).join('')}</div>` : ''}</div>

      ${a.takeaways?.length ? `<div class="card card-pad"><h4 class="rp-h">${icon('zap', 16)}马上能学的</h4><ol class="steps-ol">${a.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}

      <div class="card card-pad"><h4 class="rp-h">${icon('target', 16)}开头钩子${h.typeName ? ` · ${esc(h.typeName)}` : ''}${h.score ? ` · ${h.score} 分` : ''}</h4>
        ${(v.hookFrames || []).length ? `<div class="frame-strip">${v.hookFrames.map((f) => `<figure><img src="${frameSrc(v, f.file)}" alt="" loading="lazy"><figcaption>${f.t}s</figcaption></figure>`).join('')}</div>` : ''}
        <dl class="kv small"><dt>第一帧</dt><dd>${esc(h.firstFrame || '—')}</dd><dt>第一句话</dt><dd>${esc(h.spokenLine || '—')}</dd><dt>屏幕字</dt><dd>${esc(h.onScreenText || '—')}</dd><dt>声音</dt><dd>${esc(h.sound || '—')}</dd><dt>三者一致吗</dt><dd>${esc(h.aligned || '—')}</dd><dt>为什么停得住</dt><dd>${esc(h.whyStops || '—')}</dd><dt>筛选出什么人</dt><dd>${esc(h.whoItFilters || '—')}</dd><dt>还能怎么改</dt><dd>${esc(h.improve || '—')}</dd></dl></div>

      <div class="card"><div class="card-head"><h3>逐段拆解</h3></div><div class="table-wrap"><table class="timeline-table"><thead><tr><th>时间</th><th>画面</th><th>内容</th><th>说了什么</th><th>为什么这样拍</th></tr></thead><tbody>
        ${(a.timeline || []).map((s) => { const f = nearest(s.start ?? 0); return `<tr><td class="nowrap"><b>${esc(s.start)}–${esc(s.end)}s</b><div class="p-sub">${esc(PART[s.part] || s.part || '')}</div></td><td>${f ? `<img class="tl-frame" src="${frameSrc(v, f.file)}" alt="" loading="lazy">` : ''}</td><td>${esc(s.visual || '')}${s.camera ? `<div class="p-sub">${esc(s.camera)}</div>` : ''}</td><td>${esc(s.spoken || '')}${s.onScreenText ? `<div class="p-sub">屏幕字：${esc(s.onScreenText)}</div>` : ''}${s.audio ? `<div class="p-sub">声音：${esc(s.audio)}</div>` : ''}</td><td>${esc(s.purpose || '')}${s.retention ? `<div class="p-sub">留人：${esc(s.retention)}</div>` : ''}${s.emotion ? `<div class="p-sub">情绪：${esc(s.emotion)}</div>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>

      <div class="grid g2">
        <div class="card card-pad"><h4 class="rp-h">${icon('layers', 16)}结构和节奏</h4><p><b>${esc(a.structure?.formula || '')}</b></p><dl class="kv small"><dt>节奏</dt><dd>${esc(a.structure?.pacing || '—')}</dd><dt>产品出现</dt><dd>${esc(a.structure?.productFirstAt || '—')}</dd><dt>价格 / 优惠</dt><dd>${esc(a.structure?.priceAt || '—')}</dd><dt>最爽的一刻</dt><dd>${esc(a.structure?.payoff || '—')}</dd><dt>重看设计</dt><dd>${esc(a.structure?.rewatch || '—')}</dd></dl>${a.structure?.openLoops?.length ? `<div class="small muted mt">留下的悬念</div>${list(a.structure.openLoops)}` : ''}</div>
        <div class="card card-pad"><h4 class="rp-h">${icon('chart', 16)}评分（AI 判断）</h4><div class="score-bars">${Object.entries(SCORE).map(([k, t]) => { const s = a.scores?.[k] || {}; return `<div class="score-row"><span>${t}</span><div class="bar"><i style="width:${Math.min(100, Number(s.score) || 0)}%"></i></div><b>${esc(s.score ?? '—')}</b><small>${esc(s.why || '')}</small></div>`; }).join('')}</div>
          ${a.emotionCurve?.length ? `<div class="small muted mt">情绪曲线</div><div class="emotion">${a.emotionCurve.map((e) => `<div title="${esc(e.emotion)}"><i style="height:${Math.min(100, (Number(e.intensity) || 0) * 10)}%"></i><small>${esc(e.t)}</small><em>${esc(e.emotion)}</em></div>`).join('')}</div>` : ''}</div>
      </div>
      <div class="grid g2">
        <div class="card card-pad"><h4 class="rp-h">${icon('target', 16)}痛点和渴望</h4><dl class="kv small"><dt>给谁看</dt><dd>${esc(a.basics?.audience || '—')}</dd><dt>痛点</dt><dd>${esc(a.painAndDesire?.pain || '—')}</dd><dt>怎么放大</dt><dd>${esc(a.painAndDesire?.agitation || '—')}</dd><dt>渴望</dt><dd>${esc(a.painAndDesire?.desire || '—')}</dd><dt>场景</dt><dd>${esc(a.painAndDesire?.moment || '—')}</dd></dl></div>
        <div class="card card-pad"><h4 class="rp-h">${icon('zap', 16)}转化设计</h4><dl class="kv small"><dt>优惠</dt><dd>${esc(a.conversion?.offer || '—')}</dd><dt>行动号召</dt><dd>${esc(a.conversion?.cta || '—')}</dd><dt>紧迫感</dt><dd>${esc(a.conversion?.urgency || '—')}</dd><dt>引导评论</dt><dd>${esc(a.conversion?.commentBait || '—')}</dd></dl>${a.conversion?.objections?.length ? `<div class="small muted mt">处理的顾虑</div>${list(a.conversion.objections)}` : ''}${a.trust?.length ? `<div class="small muted mt">信任元素</div>${list(a.trust)}` : ''}</div>
      </div>
      ${a.sellingPoints?.length ? `<div class="card"><div class="card-head"><h3>卖点怎么讲</h3></div><div class="table-wrap"><table><thead><tr><th>卖点</th><th>怎么展示</th><th>证明方式</th></tr></thead><tbody>${a.sellingPoints.map((s) => `<tr><td>${esc(s.point)}</td><td>${esc(s.how)}</td><td>${esc(s.proof)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div class="card card-pad"><h4 class="rp-h">${icon('flow', 16)}可以复用的模板</h4><div class="hit accent" style="white-space:pre-wrap">${esc(a.reusable?.template || '')}</div>${a.reusable?.slots?.length ? `<dl class="kv small mt">${a.reusable.slots.map((s) => `<dt>${esc(s.slot)}</dt><dd>${esc(s.how)}</dd>`).join('')}</dl>` : ''}
        <div class="grid g2 mt"><div><div class="small muted">必须保留</div>${list(a.reusable?.mustKeep)}</div><div><div class="small muted">可以换</div>${list(a.reusable?.canChange)}</div></div></div>
      <div class="grid g2"><div class="card card-pad"><h4 class="rp-h">${icon('x', 16)}不能照搬</h4>${list(a.doNotCopy)}</div><div class="card card-pad"><h4 class="rp-h">${icon('x', 16)}合规风险</h4>${list(a.compliance)}${a.limits ? `<p class="small muted">这次分析的局限：${esc(a.limits)}</p>` : ''}</div></div>
      ${v.transcript?.text ? `<details class="card card-pad more"><summary>口播原文${v.transcript.source ? `（${esc(v.transcript.source)}）` : ''}</summary><p class="small" style="white-space:pre-wrap">${esc(v.transcript.text)}</p></details>` : ''}

      <div class="card card-pad col" id="learn"><h4 class="rp-h" style="margin:0">${icon('sparkles', 16)}学这条视频，写我的脚本</h4>
        <p class="small muted" style="margin:0">学结构、节奏和手法，用你的商品重新写，不照抄台词。第一条保留它的钩子类型，其余换不同开头，方便对比。</p>
        <div class="grid g2"><label class="field">我的商品<select class="input" id="l-pid"></select></label><div class="col" id="l-manual" hidden><label class="field">商品名称<input class="input" id="l-name"></label><label class="field">卖点（只写真实的）<input class="input" id="l-desc"></label></div></div>
        <div class="grid g3"><label class="field">写几条<select class="input" id="l-count"><option value="1">1 条</option><option value="3" selected>3 条</option><option value="5">5 条</option></select></label><label class="field">时长（秒）<input class="input" id="l-dur" type="number" min="5" max="120" value="${Math.min(60, Math.max(10, Math.round(m.duration || 20)))}"></label><label class="field">语言<select class="input" id="l-lang"><option>English</option><option>中文</option><option>Bahasa Melayu</option><option>Bahasa Indonesia</option><option>Español</option><option>ภาษาไทย</option><option>Tiếng Việt</option><option>日本語</option></select></label></div>
        <label class="field">额外要求（可选）<input class="input" id="l-extra" placeholder="例如：不露脸，只拍手"></label>
        <button class="btn lg primary-glow" id="l-go" data-loading="AI 正在写…">${icon('sparkles')}学习并生成脚本</button><div class="small muted" id="l-progress"></div><div class="col" id="l-out" style="gap:6px"></div></div>
    </div>`;
    bindCommon(v, box);
    $('#to-learn', box).onclick = (e) => { e.preventDefault(); $('#learn', box).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const products = (await api('/products?sort=score').catch(() => ({ items: [] }))).items.filter((p) => p.status !== 'dropped');
    if (!view.isConnected || !$('#l-pid', box)) return;
    $('#l-pid', box).innerHTML = `${products.map((p) => `<option value="${p.id}">${esc(nameText(p))}</option>`).join('')}<option value="">手动填写商品…</option>`;
    const syncManual = () => ($('#l-manual', box).hidden = !!$('#l-pid', box).value);
    if (!products.length) $('#l-pid', box).value = '';
    productPicker($('#l-pid', box), products);
    $('#l-pid', box).onchange = syncManual;
    syncManual();
    $('#l-go', box).onclick = (e) => withLoading(e.currentTarget, async () => {
      const count = Number($('#l-count', box).value);
      const avoid = [];
      const pid = $('#l-pid', box).value;
      const progress = $('#l-progress', box);
      try {
        for (let i = 0; i < count; i++) {
          progress.textContent = `正在写第 ${i + 1}/${count} 条，每条约半分钟…`;
          const s = await api(`/viral/${v.id}/scripts`, { method: 'POST', body: { productId: pid || undefined, productName: $('#l-name', box).value, productDesc: $('#l-desc', box).value, variant: i, avoid, duration: Number($('#l-dur', box).value), language: $('#l-lang', box).value, extra: $('#l-extra', box).value } });
          avoid.push(s.hook);
          $('#l-out', box).insertAdjacentHTML('beforeend', `<a class="list-item" href="#/scripts/${s.id}"><div style="min-width:0;flex:1"><b class="small">${esc(s.title)}</b><div class="muted small">${esc(s.hook)}${s.check ? ` · 自检 ${s.check.score} 分` : ''}</div></div>${icon('arrow', 14)}</a>`);
        }
        toast('脚本写好了，点开可以看详情、生成视频', 'success');
      } finally {
        progress.textContent = '';
      }
    });
  }

  function bindCommon(v, box) {
    const rr = $('#rerun', box);
    if (rr) rr.onclick = (e) => withLoading(e.currentTarget, async () => { await api(`/viral/${v.id}/rerun`, { method: 'POST' }); refreshAll(); });
    const dl = $('#del', box);
    if (dl) dl.onclick = async () => {
      if (!(await confirmBox('删除这条拆解和视频文件？'))) return;
      await api(`/viral/${v.id}`, { method: 'DELETE' });
      current = '';
      data = await api('/viral');
      current = data.items[0]?.id || '';
      renderList();
      loadDetail();
    };
  }

  async function refreshAll() {
    data = await api('/viral');
    if (!alive) return;
    renderList();
    loadDetail();
  }

  // 上传
  const dz = $('#dz', view), file = $('#file', view);
  async function send(f) {
    if (!f) return;
    if (f.size > data.maxMb * 1048576) return toast(`视频太大：最大 ${data.maxMb}MB`, 'error');
    const form = new FormData();
    form.append('video', f);
    for (const [k, id] of [['title', 'v-title'], ['url', 'v-url'], ['views', 'v-views'], ['likes', 'v-likes'], ['comments', 'v-comments'], ['shares', 'v-shares'], ['gmv', 'v-gmv'], ['notes', 'v-notes'], ['transcript', 'v-transcript']]) form.append(k, $(`#${id}`, view).value);
    const html = dz.innerHTML;
    dz.innerHTML = `<span class="spinner"></span><p>正在上传 ${esc(f.name)}…</p>`;
    try {
      const r = await api('/viral', { method: 'POST', form });
      current = r.id;
      await refreshAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      dz.innerHTML = html;
      const again = $('#file', view);
      again.onchange = () => send(again.files[0]);
    }
  }
  // 粘贴链接：服务器存好视频后自动开始拆解，这里等它出现
  let linkTimer = null;
  async function waitLink(id) {
    clearTimeout(linkTimer);
    if (!alive) return;
    const x = await api(`/tt-videos/${id}`).catch(() => null);
    const msg = $('#v-link-msg', view);
    if (!x || !msg) return;
    if (x.viralId) {
      msg.textContent = '已开始拆解。';
      current = x.viralId;
      return refreshAll();
    }
    if (x.dl === 'failed') return (msg.innerHTML = `<span class="down">下载失败：${esc(x.dlError || '')}</span>`);
    msg.innerHTML = `<span class="spinner"></span> 正在把 @${esc(x.author)} 的视频存到服务器，存好自动开始拆解…`;
    linkTimer = setTimeout(() => waitLink(id), 3000);
  }
  $('#v-link-go', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    const r = await api('/viral/link', { method: 'POST', body: { url: $('#v-link', view).value } });
    $('#v-link', view).value = '';
    waitLink(r.id);
  });
  dz.onclick = (e) => { if (e.target.id !== 'file') $('#file', view).click(); };
  file.onchange = () => send(file.files[0]);
  dz.ondragover = (e) => (e.preventDefault(), dz.classList.add('drag'));
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); send(e.dataTransfer.files[0]); };

  renderList();
  await loadDetail();
  return () => { alive = false; clearTimeout(poll); clearTimeout(linkTimer); };
}
