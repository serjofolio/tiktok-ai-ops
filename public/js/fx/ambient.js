// 全站动效：星尘背景、跟随光标、磁吸按钮、卡片 3D 倾斜、逐字浮现、滚动浮现、滚动驱动的 3D 素材长廊
const reduce = () => false /* 按产品要求始终播放动效 */;
const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const pointer = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

// ---------- 星尘：三层景深粒子缓慢漂移，随鼠标轻微视差（仅暗场风格可见） ----------
export function initStars() {
  const cv = document.getElementById('stars');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let w = 0, h = 0, dpr = 1, stars = [];
  const build = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((w * h) / 9000);
    stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, z: Math.random() * 0.9 + 0.1, r: Math.random() * 1.2 + 0.2, tw: Math.random() * 6.28 }));
  };
  build();
  addEventListener('resize', build);
  let px = 0, py = 0;
  // 流星：每隔几秒从右上方划过
  const meteors = [];
  let nextMeteor = 0;
  const draw = (now) => {
    requestAnimationFrame(draw);
    if (document.documentElement.dataset.style !== 'cinema' || document.hidden) return;
    px += ((pointer.x / w - 0.5) - px) * 0.04;
    py += ((pointer.y / h - 0.5) - py) * 0.04;
    ctx.clearRect(0, 0, w, h);
    const still = reduce();
    for (const s of stars) {
      if (!still) { s.y -= s.z * 0.12; if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; } }
      const x = s.x - px * 40 * s.z, y = s.y - py * 40 * s.z;
      const a = (0.25 + 0.55 * s.z) * (0.7 + 0.3 * Math.sin(now / 900 + s.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ece6d8';
      ctx.beginPath();
      ctx.arc(x, y, s.r * s.z + 0.2, 0, 6.283);
      ctx.fill();
    }
    if (now > nextMeteor) {
      nextMeteor = now + 1800 + Math.random() * 3200;
      meteors.push({ x: w * (0.35 + Math.random() * 0.7), y: -20, vx: -(5 + Math.random() * 4), vy: 3 + Math.random() * 2.5, life: 1 });
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx; m.y += m.vy; m.life -= 0.012;
      if (m.life <= 0 || m.y > h + 40) { meteors.splice(i, 1); continue; }
      const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 18, m.y - m.vy * 18);
      g.addColorStop(0, `rgba(255, 225, 180, ${m.life})`);
      g.addColorStop(1, 'rgba(255, 180, 110, 0)');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 18, m.y - m.vy * 18);
      ctx.stroke();
    }
  };
  requestAnimationFrame(draw);
}

// ---------- 跟随光标 + 磁吸按钮 + 卡片倾斜（事件委托，自动作用于后渲染的元素） ----------
export function initPointerFx() {
  if (!finePointer()) return;
  const dot = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  document.body.classList.add('has-cursor');
  let rx = pointer.x, ry = pointer.y;
  const loop = () => {
    rx += (pointer.x - rx) * 0.18;
    ry += (pointer.y - ry) * 0.18;
    dot.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(loop);
  };
  loop();
  const interactive = 'a, button, .product, .media, .preset, .chip.click, .list-item, .agent-item, .style-card, .float, input, select, textarea, [data-cursor]';
  document.addEventListener('pointerover', (e) => ring.classList.toggle('hover', !!e.target.closest(interactive)));
  document.addEventListener('pointerdown', () => ring.classList.add('down'));
  document.addEventListener('pointerup', () => ring.classList.remove('down'));
  document.addEventListener('pointerleave', () => document.body.classList.remove('has-cursor'));
  document.addEventListener('pointerenter', () => document.body.classList.add('has-cursor'));
  if (reduce()) return;

  // 磁吸：大按钮被光标轻微吸附
  let mag = null;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest('.btn.lg, .magnetic');
    if (mag && mag !== el) { mag.style.transform = ''; mag = null; }
    if (!el) return;
    mag = el;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.3}px)`;
  }, { passive: true });

  // 倾斜：商品卡、图片卡等随光标在 3D 中转动，并带一块跟随高光
  let tilt = null;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest('.product, .media, .style-card, .stat-strip > div, .pipe-node');
    if (tilt && tilt !== el) { tilt.classList.remove('tilting'); tilt.style.removeProperty('--rx'); tilt.style.removeProperty('--ry'); tilt = null; }
    if (!el) return;
    tilt = el;
    el.classList.add('tilt', 'tilting');
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(px - 0.5) * 10}deg`);
    el.style.setProperty('--rx', `${(0.5 - py) * 8}deg`);
    el.style.setProperty('--gx', `${px * 100}%`);
    el.style.setProperty('--gy', `${py * 100}%`);
  }, { passive: true });
}

