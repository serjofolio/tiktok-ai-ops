// 应用外壳：导航、路由、主题
import { icon, api, $ } from './lib.js';

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

function setThemeIcon() {
  $('#theme-btn').innerHTML = icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun');
}
$('#theme-btn').onclick = () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  setThemeIcon();
};
setThemeIcon();

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

let cleanup = null;
async function route() {
  const [, path = 'dashboard', ...rest] = location.hash.split('/');
  const r = ROUTES.find((x) => x.path === path) || ROUTES[1];
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === r.path));
  $('#page-title').textContent = r.title;
  $('#page-sub').textContent = r.sub;
  document.title = `${r.title} · TikTok AI 运营智能体`;
  $('#app').classList.remove('nav-open');
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const view = $('#view');
  view.innerHTML = '<div class="skeleton" style="height:160px"></div>';
  view.style.animation = 'none';
  void view.offsetHeight;
  view.style.animation = '';
  try {
    const mod = await import(`./pages/${r.path}.js`);
    cleanup = await mod.render(view, rest.map(decodeURIComponent));
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card card-pad"><h3>页面加载失败</h3><p class="muted">${e.message}</p></div>`;
  }
}

window.addEventListener('hashchange', route);
route();
refreshMode();
