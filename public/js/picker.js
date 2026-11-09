// 商品名双语显示 + 可搜索的商品选择器
// 选择器挂在一个原生 <select> 上：select 仍然是取值和 change 事件的来源，原有代码不用改；选择器只负责好看、好找
import { esc, icon } from './lib.js';

export const zhName = (p) => String(p?.nameZh || '').trim();
// 一行：有中文名时「中文名 · 原标题」，没有就原标题
export const nameText = (p) => (zhName(p) ? `${zhName(p)} · ${p.name}` : p?.name || '');
// 两行：中文名加粗，原标题小字（没有中文名时只显示原标题）
export const nameHTML = (p, { cls = 'pname' } = {}) => {
  const zh = zhName(p);
  return `<b class="${cls}">${esc(zh || p?.name || '')}</b>${zh ? `<span class="pname-en" title="${esc(p.name)}">${esc(p.name)}</span>` : ''}`;
};

const tagOf = (p) => (p.status === 'testing' ? ['测款中', 'v-watch'] : p.evaluation?.verdict === '可以上' ? ['可以上', 'v-go'] : p.evaluation?.verdict === '不建议上' || p.status === 'dropped' ? ['不建议', 'v-no'] : p.evaluation?.verdict ? [p.evaluation.verdict, 'v-na'] : null);
const thumbOf = (p) => (p?.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pk-ph'}))">` : '<span class="pk-ph"></span>');

export function productPicker(select, products, { placeholder = '选择商品' } = {}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  select.classList.add('picker-native');
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  wrap.innerHTML = `<button type="button" class="picker-btn input" aria-haspopup="listbox"></button><div class="picker-panel" hidden><input class="input picker-q" placeholder="搜索中文名、英文名或类目"><div class="picker-list" role="listbox"></div></div>`;
  select.after(wrap);
  const btn = wrap.querySelector('.picker-btn');
  const panel = wrap.querySelector('.picker-panel');
  const q = wrap.querySelector('.picker-q');
  const listEl = wrap.querySelector('.picker-list');

  const row = (opt) => {
    const p = byId.get(opt.value);
    if (!p) return `<div class="picker-item manual" data-v="${esc(opt.value)}" role="option">${icon('plus', 14)}<span>${esc(opt.textContent)}</span></div>`;
    const t = tagOf(p);
    return `<div class="picker-item ${opt.value === select.value ? 'on' : ''}" data-v="${esc(opt.value)}" role="option">${thumbOf(p)}<div class="pk-names">${nameHTML(p, { cls: 'pk-zh' })}${p.category ? `<span class="pk-cat">${esc(p.category)}</span>` : ''}</div>${t ? `<span class="verdict ${t[1]}">${t[0]}</span>` : ''}</div>`;
  };
  function sync() {
    const p = byId.get(select.value);
    const opt = select.selectedOptions[0];
    const t = p && tagOf(p);
    btn.innerHTML = p ? `${thumbOf(p)}<div class="pk-names">${nameHTML(p, { cls: 'pk-zh' })}</div>${t ? `<span class="verdict ${t[1]}">${t[0]}</span>` : ''}${icon('chevron', 14)}` : `<span class="pk-none">${esc(opt?.textContent || placeholder)}</span>${icon('chevron', 14)}`;
  }
  function draw() {
    const k = q.value.trim().toLowerCase();
    const opts = [...select.options].filter((o) => {
      if (!k) return true;
      const p = byId.get(o.value);
      return `${o.textContent} ${p?.nameZh || ''} ${p?.name || ''} ${p?.category || ''}`.toLowerCase().includes(k);
    });
    listEl.innerHTML = opts.map(row).join('') || '<div class="picker-empty">没有匹配的商品</div>';
  }
  const close = () => {
    panel.hidden = true;
    wrap.classList.remove('open');
  };
  const onDoc = (e) => {
    if (!wrap.isConnected) return document.removeEventListener('click', onDoc, true);
    if (!wrap.contains(e.target)) close();
  };
  document.addEventListener('click', onDoc, true);
  btn.onclick = () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    wrap.classList.add('open');
    q.value = '';
    draw();
    q.focus();
    listEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  q.oninput = draw;
  q.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') listEl.querySelector('.picker-item')?.click();
  };
  listEl.onclick = (e) => {
    const it = e.target.closest('.picker-item');
    if (!it) return;
    select.value = it.dataset.v;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    sync();
  };
  select.addEventListener('change', sync);
  sync();
  return { sync };
}
