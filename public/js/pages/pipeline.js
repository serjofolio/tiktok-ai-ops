// 自动上品流水线：选品数据 → AI 研判 → 1688 找货 → 选定供应商 → 上架包 → 人工确认 → 推送 ERP
import { api, icon, esc, toast, withLoading, $, $$, timeAgo } from '../lib.js';

const ST = { pending: ['等待', 'na'], running: ['进行中', 'run'], done: ['完成', 'ok'], waiting: ['待处理', 'wait'], error: ['出错', 'err'] };
const AGENT = { fetch: '选品数据 Agent', analyze: '研判 Agent', source: '找货 Agent', choose: '采购 Agent', pack: '上架 Agent', review: '你', push: '上品 Agent' };
const RUN_ST = { running: '运行中', waiting: '等待处理', done: '已完成', error: '已中止' };

export async function render(view) {
  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">自动上品 · 多 Agent 流水线</div>
    <h2>从数据到上架，<br><em>一条流水线</em>跑完</h2>
    <p>选品数据、AI 研判、1688 找货、挑供应商、写上架资料、推送 ERP，由 6 个 Agent 接力完成。你只需要在「确认上架包」这一步把关；也可以设置为全自动。</p>
  </section>
  <div class="ready" id="ready"></div>
  <div class="card card-pad mb" id="cfg"></div>
  <div id="run"></div>`;

  let poll = null;
  const rd = await api('/pipeline/readiness');
  const erps = (await api('/connectors')).items.filter((c) => c.kind === 'erp' && c.enabled !== false && c.status !== 'pending');
  const ok = (v) => (v ? 'ok' : 'no');
  $('#ready', view).innerHTML = [
    [ok(rd.llm), '大模型', rd.llm || '未接入：AI 研判、找货同款判断、上架包都需要', '#/providers'],
    [ok(rd.products.count), '选品数据', rd.fastmoss.length ? `FastMoss 接口：${rd.fastmoss.join('、')}` : rd.products.lastImport ? `最近一次导入 ${rd.products.batchSize} 个商品（${timeAgo(rd.products.lastImport)}）` : '还没有数据：在「智能选品」导入 FastMoss 导出文件', '#/products'],
    [rd.sourcing.length ? 'ok' : rd.plugin ? 'half' : 'no', '1688 找货', rd.sourcing.length ? rd.sourcing.join('、') : rd.plugin ? '用浏览器插件采集（已生成令牌）；接上 1688 接口可全自动' : '没有接口：添加 1688 官方 / 第三方数据接口，或安装浏览器插件', '#/providers'],
    [ok(rd.erp.length), 'ERP 上品', rd.erp.length ? rd.erp.join('、') : '没有 ERP：添加妙手 ERP 或通用 Webhook（n8n / 影刀）', '#/providers'],
  ].map(([s, t, d, href]) => `<a class="rd ${s}" href="${href}"><i>${s === 'ok' ? '✓' : s === 'half' ? '!' : '✕'}</i><div><b>${t}</b><span>${esc(d)}</span></div></a>`).join('');

  $('#cfg', view).innerHTML = `<form class="cfg-row" id="cf">
      <label class="field">范围<select class="input" name="scope"><option value="latest">最近一次导入</option><option value="all">整个选品库</option></select></label>
      <label class="field">取前几个「可以上」<input class="input" name="topN" type="number" min="1" max="20" value="5"></label>
      <label class="field">同款度门槛<input class="input" name="minMatch" type="number" min="0" max="95" value="70"><span class="small muted">低于它的货源不自动选</span></label>
      <label class="field">推送到<select class="input" name="connectorId">${erps.length ? erps.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') : '<option value="">（还没有 ERP，跑到推送前会停下）</option>'}</select></label>
      <label class="toggle" style="align-self:center"><input type="checkbox" name="autoApprove"><span class="track"><i></i></span><span>上架包自动确认（全自动）</span></label>
      <button class="btn lg primary-glow" id="go" data-loading="启动中…">${icon('play', 16)}启动流水线</button></form>`;
  $('#go', view).onclick = (e) => {
    e.preventDefault();
    withLoading(e.currentTarget, async () => {
      const f = new FormData($('#cf', view));
      await api('/pipeline/runs', { method: 'POST', body: { scope: f.get('scope'), topN: f.get('topN'), minMatch: f.get('minMatch'), connectorId: f.get('connectorId'), autoApprove: f.get('autoApprove') === 'on' } });
      toast('流水线已启动', 'success');
      loadRun();
    });
  };

  async function loadRun() {
    clearTimeout(poll);
    const r = await api('/pipeline/latest').catch(() => ({}));
    drawRun(r?.id ? r : null);
    if (r?.running && view.isConnected) poll = setTimeout(loadRun, 2000);
  }

  function drawRun(r) {
    const box = $('#run', view);
    if (!r) return (box.innerHTML = '<div class="card card-pad muted small">还没有运行过。检查上面四项准备好后，点「启动流水线」。</div>');
    box.innerHTML = `<div class="card pl">
      <div class="rp-head" style="padding:20px 22px 0"><div><div class="kicker-s">最近一次运行</div><h3>${RUN_ST[r.status] || r.status}</h3><div class="muted small">开始于 ${esc((r.createdAt || '').slice(0, 16).replace('T', ' '))} · ${r.config.scope === 'all' ? '整个选品库' : '最近一次导入'} · 前 ${r.config.topN} 个可以上 · 同款度 ≥ ${r.config.minMatch} · ${r.config.autoApprove ? '全自动' : '人工确认上架包'}</div>${r.error ? `<p class="small down">${esc(r.error)}</p>` : ''}</div>
        <div class="spacer"></div>${!r.running && ['waiting', 'error'].includes(r.status) ? `<button class="btn" id="resume" data-loading="继续中…">${icon('play', 14)}继续</button>` : ''}</div>
      <div class="pl-stages">${r.stages.map((s, i) => { const [t, cls] = ST[s.status] || ST.pending; return `<div class="pl-st ${cls}"><div class="pl-dot">${s.status === 'done' ? '✓' : i + 1}</div><b>${esc(s.label)}</b><small>${esc(AGENT[s.key])}</small><span class="pl-badge">${t}</span>${s.detail ? `<p>${esc(s.detail)}</p>` : ''}</div>`; }).join('')}</div>
      ${r.items.length ? `<div class="table-wrap" style="margin:0 22px 18px"><table><thead><tr><th>商品</th><th>当前环节</th><th>状态</th><th>说明</th><th></th></tr></thead><tbody>
        ${r.items.map((it) => { const [t, cls] = ST[it.status] || ST.pending; return `<tr><td><b class="pname">${esc(it.name)}</b></td><td>${esc(r.stages.find((s) => s.key === it.stage)?.label || '')}</td><td><span class="pl-badge ${cls}">${t}</span></td><td class="small">${esc(it.note || '')}</td>
          <td><div class="row-actions"><a class="btn sm ghost" href="#/products/${it.productId}/source">找货</a><a class="btn sm ghost" href="#/products/${it.productId}/listing">上架包${it.listingStatus === 'draft' ? ' · 待确认' : ''}</a></div></td></tr>`; }).join('')}</tbody></table></div>` : ''}
      ${r.logs?.length ? `<details class="pl-log" ${r.running ? 'open' : ''}><summary>运行日志（${r.logs.length}）</summary>${r.logs.map((l) => `<div><span>${esc(l.at.slice(11, 19))}</span>${esc(l.text)}</div>`).join('')}</details>` : ''}
    </div>`;
    const b = $('#resume', box);
    if (b) b.onclick = (e) => withLoading(e.currentTarget, async () => {
      await api(`/pipeline/runs/${r.id}/resume`, { method: 'POST' });
      loadRun();
    });
  }

  await loadRun();
  return () => clearTimeout(poll);
}
