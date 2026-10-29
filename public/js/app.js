// 应用外壳：导航、路由、主题
import { icon, api, $, countUp, esc } from './lib.js';
import { STYLES, currentStyle, applyStyle, swatch } from './styles.js';

const ROUTES = [
  { group: '工作台' },
  { path: 'dashboard', title: '总览', sub: '运营数据与快捷入口', icon: 'home' },
  { path: 'workflows', title: '一键工作流', sub: '选品 → 脚本 → 生图 → 视频 → 素材包', icon: 'flow' },
  { path: 'agents', title: 'AI 智能体', sub: '对话式运营助手，可调用平台全部能力', icon: 'bot' },
  { group: '运营能力' },
  { path: 'products', title: '智能选品', sub: '六维评分模型 + AI 选品分析', icon: 'target' },
  { path: 'scripts', title: '脚本工坊', sub: 'AI 生成 TikTok 爆款分镜脚本', icon: 'script' },
  { path: 'images', title: '图片工坊', sub: '文生图 / 参考图生图', icon: 'image' },
  { path: 'videos', title: '视频工坊', sub: '图生视频 / 分镜合成成片', icon: 'video' },
  { path: 'knowledge', title: '知识库', sub: '内部文档 RAG 检索与问答', icon: 'book' },
  { group: '系统' },
  { path: 'settings', title: '系统设置', sub: '模型服务商与 API 配置', icon: 'settings' },
];

const nav = $('#nav');
nav.innerHTML = ROUTES.map((r) =>
  r.group ? `<div class="nav-group">${r.group}</div>` : `<a href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${r.title}</span></a>`,
).join('');

$('#menu-btn').innerHTML = icon('menu');
$('#menu-btn').onclick = () => $('#app').classList.toggle('nav-open');

// ---------- 导航滑块：激活项背后的墨色块弹性滑动 ----------
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

// ---------- 主题：圆形扩散切换 ----------
let themeTransition = null;
function setThemeIcon() {
  $('#theme-btn').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
}
$('#theme-btn').onclick = (e) => {
  const apply = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch {}
    setThemeIcon();
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce || themeTransition) return apply();
  document.documentElement.style.setProperty('--vx', `${e.clientX}px`);
  document.documentElement.style.setProperty('--vy', `${e.clientY}px`);
  // 过渡被中断（连续点击、页面不可见等）时仍保证主题切换生效
  let applied = false;
  themeTransition = document.startViewTransition(() => { applied = true; apply(); });
  themeTransition.updateCallbackDone.catch(() => !applied && apply());
  themeTransition.ready.catch(() => {});
  themeTransition.finished.catch(() => {}).finally(() => (themeTransition = null));
};
setThemeIcon();

// ---------- 界面风格切换（顶栏弹出菜单） ----------
const styleBtn = $("#style-btn");
function setStyleBtn() {
  const s = STYLES.find((x) => x.key === currentStyle()) || STYLES[0];
  styleBtn.innerHTML = `${swatch(s)}<span>风格 · ${s.name}</span>`;
}
styleBtn.onclick = (e) => {
  e.stopPropagation();
  const old = document.querySelector(".style-pop");
  if (old) return old.remove();
  const pop = document.createElement("div");
  pop.className = "style-pop";
  const render = () => (pop.innerHTML = `<div class="hd">界面风格 · 点击即时预览</div>${STYLES.map((s) => `<button class="style-opt ${s.key === currentStyle() ? "on" : ""}" data-k="${s.key}">${swatch(s)}<span><b>${esc(s.name)}</b><small>${esc(s.desc)}</small></span></button>`).join("")}`);
  render();
  pop.onclick = (ev) => {
    ev.stopPropagation();
    const b = ev.target.closest("[data-k]");
    if (b) applyStyle(b.dataset.k, ev);
  };
  window.addEventListener("stylechange", render);
  $(".topbar").appendChild(pop);
  setTimeout(() => document.addEventListener("click", () => { pop.remove(); window.removeEventListener("stylechange", render); }, { once: true }));
};
window.addEventListener("stylechange", () => { setStyleBtn(); requestAnimationFrame(moveIndicator); });
setStyleBtn();

export async function refreshMode() {
  try {
    const s = await api('/settings');
    const live = s.llm.provider !== 'mock';
    const chip = $('#mode-chip');
    chip.classList.toggle('live', live);
    chip.querySelector('span').textContent = live ? `已接入 ${s.llm.model}` : '离线演示模式 · 去配置模型';
    chip.onclick = () => (location.hash = '#/settings');
    chip.style.cursor = 'pointer';
  } catch {}
}

// 新渲染出的 [data-count] 数字自动滚动
new MutationObserver(() => countUp($('#view'))).observe($('#view'), { childList: true, subtree: true });

const progress = document.createElement('div');
progress.className = 'topbar-progress';
$('.topbar').appendChild(progress);

let cleanup = null;
async function route() {
  const [, path = 'dashboard', ...rest] = location.hash.split('/');
  const r = ROUTES.find((x) => x.path === path) || ROUTES[1];
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === r.path));
  moveIndicator();
  $('#page-title').textContent = r.title;
  $('#page-sub').textContent = r.sub;
  document.title = `${r.title} · TikTok AI 运营台`;
  $('#app').classList.remove('nav-open');
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
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
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card card-pad"><h3>页面加载失败</h3><p class="muted">${e.message}</p></div>`;
  }
  progress.classList.add('done');
}

window.addEventListener('hashchange', route);
route();
refreshMode();
