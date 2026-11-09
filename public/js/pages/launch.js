// 测款作战室：看板（备战 / 测款 / 该加码 / 该止损）+ 单品作战页（备战清单、单件账本、止损线、每日复盘、素材榜）
import { api, icon, esc, fmtNum, toast, withLoading, $, $$, empty, confirmBox } from '../lib.js';
import { nameHTML, zhName } from '../picker.js';

const VCLS = { 可以上: 'v-go', 谨慎测试: 'v-watch', 不建议上: 'v-drop', 数据不足: 'v-na' };
const COLS = [['prep', '备战中', '账本和素材准备好就能开测'], ['testing', '测款中', '每天录数据，等结论'], ['scale', '该加码', 'CPA 明显低于保本'], ['stop', '该止损', '继续投大概率亏钱']];
const STEP = { pending: '等待', running: '进行中', done: '完成', skipped: '跳过', error: '失败' };
const localDay = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const yuan = (v) => `${v < 0 ? '-' : ''}¥${fmtNum(Math.abs(Math.round(v || 0)))}`;
const sign = (c, v) => (v == null ? '—' : `${v < 0 ? '-' : ''}${c}${Math.abs(v).toLocaleString()}`);
const sampleTag = (x) => (x.sample ? '<span class="tag-sample">示例</span>' : '');
const thumb = (x) => (x.image ? `<img class="pthumb" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pthumb ph">${esc((x.type || '?').slice(0, 1))}</span>`);

export async function render(view, [id, section]) {
  return id ? detail(view, id, section) : board(view);
}

// ---------- 看板 ----------
async function board(view) {
  const d = await api('/launch/board');
  const s = d.summary;
  const card = (x) => {
    const t = x.totals, c = x.economics?.currency || '';
    return `<a class="lb-card" href="#/launch/${x.id}"><div class="pcell">${thumb(x)}<div style="min-width:0">${nameHTML(x)}</div></div>
      <p class="small">${sampleTag(x)}${esc(x.decision.title)}</p>
      ${x.lastDate && t ? `<div class="lb-nums"><span>订单<b>${t.orders}</b></span><span>CPA<b>${t.cpa == null ? '—' : c + t.cpa}</b></span><span>利润<b class="${t.profit >= 0 ? 'up' : 'down'}">${sign(c, t.profit)}</b></span></div>` : `<div class="small muted">${x.economics?.ownOrder > 0 ? `每单最多花 ${c}${x.economics.ownOrder}` : '还不能算账'}</div>`}</a>`;
  };
  view.innerHTML = `
  <section class="page-hero"><div class="kicker">测款作战室 · 备战 → 测款 → 决策</div>
    <h2>每一分广告费，<br><em>都知道该不该花</em></h2>
    <p>选中的品在这里备战：账本、货源、上架包和脚本一次备齐。开测后每天录数据，程序按你的真实成本算保本线，告诉你加码、继续、优化还是止损，并指出钱漏在哪一步。</p></section>
  <div class="stat-strip mb">${[['作战中', s.active, '个商品'], ['累计订单', s.orders, '单'], ['累计投放', s.spendCny, '元'], ['累计利润', s.profitCny, '元，已扣费用和广告']].map(([t, v, u]) => `<div><div class="stat-label">${t}</div><div class="stat-value ${t === '累计利润' ? (v >= 0 ? 'up' : 'down') : ''}">${v < 0 ? '-' : ''}<span data-count="${Math.abs(v)}">0</span></div><div class="stat-detail">${u}</div></div>`).join('')}</div>
  ${s.active ? `<div class="lb-board">${COLS.map(([k, t, sub]) => `<section class="lb-col lb-${k}"><header><b>${t}</b><span>${d.columns[k].length}</span><small>${sub}</small></header>${d.columns[k].map(card).join('') || '<p class="small muted lb-none">暂无</p>'}</section>`).join('')}</div>`
    : `<div class="card">${empty('还没有作战中的商品。从下面的增长榜挑一个，或者到智能选品里点「进作战室」', 'zap', '<a class="btn sm" href="#/products">去选品</a>')}</div>`}
  <section class="mt" data-reveal><div class="section-title"><h3>下一个可以打的品</h3><span class="muted small">增长榜近 10 天靠前、结论「可以上」、还没开始备战</span></div>
    ${d.next.length ? `<div class="grid g2">${d.next.map((r) => `<a class="lb-next" href="#/launch/${r.id}"><div class="pcell">${thumb(r)}<div style="min-width:0"><b class="pname">${esc(r.name)}</b><div class="p-sub">近 10 天约 ${fmtNum(r.units.cur)} 件${r.units.rate != null ? ` · 增长 ${r.units.rate}%` : ''} · ${r.grade === 'estimate' ? '估算' : '实测'}</div></div></div>${icon('arrow', 16)}</a>`).join('')}</div>` : '<div class="card card-pad small muted">现在没有符合条件的商品。导入更多数据后这里会更新。</div>'}
  </section>`;
}

