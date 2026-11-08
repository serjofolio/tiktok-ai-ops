// AI 出片创作台：不用等脚本，自己写分镜就能出片；也可以把脚本导进来改、插镜头、删镜头再出片
// 每个镜头可以有自己的首帧图（上传或用图片模型生成），商品参考图让支持参考图的模型照着画商品
import { api, icon, esc, toast, withLoading, $, $$ } from '../lib.js';

const KEY = 'create-draft';
const blankShot = () => ({ prompt: '', duration: 5, voiceover: '', imageMediaId: '', visual: '', caption: '' });
const money = (x) => (x == null ? '—' : `¥${Number(x).toFixed(2)}`);
const LANGS = ['English', 'Bahasa Melayu', 'Bahasa Indonesia', 'ภาษาไทย', 'Tiếng Việt', 'Español', '中文', '日本語'];

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.shots) && d.shots.length) return d;
  } catch {}
  return null;
}
function saveDraft(st) {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {}
}

export async function render(view, [scriptId]) {
  const [d, sd] = await Promise.all([api('/studio'), api('/scripts')]);
  const opts = (list, unit) => list.flatMap((c) => c.models.map((m) => `<option value="${c.id}|${esc(m.id)}">${esc(c.name)} · ${esc(m.label || m.id)}${m.price !== '' && m.price != null ? `（¥${m.price}/${m.unit || unit}）` : ''}</option>`)).join('');
  let st = loadDraft() || { title: '', scriptId: '', language: 'English', video: '', image: '', mode: 'scenes', ratio: '9:16', variants: 1, audio: false, guard: true, refs: [], shots: [blankShot()] };

  // 从脚本导入：每个镜头带上英文提示词、时长、口播，中文画面说明留作参考
  const fromScript = (s) => ({
    ...st, title: s.title, scriptId: s.id, language: s.language || st.language,
    shots: (s.scenes || []).map((x) => ({ prompt: x.videoPrompt || '', duration: Number(x.duration) || 4, voiceover: x.voiceover || '', imageMediaId: '', visual: [x.shot, x.visual].filter(Boolean).join(' · '), caption: x.caption || '', part: x.part || '' })),
  });
  if (scriptId) {
    const s = sd.items.find((x) => x.id === scriptId);
    if (s) st = fromScript(s);
  }

  view.innerHTML = `
  <div class="card card-pad col create-top">
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <input class="input" id="title" placeholder="给这条视频起个名字" style="flex:1;min-width:200px">
      <select class="input" id="imp" style="width:auto;max-width:280px"><option value="">从脚本导入…</option>${sd.items.map((s) => `<option value="${s.id}">${esc(String(s.title || '').slice(0, 36))}</option>`).join('')}</select>
      <button class="btn sm ghost" id="save" data-loading="保存中…">${icon('check', 14)}存成脚本</button>
      <button class="btn sm ghost" id="clear">${icon('refresh', 14)}清空</button>
    </div>
    <p class="small muted" style="margin:0">不用等脚本：直接写分镜就能出片。导入的脚本可以随便改、插镜头、删镜头，改好可以「存成脚本」。草稿自动保存在这个浏览器里。</p>
    ${d.video.length ? '' : `<div class="note-card warn" style="margin:0">还没有接入视频模型。到 <a class="link-lime" href="#/providers">接入配置 → 视频与图片模型</a> 添加；你的中转站选「中转站（new-api / OpenAI 兼容格式）」。</div>`}
    <div class="grid g3">
      <label class="field">视频模型<select class="input" id="video">${opts(d.video, '秒') || '<option value="">还没有</option>'}</select></label>
      <label class="field">生成方式<select class="input" id="mode"><option value="scenes">每个镜头单独生成，再合并</option><option value="whole">整条一次生成（多镜头更连贯）</option></select></label>
      <label class="field">画面比例<select class="input" id="ratio"><option value="9:16">竖屏 9:16</option><option value="1:1">方形 1:1</option><option value="3:4">3:4</option><option value="16:9">横屏 16:9</option></select></label>
    </div>
    <div class="grid g3">
      <label class="field">出几个版本<select class="input" id="variants"><option value="1">1 个</option><option value="2">2 个（挑好的）</option><option value="3">3 个</option><option value="4">4 个</option></select></label>
      <label class="field">首帧图片模型（AI 出首帧用）<select class="input" id="image">${opts(d.image, '张') || '<option value="">没有接入，只能上传首帧</option>'}</select></label>
      <label class="field">口播语言<select class="input" id="lang">${LANGS.map((l) => `<option>${l}</option>`).join('')}</select></label>
    </div>
    <div class="row" style="gap:18px;flex-wrap:wrap">
      <label class="switch"><input type="checkbox" id="audio"><span></span>生成声音和口播（模型支持才有效）</label>
      <label class="switch"><input type="checkbox" id="guard"><span></span>自动加商品保护语（不变形、不加东西、不写字）</label>
    </div>
    <div class="field"><span>商品参考图（可选）：没有首帧图的镜头，支持参考图的模型（Seedance、中转站）会照着它画商品；AI 出首帧也会用它</span>
      <div class="row" style="gap:8px"><button type="button" class="btn sm ghost" id="refbtn">${icon('upload', 14)}上传商品图</button><input type="file" id="reffiles" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden><div class="asset-row" id="refs"></div></div></div>
  </div>
  <div id="shots" class="col" style="gap:12px;margin-top:14px"></div>
  <div class="row" style="margin-top:12px"><button class="btn ghost" id="add">${icon('plus', 15)}添加镜头</button></div>
  <div class="create-bar card"><div class="small" id="plan"></div><div class="spacer"></div><button class="btn primary-glow" id="go" data-loading="提交中…" ${d.video.length ? '' : 'disabled'}>${icon('video', 15)}开始生成</button></div>`;

  const f = (id) => $(`#${id}`, view);
  const pick = (sel, val) => { if (val && [...sel.options].some((o) => o.value === val)) sel.value = val; };
  f('title').value = st.title || '';
  pick(f('video'), st.video);
  pick(f('image'), st.image);
  pick(f('mode'), st.mode);
  pick(f('ratio'), st.ratio);
  pick(f('variants'), String(st.variants));
  pick(f('lang'), st.language);
  f('audio').checked = !!st.audio;
  f('guard').checked = st.guard !== false;

  const readTop = () => {
    Object.assign(st, { title: f('title').value, video: f('video').value, image: f('image').value, mode: f('mode').value, ratio: f('ratio').value, variants: Number(f('variants').value), language: f('lang').value, audio: f('audio').checked, guard: f('guard').checked });
  };
  const body = () => {
    readTop();
    const [connectorId, model] = (st.video || '').split('|');
    return { title: st.title, scriptId: st.scriptId, connectorId, model, mode: st.mode, ratio: st.ratio, variants: st.variants, audio: st.audio, guard: st.guard, language: st.language, refAssetIds: st.refs.map((r) => r.id), shots: st.shots };
  };

  let timer = null;
  const replan = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      saveDraft(st);
      const out = f('plan');
      if (!d.video.length) return;
      if (st.shots.some((s) => !s.prompt.trim())) {
        out.className = 'small muted';
        out.textContent = `每个镜头写好画面后，这里显示要花多少（${st.shots.length} 个镜头）`;
        return;
      }
      try {
        const p = await api('/video-jobs/free/plan', { method: 'POST', body: body() });
        out.className = 'small';
        const trimmed = p.clips.some((c) => c.duration > c.target);
        out.innerHTML = `${p.variants > 1 ? `${p.variants} 个版本，` : ''}共 <b>${p.totalTasks} 个任务、${p.totalSeconds} 秒</b>，约 <b>${money(p.yuan)}</b>${p.yuan == null ? '（这个模型没填单价，到接入配置的模型映射里填）' : ''}${trimmed ? '。模型有最短时长，有的镜头会多生成几秒再裁掉' : ''}`;
        f('go').disabled = false;
      } catch (e) {
        out.className = 'small down';
        out.textContent = e.message;
        f('go').disabled = true;
      }
    }, 300);
  };

  const drawRefs = () => {
    f('refs').innerHTML = st.refs.map((a, i) => `<div class="asset sm"><img src="/api/media/${a.id}" alt=""><button class="icon-btn" data-rref="${i}" title="移除">${icon('x', 12)}</button></div>`).join('');
    $$('[data-rref]', view).forEach((b) => (b.onclick = () => { st.refs.splice(Number(b.dataset.rref), 1); drawRefs(); replan(); }));
  };
  const upload = async (files) => {
    const fd = new FormData();
    for (const x of files) fd.append('files', x);
    return (await api('/studio/assets', { method: 'POST', form: fd })).items;
  };
  f('refbtn').onclick = () => f('reffiles').click();
  f('reffiles').onchange = async (e) => {
    try {
      st.refs.push(...(await upload([...e.target.files])));
      st.refs = st.refs.slice(0, 6);
      drawRefs();
      replan();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  function drawShots() {
    f('shots').innerHTML = st.shots.map((s, i) => `<div class="card shot" data-i="${i}">
      <div class="shot-h"><b>镜头 ${i + 1}</b>${s.part ? `<span class="chip">${esc(s.part)}</span>` : ''}<label class="row small" style="gap:6px">时长<input class="input" data-k="duration" type="number" min="1" max="30" value="${esc(s.duration)}" style="width:70px;height:30px">秒</label><div class="spacer"></div>
        <button class="icon-btn" data-act="up" title="上移" ${i ? '' : 'disabled'}>${icon('arrow', 14)}</button><button class="icon-btn" data-act="down" title="下移" ${i < st.shots.length - 1 ? '' : 'disabled'}>${icon('arrow', 14)}</button>
        <button class="btn sm ghost" data-act="insert">${icon('plus', 13)}在下面插一个</button><button class="icon-btn danger" data-act="del" title="删除" ${st.shots.length > 1 ? '' : 'disabled'}>${icon('trash', 14)}</button></div>
      <div class="shot-b">
        <div class="shot-frame">${s.imageMediaId ? `<img src="/api/media/${s.imageMediaId}" alt="首帧"><button class="icon-btn" data-act="rmimg" title="不用首帧">${icon('x', 12)}</button>` : `<span class="small muted">没有首帧<br>模型自己画</span>`}
          <div class="col" style="gap:6px;width:100%"><button class="btn sm ghost" data-act="upimg">${icon('upload', 13)}上传首帧</button>${d.image.length ? `<button class="btn sm ghost" data-act="genimg" data-loading="出图中…">${icon('image', 13)}AI 出首帧</button>` : ''}<input type="file" data-file accept="image/jpeg,image/png,image/webp" hidden></div></div>
        <div class="col" style="gap:8px;min-width:0">
          ${s.visual ? `<div class="small muted">脚本里的画面：${esc(s.visual)}</div>` : ''}
          <label class="field small">画面和动作（中文也行，点「优化提示词」改写成模型更听得懂的英文）<textarea class="input" data-k="prompt" rows="4" placeholder="例如：女生在镜子前戴上这条项链，手指轻轻拨动吊坠，镜头慢慢推近">${esc(s.prompt)}</textarea></label>
          <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm ghost" data-act="polish" data-loading="改写中…">${icon('wand', 13)}优化提示词</button><span class="small muted" data-note></span></div>
          <div class="grid g2"><label class="field small">口播（开了声音才会说）<input class="input" data-k="voiceover" value="${esc(s.voiceover)}"></label><label class="field small">屏幕字（后期加，不进模型）<input class="input" data-k="caption" value="${esc(s.caption || '')}"></label></div>
        </div></div></div>`).join('');
    bindShots();
  }
  function bindShots() {
    $$('.shot', view).forEach((el) => {
      const i = Number(el.dataset.i);
      const s = st.shots[i];
      el.oninput = (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        s[k] = k === 'duration' ? Number(e.target.value) || 1 : e.target.value;
        replan();
      };
      el.onclick = async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'up' || act === 'down') {
          const j = act === 'up' ? i - 1 : i + 1;
          [st.shots[i], st.shots[j]] = [st.shots[j], st.shots[i]];
        } else if (act === 'insert') st.shots.splice(i + 1, 0, blankShot());
        else if (act === 'del') st.shots.splice(i, 1);
        else if (act === 'rmimg') s.imageMediaId = '';
        else if (act === 'upimg') return el.querySelector('[data-file]').click();
        else if (act === 'genimg') {
          if (!s.prompt.trim()) return toast('先写这个镜头的画面', 'error');
          await withLoading(b, async () => {
            const [connectorId, model] = (f('image').value || '').split('|');
            const r = await api('/video-jobs/keyframe', { method: 'POST', body: { connectorId, model, prompt: s.prompt, refAssetIds: st.refs.map((x) => x.id) } });
            s.imageMediaId = r.id;
            toast(`首帧好了${r.price != null ? `（约 ¥${r.price}）` : ''}，不满意再点一次`, 'success');
          });
        } else if (act === 'polish') {
          if (!s.prompt.trim()) return toast('先写一句想要的画面', 'error');
          return withLoading(b, async () => {
            const r = await api('/video-jobs/polish', { method: 'POST', body: { text: s.prompt, seconds: s.duration, hasImage: !!s.imageMediaId, hasRefs: st.refs.length > 0 } });
            s.prompt = r.prompt;
            el.querySelector('[data-k=prompt]').value = r.prompt;
            el.querySelector('[data-note]').textContent = r.note || '';
            replan();
          });
        } else return;
        drawShots();
        replan();
      };
      el.querySelector('[data-file]').onchange = async (e) => {
        try {
          const [m] = await upload([...e.target.files]);
          s.imageMediaId = m.id;
          drawShots();
          replan();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  view.querySelector('.create-top').addEventListener('change', (e) => {
    if (e.target.id === 'imp') {
      const s = sd.items.find((x) => x.id === e.target.value);
      if (!s) return;
      st = fromScript(s);
      f('title').value = st.title;
      pick(f('lang'), st.language);
      drawShots();
      e.target.value = '';
      toast(`已导入「${s.title}」的 ${st.shots.length} 个镜头，可以随便改`, 'success');
    }
    replan();
  });
  f('title').oninput = replan;
  f('add').onclick = () => { st.shots.push(blankShot()); drawShots(); replan(); };
  f('clear').onclick = () => { st = { ...st, title: '', scriptId: '', shots: [blankShot()] }; f('title').value = ''; drawShots(); replan(); };
  f('save').onclick = (e) => withLoading(e.currentTarget, async () => {
    readTop();
    const payload = { title: st.title, language: st.language, shots: st.shots.map((s) => ({ ...s, visual: s.visual || s.prompt })) };
    const saved = st.scriptId ? await api(`/scripts/${st.scriptId}`, { method: 'PUT', body: payload }) : await api('/scripts/manual', { method: 'POST', body: payload });
    st.scriptId = saved.id;
    saveDraft(st);
    toast(`已存成脚本「${saved.title}」`, 'success');
  });
  f('go').onclick = (e) => withLoading(e.currentTarget, async () => {
    const r = await api('/video-jobs/free', { method: 'POST', body: body() });
    toast(`已开始生成 ${r.items.length} 个视频，可以去忙别的，好了在视频库里看`, 'success');
    location.hash = '#/scripts/videos';
  });

  drawRefs();
  drawShots();
  replan();
}
