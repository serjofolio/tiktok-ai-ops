// 使用指南：推荐的整体用法 + 每个功能怎么用（内容在 help.js，和各页面的「?」是同一份）
import { icon, esc } from '../lib.js';
import { HELP, FLOW, helpHTML } from '../help.js';

const GROUPS = [
  ['第一次使用', ['providers', 'dashboard']],
  ['选品和上架', ['products', 'pipeline']],
  ['做视频', ['scripts', 'scripts/create', 'scripts/studio', 'scripts/viral', 'scripts/videos', 'scripts/playbook']],
  ['测款和复盘', ['launch']],
  ['资料和问答', ['knowledge', 'chat']],
];
const href = (k) => `#/${k}`;

export async function render(view) {
  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">使用指南</div>
    <h2>每个功能<em>怎么用</em></h2>
    <p>推荐按下面四步走：选出能卖的品 → 找货上架 → 做视频 → 测款复盘。每个页面右上角的「?」也能随时打开这一页的说明。</p>
  </section>
  <div class="guide-flow">${FLOW.map((x, i) => `<a class="card gf-step" href="${href(x.key)}"><b>${i + 1}</b><strong>${esc(x.name)}</strong><span>${esc(x.text)}</span></a>`).join(`<span class="gf-arrow">${icon('arrow', 16)}</span>`)}</div>
  <div class="note-card" style="margin-top:16px"><b>开始之前：</b>先到「接入配置」接一个大模型（写脚本、分析都要用）；要出视频再接视频模型。还没有数据时，在「总览」点「载入示例工作区」，用虚构数据把流程走一遍。</div>
  <nav class="guide-toc">${GROUPS.map(([g, keys]) => `<span><b>${esc(g)}</b>${keys.map((k) => `<a href="#/guide" data-jump="${k}">${esc(HELP[k].title)}</a>`).join('')}</span>`).join('')}</nav>
  ${GROUPS.map(([g, keys]) => `<h3 class="guide-group">${esc(g)}</h3><div class="guide-grid">${keys.map((k) => `<article class="card card-pad guide-card" id="g-${k.replace('/', '-')}"><div class="row"><h4>${esc(HELP[k].title)}</h4><div class="spacer"></div><a class="btn sm ghost" href="${href(k)}">打开${icon('arrow', 13)}</a></div>${helpHTML(HELP[k])}</article>`).join('')}</div>`).join('')}`;
  view.querySelectorAll('[data-jump]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    view.querySelector(`#g-${a.dataset.jump.replace('/', '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}
