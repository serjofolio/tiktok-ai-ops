import { api, icon, esc, toast, withLoading, $, $$, empty, modal, confirmBox, copy } from '../lib.js';

const STYLES = [
  ['', '商业摄影', 'commercial product photography, studio lighting, ultra detailed, 8k'],
  ['', '生活场景', 'lifestyle scene, cozy modern home, natural window light, authentic UGC feel'],
  ['⬜', '极简白底', 'minimalist pure white background, soft shadow, e-commerce main image'],
  ['', '霓虹潮酷', 'neon cyberpunk lighting, vibrant pink and cyan glow, trendy'],
  ['', '日系清新', 'japanese soft pastel aesthetic, airy, film grain, fresh'],
  ['', '3D 渲染', '3d render, octane, glossy materials, floating product, colorful backdrop'],
];
const SIZES = [['1024x1792', '9:16 竖版'], ['1024x1024', '1:1 方图'], ['1792x1024', '16:9 横版']];

export async function render(view) {
  const [{ items }, { items: products }] = await Promise.all([api('/images'), api('/products')]);
  let style = STYLES[0];
  let reference = '';
  view.innerHTML = `<div class="split">
    <div class="card card-pad col sticky">
      <h3 style="font-size:15px">${icon('sparkles')} 文生图</h3>
      <label class="field">从商品快速填充<select class="input" id="pp"><option value="">— 选择商品 —</option>${products.map((p) => `<option value="${p.id}">${esc(p.nameCn)}</option>`).join('')}</select></label>
      <label class="field">提示词（建议英文）<textarea class="input" id="prompt" rows="5" placeholder="A heatless curling headband on a marble vanity, soft morning sunlight, close-up product shot"></textarea></label>
      <div class="field">风格<div class="preset-grid" id="st">${STYLES.map((s, i) => `<div class="preset ${i === 0 ? 'on' : ''}" data-i="${i}"><span class="e">${s[0]}</span>${s[1]}</div>`).join('')}</div></div>
      <div class="grid g2">
        <label class="field">尺寸<select class="input" id="size">${SIZES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        <label class="field">数量<select class="input" id="count"><option>1</option><option>2</option><option>4</option></select></label>
      </div>
      <div class="field">参考图（图生图，可选）<div class="row" id="ref"><button class="btn sm ghost" id="pick">${icon('image', 15)}从图库选择</button><button class="btn sm ghost" id="up">${icon('upload', 15)}上传</button><input type="file" id="file" accept="image/*" hidden></div></div>
      <button class="btn grad block lg" id="gen" data-loading="生成中…">${icon('wand')}生成图片</button>
    </div>
    <div class="card"><div class="card-head"><h3>${icon('image')}图库</h3><span class="muted small" id="cnt"></span><div class="spacer"></div></div><div class="card-pad" id="gal"></div></div>
  </div>`;

  $$('#st .preset', view).forEach((el) => (el.onclick = () => { style = STYLES[el.dataset.i]; $$('#st .preset', view).forEach((x) => x.classList.toggle('on', x === el)); }));
  $('#pp', view).onchange = (e) => {
    const p = products.find((x) => x.id === e.target.value);
    if (p) $('#prompt', view).value = `${p.name}, hero product shot, ${p.category === '美妆个护' ? 'elegant vanity table' : p.category === '宠物用品' ? 'cute pet interacting with it' : 'bright modern home'}, vertical composition, TikTok aesthetic`;
  };

  function renderRef() {
    const box = $('#ref', view);
    $$('.ref-prev', box).forEach((x) => x.remove());
    if (reference) box.insertAdjacentHTML('beforeend', `<span class="chip ref-prev"><img src="${reference}" style="width:22px;height:22px;border-radius:5px;object-fit:cover">已选参考图 <a href="javascript:;" id="clr"></a></span>`);
    const clr = $('#clr', box);
    if (clr) clr.onclick = () => { reference = ''; renderRef(); };
  }
  $('#pick', view).onclick = () => modal({
    title: '选择参考图', wide: true,
    body: items.length ? `<div class="media-grid">${items.map((i) => `<div class="media" data-url="${i.url}"><img src="${i.url}" loading="lazy"></div>`).join('')}</div>` : empty('图库为空'),
    onMount(el, close) { $$('.media', el).forEach((m) => (m.onclick = () => { reference = m.dataset.url; renderRef(); close(); })); },
  });
  $('#up', view).onclick = () => $('#file', view).click();
  $('#file', view).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const form = new FormData();
    form.append('file', f);
    try {
      const img = await api('/images/upload', { method: 'POST', form });
      items.unshift(img);
      reference = img.url;
      renderRef();
      renderGal();
      toast('上传成功', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  function renderGal() {
    $('#cnt', view).textContent = `${items.length} 张`;
    const g = $('#gal', view);
    if (!items.length) return (g.innerHTML = empty('还没有图片，输入提示词开始创作吧', 'image'));
    g.innerHTML = `<div class="media-grid">${items.map((i) => `<div class="media" data-id="${i.id}"><img src="${i.url}" alt="" loading="lazy">
      <div class="tools"><button data-a="video" title="图生视频">${icon('video', 15)}</button><a href="${i.url}" download><button data-a="dl" title="下载">${icon('download', 15)}</button></a><button data-a="del" title="删除">${icon('trash', 15)}</button></div>
      <div class="cap">${esc(i.title || i.prompt?.slice(0, 40) || '')}</div></div>`).join('')}</div>`;
    $$('.media', g).forEach((m) => {
      const img = items.find((x) => x.id === m.dataset.id);
      m.onclick = async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'dl') return;
        e.preventDefault();
        if (a === 'video') return (location.hash = `#/videos/new/${encodeURIComponent(img.url)}`);
        if (a === 'del') {
          if (!(await confirmBox('确定删除这张图片？'))) return;
          await api(`/images/${img.id}`, { method: 'DELETE' });
          items.splice(items.indexOf(img), 1);
          return renderGal();
        }
        modal({
          title: esc(img.title || '图片详情'), wide: true,
          body: `<div class="grid" style="grid-template-columns:minmax(0,1fr) 320px"><img src="${img.url}" style="border-radius:14px;max-height:70vh;margin:auto;display:block"><div class="col"><div class="hit"><div class="muted small">提示词</div>${esc(img.prompt || '—')}</div><div class="hit small"><span class="muted">来源：</span>${esc(img.source || img.provider)} · <span class="muted">模型：</span>${esc(img.provider)}</div>
          <button class="btn" id="tv">${icon('video', 15)}用这张图生成视频</button><button class="btn ghost" id="cpp">${icon('copy', 15)}复制提示词</button><button class="btn ghost" id="asref">${icon('image', 15)}作为参考图</button></div></div>`,
          onMount(el, close) {
            $('#tv', el).onclick = () => { close(); location.hash = `#/videos/new/${encodeURIComponent(img.url)}`; };
            $('#cpp', el).onclick = () => copy(img.prompt || '');
            $('#asref', el).onclick = () => { reference = img.url; renderRef(); close(); };
          },
        });
      };
    });
  }

  $('#gen', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    const prompt = $('#prompt', view).value.trim();
    if (!prompt) throw new Error('请输入提示词');
    const r = await api('/images/generate', { method: 'POST', body: { prompt, style: style[2], size: $('#size', view).value, count: Number($('#count', view).value), referenceImage: reference || undefined, productId: $('#pp', view).value || undefined } });
    items.unshift(...r.items);
    renderGal();
    toast(`已生成 ${r.items.length} 张图片`, 'success');
  });
  renderGal();
}
