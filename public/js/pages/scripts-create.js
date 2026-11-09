// AI 出片创作台：不用等脚本，自己写分镜就能出片；也可以把脚本导进来改、插镜头、删镜头再出片
// 每个镜头可以有自己的首帧图（上传或用图片模型生成），商品参考图让支持参考图的模型照着画商品
import { api, icon, esc, toast, withLoading, $, $$ } from '../lib.js';

const KEY = 'create-draft';
const blankShot = () => ({ prompt: '', duration: 5, voiceover: '', imageMediaId: '', visual: '', caption: '' });
const money = (x) => (x == null ? '—' : `¥${Number(x).toFixed(2)}`);
const PART = { Hook: '开头钩子', Problem: '痛点', Demo: '演示', Proof: '证明', Offer: '优惠', CTA: '行动号召', Story: '故事', Twist: '反转' };
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
  <div class="create-guide">
    <div class="cg-step"><b>1</b><span><strong>选模型</strong>在「生成设置」里选视频模型</span></div>
    <div class="cg-step"><b>2</b><span><strong>写镜头</strong>每个镜头写画面和动作，中文也行</span></div>
    <div class="cg-step"><b>3</b><span><strong>生成</strong>看好费用点「开始生成」，在视频库取片</span></div>
  </div>
  <div class="create-layout">
    <div class="create-main">
      <div class="create-head">
        <input class="input" id="title" placeholder="给这条视频起个名字（可不填）">
        <select class="input" id="imp" title="把已有脚本的分镜导进来改"><option value="">从脚本导入…</option>${sd.items.map((s) => `<option value="${s.id}">${esc(String(s.title || '').slice(0, 36))}</option>`).join('')}</select>
        <button class="btn sm ghost" id="save" data-loading="保存中…" title="把这些镜头存进脚本库">${icon('check', 14)}存成脚本</button>
        <button class="icon-btn" id="clear" title="清空，重新开始">${icon('refresh', 15)}</button>
      </div>
      <div id="shots" class="col" style="gap:12px"></div>
      <button class="btn ghost add-shot" id="add">${icon('plus', 15)}添加镜头</button>
      <p class="small muted" style="margin:4px 0 0">草稿自动保存在这个浏览器里，关掉页面再回来还在。</p>
    </div>
    <aside class="create-side card">
      <h4 class="cs-h">生成设置</h4>
      ${d.video.length ? `<label class="field">视频模型<select class="input" id="video">${opts(d.video, '秒')}</select></label>` : `<div class="cs-empty"><b>还没有视频模型</b><span>先到接入配置添加一个（你的中转站选「中转站（new-api / OpenAI 兼容格式）」），回来就能生成。</span><a class="btn sm" href="#/providers">${icon('link', 14)}去接入配置</a><select id="video" hidden><option value=""></option></select></div>`}
      <div class="grid g2">
        <label class="field">画面比例<select class="input" id="ratio"><option value="9:16">竖屏 9:16</option><option value="1:1">方形 1:1</option><option value="3:4">3:4</option><option value="16:9">横屏 16:9</option></select></label>
        <label class="field">出几个版本<select class="input" id="variants"><option value="1">1 个</option><option value="2">2 个</option><option value="3">3 个</option><option value="4">4 个</option></select></label>
      </div>
      <div class="field"><span>商品参考图 <i class="muted">可选</i></span>
        <span class="small muted">让模型照着真实商品画，商品不容易走样</span>
        <div class="row" style="gap:8px"><button type="button" class="btn sm ghost" id="refbtn">${icon('upload', 14)}上传商品图</button><input type="file" id="reffiles" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden></div>
        <div class="asset-row" id="refs"></div></div>
      <details class="cs-more"><summary>${icon('chevron', 14)}更多设置</summary><div class="col" style="gap:12px;padding-top:10px">
        <label class="field">生成方式<select class="input" id="mode"><option value="scenes">每个镜头单独生成，再拼起来</option><option value="whole">整条一次生成（人和画面更连贯）</option></select></label>
        <label class="field">AI 出首帧用的图片模型<select class="input" id="image">${opts(d.image, '张') || '<option value="">没有接入，只能上传首帧</option>'}</select></label>
        <label class="field">口播语言<select class="input" id="lang">${LANGS.map((l) => `<option>${l}</option>`).join('')}</select></label>
        <label class="switch"><input type="checkbox" id="audio"><span></span>让模型生成声音和口播</label>
        <label class="switch"><input type="checkbox" id="guard"><span></span>自动加「商品不变形、不加东西、不写字」</label>
      </div></details>
      <div class="cs-plan small" id="plan"></div>
      <button class="btn primary-glow block" id="go" data-loading="提交中…" ${d.video.length ? '' : 'disabled'}>${icon('video', 15)}开始生成</button>
    </aside>
  </div>`;

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
      <div class="shot-h"><b class="shot-n">${i + 1}</b><b>镜头 ${i + 1}</b>${s.part ? `<span class="chip">${esc(PART[s.part] || s.part)}</span>` : ''}
        <label class="shot-dur"><input class="input" data-k="duration" type="number" min="1" max="30" value="${esc(s.duration)}">秒</label><div class="spacer"></div>
        <button class="icon-btn" data-act="up" title="上移" ${i ? '' : 'disabled'}>${icon('arrow', 14)}</button><button class="icon-btn" data-act="down" title="下移" ${i < st.shots.length - 1 ? '' : 'disabled'}>${icon('arrow', 14)}</button>
        <button class="icon-btn" data-act="insert" title="在下面插入一个镜头">${icon('plus', 15)}</button><button class="icon-btn danger" data-act="del" title="删除这个镜头" ${st.shots.length > 1 ? '' : 'disabled'}>${icon('trash', 14)}</button></div>
      <div class="shot-b">
        <div class="shot-frame" title="首帧：视频的第一张画面。有首帧时商品和构图更可控">${s.imageMediaId ? `<img src="/api/media/${s.imageMediaId}" alt="首帧"><button class="icon-btn" data-act="rmimg" title="不用这张首帧">${icon('x', 12)}</button>` : `<span class="small muted">首帧<br>可选</span>`}
          <div class="col" style="gap:6px;width:100%"><button class="btn sm ghost" data-act="upimg">${icon('upload', 13)}上传</button>${d.image.length ? `<button class="btn sm ghost" data-act="genimg" data-loading="出图中…">${icon('image', 13)}AI 出图</button>` : ''}<input type="file" data-file accept="image/jpeg,image/png,image/webp" hidden></div></div>
        <div class="col" style="gap:8px;min-width:0">
          <textarea class="input shot-prompt" data-k="prompt" rows="3" aria-label="画面和动作" placeholder="写这个镜头的画面和动作，中文也行。例如：女生在镜子前戴上这条项链，手指轻轻拨动吊坠，镜头慢慢推近">${esc(s.prompt)}</textarea>
          <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm ghost" data-act="polish" data-loading="改写中…" title="按提示词规则改写成模型更听得懂的英文">${icon('wand', 13)}优化提示词</button><span class="small muted" data-note></span></div>
          ${s.visual ? `<div class="small muted shot-src">脚本原文：${esc(s.visual)}</div>` : ''}
          <details class="shot-more" ${s.voiceover || s.caption ? 'open' : ''}><summary>口播和屏幕字 <i class="muted">可选</i></summary><div class="grid g2" style="margin-top:8px"><label class="field small">口播（打开「生成声音」才会说）<input class="input" data-k="voiceover" value="${esc(s.voiceover)}"></label><label class="field small">屏幕字（后期在剪映里加）<input class="input" data-k="caption" value="${esc(s.caption || '')}"></label></div></details>
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

  view.querySelector('.create-layout').addEventListener('change', (e) => {
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
