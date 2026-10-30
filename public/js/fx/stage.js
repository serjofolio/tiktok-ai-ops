// Three.js 场景底座：渲染循环只在可见时运行，自动适配尺寸与像素比，离开页面时完整释放
import * as THREE from 'three';

export { THREE };

export const reducedMotion = () => false /* 按产品要求始终播放动效 */;

// 读取 CSS 变量颜色，保证 3D 场景跟随当前界面风格
export function cssColor(name, fallback = '#ffffff') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

/**
 * @param {HTMLElement} host 容器（需为定位元素）
 * @param {{fov?:number, near?:number, far?:number}} opts
 * @returns {null | {scene, camera, renderer, canvas, mouse, onFrame:(fn)=>void, size:{w:number,h:number}, dispose:()=>void}}
 */
export function createStage(host, { fov = 45, near = 0.1, far = 100 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'webgl';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.warn('[fx] WebGL 不可用，跳过 3D 场景');
    return null;
  }
  host.prepend(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  const size = { w: 1, h: 1 };
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, px: -1, py: -1, inside: false };
  const frames = [];
  let raf = 0, visible = true, dead = false, last = performance.now();

  const resize = () => {
    const r = host.getBoundingClientRect();
    size.w = Math.max(1, r.width);
    size.h = Math.max(1, r.height);
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const onMove = (e) => {
    const r = host.getBoundingClientRect();
    mouse.px = e.clientX - r.left;
    mouse.py = e.clientY - r.top;
    mouse.inside = mouse.px >= 0 && mouse.py >= 0 && mouse.px <= r.width && mouse.py <= r.height;
    mouse.tx = (mouse.px / r.width) * 2 - 1;
    mouse.ty = -((mouse.py / r.height) * 2 - 1);
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  // 不在视口内或页面隐藏时停止渲染，节省 CPU/GPU
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); }, { threshold: 0 });
  io.observe(host);
  const onVis = () => !document.hidden && loop();
  document.addEventListener('visibilitychange', onVis);

  const still = reducedMotion();
  function loop() {
    if (dead || raf) return;
    raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    raf = 0;
    if (dead) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    for (const fn of frames) fn(still ? 0 : dt, now / 1000);
    renderer.render(scene, camera);
    if (visible && !document.hidden && !still) loop();
  }
  requestAnimationFrame(() => loop());

  return {
    scene, camera, renderer, canvas, mouse, size,
    onFrame: (fn) => frames.push(fn),
    still,
    // 减少动效模式下不持续渲染，交互时手动请求一帧
    kick: () => loop(),
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        [].concat(o.material || []).forEach((m) => m.dispose?.());
      });
      renderer.dispose();
      canvas.remove();
    },
  };
}
