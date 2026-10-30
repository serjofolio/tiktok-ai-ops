// 总览主视觉：呼吸的粒子球 + 线框环 + 品类 GMV 立柱（立柱高度 = 真实 7 日 GMV）
import { THREE, createStage, cssColor } from './stage.js';

// 按住拖动旋转，松手后带惯性继续转动

const POINT_VERT = `
  uniform float uTime; uniform float uSize; uniform float uPixel;
  attribute float aSeed;
  varying float vDepth; varying float vSeed;
  void main() {
    vec3 p = position;
    // 沿纬度的呼吸波：让球面像被声波拨动
    float lat = asin(clamp(normalize(p).y, -1.0, 1.0));
    float wave = sin(lat * 9.0 + uTime * 1.4) * 0.035 + sin(atan(p.z, p.x) * 5.0 - uTime * 0.9) * 0.02;
    p *= 1.0 + wave;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = clamp((-mv.z - 6.0) / 4.0, 0.0, 1.0);
    vSeed = aSeed;
    gl_PointSize = uSize * uPixel * (0.6 + aSeed * 0.8) * (9.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const POINT_FRAG = `
  uniform vec3 uColor; uniform float uTime;
  varying float vDepth; varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    float twinkle = 0.75 + 0.25 * sin(uTime * 2.0 + vSeed * 40.0);
    gl_FragColor = vec4(uColor, a * mix(1.0, 0.18, vDepth) * twinkle);
  }`;

function fibonacciSphere(n, r) {
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const t = g * i;
    const jitter = 1 + (Math.random() - 0.5) * 0.02;
    pos.set([Math.cos(t) * rad * r * jitter, y * r * jitter, Math.sin(t) * rad * r * jitter], i * 3);
    seed[i] = Math.random();
  }
  return { pos, seed };
}

function ring(radius, y, color, opacity, segments = 160) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

/**
 * @param {HTMLElement} host
 * @param {{bars: {label:string, value:number, text:string}[]}} data
 */
export function mountOrb(host, { bars = [] } = {}) {
  const st = createStage(host, { fov: 40 });
  if (!st) return () => {};
  const { scene, camera, renderer, mouse, size } = st;
  // 深色底用发光叠加 + 强调色粒子；浅色底改用普通混合 + 墨色，保证可见
  const bgc = cssColor('--bg', '#060606');
  const dark = bgc.r * 0.3 + bgc.g * 0.59 + bgc.b * 0.11 < 0.35;
  const bone = dark ? cssColor('--lime', '#e8dcc4') : cssColor('--ink', '#111110');
  const lineCol = cssColor('--text-3', '#6c6b65');
  const textCol = cssColor('--text', '#edede9');

  const world = new THREE.Group();
  scene.add(world);

  // 粒子球
  const { pos, seed } = fibonacciSphere(7000, 1.45);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uSize: { value: 3.1 }, uPixel: { value: renderer.getPixelRatio() }, uColor: { value: bone } };
  const sphere = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending }));
  world.add(sphere);

  // 线框环 + 稀疏经线
  const R = 3.4;
  const rings = new THREE.Group();
  rings.add(ring(R, -1.7, lineCol, 0.55), ring(R * 1.06, 1.9, lineCol, 0.35), ring(R * 0.62, 2.45, lineCol, 0.25), ring(R * 1.12, -1.7, lineCol, 0.2));
  const lat = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    lat.push(new THREE.Vector3(Math.cos(a) * R, -1.7, Math.sin(a) * R), new THREE.Vector3(Math.cos(a) * R * 1.06, 1.9, Math.sin(a) * R * 1.06));
  }
  rings.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lat), new THREE.LineBasicMaterial({ color: lineCol, transparent: true, opacity: 0.07 })));
  world.add(rings);

  // 品类 GMV 立柱：环绕球体，高度按真实 GMV 缩放
  const max = Math.max(...bars.map((b) => b.value), 1);
  const columns = [];
  const labels = [];
  bars.forEach((b, i) => {
    const a = (i / bars.length) * Math.PI * 2 + 0.3;
    const h = 0.35 + (b.value / max) * 2.6;
    const w = 0.22;
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, w)), new THREE.LineBasicMaterial({ color: i === 0 ? bone : textCol, transparent: true, opacity: i === 0 ? 0.95 : 0.55 }));
    box.position.set(Math.cos(a) * R * 0.93, -1.7 + h / 2, Math.sin(a) * R * 0.93);
    box.scale.y = 0.001;
    box.userData = { h, delay: i * 0.08 };
    world.add(box);
    columns.push(box);
    const el = document.createElement('div');
    el.className = 'orb-label';
    const name = document.createElement('b');
    name.textContent = b.label; // 品类名可能来自导入的 CSV，按文本插入
    el.append(name, ` ${b.text}`);
    host.appendChild(el);
    labels.push({ el, box });
  });

  // 外层星尘
  const dustN = 700;
  const dust = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    const r = 4 + Math.random() * 7, t = Math.random() * Math.PI * 2, p = Math.acos(Math.random() * 2 - 1);
    dust.set([r * Math.sin(p) * Math.cos(t), r * Math.cos(p) * 0.6, r * Math.sin(p) * Math.sin(t)], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: textCol, size: 0.025, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(dustPts);

  const tmp = new THREE.Vector3();
  const center = new THREE.Vector3();
  // ---------- 拖动旋转 ----------
  const drag = { on: false, x: 0, y: 0, yaw: 0, pitch: 0, vy: 0, vp: 0 };
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('a, button, input, .copy p')) return;
    drag.on = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    host.classList.add('grabbing');
    host.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag.on) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.vy = dx * 0.006;
    drag.vp = dy * 0.004;
    drag.yaw += drag.vy;
    drag.pitch = Math.max(-0.6, Math.min(0.6, drag.pitch + drag.vp));
    st.kick();
  };
  const up = () => { drag.on = false; host.classList.remove('grabbing'); };
  host.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);

  let t0 = 0;
  st.onFrame((dt, now) => {
    if (!t0) t0 = now;
    // 减少动效模式：直接显示最终状态
    const t = st.still ? 99 : now - t0;
    if (!drag.on) {
      drag.yaw += drag.vy;
      drag.vy *= 0.94;
      drag.pitch *= 0.97;
    }
    uniforms.uTime.value = now;
    // 桌面端把球体放在右侧，给左侧标题留空间
    world.position.x = size.w > 900 ? 2.6 : 0;
    world.scale.setScalar(size.w > 900 ? 0.86 : 0.8);
    world.position.y = size.w > 900 ? 0 : 0.9;
    world.rotation.y = t * 0.12 + drag.yaw;
    world.rotation.x = drag.pitch;
    sphere.rotation.y += dt * 0.08;
    sphere.rotation.x = Math.sin(now * 0.2) * 0.08;
    dustPts.rotation.y -= dt * 0.02;
    columns.forEach((c) => {
      const p = Math.min(1, Math.max(0, (t - 0.4 - c.userData.delay) / 1.2));
      const e = 1 - Math.pow(1 - p, 3);
      c.scale.y = Math.max(0.001, e);
      c.position.y = -1.7 + (c.userData.h * c.scale.y) / 2;
    });
    camera.position.set(Math.sin(now * 0.18) * 1.6 + mouse.x * 1.1, 1.5 + Math.sin(now * 0.11) * 0.6 + mouse.y * 0.7, 9.2 + Math.cos(now * 0.14) * 0.6);
    camera.lookAt(world.position.x * 0.55, 0.1, 0);
    // 立柱顶部的 HTML 标签：投影到屏幕，转到背面时淡出
    world.getWorldPosition(center);
    const camDist = camera.position.distanceTo(center);
    labels.forEach(({ el, box }) => {
      box.getWorldPosition(tmp);
      tmp.y += (box.userData.h * box.scale.y) / 2 + 0.15;
      const behind = camera.position.distanceTo(tmp) > camDist;
      tmp.project(camera);
      el.style.transform = `translate(${((tmp.x + 1) / 2) * size.w + 8}px, ${((1 - tmp.y) / 2) * size.h - 6}px)`;
      el.style.opacity = box.scale.y < 0.6 ? 0 : behind ? 0.2 : 1;
    });
  });

  return () => {
    host.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    labels.forEach(({ el }) => el.remove());
    st.dispose();
  };
}
