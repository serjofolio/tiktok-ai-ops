// 界面风格清单与切换
export const STYLES = [
  { key: 'paper', name: '纸墨', desc: '纸白 + 墨黑 + 柠檬绿，克制专业', colors: ['#f3f2ee', '#111110', '#d2ff1f'] },
  { key: 'brutal', name: '波普', desc: '新粗野主义：粗描边、硬投影、撞色', colors: ['#fff4e0', '#111111', '#ff90e8', '#ffc900'] },
  { key: 'editorial', name: '杂志', desc: '衬线标题、象牙底、墨绿与赤陶', colors: ['#f6f1e7', '#1f3b2d', '#c8553d'] },
  { key: 'terminal', name: '终端', desc: '等宽字体、琥珀色数据屏、扫描线', colors: ['#0a0a08', '#e9e6d6', '#ffb000'] },
  { key: 'soft', name: '奶油', desc: '暖桃色、大圆角、柔和投影', colors: ['#fbf3ec', '#3a2a22', '#ff7a59', '#7dd3b0'] },
];

export const currentStyle = () => document.documentElement.dataset.style || 'paper';

export function applyStyle(key, evt) {
  const set = () => {
    document.documentElement.dataset.style = key;
    try { localStorage.setItem('style', key); } catch {}
    window.dispatchEvent(new CustomEvent('stylechange', { detail: key }));
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) return set();
  if (evt) {
    document.documentElement.style.setProperty('--vx', `${evt.clientX}px`);
    document.documentElement.style.setProperty('--vy', `${evt.clientY}px`);
  }
  let done = false;
  const t = document.startViewTransition(() => { done = true; set(); });
  t.updateCallbackDone.catch(() => !done && set());
  t.ready.catch(() => {});
  t.finished.catch(() => {});
}

export const swatch = (s) => `<span class="swatch">${s.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
