// 应用外壳：导航、路由、全站动效
import { icon, api, $, esc, countUp, toast } from './lib.js';
import { session, loadSession } from './session.js';
import { initStars, initPointerFx, initSpotlight, splitText, armReveal, initIntro, initClickBurst } from './fx/ambient.js';

initStars();
initPointerFx();
initSpotlight();
initIntro();
initClickBurst();

const ROUTES = [
  { path: 'home', title: '首页', hidden: true, full: true, public: true },
  { path: 'login', title: '登录', hidden: true, full: true, public: true },
  { path: 'account', title: '账号设置', hidden: true },
  { path: 'admin', title: '用户管理', hidden: true, admin: true },
  { path: 'dashboard', title: '总览', icon: 'home' },
  { path: 'products', title: '智能选品', icon: 'target' },
  { path: 'pipeline', title: '自动上品', icon: 'flow' },
  { path: 'scripts', title: '视频脚本', icon: 'script' },
  { path: 'knowledge', title: '知识库', icon: 'book' },
  { path: 'providers', title: '接入配置', icon: 'link' },
  { path: 'chat', title: 'Agent', icon: 'bot' },
];

const nav = $('#nav');
nav.innerHTML = ROUTES.filter((r) => !r.hidden).map((r) => `<a href="#/${r.path}" data-path="${r.path}">${icon(r.icon, 16)}<span>${r.title}</span></a>`).join('');

$('#menu-btn').innerHTML = icon('menu');
$('#menu-btn').onclick = () => { $('#app').classList.toggle('nav-open'); requestAnimationFrame(moveIndicator); };

// ---------- 导航滑块：激活项背后的色块弹性滑动 ----------
const indicator = document.createElement('div');
indicator.className = 'nav-indicator';
nav.prepend(indicator);
function moveIndicator() {
  const a = nav.querySelector('a.active');
  if (!a) return (indicator.style.opacity = 0);
  indicator.style.opacity = 1;
  // 桌面端横向导航，移动端展开为纵向菜单
  const vertical = getComputedStyle(nav).flexDirection === 'column';
  indicator.style.width = vertical ? '' : `${a.offsetWidth}px`;
  indicator.style.height = `${a.offsetHeight}px`;
  indicator.style.transform = vertical ? `translateY(${a.offsetTop}px)` : `translateX(${a.offsetLeft}px)`;
}
window.addEventListener('resize', moveIndicator);

// ---------- 顶部滚动进度条 ----------
const scrollBar = document.createElement('div');
scrollBar.className = 'scroll-progress';
document.body.appendChild(scrollBar);
addEventListener('scroll', () => {
  $('#sitenav').classList.toggle('scrolled', scrollY > 20);
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollBar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
}, { passive: true });

export async function refreshMode() {
  $('#mode-chip').hidden = !session.user;
  if (!session.user) return;
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
$('#sitenav').appendChild(progress);

let cleanup = null;
let firstRoute = true;
const curtain = document.querySelector('.curtain');
async function route() {
  const [, path = 'home', ...rest] = location.hash.split('/');
  const r = ROUTES.find((x) => x.path === path) || ROUTES[0];
  // 未登录访问工作台页面 → 登录页（登录后回到原页面）；已登录访问登录页 → 总览
  if (!session.user && !r.public) return location.replace(`#/login/${location.hash.slice(2)}`);
  if (session.user && r.path === 'login') return location.replace(`#/${rest.filter((x) => x !== 'register').join('/') || 'dashboard'}`);
  if (r.admin && session.user?.role !== 'admin') return location.replace('#/dashboard');
  // 页面切换幕布：首次进入不播放
  if (!firstRoute && curtain) {
    curtain.classList.remove('go');
    void curtain.offsetWidth;
    curtain.classList.add('go');
  }
  firstRoute = false;
  document.body.classList.toggle('is-home', !!r.full);
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === r.path));
  moveIndicator();
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

// ---------- 账号：右上角登录 / 注册按钮或用户菜单 ----------
function renderAccount() {
  const box = $('#account');
  const u = session.user;
  if (!u) {
    box.innerHTML = `<a class="btn sm ghost" href="#/login">登录</a><a class="btn sm btn-glow" href="#/login/register">${session.firstUser ? '创建管理员' : '免费注册'}</a>`;
    return;
  }
  const admin = u.role === 'admin';
  box.innerHTML = `<button class="user-btn" id="user-btn" aria-haspopup="menu"><span class="avatar">${esc(u.username.slice(0, 1).toUpperCase())}</span><span class="uname">${esc(u.username)}</span>${admin ? '<span class="role">管理员</span>' : ''}</button>
    <div class="user-menu" id="user-menu" role="menu">
      <div class="um-head"><b>${esc(u.username)}</b><small>${admin ? '管理员 · 可管理所有账号' : '只能看到自己的数据'}</small></div>
      <a href="#/account" role="menuitem">${icon('settings', 15)}账号与密码</a>
      ${admin ? `<a href="#/admin" role="menuitem">${icon('layers', 15)}用户管理</a>` : ''}
      <button id="logout" role="menuitem">${icon('arrow', 15)}退出登录</button>
    </div>`;
  const menu = $('#user-menu');
  $('#user-btn').onclick = (e) => (e.stopPropagation(), menu.classList.toggle('open'));
  menu.onclick = () => menu.classList.remove('open');
  $('#logout').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    session.user = null;
    renderAccount();
    refreshMode();
    location.hash = '#/home';
    toast('已退出登录');
  };
}
document.addEventListener('click', () => $('#user-menu')?.classList.remove('open'));

// 登录 / 注册成功后由登录页触发
window.addEventListener('authchange', () => {
  renderAccount();
  refreshMode();
});
window.addEventListener('unauthorized', () => {
  if (!session.user) return;
  session.user = null;
  renderAccount();
  refreshMode();
  toast('登录已过期，请重新登录', 'error');
  route();
});

window.addEventListener('hashchange', route);
window.addEventListener('providerschange', refreshMode);
loadSession().then(() => {
  renderAccount();
  refreshMode();
  route();
});
