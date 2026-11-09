// 批量出片：上传商品素材 → 每条分配不同的钩子和场景 → 先出关键帧并质检 → 人确认 → 只把合格的做成视频
import { api, icon, esc, toast, withLoading, $, $$, empty, confirmBox, timeAgo } from '../lib.js';
import { productPicker, nameText, zhName } from '../picker.js';

const STATUS = { preparing: ['准备中', 'run'], review: ['待确认', 'watch'], rendering: ['生成视频中', 'run'], done: ['完成', 'ok'], error: ['出错', 'err'] };
const money = (x) => (x == null ? '—' : `¥${Number(x).toFixed(Number(x) < 10 ? 2 : 1)}`);
const LANGS = ['English', 'Bahasa Melayu', 'Bahasa Indonesia', 'ภาษาไทย', 'Tiếng Việt', 'Español', '中文', '日本語'];

export async function render(view, [openId]) {
  let alive = true;
  let poll = null;
  if (openId) return detail(view, openId, () => alive, (t) => (poll = t), () => clearTimeout(poll)).then(() => () => { alive = false; clearTimeout(poll); });

  const d = await api('/studio');
  const { items: prods } = await api('/products').catch(() => ({ items: [] }));
  const assets = [];
  const people = [];
  view.innerHTML = `
  <div class="studio-why card card-pad">
    <div class="sw-step"><b>1</b><div><strong>商品图锁住长相</strong><span>上传几张真实商品图或一段实拍视频，模型照着画，商品不走样</span></div></div>
    <div class="sw-step"><b>2</b><div><strong>先出图，再出片</strong><span>每条先出 1–3 张关键帧（几毛钱一张），AI 对照真实商品打分，挑最好的</span></div></div>
    <div class="sw-step"><b>3</b><div><strong>只为合格的付视频钱</strong><span>你确认后才生成视频（一秒几毛到一块），成片再抽帧复检一次</span></div></div>
  </div>
  <div class="split studio-split">
    <div class="card card-pad col" id="new">
      <h3 style="margin:0;font-size:15px">新建一批</h3>
      ${d.video.length ? '' : `<div class="note-card warn">还没有接入视频模型。到 <a class="link-lime" href="#/providers">接入配置 → 视频与图片模型</a> 添加；你的中转站选「中转站（new-api 格式）」。</div>`}
      <h4 class="studio-sec">1 · 商品</h4>
      <div class="grid g2">
        <label class="field">选品库商品<select class="input" id="prod"><option value="">不选，下面手填</option>${prods.slice(0, 300).map((p) => `<option value="${p.id}">${esc(nameText(p))}</option>`).join('')}</select></label>
        <label class="field">商品名称<input class="input" id="pname" placeholder="例如 Waterproof 18K Gold Anklet"></label>
      </div>
      <label class="field">卖点和事实（只写真的，AI 不会编）<textarea class="input" id="points" rows="2" placeholder="例如：18K 镀金不锈钢，防水不褪色，可调节长度，RM 19.90"></textarea></label>
      <div class="field"><span>商品素材（图片或视频，可以不传）</span>
        <div class="dropzone sm" id="dz">${icon('upload', 22)}<p><b>拖入商品图片或实拍视频，或点击选择</b><br><span class="small">图片 JPG / PNG / WebP；视频会截 3 帧当参考图。最多 6 张参考图，正面、侧面、细节各一张最好</span></p><input type="file" id="files" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden></div>
        <div class="asset-row" id="assets"></div></div>
      <h4 class="studio-sec">2 · 怎么拍</h4>
      <div class="grid g3">
        <label class="field">视频格式<select class="input" id="format">${d.formats.map((x) => `<option value="${x.id}" title="${esc(x.desc)}">${esc(x.name)}</option>`).join('')}</select><span class="small muted" id="format-desc">${esc(d.formats[0]?.desc || '')}</span></label>
        <label class="field">做几条<input class="input" id="count" type="number" min="1" max="20" value="10"></label>
        <label class="field">每条时长（秒）<input class="input" id="secs" type="number" min="3" max="15" value="5"><span class="small muted">8 秒以上一次生成 2–3 个镜头</span></label>
      </div>
      <h4 class="studio-sec">3 · 模型和花费</h4>
      <div class="grid g2">
        <label class="field">视频模型<select class="input" id="vm">${d.video.flatMap((c) => c.models.map((m) => `<option value="${c.id}|${esc(m.id)}">${esc(c.name)} · ${esc(m.label || m.id)}${m.price !== '' && m.price != null ? `（¥${m.price}/${m.unit || '秒'}）` : ''}</option>`)).join('') || '<option value="">还没有</option>'}</select></label>
        <label class="field">关键帧图片模型<select class="input" id="im">${d.image.flatMap((c) => c.models.map((m) => `<option value="${c.id}|${esc(m.id)}">${esc(c.name)} · ${esc(m.label || m.id)}${m.price !== '' && m.price != null ? `（¥${m.price}/张）` : ''}</option>`)).join('')}<option value="direct">不用：直接出片（贵，商品容易走样）</option></select></label>
      </div>
      <div class="grid g2">
        <label class="field">每条出几张关键帧<select class="input" id="cands"><option value="1">1 张（最省）</option><option value="2" selected>2 张（推荐）</option><option value="3">3 张（最稳）</option></select></label>
        <label class="field">预算上限 ¥（可不填）<input class="input" id="budget" type="number" min="0" step="1" placeholder="例如 50"></label>
      </div>
      <details class="cs-more"><summary>${icon('chevron', 14)}更多设置：学爆款、统一人物、语言、口播、补充要求</summary><div class="col" style="gap:12px;padding-top:12px">
        <label class="field">学这条爆款的结构（可选）<select class="input" id="viral"><option value="">不学</option>${d.virals.map((v) => `<option value="${v.id}">${esc(String(v.title || '').slice(0, 40))}</option>`).join('')}</select><span class="small muted">${d.virals.length ? '学它的钩子、节奏和结构，不照抄台词画面' : '先到「爆款拆解」上传一条爆款视频'}</span></label>
      <div class="field"><span>统一人物（可选）：上传一张模特照片，这批视频都用同一个人</span>
        <div class="row" style="gap:8px"><button type="button" class="btn sm ghost" id="pbtn">${icon('upload', 14)}上传人物照片</button><input type="file" id="pfiles" accept="image/jpeg,image/png,image/webp" hidden><div class="asset-row" id="people"></div></div>
        <span class="small muted">用你有权使用的照片（自己、签约模特或 AI 生成的人），不要用别人的脸</span></div>
      <div class="grid g2">
        <label class="field">屏幕字 / 口播语言<select class="input" id="lang">${LANGS.map((l) => `<option>${l}</option>`).join('')}</select></label>
        <label class="field">直接出片的合格率（假设）<select class="input" id="pass"><option value="0.3">30%</option><option value="0.5" selected>50%</option><option value="0.7">70%</option></select></label>
      </div>
      <label class="switch"><input type="checkbox" id="audio"><span></span>让模型生成口播和声音（外语口型不一定准；不开也可以后期配音）</label>
      <label class="field">补充要求（可选）<input class="input" id="note" placeholder="例如：模特是东南亚年轻女性；不要出现室外场景"></label>
      </div></details>
      <div class="studio-est" id="est"></div>
      <div class="row"><div class="spacer"></div><button class="btn primary-glow" id="go" data-loading="准备中…" ${d.video.length ? '' : 'disabled'}>${icon('layers', 15)}开始：先出关键帧</button></div>
      ${d.canSee ? '' : '<p class="small muted" style="margin:0">没有能看图的模型时会跳过 AI 质检，关键帧要你自己挑。接一个免费的智谱 GLM-4.6V-Flash 就行。</p>'}
    </div>
    <div class="col" id="list"></div>
  </div>`;

  const lang = $('#lang', view);
  productPicker($('#prod', view), prods.slice(0, 300), { placeholder: '不选，下面手填' });
  lang.value = LANGS.includes(localStorage.getItem('studio-lang')) ? localStorage.getItem('studio-lang') : 'English';
  const form = () => {
    const [videoConnectorId, videoModel] = ($('#vm', view).value || '').split('|');
    const im = $('#im', view).value;
    const [imageConnectorId, imageModel] = im === 'direct' ? ['', ''] : im.split('|');
    return { videoConnectorId, videoModel, imageConnectorId, imageModel, direct: im === 'direct', count: Number($('#count', view).value), candidates: Number($('#cands', view).value), duration: Number($('#secs', view).value), passRate: Number($('#pass', view).value), budget: $('#budget', view).value, format: $('#format', view).value, viralId: $('#viral', view).value, personAssetIds: people.map((a) => a.id), audio: $('#audio', view).checked, language: lang.value, note: $('#note', view).value, productId: $('#prod', view).value, productName: $('#pname', view).value, sellingPoints: $('#points', view).value, assetIds: assets.map((a) => a.id) };
  };
  let timer = null;
  const estimate = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const box = $('#est', view);
      if (!d.video.length) return (box.innerHTML = '');
      try {
        const e = await api('/studio/estimate', { method: 'POST', body: form() });
        const save = e.total != null && e.directTotal != null && e.directTotal > e.total ? `，比直接出片省约 ${money(e.directTotal - e.total)}` : '';
        box.innerHTML = `<div class="est-main"><span>预计花费</span><b>${money(e.total)}</b><small>${e.count} 条 × ${e.seconds} 秒${save}</small></div>
          <div class="est-rows">${e.image ? `<div><span>关键帧 ${e.image.images} 张 × ${money(e.image.price)}</span><b>${money(e.image.yuan)}</b></div>` : ''}<div><span>视频 ${e.count} 条 × ${money(e.video.perVideo)}</span><b>${money(e.video.yuan)}</b></div>
          <div class="muted"><span>直接出片拿到 ${e.count} 条合格视频（合格率按 ${Math.round(e.passRate * 100)}% 算，不合格的也全价扣）</span><b>${money(e.directTotal)}</b></div></div>
          ${e.missing.length ? `<p class="small down" style="margin:6px 0 0">${esc(e.missing.join('、'))} 还没填单价，算不出花费：到 <a class="link-lime" href="#/providers">接入配置</a> 的「模型映射」填，中转站可以点「读取价格」。</p>` : ''}
          <p class="small muted" style="margin:6px 0 0">按你填的单价估算，实际以模型账单为准。失败的任务大多数平台不收费。</p>`;
      } catch (err) {
        box.innerHTML = `<p class="small down" style="margin:0">${esc(err.message)}</p>`;
      }
    }, 250);
  };
  $('#new', view).addEventListener('input', (e) => { if (!['pname', 'points', 'note'].includes(e.target.id)) estimate(); });
  $('#new', view).addEventListener('change', (e) => {
    if (e.target.id === 'lang') localStorage.setItem('studio-lang', lang.value);
    if (e.target.id === 'prod' && e.target.value) { const p = prods.find((x) => x.id === e.target.value); $('#pname', view).value = zhName(p) || p?.name || ''; }
    if (e.target.id === 'format') {
      $('#format-desc', view).textContent = d.formats.find((x) => x.id === e.target.value)?.desc || '';
      if (e.target.value === 'ugc') $('#audio', view).checked = true;
    }
    estimate();
  });
  estimate();

  const drawAssets = () => {
    $('#assets', view).innerHTML = assets.map((a, i) => `<div class="asset"><img src="/api/media/${a.id}" alt=""><button class="icon-btn" data-rm="${i}" title="移除">${icon('x', 12)}</button>${a.from === 'video' ? '<i>视频截帧</i>' : ''}</div>`).join('');
    $$('[data-rm]', view).forEach((b) => (b.onclick = () => { assets.splice(Number(b.dataset.rm), 1); drawAssets(); }));
  };
  const upload = async (files) => {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const dz = $('#dz', view);
    dz.classList.add('busy');
    try {
      const r = await api('/studio/assets', { method: 'POST', form: fd });
      assets.push(...r.items);
      if (assets.length > 6) toast(`参考图最多用 6 张，已有 ${assets.length} 张，只用前 6 张`, 'info');
      drawAssets();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      dz.classList.remove('busy');
    }
  };
  const drawPeople = () => {
    $('#people', view).innerHTML = people.map((a, i) => `<div class="asset sm"><img src="/api/media/${a.id}" alt=""><button class="icon-btn" data-prm="${i}" title="移除">${icon('x', 12)}</button></div>`).join('');
    $$('[data-prm]', view).forEach((b) => (b.onclick = () => { people.splice(Number(b.dataset.prm), 1); drawPeople(); }));
  };
  $('#pbtn', view).onclick = () => $('#pfiles', view).click();
  $('#pfiles', view).onchange = async (e) => {
    const fd = new FormData();
    for (const f of e.target.files) fd.append('files', f);
    try {
      const r = await api('/studio/assets', { method: 'POST', form: fd });
      people.splice(0, people.length, ...r.items.slice(0, 2));
      drawPeople();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const dz = $('#dz', view);
  dz.onclick = () => $('#files', view).click();
  $('#files', view).onchange = (e) => upload([...e.target.files]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); upload([...e.dataTransfer.files]); };

  $('#go', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    const b = await api('/studio', { method: 'POST', body: form() });
    toast('已开始：先写画面、出关键帧，好了会提醒你确认', 'success');
    location.hash = `#/scripts/studio/${b.id}`;
  });

  const drawList = (items) => {
    $('#list', view).innerHTML = items.length ? items.map((b) => { const s = STATUS[b.status] || STATUS.error; return `<a class="card studio-item" href="#/scripts/studio/${b.id}">${b.cover ? `<img src="/api/media/${b.cover}" alt="">` : `<div class="si-ph">${icon('layers', 22)}</div>`}<div class="col" style="gap:4px;min-width:0"><b class="small">${esc(b.title)}</b><span class="small muted">${esc(b.step || '')}</span><span class="small"><span class="clip clip-${s[1]}">${s[0]}</span> 已花 ${money(b.spent.imageYuan + b.spent.videoYuan)} · ${b.videos} 条视频 · ${timeAgo(b.createdAt)}</span></div></a>`; }).join('')
      : `<div class="card">${empty('还没有批次。左边上传商品图，设置条数和模型，点「开始」', 'layers')}</div>`;
    clearTimeout(poll);
    if (items.some((b) => ['preparing', 'rendering'].includes(b.status))) poll = setTimeout(async () => alive && view.isConnected && drawList((await api('/studio')).items), 5000);
  };
  drawList(d.items);
  return () => { alive = false; clearTimeout(poll); };
}

