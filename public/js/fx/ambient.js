// 全站动效：星尘背景、跟随光标、磁吸按钮、卡片 3D 倾斜、逐字浮现、滚动浮现、滚动驱动的 3D 素材长廊
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
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
