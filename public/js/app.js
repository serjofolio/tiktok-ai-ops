// 应用外壳：导航、路由、全站动效
import { icon, api, $, countUp } from './lib.js';
import { initStars, initPointerFx, initSpotlight, splitText, armReveal } from './fx/ambient.js';

initStars();
initPointerFx();
initSpotlight();

const ROUTES = [
  { group: '工作台' },
  { path: 'dashboard', title: '总览', sub: '数据、进度与快捷入口', icon: 'home' },
  { group: '选品到内容' },
  { path: 'products', title: '智能选品', sub: 'FastMoss 数据 → 硬指标 → 利润测算 → AI 分析 → 测款方案', icon: 'target' },
  { path: 'scripts', title: '视频脚本', sub: '选好的品，一键生成可直接开拍的带货脚本', icon: 'script' },
  { group: '智能' },
  { path: 'knowledge', title: '知识库', sub: 'TikTok 官方文档与运营资料，Agent 回答的依据', icon: 'book' },
  { path: 'providers', title: '接入配置', sub: '模型供应商与 API 密钥，一键切换', icon: 'link' },
  { path: 'chat', title: 'Agent', sub: '像正常 AI 一样对话，可引用知识库', icon: 'bot' },
];

const nav = $('#nav');
nav.innerHTML = ROUTES.map((r) =>
  r.group ? `<div class="nav-group">${r.group}</div>` : `<a href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${r.title}</span></a>`,
).join('');

$('#menu-btn').innerHTML = icon('menu');
$('#menu-btn').onclick = () => $('#app').classList.toggle('nav-open');

// ---------- 导航滑块：激活项背后的色块弹性滑动 ----------
const indicator = document.createElement('div');
indicator.className = 'nav-indicator';
nav.prepend(indicator);
function moveIndicator() {
  const a = nav.querySelector('a.active');
  if (!a) return (indicator.style.opacity = 0);
  indicator.style.opacity = 1;
  indicator.style.height = `${a.offsetHeight}px`;
  indicator.style.transform = `translateY(${a.offsetTop}px)`;
}
window.addEventListener('resize', moveIndicator);

// ---------- 顶部滚动进度条 ----------
const scrollBar = document.createElement('div');
scrollBar.className = 'scroll-progress';
document.body.appendChild(scrollBar);
addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollBar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
}, { passive: true });

export async function refreshMode() {
  try {
    const d = await api('/providers');
    const p = d.items.find((x) => x.id === d.activeId);
    const chip = $('#mode-chip');
    chip.classList.toggle('live', !!p);
    chip.querySelector('span').textContent = p ? `${p.name} · ${p.model}` : '未接入大模型 · 去配置';
    chip.onclick = () => (location.hash = '#/providers');
    chip.style.cursor = 'pointer';
  } catch {}
}

// 新渲染出的 [data-count] 数字自动滚动
new MutationObserver(() => countUp($('#view'))).observe($('#view'), { childList: true, subtree: true });

const progress = document.createElement('div');
progress.className = 'topbar-progress';
$('.topbar').appendChild(progress);

let cleanup = null;
let firstRoute = true;
const curtain = document.querySelector('.curtain');
async function route() {
  // 页面切换幕布：首次进入不播放
  if (!firstRoute && curtain) {
    curtain.classList.remove('go');
    void curtain.offsetWidth;
    curtain.classList.add('go');
  }
  firstRoute = false;
  const [, path = 'dashboard', ...rest] = location.hash.split('/');
  const r = ROUTES.find((x) => x.path === path) || ROUTES[1];
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === r.path));
  moveIndicator();
  $('#page-title').textContent = r.title;
  $('#page-sub').textContent = r.sub;
  document.title = `${r.title} · TikTok 运营台`;
  $('#app').classList.remove('nav-open');
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  scrollTo(0, 0);
  document.querySelectorAll('.modal-mask').forEach((m) => m.remove());
  // 每次路由渲染到新的容器：上一个页面的迟到渲染只会写入已脱离文档的节点
  const view = document.createElement('div');
  view.className = 'page';
  $('#view').replaceChildren(view);
  progress.className = 'topbar-progress';
  void progress.offsetWidth;
  progress.classList.add('go');
  view.innerHTML = '<div class="skeleton" style="height:160px"></div>';
  try {
    const mod = await import(`./pages/${r.path}.js`);
    cleanup = await mod.render(view, rest.map(decodeURIComponent));
    // 页面大标题逐字浮现、带 data-reveal 的区块滚动浮现
    view.querySelectorAll(".page-hero h2").forEach(splitText);
    const disarm = armReveal(view);
    const pageCleanup = cleanup;
    cleanup = () => { disarm(); if (typeof pageCleanup === "function") pageCleanup(); };
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card card-pad"><h3>页面加载失败</h3><p class="muted">${e.message}</p></div>`;
  }
  progress.classList.add('done');
}

window.addEventListener('hashchange', route);
window.addEventListener('providerschange', refreshMode);
route();
refreshMode();