// ---------- 单品作战页 ----------
async function detail(view, id, section) {
  let d = await api(`/launch/${id}`);
  let poll = null;
  const draw = () => {
    const e = d.economics, c = e?.currency || '', t = d.totals, dec = d.decision, plan = d.plan;
    view.innerHTML = `
    <a class="back-link small" href="#/launch">${icon('arrow', 13)}返回作战室</a>
    <section class="dc dc-${dec.code}" data-reveal>
      <div class="dc-main"><div class="dc-top">${sampleTag(d)}<span class="verdict ${VCLS[d.verdict] || 'v-na'}">${esc(d.verdict)}</span><span class="muted small">${esc(d.market)} 站 · ${esc(d.type)}</span></div>
        <h2 class="dc-name">${esc(zhName(d) || d.name)}</h2>${zhName(d) ? `<div class="pname-en">${esc(d.name)}</div>` : ''}
        <div class="dc-call"><b>${esc(dec.label)}</b><div><h3>${esc(dec.title)}</h3><p>${esc(dec.why)}</p></div></div>
        ${(dec.diagnosis || []).length ? `<ul class="dc-diag">${dec.diagnosis.map((x) => `<li class="${x.ok ? 'ok' : ''}"><span>${esc(x.stage)}</span>${esc(x.text)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="dc-kpis">${[['累计利润', t?.profit == null ? '—' : sign(c, t.profit), t?.profit == null ? '' : t.profit >= 0 ? 'up' : 'down'], ['实际 CPA', t?.cpa == null ? '—' : c + t.cpa, ''], ['保本 CPA', t?.breakEvenCpa == null ? (e?.ownOrder == null ? '—' : c + e.ownOrder) : c + t.breakEvenCpa, ''], ['ROAS / 保本', `${t?.roas ?? '—'} / ${e?.breakEvenRoas ?? '—'}`, ''], ['订单', t?.orders ?? 0, ''], ['花费', t ? c + t.adSpend : '—', '']].map(([k, v, cls]) => `<div><small>${k}</small><b class="${cls}">${esc(v)}</b></div>`).join('')}
        <div class="dc-actions"><a class="btn sm ghost" href="/api/launch/${d.id}/export" download>${icon('download', 14)}导出作战书</a><a class="btn sm ghost" href="#/products/${d.id}">${icon('target', 14)}商品详情</a></div></div>
    </section>
    ${d.flags.length ? `<div class="col mt">${d.flags.map((f) => `<div class="note-card ${f.level === 'block' ? 'danger' : 'warn'}"><b>${esc(f.title)}</b>：${esc(f.detail)}</div>`).join('')}</div>` : ''}

    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h3>备战清单</h3><div class="spacer"></div><button class="btn sm primary-glow" id="prep" data-loading="启动中…" ${d.job?.status === 'running' ? 'disabled' : ''}>${icon('zap', 14)}一键备战</button></div>
        <div class="card-pad">
          ${d.job?.status === 'running' || (d.job && d.job.steps.some((s) => s.status === 'error')) ? `<div class="prep-steps">${d.job.steps.map((s) => `<div class="prep-step ${s.status}"><i>${s.status === 'running' ? '<span class="spinner"></span>' : s.status === 'done' ? '✓' : s.status === 'error' ? '✕' : s.status === 'skipped' ? '–' : '·'}</i><b>${esc(s.label)}</b><span class="small muted">${esc(s.note || STEP[s.status])}</span></div>`).join('')}</div>` : ''}
          <div class="cl">${d.checklist.map((x) => `<a class="cl-row ${x.done ? 'done' : ''}" href="${x.href}"><i>${x.done ? icon('check', 13) : ''}</i><div><b>${esc(x.label)}${x.optional ? '<small> 可选</small>' : ''}</b><span class="small muted">${esc(x.note)}</span>${x.warn ? `<span class="small down">${esc(x.warn)}</span>` : ''}</div>${icon('arrow', 14)}</a>`).join('')}</div>
          <p class="small muted" style="margin:10px 0 0">一键备战只补缺的，不覆盖你改过的内容，也不会自动推送上架。${d.hasLlm ? '' : '<a class="link-lime" href="#/providers">先接入大模型</a>才能用。'}${d.hasSourcingApi ? '' : ' 没有 1688 接口时，货源要用插件采集或手动添加。'}</p>
        </div></div>
      <div class="card"><div class="card-head"><h3>单件账本</h3></div><div class="card-pad">${e ? ledger(e) : '<p class="small muted">缺少售价</p>'}</div></div>
    </div>

    ${plan ? `<div class="card mt"><div class="card-head"><h3>测款计划和止损线</h3></div><div class="card-pad">
      <div class="plan-grid"><label class="field">测款预算（${esc(c)}）<input class="input" id="c-budget" type="number" min="1" value="${plan.budget}"></label><label class="field">止损倍数（× 保本 CPA）<input class="input" id="c-kill" type="number" min="0.5" step="0.5" value="${plan.killMultiple}"></label>
        <div class="plan-stat"><small>止损线</small><b class="down">${c}${plan.killSpend}</b></div><div class="plan-stat"><small>加码线</small><b class="up">CPA ≤ ${c}${plan.scaleCpa}</b></div><div class="plan-stat"><small>首批备货约</small><b>${plan.stock} 件</b></div></div>
      <ul class="plain small mt">${plan.rules.map((r) => `<li>${esc(r)}</li>`).join('')}<li>首批备货按预算在保本 CPA 下能出的单数 × 2 估算，实际要看起批量。</li></ul>
      <p class="small muted" style="margin:6px 0 0">止损倍数、七成加码线、${d.thresholds.minOrders} 单样本线是常用经验值，不是平台规则。你的品类跑出规律后可以改。</p></div></div>` : ''}

    <div class="card mt" id="data"><div class="card-head"><h3>每日复盘</h3><span class="muted small">金额用当地货币（${esc(c)}）</span></div><div class="card-pad">
      ${d.series.length >= 2 ? `<div class="profit-chart">${chart(d.series, c)}</div>` : ''}
      <form class="day-form" id="df"><label class="field">日期<input class="input" name="date" type="date" value="${localDay()}" max="${localDay()}" required></label>
        <label class="field">素材<select class="input" name="scriptId"><option value="">不区分素材</option>${d.scripts.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select></label>
        <label class="field">播放<input class="input" name="views" type="number" min="0"></label><label class="field">点击<input class="input" name="clicks" type="number" min="0"></label>
        <label class="field">订单<input class="input" name="orders" type="number" min="0" value="0"></label><label class="field" title="不填就全部按达人单扣佣金，算出来的利润偏保守">其中达人单<input class="input" name="creatorOrders" type="number" min="0" placeholder="不填按全部"></label>
        <label class="field">广告花费<input class="input" name="adSpend" type="number" min="0" step="0.01" value="0"></label><button class="btn" id="d-add" data-loading="保存中…">${icon('plus', 14)}录入</button></form>
      <p class="small muted" style="margin:8px 0 0">同一天、同一条素材再录一次会覆盖。数据从 TikTok Shop 后台或广告后台抄过来，目前不能自动同步。</p>
      ${d.days.length ? `<div class="table-wrap mt"><table class="wide-t"><thead><tr><th>日期</th><th>素材</th><th class="r">播放</th><th class="r">点击</th><th class="r">订单</th><th class="r">花费</th><th class="r">CPA</th><th></th></tr></thead><tbody>${d.days.slice(0, 40).map((x) => `<tr><td class="nowrap">${esc(x.date)}</td><td class="small">${esc(d.scripts.find((s) => s.id === x.scriptId)?.title || '—')}</td><td class="r">${x.views == null ? '—' : fmtNum(x.views)}</td><td class="r">${x.clicks ?? '—'}</td><td class="r">${x.orders}</td><td class="r money">${c}${x.adSpend}</td><td class="r money">${x.orders ? c + Math.round((x.adSpend / x.orders) * 100) / 100 : '—'}</td><td><button class="icon-btn" data-del="${x.id}" aria-label="删除这条">${icon('trash', 14)}</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    </div></div>

    ${d.creatives.some((x) => x.scriptId) ? `<div class="card mt"><div class="card-head"><h3>素材榜</h3><span class="muted small">至少 3 单才会评出赢家</span><div class="spacer"></div>${d.creatives.some((x) => x.winner) ? `<button class="btn sm primary-glow" id="more" data-loading="写第 1 条…" ${d.hasLlm ? '' : 'disabled title="先接入大模型"'}>${icon('sparkles', 14)}学赢家再写 3 条</button>` : ''}</div>
      <div class="table-wrap"><table class="wide-t"><thead><tr><th>素材</th><th class="r">花费</th><th class="r">点击率</th><th class="r">转化率</th><th class="r">订单</th><th class="r">CPA</th></tr></thead><tbody>${d.creatives.map((x) => `<tr class="${x.winner ? 'chosen' : ''}"><td>${x.winner ? '<span class="verdict v-go" style="font-size:11px">赢家</span> ' : ''}${x.scriptId ? `<a class="pname" href="#/scripts/${x.scriptId}">${esc(x.title)}</a>` : esc(x.title)}<div class="p-sub">${esc(x.hook)}</div></td><td class="r money">${c}${x.adSpend}</td><td class="r">${x.ctr == null ? '—' : x.ctr + '%'}</td><td class="r">${x.cvr == null ? '—' : x.cvr + '%'}</td><td class="r">${x.orders}</td><td class="r money ${x.cpa != null && x.breakEvenCpa != null ? (x.cpa <= x.breakEvenCpa ? 'up' : 'down') : ''}">${x.cpa == null ? '—' : c + x.cpa}</td></tr>`).join('')}</tbody></table></div><div class="small muted card-pad" id="more-out" style="padding-top:8px">赢家的结构可以复用，但素材会疲劳，要持续补新开头。</div></div>` : ''}`;
    bind();
  };

  const bind = () => {
    $('#prep', view).onclick = (ev) => withLoading(ev.currentTarget, async () => {
      const risk = d.flags.find((f) => f.level === 'block');
      if (risk && !(await confirmBox(`这个商品有硬伤（${risk.title}），备战会花模型费用，也很可能白做。还要继续吗？`))) return;
      d = await api(`/launch/${id}/prepare`, { method: 'POST', body: { force: !!risk } });
      draw();
      watch();
    });
    const save = (body) => api(`/launch/${id}`, { method: 'PATCH', body }).then((x) => { d = x; draw(); }).catch((e) => toast(e.message, 'error'));
    const b = $('#c-budget', view), k = $('#c-kill', view);
    if (b) b.onchange = () => save({ budget: b.value });
    if (k) k.onchange = () => save({ killMultiple: k.value });
    $('#d-add', view).onclick = (ev) => {
      ev.preventDefault();
      withLoading(ev.currentTarget, async () => {
        d = await api(`/launch/${id}/days`, { method: 'POST', body: Object.fromEntries(new FormData($('#df', view))) });
        draw();
        toast(`已录入，当前判断：${d.decision.label}`, 'success');
        $('#data', view).scrollIntoView({ block: 'start' });
      });
    };
    $$('[data-del]', view).forEach((x) => (x.onclick = async () => {
      if (!(await confirmBox('删除这条记录？'))) return;
      d = await api(`/launch/${id}/days/${x.dataset.del}`, { method: 'DELETE' });
      draw();
    }));
    const more = $('#more', view);
    if (more) more.onclick = (ev) => withLoading(ev.currentTarget, () => writeMore(ev.currentTarget));
  };

  async function writeMore(btn) {
    const w = d.creatives.find((x) => x.winner);
    const benchmark = `这条素材是这个商品实测最好的：开头「${w.hook}」，${w.orders} 单，CPA ${d.economics.currency}${w.cpa}，点击率 ${w.ctr ?? '未知'}%，转化率 ${w.cvr ?? '未知'}%。保留它打动人的角度，换新的开头和场景，避免素材疲劳。`;
    const avoid = d.scripts.map((s) => s.hook);
    const out = $('#more-out', view);
    out.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      btn.innerHTML = `<span class="spinner"></span>写第 ${i + 1}/3 条…`;
      const s = await api('/scripts/generate', { method: 'POST', body: { productId: id, benchmark, avoid, variant: i, duration: 26 } });
      avoid.push(s.hook);
      out.insertAdjacentHTML('beforeend', `<a class="list-item" href="#/scripts/${s.id}"><b class="small">${esc(s.title)}</b><span class="muted small">${esc(s.hook)}</span></a>`);
    }
    toast('写好了，拍完记得在录入时选对素材', 'success');
  }

  const watch = () => {
    clearTimeout(poll);
    if (d.job?.status !== 'running') return;
    poll = setTimeout(async () => {
      if (!view.isConnected) return;
      d = await api(`/launch/${id}`);
      draw();
      if (d.job?.status === 'running') watch();
      else toast('备战结束，看看清单里还缺什么', 'success');
    }, 2500);
  };

  draw();
  watch();
  if (section === 'data') requestAnimationFrame(() => $('#data', view)?.scrollIntoView({ block: 'start' }));
  return () => clearTimeout(poll);
}

// 单件账本：售价被拆成各项费用，剩下的才是能花在流量上的钱
function ledger(e) {
  const c = e.currency;
  const left = e.ownOrder ?? 0;
  const parts = e.rows.map((r) => ({ ...r, w: (r.value / e.price) * 100 }));
  const keep = Math.max(0, (left / e.price) * 100);
  return `<div class="ledger-head"><div><small>售价</small><b>${c}${e.price}</b></div><div><small>每单最多能花在流量上</small><b class="${left > 0 ? 'up' : 'down'}">${e.ownOrder == null ? '缺成本' : c + e.ownOrder}</b></div><div><small>保本 ROAS</small><b>${e.breakEvenRoas ?? '—'}</b></div></div>
    <div class="ledger-bar" aria-hidden="true">${parts.map((p) => `<i class="l-${p.key}" style="width:${p.w}%"></i>`).join('')}${keep ? `<i class="l-keep" style="width:${keep}%"></i>` : ''}</div>
    <div class="ledger-rows">${parts.map((p) => `<div><span class="dot l-${p.key}"></span><span>${esc(p.label)}</span><b>-${c}${p.value}</b></div>`).join('')}
      <div class="sum"><span class="dot l-keep"></span><span>自投单：不付达人佣金</span><b class="${left > 0 ? 'up' : 'down'}">${e.ownOrder == null ? '—' : c + e.ownOrder}</b></div>
      <div><span class="dot"></span><span>达人单：再扣佣金 ${e.commissionRate}%（${c}${e.commission}）</span><b>${e.creatorOrder == null ? '—' : c + e.creatorOrder}</b></div></div>
    <p class="small muted" style="margin:10px 0 0">售价优先用上架包定价，其次是同类成交均价。退货和费率可在「智能选品 → 利润假设」里改。</p>`;
}

// 累计利润曲线：穿过 0 线的那天就是回本的那天
function chart(series, c) {
  const W = 760, H = 180, P = 8;
  const vals = series.map((s) => s.cumulative);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const x = (i) => P + (i / (series.length - 1)) * (W - 2 * P);
  const y = (v) => P + ((max - v) / (max - min || 1)) * (H - 2 * P);
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.cumulative).toFixed(1)}`).join('');
  const end = vals.at(-1);
  return `<div class="pc-head"><span class="small muted">累计利润（已扣广告费）</span><b class="${end >= 0 ? 'up' : 'down'}">${sign(c, end)}</b></div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="累计利润曲线"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="pc-zero"/><path class="pc-area ${end >= 0 ? 'pos' : 'neg'}" d="${line}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/><path class="pc-line ${end >= 0 ? 'pos' : 'neg'}" d="${line}" vector-effect="non-scaling-stroke"/></svg>
  <div class="pc-axis small muted"><span>${esc(series[0].date)}</span><span>${esc(series.at(-1).date)}</span></div>`;
}
