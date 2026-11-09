// 视频脚本：做视频（写脚本 / AI 出片 / 批量出片）+ 素材（爆款拆解 / 视频库 / 爆款方法论）
import { icon, esc } from '../lib.js';
import { HELP, openHelp } from '../help.js';

const TABS = [
  ['', '写脚本', 'script', 'make'],
  ['create', 'AI 出片', 'video', 'make'],
  ['studio', '批量出片', 'layers', 'make'],
  ['viral', '爆款拆解', 'search', 'ref'],
  ['videos', '视频库', 'video', 'ref'],
  ['playbook', '爆款方法论', 'book', 'ref'],
];

export async function render(view, [first, second]) {
  const tab = ['create', 'studio', 'viral', 'videos', 'playbook'].includes(first) ? first : '';
  const key = tab ? `scripts/${tab}` : 'scripts';
  const link = ([k, t, ic]) => `<a href="#/scripts${k ? `/${k}` : ''}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${icon(ic, 14)}${t}</a>`;
  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">视频脚本</div>
    <h2>写脚本，<em>直接出片</em></h2>
    <p>写脚本、出视频、学爆款都在这里。不知道从哪开始：有商品没脚本用「写脚本」，有想法直接出片用「AI 出片」，要一次测很多开头用「批量出片」。</p>
  </section>
  <div class="script-nav">
    <div class="seg script-tabs" id="script-tabs"><span class="st-label">做视频</span>${TABS.filter((x) => x[3] === 'make').map(link).join('')}<span class="st-sep"></span><span class="st-label">素材</span>${TABS.filter((x) => x[3] === 'ref').map(link).join('')}</div>
  </div>
  <div class="tab-hint"><span>${esc(HELP[key]?.what || '')}</span><button class="btn sm ghost" id="tab-help">${icon('book', 13)}怎么用</button></div>
  <div id="tab" class="mt"></div>`;
  view.querySelector('#tab-help').onclick = () => openHelp(key);
  const box = view.querySelector('#tab');
  const mod = await import(`./scripts-${tab || 'write'}.js`);
  return mod.render(box, tab ? [second] : [first, second], view);
}
