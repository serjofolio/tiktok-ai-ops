// 粘贴上传：在网页上右键图片「复制图片」、截图，或者在文件夹里复制文件，然后在页面上按 Ctrl+V（Mac 是 ⌘V）
// 全站统一处理：找到该接收的上传框，把文件放进它的 <input type="file"> 再触发 change，各页面原来的上传逻辑不用改
//   1. 有弹窗时，用弹窗里的上传框
//   2. 鼠标停在哪个上传框上（或者刚点过它），就给哪个
//   3. 否则给这一页的主上传框（data-paste-default）
// 在输入框里粘贴文字照常；剪贴板里没有文件时什么都不做
import { toast } from './lib.js';

const ZONE = '[data-paste-zone], .dropzone, .field';
const zoneOf = (input) => input.closest(ZONE) || input.parentElement;
const editable = (el) => el && (el.isContentEditable || /^(textarea|select)$/i.test(el.tagName) || (el.tagName === 'INPUT' && !/^(file|checkbox|radio|button|submit|range|color)$/i.test(el.type)));

// 截图粘贴过来的文件都叫 image.png：换个能看懂的名字
function renamed(files) {
  return files.map((f, i) => (/^image\.\w+$/i.test(f.name) || !f.name ? new File([f], `粘贴的图片-${Date.now()}-${i + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }) : f));
}

function accepts(input, f) {
  const list = String(input.accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const name = String(f.name || '').toLowerCase();
  const type = String(f.type || '').toLowerCase();
  return list.some((a) => (a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : a.startsWith('.') ? name.endsWith(a) : type === a));
}

export function filesIn(dataTransfer) {
  const files = [...(dataTransfer?.files || [])];
  if (files.length) return files;
  return [...(dataTransfer?.items || [])].filter((x) => x.kind === 'file').map((x) => x.getAsFile()).filter(Boolean);
}

// 现在能接收粘贴的上传框：看得见的（或者标了 data-paste 的），弹窗优先
function candidates() {
  const masks = document.querySelectorAll('.modal-mask');
  const root = masks[masks.length - 1] || document.getElementById('view') || document.body;
  return [...root.querySelectorAll('input[type=file]')].filter((i) => !i.disabled && (i.hasAttribute('data-paste') || (!i.parentElement?.closest('[hidden]') && i.parentElement?.getClientRects().length > 0)));
}

let lastPointer = { el: null, at: 0 };
function pick(list) {
  const hovered = list.filter((i) => zoneOf(i).matches(':hover'));
  if (hovered.length) return hovered[hovered.length - 1]; // 嵌套时取最里面的
  if (Date.now() - lastPointer.at < 120000) {
    const clicked = list.find((i) => zoneOf(i).contains(lastPointer.el));
    if (clicked) return clicked;
  }
  return list.find((i) => i.hasAttribute('data-paste-default')) || list[0];
}

// 把文件交给某个上传框（按 accept 过滤，单选框只放第一个）
export function giveTo(input, files) {
  const ok = renamed(files.filter((f) => accepts(input, f)));
  if (!ok.length) {
    toast(/image/.test(input.accept) && !/video/.test(input.accept) ? '这里只能粘贴图片' : /video/.test(input.accept) && !/image/.test(input.accept) ? '这里只能传视频文件' : '这个上传框不收这种文件', 'info');
    return false;
  }
  const dt = new DataTransfer();
  for (const f of input.multiple ? ok : ok.slice(0, 1)) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

let installed = false;
export function installPaste() {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', (e) => (lastPointer = { el: e.target, at: Date.now() }), true);
  document.addEventListener('paste', (e) => {
    const files = filesIn(e.clipboardData);
    if (!files.length) return;
    // 在输入框里粘贴、剪贴板里也有文字（比如从 Excel 复制的表格）：照常粘贴文字
    if (editable(e.target) && [...(e.clipboardData?.types || [])].includes('text/plain')) return;
    const list = candidates();
    e.preventDefault();
    if (!list.length) return toast(document.querySelector('#view [data-paste-hint]')?.dataset.pasteHint || '这个页面现在没有能粘贴文件的地方', 'info');
    giveTo(pick(list), files);
  });
}

// 「粘贴图片」按钮：直接读剪贴板（浏览器会问一次要不要允许），读不了时提示用 Ctrl+V
export async function pasteInto(input) {
  const hint = '直接按 Ctrl+V（Mac 按 ⌘V）粘贴也可以';
  if (!navigator.clipboard?.read) throw new Error(`这个浏览器的按钮读不了剪贴板：${hint}`);
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error(`浏览器没允许读剪贴板：${hint}`);
  }
  const out = [];
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith('image/'));
    if (type) out.push(new File([await it.getType(type)], 'image.png', { type }));
  }
  if (!out.length) throw new Error('剪贴板里没有图片：先在网页上右键图片选「复制图片」，或者截个图');
  giveTo(input, out);
}

export const PASTE_TIP = '也可以 Ctrl+V 粘贴复制的图片，或者直接拖进来';
