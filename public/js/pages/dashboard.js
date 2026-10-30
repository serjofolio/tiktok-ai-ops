// 总览：3D 主视觉 + 选品到脚本的进度 + 快捷入口
import { api, icon, esc, fmtNum, timeAgo, empty } from '../lib.js';
import { splitText, mountGallery } from '../fx/ambient.js';

const VC = { 推荐测款: 'v-go', 再观察: 'v-watch', 建议放弃: 'v-drop', 数据不足: 'v-na' };

export async function render(view) {
  const d = await api('/dashboard');
  const s = d.stats;
  const cats = d.categoryStats;
  const maxSales = Math.max(...cats.map((c) => c.sales || c.count), 1);
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const stats = [
    ['选品库', s.products, `${s.recommended} 个推荐测款`, '#/products'],
    ['测款中', s.testing, '正在验证的商品', '#/products'],
    ['视频脚本', s.scripts, '可直接开拍', '#/scripts'],
    ['知识文档', s.docs, `${s.chats} 个 Agent 对话`, '#/knowledge'],
  ];
  const flow = [
    ['upload', '导入 FastMoss 数据', '榜单 / 搜索结果导出，或直接粘贴', '#/products'],
    ['target', '硬指标 + 利润测算', '销量增长、利润、对标视频、价格带', '#/products'],
    ['sparkles', 'AI 选品分析', '为什么选、怎么拍、测款方案', '#/products'],
    ['script', '一键生成视频脚本', '钩子 → 痛点 → 演示 → 证明 → CTA', '#/scripts'],
  ];
  const cards = d.topProducts.slice(0, 9).map((p) => ({ title: p.name, sub: `${p.evaluation.verdict} · ${p.growth != null ? (p.growth > 0 ? '+' : '') + p.growth + '%' : '—'}`, href: `#/products/${p.id}` }));

  view.innerHTML = `
  <section class="stage3d" id="stage">
    <div class="copy">
      <div class="eyebrow">${today} · ${esc(d.store.market)} 站</div>
      <h2 id="headline">${esc(d.store.name)}，<br>今天选出<em>能卖的品</em></h2>
      <p>从 FastMoss 真实数据出发：按硬指标筛、算清利润、AI 说明为什么选，再一键生成带货脚本。</p>
      <div class="row">
        <a class="btn lg primary-glow" href="#/products">${icon('target')}开始选品</a>
        <a class="btn ghost lg" href="#/chat">${icon('bot')}问 Agent</a>
        ${d.provider ? '' : `<a class="btn ghost lg" href="#/providers">${icon('link')}接入大模型</a>`}
      </div>
    </div>
    <div class="side"><b>当前模型</b>${d.provider ? `${esc(d.provider.name)}<br><span class="money">${esc(d.provider.model)}</span>` : '未接入'}<br><span class="muted">按住拖动可旋转</span></div>
    <div class="legend">${cats.length ? '立柱高度 = 各类目近 7 天销量' : '导入商品后，立柱显示各类目销量'}</div>
    <div class="scroll-hint"><i></i>向下滚动</div>
  </section>

  <div class="stat-strip">
    ${stats.map(([t, v, sub, href]) => `<a href="${href}"><div class="stat-label">${t}</div><div class="stat-value" data-count="${v}">0</div><div class="stat-detail">${sub}</div></a>`).join('')}
  </div>

  ${cats.length ? `<div class="mega" aria-hidden="true"><div class="mega-track">${cats.concat(cats).map((c) => `<span>${esc(c.category)}</span>`).join('')}</div></div>` : ''}

  <section data-reveal>
    <div class="section-title"><h3>从选品到脚本</h3><span class="muted small">点击任一步直接进入</span></div>
    <div class="pipeline">
      ${flow.map(([ic, t, sub, href], i) => `<div class="pipe-step"><a class="pipe-node done" href="${href}"><div class="n">${icon(ic, 15)}</div><b>${t}</b><small>${sub}</small></a>${i < flow.length - 1 ? '<div class="pipe-arrow"></div>' : ''}</div>`).join('')}
    </div>
  </section>

  <div class="grid mt g-2-1" data-reveal>
    <div class="card">
      <div class="card-head"><h3>选品库</h3><div class="spacer"></div><a class="btn sm ghost" href="#/products">全部 ${icon('arrow', 14)}</a></div>
      ${d.topProducts.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>商品</th><th class="r">售价</th><th class="r">7 天销量</th><th class="r">环比</th><th>结论</th></tr></thead>
        <tbody>${d.topProducts.map((p) => `<tr style="cursor:pointer" onclick="location.hash='#/products/${p.id}'">
          <td><b>${esc(p.name)}</b><div class="p-sub">${esc(p.category || '')}</div></td><td class="r money">${p.price != null ? '$' + p.price : '—'}</td>
          <td class="r">${p.sales7d != null ? fmtNum(p.sales7d) : '—'}</td><td class="r ${p.growth >= 0 ? 'up' : 'down'}">${p.growth != null ? (p.growth > 0 ? '+' : '') + p.growth + '%' : '—'}</td>
          <td><span class="verdict ${VC[p.evaluation.verdict] || 'v-na'}">${esc(p.evaluation.verdict)}</span></td></tr>`).join('')}</tbody></table></div>`
        : empty('选品库是空的：从 FastMoss 导出商品数据后导入', 'target', '<a class="btn sm" href="#/products">去导入</a>')}
    </div>
    <div class="card">
      <div class="card-head"><h3>类目销量</h3></div>
      <div class="card-pad bars">
        ${cats.length ? cats.map((c) => `<div class="bar-row"><span>${esc(c.category)}</span><div class="track"><i style="width:${((c.sales || c.count) / maxSales) * 100}%"></i></div><b>${fmtNum(c.sales || c.count)}</b></div>`).join('') : '<p class="muted small">导入商品后显示</p>'}
      </div>
    </div>
  </div>

  ${cards.length >= 3 ? `<section class="gallery3d mt" id="gallery"><div class="viewport"><div class="title"><h3>候选商品，正在浮现</h3><div>${s.products} 个商品 // ${s.recommended} 个推荐测款 // 滚动浏览</div></div></div></section>` : ''}

  <div class="grid g2 mt" data-reveal>
    <div class="card">
      <div class="card-head"><h3>最近脚本</h3><div class="spacer"></div><a class="btn sm ghost" href="#/scripts">全部 ${icon('arrow', 14)}</a></div>
      <div class="card-pad col" style="padding:8px">${d.recentScripts.length ? d.recentScripts.map((r) => `<a class="list-item" href="#/scripts/${r.id}"><div style="flex:1;min-width:0"><b>${esc(r.title)}</b><div class="muted small">${esc(r.productName || '')} · ${timeAgo(r.createdAt)}</div></div>${icon('arrow', 14)}</a>`).join('') : empty('还没有生成脚本', 'script')}</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>动态</h3></div>
      <div class="card-pad col">${d.activity.length ? d.activity.map((a) => `<div class="row" style="flex-wrap:nowrap"><span class="chip">${{ product: '选品', script: '脚本' }[a.type] || '记录'}</span><span style="flex:1">${esc(a.text)}</span><span class="muted small">${timeAgo(a.createdAt)}</span></div>`).join('') : empty('暂无动态')}</div>
    </div>
  </div>`;

  splitText(view.querySelector('#headline'));
  const cleanups = [];
  const gal = view.querySelector('#gallery');
  if (gal) cleanups.push(mountGallery(gal, cards));
  // 3D 场景按需加载，失败（如浏览器禁用 WebGL）时页面其余部分照常可用
  import('../fx/orb.js')
    .then(({ mountOrb }) => {
      if (!view.isConnected) return;
      cleanups.push(mountOrb(view.querySelector('#stage'), { bars: cats.map((c) => ({ label: c.category, value: c.sales || c.count, text: c.sales ? `${fmtNum(c.sales)} 件` : `${c.count} 个商品` })) }));
    })
    .catch((e) => console.warn('[fx] 3D 主视觉未加载：', e.message));
  return () => cleanups.forEach((fn) => fn && fn());
}
