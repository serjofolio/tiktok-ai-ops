import { api, icon, esc, fmtNum, timeAgo, statusBadge, sparkline, empty } from '../lib.js';

export async function render(view) {
  const d = await api('/dashboard');
  const s = d.stats;
  const maxGmv = Math.max(...d.categoryStats.map((c) => c.gmv), 1);
  const stats = [
    ['target', '商品库', s.products, `${s.hotProducts} 个潜力款`],
    ['script', '视频脚本', s.scripts, 'AI 分镜脚本'],
    ['image', 'AI 图片', s.images, '文生图素材'],
    ['video', '视频', s.videos, '图生视频 / 成片'],
  ];
  const steps = [
    ['target', '智能选品', '六维评分 + AI 分析'],
    ['script', 'AI 脚本', 'RAG 增强的爆款脚本'],
    ['image', '分镜生图', '每个镜头文生图'],
    ['video', '图生视频', '片段生成与合成'],
    ['zap', '素材包', '标题文案与话题'],
  ];
  view.innerHTML = `
  <div class="hero">
    <h2>你好，${esc(d.store.name)} 👋 <span class="gradient-text">今天打造哪款爆品？</span></h2>
    <p>从选品到成片只需一键：AI 智能体会自动完成选品分析、爆款脚本、分镜生图和图生视频，并基于内部知识库确保内容合规、专业。</p>
    <div class="row">
      <a class="btn grad lg" href="#/workflows">${icon('zap')}启动一键工作流</a>
      <a class="btn ghost lg" href="#/agents">${icon('bot')}和 AI 运营总监聊聊</a>
      ${d.providers.llm === 'mock' ? `<a class="btn ghost lg" href="#/settings">${icon('settings')}接入大模型</a>` : ''}
    </div>
  </div>

  <div class="grid g4 mt">
    ${stats.map(([ic, t, v, sub]) => `<div class="card stat"><div class="stat-ico">${icon(ic, 22)}</div><div><b>${fmtNum(v)}</b><span>${t} · ${sub}</span></div></div>`).join('')}
  </div>

  <div class="card mt">
    <div class="card-head"><h3>${icon('flow')}选品 - 图片 - 视频 全链路</h3><div class="spacer"></div><a class="btn sm ghost" href="#/workflows">查看工作流 ${icon('arrow', 14)}</a></div>
    <div class="card-pad"><div class="pipeline">
      ${steps.map(([ic, t, sub], i) => `<div class="pipe-step"><div class="pipe-node done"><div class="n">${icon(ic, 16)}</div><b>${i + 1}. ${t}</b><small>${sub}</small></div>${i < steps.length - 1 ? `<div class="pipe-arrow">${icon('arrow', 16)}</div>` : ''}</div>`).join('')}
    </div></div>
  </div>

  <div class="grid mt" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
    <div class="card">
      <div class="card-head"><h3>${icon('star')}今日潜力爆品</h3><div class="spacer"></div><a class="btn sm ghost" href="#/products">全部商品 ${icon('arrow', 14)}</a></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>商品</th><th>品类</th><th>价格</th><th>7日销量</th><th>增长</th><th>14日趋势</th><th>评分</th></tr></thead>
        <tbody>${d.topProducts.map((p) => `<tr style="cursor:pointer" onclick="location.hash='#/products/${p.id}'">
          <td><div class="row" style="flex-wrap:nowrap"><span style="font-size:22px">${p.emoji}</span><div><b>${esc(p.nameCn)}</b><div class="p-sub">${esc(p.name)}</div></div></div></td>
          <td><span class="chip">${esc(p.category)}</span></td><td>$${p.price}</td><td>${fmtNum(p.sales7d)}</td>
          <td style="white-space:nowrap" class="${p.salesGrowth >= 0 ? 'up' : 'down'}">${p.salesGrowth >= 0 ? '▲' : '▼'} ${Math.abs(p.salesGrowth)}%</td>
          <td>${sparkline(p.trend, { w: 90, h: 28 })}</td>
          <td><div class="row" style="flex-wrap:nowrap"><span class="grade grade-${p.grade}">${p.grade}</span><b>${p.score}</b></div></td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${icon('chart')}品类 7 日 GMV</h3></div>
      <div class="card-pad bars">
        ${d.categoryStats.sort((a, b) => b.gmv - a.gmv).map((c) => `<div class="bar-row"><span>${esc(c.category)}</span><div class="track"><i style="width:${(c.gmv / maxGmv) * 100}%"></i></div><b style="text-align:right">$${fmtNum(c.gmv)}</b></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="grid g2 mt">
    <div class="card">
      <div class="card-head"><h3>${icon('layers')}最近工作流</h3></div>
      <div class="card-pad col">
        ${d.recentRuns.length ? d.recentRuns.map((r) => `<a class="list-item" href="#/workflows/${r.id}" style="color:inherit"><div class="stat-ico" style="width:36px;height:36px">${icon('flow', 18)}</div><div style="flex:1;min-width:0"><b>${esc(r.productName || r.name)}</b><div class="muted small">${timeAgo(r.createdAt)} · ${r.steps.filter((x) => x === 'done').length}/${r.steps.length} 步</div></div>${statusBadge(r.status)}</a>`).join('') : empty('还没有运行过工作流', 'flow', '<a class="btn sm" href="#/workflows">立即启动</a>')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${icon('sparkles')}动态</h3></div>
      <div class="card-pad col">
        ${d.activity.length ? d.activity.map((a) => `<div class="row" style="flex-wrap:nowrap"><span class="chip">${{ workflow: '工作流', script: '脚本', image: '图片', video: '视频' }[a.type] || a.type}</span><span style="flex:1">${esc(a.text)}</span><span class="muted small">${timeAgo(a.createdAt)}</span></div>`).join('') : empty('暂无动态')}
      </div>
    </div>
  </div>`;
}
