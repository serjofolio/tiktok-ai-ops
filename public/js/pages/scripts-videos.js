// 视频库：脚本生成的视频。这个文件也导出「生成视频」对话框，写脚本和拆解页都会用
import { api, icon, esc, toast, withLoading, $, $$, empty, modal, confirmBox, timeAgo } from '../lib.js';

const CLIP = { pending: ['等待', 'muted'], running: ['生成中', 'run'], done: ['完成', 'ok'], failed: ['失败', 'err'] };

export async function videoDialog(script) {
  const { items: _jobs, models } = await api('/video-jobs');
  if (!models.length) {
    modal({
      title: '还没有接入视频模型',
      body: `<p>到「接入配置 → 视频模型」添加一个就能用。支持 Seedance、可灵、通义万相、海螺，也可以填其他模型或中转站的接口。</p><p class="muted small">接入后回到这里，点「生成视频」就能直接出片，生成的视频会存到「视频库」，可以播放和下载。</p>`,
      footer: `<button class="btn ghost" data-close>关闭</button><a class="btn" href="#/providers" data-close>去接入配置</a>`,
    });
    return;
  }
  const scenes = script.scenes || [];
  const product = script.productId ? await api(`/products/${script.productId}`).catch(() => null) : null;
  modal({
    title: `生成视频：${esc(script.title)}`, wide: true,
    body: `<form class="col" id="vf">
      <div class="grid g3">
        <label class="field">视频模型<select class="input" name="connectorId">${models.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
        <label class="field">生成方式<select class="input" name="mode"><option value="scenes">分镜逐段生成，再合并</option><option value="whole">整条一次生成（人物和画面更连贯）</option></select></label>
        <label class="field">画面比例<select class="input" name="ratio"><option value="9:16">竖屏 9:16</option><option value="1:1">方形 1:1</option><option value="16:9">横屏 16:9</option></select></label>
      </div>
      <div class="grid g2">
        <label class="field">首帧图片（让画面更接近真实商品）<select class="input" name="imageSource"><option value="">不用</option>${product?.image ? '<option value="product" selected>用商品主图</option>' : ''}<option value="upload">上传我拍的图</option></select></label>
        <label class="field" id="img-field" hidden>选择图片<input class="input" type="file" name="image" accept="image/jpeg,image/png,image/webp"></label>
      </div>
      <label class="switch"><input type="checkbox" name="audio"><span></span>让模型生成声音和口播（模型支持才有效，外语口型不一定准，也可以后期配音）</label>
      <div class="field">要生成的镜头 <label class="row small" style="gap:6px;font-weight:400"><input type="checkbox" id="skip-product"> 跳过有商品的镜头（这些镜头用实拍替换，最稳妥）</label>
        <div class="scene-picks">${scenes.map((s) => `<label class="scene-pick"><input type="checkbox" name="scene" value="${s.n}" checked data-product="${s.productVisible ? 1 : ''}"><span><b>${s.n}</b> ${esc(s.duration)} 秒 · ${esc(String(s.visual || '').slice(0, 42))}${s.productVisible ? ' <i class="tag-type">有商品</i>' : ''}</span></label>`).join('')}</div></div>
      <div class="note-card warn"><b>发布前必看：</b>TikTok Shop 禁止用 AI 改变商品的尺寸、颜色、材质、形状、数量，也不允许把静态商品做成动画，违规可能被限流、移除商品链接甚至封号。生成后请逐段对比真实商品，发布时打开「AI-generated content」标识。<a class="link-lime" href="#/scripts/playbook" data-close>看详细规则</a></div>
      <p class="small" id="plan" style="margin:0"></p></form>`,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn primary-glow" id="go" data-loading="提交中…">${icon('video', 15)}开始生成</button>`,
    onMount(el, close) {
      const f = $('#vf', el);
      const chosen = () => $$('[name=scene]', f).filter((c) => c.checked).map((c) => Number(c.value));
      const refresh = async () => {
        const out = $('#plan', el);
        try {
          const p = await api('/video-jobs/plan', { method: 'POST', body: { scriptId: script.id, connectorId: f.connectorId.value, mode: f.mode.value, sceneNs: chosen() } });
          const trimmed = p.clips.some((c) => c.duration > c.target);
          out.className = 'small';
          out.innerHTML = `将提交 <b>${p.tasks} 个任务，共 ${p.seconds} 秒</b>，费用由你的模型账号按量扣除。${trimmed ? '这个模型有最短时长限制，有的镜头会多生成几秒，合并时裁掉（多的部分也计费）。' : ''}${p.mode === 'scenes' && p.tasks > 1 ? '每段单独生成，人物和背景可能不完全一致。' : ''}`;
          $('#go', el).disabled = false;
        } catch (e) {
          out.className = 'small down';
          out.textContent = e.message;
          $('#go', el).disabled = true;
        }
      };
      f.onchange = (e) => {
        if (e.target.name === 'imageSource') $('#img-field', el).hidden = e.target.value !== 'upload';
        if (e.target.id === 'skip-product') $$('[name=scene]', f).forEach((c) => { if (c.dataset.product) c.checked = !e.target.checked; });
        if (e.target.name !== 'image') refresh();
      };
      refresh();
      $('#go', el).onclick = (e) => withLoading(e.currentTarget, async () => {
        const body = { scriptId: script.id, connectorId: f.connectorId.value, mode: f.mode.value, ratio: f.ratio.value, audio: f.audio.checked, sceneNs: chosen(), imageSource: f.imageSource.value };
        if (f.imageSource.value === 'upload') {
          if (!f.image.files[0]) throw new Error('请选择首帧图片');
          const form = new FormData();
          form.append('image', f.image.files[0]);
          body.imageMediaId = (await api('/media/image', { method: 'POST', form })).id;
          body.imageSource = '';
        }
        await api('/video-jobs', { method: 'POST', body });
        close();
        toast('已开始生成，可以去忙别的，完成后在视频库里看', 'success');
        location.hash = '#/scripts/videos';
      });
    },
  });
}