// ---------- 逐字浮现：把元素文本拆成单字（保留 <em> 等内联强调） ----------
export function splitText(el) {
  if (!el || el.dataset.split) return;
  el.dataset.split = '1';
  let i = 0;
  const walk = (node) => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        let word = null;
        for (const ch of n.textContent) {
          const s = document.createElement('span');
          if (ch === ' ') { s.className = 'sp'; s.textContent = ' '; }
          else { s.className = 'ch'; s.textContent = ch; s.style.setProperty('--i', i++); }
          // 连续的字母数字放进同一个不换行的词容器
          if (/[A-Za-z0-9$%.]/.test(ch)) {
            if (!word) { word = document.createElement('span'); word.className = 'w'; frag.appendChild(word); }
            word.appendChild(s);
          } else { word = null; frag.appendChild(s); }
        }
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    }
  };
  el.setAttribute('aria-label', el.textContent);
  walk(el);
  el.classList.add('chars');
}

// ---------- 滚动浮现 ----------
export function armReveal(root) {
  const els = root.querySelectorAll('[data-reveal]');
  if (!els.length || reduce() || !('IntersectionObserver' in window)) return () => {};
  root.classList.add('reveal-armed');
  const io = new IntersectionObserver((ents) => ents.forEach((en) => en.isIntersecting && (en.target.classList.add('in'), io.unobserve(en.target))), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((el) => io.observe(el));
  return () => io.disconnect();
}

// ---------- 素材长廊：卡片按滚动进度在 3D 空间中漂浮、旋转、迎面飞来 ----------
export function mountGallery(section, cards) {
  const vp = section.querySelector('.viewport');
  const els = cards.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'float';
    el.dataset.href = c.href || '';
    if (c.src) {
      const img = document.createElement('img');
      img.src = c.src;
      img.alt = c.title || '';
      img.loading = 'lazy';
      el.appendChild(img);
    } else {
      // 还没有生成图片时，用商品名做文字卡片
      el.classList.add('text');
      const b = document.createElement('b');
      b.textContent = c.title || '';
      const sm = document.createElement('small');
      sm.textContent = c.sub || '';
      el.append(b, sm);
    }
    vp.appendChild(el);
    // 每张卡片一条固定的飞行轨迹
    const a = (i / cards.length) * Math.PI * 2 + 0.4;
    return { el, a, r: 280 + (i % 3) * 120, spin: (i % 2 ? 1 : -1) * (18 + i * 7), lag: i * 0.11, y: ((i * 37) % 100) / 100 - 0.5 };
  });
  vp.addEventListener('click', (e) => {
    const f = e.target.closest('.float');
    if (f?.dataset.href) location.hash = f.dataset.href;
  });
  let raf = 0, dead = false;
  const update = () => {
    raf = 0;
    if (dead) return;
    const r = section.getBoundingClientRect();
    const total = r.height - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
    const wide = innerWidth > 900 ? 1 : 0.55;
    for (const c of els) {
      const k = Math.min(1, Math.max(0, p * 1.4 - c.lag * 0.5));
      const ang = c.a + p * 1.6;
      const x = Math.cos(ang) * c.r * 1.6 * wide;
      const y = (c.y * 420 + Math.sin(ang * 2) * 40) * wide - (k - 0.5) * 160;
      const z = -600 + k * 900;
      c.el.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateY(${c.spin * (1 - k) + Math.sin(ang) * 25}deg) rotateZ(${(1 - k) * c.spin * 0.6}deg)`;
      c.el.style.opacity = String(Math.min(1, 0.15 + k * 1.2) * (z > 250 ? Math.max(0, 1 - (z - 250) / 60) : 1));
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
  return () => { dead = true; removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); };
}

// ---------- 卡片光边：光标靠近时点亮边框 ----------
export function initSpotlight() {
  if (!finePointer() || reduce()) return;
  let lit = null;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest('.card, .product, .pipe-node, .step, .provider-item, .stat-strip > div');
    if (lit && lit !== el) lit.classList.remove('lit');
    lit = el;
    if (!el) return;
    el.classList.add('spot', 'lit');
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

// ---------- 文字解码：切换时字符先乱码滚动，再逐个定格为目标文字 ----------
const GLYPHS = '#$%&*+<>?/\\=ABCDEFGHJKLMNPQRSTUVWXYZ0123456789选品利润脚本测款爆款数据增长';
export function scramble(el, text, { duration = 700 } = {}) {
  if (!el) return;
  const chars = [...text];
  const start = performance.now();
  cancelAnimationFrame(el._scr);
  const tick = (t) => {
    const p = Math.min(1, (t - start) / duration);
    const fixed = Math.floor(p * chars.length);
    el.textContent = chars.map((c, i) => (i < fixed || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
    if (p < 1) el._scr = requestAnimationFrame(tick);
    else el.textContent = text;
  };
  el._scr = requestAnimationFrame(tick);
}

// ---------- 闪光星点：在元素周围不断随机冒出四角星，返回停止函数 ----------
export function sparkles(el, { every = 260, colors = ['#ffd59a', '#ffb35c', '#ff7a59', '#fff4e0'] } = {}) {
  if (!el) return () => {};
  el.classList.add('sparkle-host');
  const timer = setInterval(() => {
    if (document.hidden) return;
    const s = document.createElement('i');
    s.className = 'sparkle';
    const size = 8 + Math.random() * 14;
    s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size}px;color:${colors[(Math.random() * colors.length) | 0]}`;
    s.innerHTML = '<svg viewBox="0 0 160 160"><path fill="currentColor" d="M80 0C80 0 84.2 41.2 101.5 58.5C118.8 75.8 160 80 160 80C160 80 118.8 84.2 101.5 101.5C84.2 118.8 80 160 80 160C80 160 75.8 118.8 58.5 101.5C41.2 84.2 0 80 0 80C0 80 41.2 75.8 58.5 58.5C75.8 41.2 80 0 80 0Z"/></svg>';
    el.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }, every);
  return () => clearInterval(timer);
}

// ---------- 开场动画：每次打开网站播放一次（纯视觉层，不拦截点击） ----------
export function initIntro() {
  let seen = false;
  try {
    seen = sessionStorage.getItem('intro') === '1';
    sessionStorage.setItem('intro', '1');
  } catch {}
  if (seen || navigator.webdriver) return;
  const el = document.createElement('div');
  el.className = 'intro';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="intro-half top"></div><div class="intro-half bottom"></div>
    <div class="intro-core"><div class="intro-ring"></div><div class="intro-ring r2"></div><div class="intro-logo">T</div>
    <div class="intro-name">${[...'TikTok 运营台'].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('')}</div>
    <div class="intro-bar"><i></i></div></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('open'), 1500);
  setTimeout(() => el.remove(), 2600);
}

// ---------- 点击按钮时迸发一圈光点 ----------
export function initClickBurst() {
  addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn, .user-btn, .auth-tabs button');
    if (!b) return;
    const box = document.createElement('div');
    box.className = 'burst';
    box.style.left = `${e.clientX}px`;
    box.style.top = `${e.clientY}px`;
    box.innerHTML = Array.from({ length: 10 }, (_, i) => `<i style="--a:${i * 36}deg"></i>`).join('');
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 700);
  }, { passive: true });
}
