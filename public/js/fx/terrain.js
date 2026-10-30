// 选品页「市场地形」：起伏的方块阵列，亮色方块 = 真实商品，高度 = 综合评分；悬停查看、点击打开详情
import { THREE, createStage, cssColor } from './stage.js';

const COLS = 34, ROWS = 14, GAP = 1.0, SIZE = 0.86;

/**
 * @param {HTMLElement} host
 * @param {{items:{id:string,nameCn:string,score:number,grade:string,category:string}[], onPick?:(id:string)=>void}} data
 */
export function mountTerrain(host, { items = [], onPick } = {}) {
  const st = createStage(host, { fov: 38, far: 60 });
  if (!st) return () => {};
  const { scene, camera, mouse } = st;
  const bg = cssColor('--bg', '#060606');
  const bone = cssColor('--lime', '#e8dcc4');
  const ink = cssColor('--text', '#edede9');
  const base = cssColor('--panel-2', '#161615').lerp(new THREE.Color('#888'), 0.08);

  scene.fog = new THREE.Fog(bg, 10, 30);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-6, 10, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(8, 3, -6);
  scene.add(rim);

  const count = COLS * ROWS;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(SIZE, 1, SIZE), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 }), count);
  scene.add(mesh);

  // 把商品分散放进前中部的格子里，其余格子是"市场背景"
  const product = new Map(); // instance index -> item
  const slots = [];
  for (let r = 4; r < 11; r++) for (let c = 6; c < COLS - 4; c += 1) slots.push(r * COLS + c);
  const stride = Math.max(1, Math.floor(slots.length / Math.max(1, items.length)));
  items.forEach((it, i) => product.set(slots[(i * stride + (i % 3)) % slots.length], it));

  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const it = product.get(i);
    if (it) color.copy(it.grade === 'S' ? bone : it.grade === 'A' ? ink : base.clone().lerp(ink, 0.45));
    else color.copy(base);
    mesh.setColorAt(i, color);
  }
  mesh.instanceColor.needsUpdate = true;

  const dummy = new THREE.Object3D();
  const heights = new Float32Array(count);
  let t0 = 0;
  let hover = -1;

  // 悬停提示
  const tip = document.createElement('div');
  tip.className = 'tip';
  host.appendChild(tip);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  st.onFrame((dt, now) => {
    if (!t0) t0 = now;
    const grow = Math.min(1, (now - t0) / 1.6);
    const ease = 1 - Math.pow(1 - grow, 3);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const x = (c - COLS / 2) * GAP, z = (r - ROWS / 2) * GAP;
        const wave = (Math.sin(x * 0.32 + now * 0.9) * Math.cos(z * 0.45 + now * 0.6) + 1) / 2;
        const it = product.get(i);
        let h = 0.25 + wave * 0.9 + (it ? (it.score / 100) * 2.4 : 0);
        if (i === hover) h += 0.5;
        heights[i] += (h - heights[i]) * 0.12;
        const hh = Math.max(0.05, heights[i] * ease);
        dummy.position.set(x, hh / 2 - 1.2, z);
        dummy.scale.set(1, hh, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    camera.position.set(mouse.x * 1.6 + 2, 6.2 + mouse.y * 0.8, 12.5);
    camera.lookAt(1.5, -0.5, 0);

    // 只对商品方块做命中检测
    if (mouse.inside) {
      ndc.set(mouse.tx, mouse.ty);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh, false).find((h) => product.has(h.instanceId));
      const idx = hit ? hit.instanceId : -1;
      if (idx !== hover) {
        hover = idx;
        host.style.cursor = idx >= 0 ? 'pointer' : '';
        if (idx >= 0) {
          const it = product.get(idx);
          tip.replaceChildren(Object.assign(document.createElement('b'), { textContent: it.nameCn }), Object.assign(document.createElement('small'), { textContent: `${it.category} · 评分 ${it.score} · ${it.grade} 级` }));
        }
        tip.classList.toggle('on', idx >= 0);
      }
      if (hover >= 0) tip.style.left = `${mouse.px}px`, (tip.style.top = `${mouse.py}px`);
    } else if (hover >= 0) {
      hover = -1;
      tip.classList.remove('on');
    }
  });

  const onClick = () => hover >= 0 && onPick?.(product.get(hover).id);
  host.addEventListener('click', onClick);
  return () => {
    host.removeEventListener('click', onClick);
    tip.remove();
    st.dispose();
  };
}