export async function render(view) {
  let poll = null;
  let alive = true;

  async function load() {
    const d = await api('/video-jobs');
    if (!alive) return;
    const box = view;
    const top = `<div class="row" style="margin-bottom:12px"><span class="muted small">生成的视频保存在你的服务器上，模型服务商的链接过期也不影响。已用 ${d.storage.usedMb} MB${d.storage.quotaMb ? ` / ${d.storage.quotaMb} MB` : ''}。</span><div class="spacer"></div>${d.models.length ? '' : `<a class="btn sm" href="#/providers">${icon('link', 14)}接入视频模型</a>`}</div>`;
    if (!d.items.length) {
      box.innerHTML = `${top}<div class="card">${empty(d.models.length ? '还没有视频。到「写脚本」选一个脚本，点「生成视频」' : '先到「接入配置 → 视频模型」接入一个模型，再回来从脚本生成视频', 'video', d.models.length ? '<a class="btn" href="#/scripts">去写脚本</a>' : '<a class="btn" href="#/providers">去接入配置</a>')}</div>`;
      return;
    }
    box.innerHTML = `${top}<div class="video-grid">${d.items.map(jobCard).join('')}</div>`;
    $$('[data-act]', box).forEach((b) => (b.onclick = async () => {
      const id = b.closest('[data-job]').dataset.job;
      if (b.dataset.act === 'retry') {
        await withLoading(b, () => api(`/video-jobs/${id}/retry`, { method: 'POST' }));
        load();
      } else if (b.dataset.act === 'del') {
        if (!(await confirmBox('删除这个视频？文件会从服务器上删掉，找不回来。'))) return;
        await api(`/video-jobs/${id}`, { method: 'DELETE' });
        load();
      }
    }));
    clearTimeout(poll);
    if (d.items.some((j) => j.status === 'running')) poll = setTimeout(() => alive && view.isConnected && load(), 5000);
  }

  function jobCard(j) {
    const failed = (j.clips || []).filter((x) => x.status === 'failed');
    return `<div class="card video-card" data-job="${j.id}">
      ${j.mediaId ? `<video src="/api/media/${j.mediaId}" controls preload="metadata" playsinline class="video-el ${j.ratio === '16:9' ? 'wide' : ''}"></video>` : `<div class="video-ph">${j.status === 'running' ? '<span class="spinner"></span>' : icon('video', 30)}<span class="small muted">${esc(j.step || '')}</span></div>`}
      <div class="card-pad col" style="gap:8px">
        <b class="small">${esc(j.title)}</b>
        <div class="muted small">${esc(j.connectorName)}${j.model ? ` · ${esc(j.model)}` : ''} · ${j.mode === 'whole' ? '整条生成' : `${j.clips.length} 段`} · ${timeAgo(j.createdAt)}${j.duration ? ` · ${Math.round(j.duration)} 秒` : ''}</div>
        ${j.status === 'error' ? `<div class="small down">${esc(j.error)}</div>` : ''}${j.warning ? `<div class="small" style="color:var(--warn)">${esc(j.warning)}</div>` : ''}
        <div class="clips">${(j.clips || []).map((x, i) => { const c = CLIP[x.status] || CLIP.pending; return `<span class="clip clip-${c[1]}" title="${esc(x.error || '')}">${x.mediaId ? `<a href="/api/media/${x.mediaId}?download=1">第 ${(x.scenes || [i + 1]).join('、')} 镜 ${icon('download', 11)}</a>` : `第 ${(x.scenes || [i + 1]).join('、')} 镜 · ${c[0]}`}</span>`; }).join('')}</div>
        ${failed.length ? `<div class="small down">${esc(failed[0].error || '')}</div>` : ''}
        ${j.status === 'done' ? '<div class="small" style="color:var(--warn)">发布前：对比真实商品，打开 AI 标识</div>' : ''}
        <div class="row">${j.mediaId ? `<a class="btn sm" href="/api/media/${j.mediaId}?download=1">${icon('download', 14)}下载</a>` : ''}${failed.length && j.status !== 'running' ? `<button class="btn sm ghost" data-act="retry" data-loading="提交中…">${icon('refresh', 14)}重试失败的段</button>` : ''}<div class="spacer"></div>${j.status !== 'running' ? `<button class="icon-btn danger" data-act="del" title="删除">${icon('trash', 15)}</button>` : ''}</div>
      </div></div>`;
  }

  await load();
  return () => { alive = false; clearTimeout(poll); };
}
