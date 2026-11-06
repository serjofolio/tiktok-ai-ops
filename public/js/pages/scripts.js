// 视频脚本：写脚本 / 爆款拆解 / 视频库 / 爆款方法论
import { icon } from '../lib.js';

const TABS = [
  ['', '写脚本', 'script'],
  ['viral', '爆款拆解', 'search'],
  ['videos', '视频库', 'video'],
  ['playbook', '爆款方法论', 'book'],
];

export async function render(view, [first, second]) {
  const tab = ['viral', 'videos', 'playbook'].includes(first) ? first : '';
  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">视频脚本 · 爆款方法 × AI × 视频模型</div>
    <h2>学爆款，写脚本，<em>直接出片</em></h2>
    <p>脚本按真实爆款的方法来写：选风格、选钩子、抓痛点。上传一条爆款视频，AI 逐段拆解，再学它的结构写你的脚本；接入视频模型后，脚本可以直接生成视频并保存。</p>
  </section>
  <div class="seg script-tabs" id="script-tabs">${TABS.map(([k, t, ic]) => `<a href="#/scripts${k ? `/${k}` : ''}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${icon(ic, 14)}${t}</a>`).join('')}</div>
  <div id="tab" class="mt"></div>`;
  const box = view.querySelector('#tab');
  const mod = await import(`./scripts-${tab || 'write'}.js`);
  return mod.render(box, tab ? [second] : [first, second], view);
}
