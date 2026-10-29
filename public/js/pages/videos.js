import { api, icon, esc, toast, withLoading, $, $$, empty, modal, confirmBox, statusBadge, timeAgo } from '../lib.js';
import { mountPlayer, thumb } from '../player.js';

const MOTIONS = [
  ['', '缓慢推近', 'Slow push-in camera, the product stays in focus, soft light sweeps across the surface, cinematic', 'zoom-in'],
  ['', '环绕展示', 'Smooth orbit camera around the product, 360 degree reveal, studio lighting', 'zoom-out'],
  ['', '横向平移', 'Smooth lateral pan from left to right, lifestyle scene, natural motion', 'pan-right'],
  ['', '手持实拍', 'Handheld UGC style camera, slight shake, person using the product, authentic TikTok vibe', 'pan-left'],
  ['', '高光闪耀', 'Sparkles and light flares around the product, magical reveal, slow motion', 'zoom-in'],
  ['', '快速冲击', 'Fast dynamic zoom, energetic motion, bold reveal for a viral hook', 'zoom-in'],
];

export async function render(view, [first, second]) {
  const [{ items }, { items: images }] = await Promise.all([api('/videos'), api('/images')]);
  let image = first === 'new' && second ? second : images[0]?.url || '';
  let motion = MOTIONS[0];
  let disposePlayer = null;
  view.innerHTML = `<div class="split">
    <div class="card card-pad col sticky">
      <h3 style="font-size:15px">${icon('video')} 图生视频</h3>
      <div class="field">首帧图片<div class="row" style="flex-wrap:nowrap;align-items:flex-start"><div class="media" id="img" style="width:110px;flex-shrink:0;cursor:pointer"></div><div class="col" style="gap:8px"><button class="btn sm ghost" id="pick">${icon('image', 15)}从图库选择</button><a class="btn sm ghost" href="#/images">${icon('sparkles', 15)}去生成图片</a></div></div></div>
      <div class="field">运镜模板<div class="preset-grid" id="mo">${MOTIONS.map((m, i) => `<div class="preset ${i === 0 ? 'on' : ''}" data-i="${i}"><span class="e">${m[0]}</span>${m[1]}</div>`).join('')}</div></div>
      <label class="field">运动描述<textarea class="input" id="prompt" rows="3">${MOTIONS[0][2]}</textarea></label>
      <label class="field">屏幕字幕（本地合成模式）<input class="input" id="cap" placeholder="Stop scrolling! You need this "></label>
      <div class="grid g2">
        <label class="field">时长<select class="input" id="dur"><option value="5">5 秒</option><option value="10">10 秒</option></select></label>
        <label class="field">比例<select class="input" id="ratio"><option>9:16</option><option>1:1</option><option>16:9</option></select></label>
      </div>
      <button class="btn grad block lg" id="gen" data-loading="提交中…">${icon('play')}生成视频</button>
      <p class="muted small" style="margin:0">未接入视频模型时，使用本地 Canvas 合成（Ken Burns 运镜 + 字幕），可导出 WebM；接入火山方舟 Seedance 等模型后生成真实 AI 视频。</p>
    </div>
    <div class="card"><div class="card-head"><h3>${icon('layers')}视频库</h3><span class="muted small" id="cnt"></span></div><div class="card-pad" id="list"></div></div>
  </div>`;

  const renderImg = () => ($('#img', view).innerHTML = image ? `<img src="${image}">` : `<div class="thumb-ph">${icon('image', 26)}</div>`);
  renderImg();
  const pick = () => modal({
    title: '选择首帧图片', wide: true,
    body: images.length ? `<div class="media-grid">${images.map((i) => `<div class="media" data-url="${i.url}"><img src="${i.url}" loading="lazy"><div class="cap">${esc(i.title || '')}</div></div>`).join('')}</div>` : empty('图库为空，请先生成图片', 'image', '<a class="btn sm" href="#/images" data-close>去生成</a>'),
    onMount(el, close) { $$('.media', el).forEach((m) => (m.onclick = () => { image = m.dataset.url; renderImg(); close(); })); },
  });
  $('#pick', view).onclick = pick;
  $('#img', view).onclick = pick;
  $$('#mo .preset', view).forEach((el) => (el.onclick = () => {
    motion = MOTIONS[el.dataset.i];
    $('#prompt', view).value = motion[2];
    $$('#mo .preset', view).forEach((x) => x.classList.toggle('on', x === el));
  }));

  function renderList() {
    $('#cnt', view).textContent = `${items.length} 个`;
    const box = $('#list', view);
    if (!items.length) return (box.innerHTML = empty('还没有视频，选择一张图片开始生成', 'video'));
    box.innerHTML = `<div class="media-grid">${items.map((v) => `<div class="media" data-id="${v.id}">${thumb(v)}<div class="st">${statusBadge(v.status)}</div>
      ${v.status === 'succeeded' ? `<div class="play-ico"><span>${icon('play', 20)}</span></div>` : ''}
      <div class="tools"><button data-a="del" title="删除">${icon('trash', 15)}</button></div>
      <div class="cap"><b>${esc(v.title)}</b><br><span style="opacity:.75">${v.kind === 'storyboard' ? `分镜合成 · ${v.storyboard?.length || 1} 段` : esc(v.provider)} · ${timeAgo(v.createdAt)}</span></div></div>`).join('')}</div>`;
    $$('.media', box).forEach((m) => (m.onclick = async (e) => {
      const v = items.find((x) => x.id === m.dataset.id);
      if (e.target.closest('[data-a=del]')) {
        if (!(await confirmBox('确定删除该视频？'))) return;
        await api(`/videos/${v.id}`, { method: 'DELETE' });
        items.splice(items.indexOf(v), 1);
        return renderList();
      }
      if (v.status === 'failed') return toast(v.error || '生成失败', 'error');
      if (v.status !== 'succeeded') return toast('视频生成中，请稍候…');
      openPlayer(v);
    }));
  }

  function openPlayer(v) {
    modal({
      title: esc(v.title),
      body: `<div id="pl"></div>${v.storyboard?.length > 1 ? `<div class="col mt">${v.storyboard.map((s, i) => `<div class="row small" style="flex-wrap:nowrap"><span class="chip">${i + 1}</span><span style="flex:1">${esc(s.caption || '')}</span><span class="muted">${s.duration}s · ${s.video ? 'AI 片段' : esc(s.motion)}</span></div>`).join('')}</div>` : ''}`,
      async onMount(el) {
        disposePlayer = await mountPlayer($('#pl', el), v, { autoplay: true });
        const obs = new MutationObserver(() => { if (!document.body.contains(el)) { disposePlayer?.(); obs.disconnect(); } });
        obs.observe(document.body, { childList: true });
      },
    });
  }

  $('#gen', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    if (!image) throw new Error('请先选择一张图片');
    const caption = $('#cap', view).value.trim();
    const duration = Number($('#dur', view).value);
    const v = await api('/videos/generate', { method: 'POST', body: { image, prompt: $('#prompt', view).value, duration, ratio: $('#ratio', view).value, title: caption || motion[1], scenes: [{ image, caption, duration, motion: motion[3] }] } });
    items.unshift(v);
    renderList();
    toast('视频任务已提交', 'success');
  });

  // 轮询进行中的任务
  const timer = setInterval(async () => {
    const pending = items.filter((v) => ['queued', 'running'].includes(v.status));
    if (!pending.length) return;
    let changed = false;
    for (const v of pending) {
      const n = await api(`/videos/${v.id}`).catch(() => null);
      if (n && n.status !== v.status) {
        Object.assign(v, n);
        changed = true;
        if (n.status === 'succeeded') toast(`视频「${n.title}」已生成`, 'success');
      }
    }
    if (changed) renderList();
  }, 1500);

  renderList();
  if (first && first !== 'new') {
    const v = items.find((x) => x.id === first);
    if (v) openPlayer(v);
  }
  return () => { clearInterval(timer); disposePlayer?.(); };
}
