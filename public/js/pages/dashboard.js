import { api, icon, esc, fmtNum, timeAgo, statusBadge, sparkline, empty, monogram } from '../lib.js';

export async function render(view) {
  const d = await api('/dashboard');
  const s = d.stats;
  const maxGmv = Math.max(...d.categoryStats.map((c) => c.gmv), 1);
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const stats = [
    ['商品库', s.products, `其中 ${s.hotProducts} 个 A 级以上潜力款`],
    ['视频脚本', s.scripts, 'AI 分镜脚本'],
    ['AI 图片', s.images, '文生图素材'],
    ['视频', s.videos, `已运行 ${s.runs} 次工作流`],
  ];
  const steps = [
    ['target', '智能选品', '六维评分 + AI 分析'],
    ['script', 'AI 脚本', '知识库增强的爆款脚本'],
    ['image', '分镜生图', '每个镜头文生图'],
    ['video', '图生视频', '片段生成与合成'],
    ['zap', '素材包', '标题、文案与话题'],
  ];
  const tick = d.topProducts.concat(d.topProducts);
  view.innerHTML = `
  <section class="hero">
    <div class="eyebrow">${today} · ${esc(d.store.market)} 站</div>
    <h2>${esc(d.store.name)}，今天<span class="mark">打造哪款爆品</span>？</h2>
    <p>选品、脚本、分镜图到成片一条龙完成。AI 智能体会参考你的内部知识库，让内容既专业又合规。</p>
    <div class="row">
      <a class="btn lg" href="#/workflows">${icon('zap')}启动一键工作流</a>
      <a class="btn ghost lg" href="#/agents">${icon('bot')}问问运营总监</a>
      ${d.providers.llm === 'mock' ? `<a class="btn ghost lg" href="#/settings">${icon('settings')}接入大模型</a>` : ''}
    </div>
  </section>

  <div class="ticker" aria-label="潜力商品滚动">
    <div class="ticker-track">${tick.map((p) => `<a class="ticker-item" href="#/products/${p.id}"><b>${esc(p.nameCn)}</b><span class="p">$${p.price}</span><span class="${p.salesGrowth >= 0 ? 'up' : 'down'}">${p.salesGrowth >= 0 ? '↑' : '↓'}${Math.abs(p.salesGrowth)}%</span><span class="p">评分 ${p.score}</span></a>`).join('')}</div>
  </div>

  <div class="stat-strip">
    ${stats.map(([t, v, sub]) => `<div><div class="stat-label">${t}</div><div class="stat-value" data-count="${v}">0</div><div class="stat-detail">${sub}</div></div>`).join('')}
  </div>

  <div class="section-title"><h3>选品 → 图片 → 视频</h3><span class="muted small">一键工作流的五个步骤</span><div class="spacer"></div><a class="btn sm ghost" href="#/workflows">查看工作流 ${icon('arrow', 14)}</a></div>
  <div class="pipeline">
    ${steps.map(([ic, t, sub], i) => `<div class="pipe-step"><div class="pipe-node done"><div class="n">${icon(ic, 15)}</div><b><span class="muted num">0${i + 1}</span> ${t}</b><small>${sub}</small></div>${i < steps.length - 1 ? '<div class="pipe-arrow"></div>' : ''}</div>`).join('')}
  </div>

  <div class="grid mt" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
    <div class="card">
      <div class="card-head"><h3>今日潜力爆品</h3><div class="spacer"></div><a class="btn sm ghost" href="#/products">全部商品 ${icon('arrow', 14)}</a></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>商品</th><th>品类</th><th class="r">价格</th><th class="r">7日销量</th><th class="r">环比</th><th>14日趋势</th><th class="r">评分</th></tr></thead>
        <tbody>${d.topProducts.map((p) => `<tr style="cursor:pointer" onclick="location.hash='#/products/${p.id}'">
          <td><div class="row" style="flex-wrap:nowrap">${monogram(p.name, 'sm')}<div><b>${esc(p.nameCn)}</b><div class="p-sub">${esc(p.name)}</div></div></div></td>
          <td><span class="chip">${esc(p.category)}</span></td><td class="r">$${p.price}</td><td class="r">${fmtNum(p.sales7d)}</td>
          <td class="r ${p.salesGrowth >= 0 ? 'up' : 'down'}">${p.salesGrowth >= 0 ? '+' : ''}${p.salesGrowth}%</td>
          <td>${sparkline(p.trend, { w: 90, h: 28 })}</td>
          <td class="r"><div class="row" style="flex-wrap:nowrap;justify-content:flex-end"><b>${p.score}</b><span class="grade grade-${p.grade}">${p.grade}</span></div></td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>品类 7 日 GMV</h3></div>
      <div class="card-pad bars">
        ${d.categoryStats.sort((a, b) => b.gmv - a.gmv).map((c) => `<div class="bar-row"><span>${esc(c.category)}</span><div class="track"><i style="width:${(c.gmv / maxGmv) * 100}%"></i></div><b>$${fmtNum(c.gmv)}</b></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="grid g2 mt">
    <div class="card">
      <div class="card-head"><h3>最近工作流</h3></div>
      <div class="card-pad col" style="padding:8px">
        ${d.recentRuns.length ? d.recentRuns.map((r) => `<a class="list-item" href="#/workflows/${r.id}"><div style="flex:1;min-width:0"><b>${esc(r.productName || r.name)}</b><div class="muted small">${timeAgo(r.createdAt)} · ${r.steps.filter((x) => x === 'done').length}/${r.steps.length} 步</div></div>${statusBadge(r.status)}</a>`).join('') : empty('还没有运行过工作流', 'flow', '<a class="btn sm" href="#/workflows">立即启动</a>')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>动态</h3></div>
      <div class="card-pad col">
        ${d.activity.length ? d.activity.map((a) => `<div class="row" style="flex-wrap:nowrap"><span class="chip">${{ workflow: '工作流', script: '脚本', image: '图片', video: '视频' }[a.type] || a.type}</span><span style="flex:1">${esc(a.text)}</span><span class="muted small">${timeAgo(a.createdAt)}</span></div>`).join('') : empty('暂无动态')}
      </div>
    </div>
  </div>`;
}