// ---------- 一批的详情 ----------
async function detail(view, id, alive, setPoll, stopPoll) {
  let b;
  const load = async () => {
    b = await api(`/studio/${id}`);
    if (!alive() || !view.isConnected) return;
    draw();
    stopPoll();
    if (['preparing', 'rendering'].includes(b.status) || b.briefs.some((x) => x.candidates.some((c) => ['running', 'checking'].includes(c.status)))) setPoll(setTimeout(load, 4000));
  };
  const qcBadge = (qc) => {
    if (!qc) return '';
    if (qc.skipped) return `<span class="qc qc-skip" title="${esc(qc.reason)}">未质检</span>`;
    return `<span class="qc ${qc.pass ? 'qc-ok' : 'qc-bad'}" title="${esc([qc.sameProduct != null ? `像真实商品 ${qc.sameProduct}` : '', `抓眼 ${qc.stopPower}`, ...(qc.problems || [])].filter(Boolean).join('；'))}">${qc.score}</span>`;
  };
  const card = (x) => {
    const v = x.video;
    const vs = v ? ({ pending: '排队', running: '生成中', checking: '复检中', done: '完成', failed: '失败' })[v.status] : '';
    return `<div class="card brief ${x.approved ? 'on' : ''}" data-n="${x.n}">
      <div class="brief-h"><b>${x.n}</b><div class="col" style="gap:2px;min-width:0"><strong class="small">${esc(x.angle)}</strong><span class="small muted">${esc(x.hookName)} · ${esc(x.sceneName)}</span></div>
        <label class="switch sm" title="要不要生成这条视频"><input type="checkbox" data-approve ${x.approved ? 'checked' : ''} ${v && v.status !== 'failed' ? 'disabled' : ''}><span></span></label></div>
      ${v?.mediaId ? `<video src="/api/media/${v.mediaId}" controls preload="metadata" playsinline class="brief-video"></video><div class="row small" style="gap:6px">${qcBadge(v.qc)}<span class="muted">${v.qc && !v.qc.skipped && v.qc.problems?.length ? esc(v.qc.problems.join('、')) : v.qc?.pass ? '复检通过' : ''}</span><div class="spacer"></div><a class="btn sm ghost" href="/api/studio/${b.id}/briefs/${x.n}/srt" title="剪映 / CapCut 可以导入">字幕</a><a class="btn sm ghost" href="/api/media/${v.mediaId}?download=1">${icon('download', 13)}下载</a></div>`
        : b.mode === 'keyframe' ? `<div class="kf-row">${x.candidates.map((c, i) => `<button class="kf ${x.pick === i ? 'on' : ''}" data-pick="${i}" ${c.status !== 'done' ? 'disabled' : ''} title="${esc(c.error || '')}">${c.mediaId ? `<img src="/api/media/${c.mediaId}" alt="">` : `<span class="kf-ph">${c.status === 'failed' ? icon('x', 18) : '<span class="spinner"></span>'}</span>`}${c.status === 'checking' ? '<span class="qc qc-skip">质检中</span>' : qcBadge(c.qc)}</button>`).join('')}</div>
          ${x.candidates.find((c) => c.status === 'failed') ? `<div class="small down">${esc(x.candidates.find((c) => c.status === 'failed').error)}</div>` : ''}
          ${x.pick != null && x.candidates[x.pick]?.qc?.problems?.length ? `<div class="small" style="color:var(--warn)">${esc(x.candidates[x.pick].qc.problems.join('、'))}</div>` : ''}` : ''}
      ${v && v.status !== 'done' ? `<div class="small ${v.status === 'failed' ? 'down' : 'muted'}">视频：${vs}${v.error ? `：${esc(v.error)}` : ''}</div>` : ''}
      <label class="field small">屏幕字<input class="input" data-edit="caption" value="${esc(x.caption)}" placeholder="后期在剪映 / TikTok 里加"></label>
      <label class="field small">口播<textarea class="input" data-edit="voiceover" rows="2">${esc(x.voiceover)}</textarea></label>
      <details class="more"><summary>提示词和思路</summary><div class="col mt" style="gap:8px"><p class="small muted" style="margin:0">${esc(x.why)}</p>
        ${b.mode === 'keyframe' ? `<label class="field small">关键帧提示词（改了之后点「再出一张」生效）<textarea class="input mono" data-edit="keyframe" rows="4">${esc(x.keyframe)}</textarea></label>` : ''}
        <label class="field small">动作提示词<textarea class="input mono" data-edit="motion" rows="3">${esc(x.motion)}</textarea></label></div></details>
      ${b.mode === 'keyframe' && !v ? `<div class="row" style="gap:6px;flex-wrap:nowrap"><input class="input" data-note placeholder="哪里不满意？例如：手离镜头再近一点" style="height:32px"><button class="btn sm ghost" data-regen data-loading="出图中…">${icon('refresh', 13)}再出一张</button></div>` : ''}
    </div>`;
  };
  function draw() {
    const s = STATUS[b.status] || STATUS.error;
    const spent = b.spent.imageYuan + b.spent.videoYuan;
    const doneVideos = b.briefs.filter((x) => x.video?.status === 'done').length;
    const failedVideos = b.briefs.filter((x) => x.video?.status === 'failed').length;
    view.innerHTML = `
    <div class="row" style="margin-bottom:10px"><a class="btn sm ghost" href="#/scripts/studio">${icon('arrow', 14)}全部批次</a><div class="spacer"></div></div>
    <div class="card card-pad studio-head">
      <div class="col" style="gap:4px;min-width:0"><div class="row" style="gap:8px"><h3 style="margin:0;font-size:16px">${esc(b.title)}</h3><span class="clip clip-${s[1]}">${s[0]}</span></div>
        <span class="small muted">${esc(b.step || '')}${b.error ? ` · <span class="down">${esc(b.error)}</span>` : ''}</span>
        <span class="small">${esc(b.formatName || '')}${b.viral ? ` · 学「${esc(String(b.viral.title || '').slice(0, 24))}」的结构` : ''}</span>
        <span class="small">已花约 <b>${money(spent)}</b>（关键帧 ${b.spent.images} 张 ${money(b.spent.imageYuan)}，视频 ${b.spent.videos} 条 ${money(b.spent.videoYuan)}）· 预计全部 ${money(b.estimate?.total)}${b.budget ? ` · 预算 ¥${b.budget}` : ''} · ${b.seconds} 秒 · ${esc(b.videoModel)}${b.imageModel ? ` · 关键帧 ${esc(b.imageModel)}` : ''}</span>
        ${b.refs.length ? `<div class="asset-row">${b.refs.map((r) => `<div class="asset sm"><img src="/api/media/${r.id}" alt="" title="${esc(r.title)}"></div>`).join('')}<span class="small muted">参考图</span>${b.personRefs?.length ? b.personRefs.map((r) => `<div class="asset sm"><img src="/api/media/${r.id}" alt="" title="人物"></div>`).join('') + '<span class="small muted">人物</span>' : ''}</div>` : '<span class="small" style="color:var(--warn)">没有商品图：画面以人和场景为主，商品镜头建议用实拍替换</span>'}</div>
      <div class="studio-actions">
        ${b.next && b.next.count ? `<button class="btn primary-glow" id="render" data-loading="提交中…">${icon('video', 15)}生成 ${b.next.count} 条视频${b.next.yuan != null ? `（约 ${money(b.next.yuan)}）` : ''}</button>` : ''}
        ${b.status === 'error' || failedVideos ? `<button class="btn ghost" id="retry" data-loading="提交中…">${icon('refresh', 14)}重试</button>` : ''}
        ${doneVideos ? `<a class="btn ghost" href="/api/studio/${b.id}/export">${icon('file', 14)}发布清单</a>` : ''}
        ${['preparing', 'rendering'].includes(b.status) ? '' : `<button class="icon-btn danger" id="del" title="删除这批">${icon('trash', 15)}</button>`}
      </div>
    </div>
    ${b.status === 'review' ? `<div class="note-card" style="margin:12px 0">点关键帧可以换一张；右上角开关决定要不要做成视频。分数是 AI 对照真实商品的打分（像不像 60% + 抓不抓眼 40%），商品不像的默认不勾。<b>发布前</b>逐条对比真实商品，打开「AI-generated content」标识。</div>` : ''}
    ${b.status === 'preparing' && !b.briefs.length ? `<div class="card">${empty('正在按钩子和场景写每条的画面和文案…', 'sparkles')}</div>` : ''}
    <div class="brief-grid">${b.briefs.map(card).join('')}</div>`;
    bind();
  }
  function bind() {
    const r = $('#render', view);
    if (r) r.onclick = (e) => withLoading(e.currentTarget, async () => { await api(`/studio/${id}/render`, { method: 'POST' }); toast('已提交，视频好了会出现在每条卡片里', 'success'); load(); });
    const rt = $('#retry', view);
    if (rt) rt.onclick = (e) => withLoading(e.currentTarget, async () => { await api(`/studio/${id}/retry`, { method: 'POST' }); load(); });
    const del = $('#del', view);
    if (del) del.onclick = async () => {
      if (!(await confirmBox('删除这一批？关键帧和视频文件会一起删掉，找不回来。'))) return;
      await api(`/studio/${id}`, { method: 'DELETE' });
      location.hash = '#/scripts/studio';
    };
    $$('.brief', view).forEach((el) => {
      const n = el.dataset.n;
      const patch = (body) => api(`/studio/${id}/briefs/${n}`, { method: 'PATCH', body }).then(load).catch((e) => toast(e.message, 'error'));
      $$('[data-pick]', el).forEach((btn) => (btn.onclick = () => patch({ pick: Number(btn.dataset.pick), approved: true })));
      const ap = $('[data-approve]', el);
      if (ap) ap.onchange = () => patch({ approved: ap.checked });
      $$('[data-edit]', el).forEach((i) => (i.onchange = () => api(`/studio/${id}/briefs/${n}`, { method: 'PATCH', body: { [i.dataset.edit]: i.value } }).then(() => toast('已保存', 'success'))));
      const rg = $('[data-regen]', el);
      if (rg) rg.onclick = (e) => withLoading(e.currentTarget, async () => {
        await api(`/studio/${id}/briefs/${n}/regen`, { method: 'POST', body: { note: $('[data-note]', el).value } });
        await load();
      });
    });
  }
  await load();
}
