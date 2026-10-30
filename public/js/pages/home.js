// 官网式首页：首屏 + 集成墙 + 功能 Bento + 流程 + 数据 + 行动区 + FAQ
import { api, icon, esc, fmtNum, sparkline } from '../lib.js';
import { session } from '../session.js';
import { scramble, sparkles } from '../fx/ambient.js';

const WORDS = ['能卖的品', '算清的利润', '可拍的脚本', '清晰的测款方案'];
const LOGOS = ['TikTok Shop', 'FastMoss', '1688', '智谱 GLM', 'DeepSeek', 'Kimi', '通义千问', 'Claude', 'Cloudflare'];
const FAQ = [
  ['需要 FastMoss 会员吗？', '目前通过导入 FastMoss 的导出文件或粘贴表格获取数据，需要你的 FastMoss 账号能导出。FastMoss 开放接口审批通过后，在「接入配置」填写即可改为自动拉取。'],
  ['支持哪些大模型？', '所有 OpenAI 兼容接口和 Anthropic 协议：智谱 GLM（含编码套餐）、DeepSeek、Kimi、通义千问、豆包、OpenAI、Claude 等。可以添加多个，一键切换。'],
  ['数据和 API Key 存在哪里？', '全部保存在你自己的服务器上，不经过第三方。页面只显示脱敏后的 Key。'],
  ['飞书上的 TikTok 官方文档怎么导入？', '飞书文档需要登录才能读取。在飞书里打开文档，右上角「…」→「下载为」Word 或 PDF，再上传到知识库的「TikTok 官方文档」。Agent 回答时会优先依据这些文档并标注出处。'],
  ['选品结论是怎么来的？', '先用硬指标自动检查：销量是否在增长、扣除平台佣金/达人佣金/退货/广告/采购/物流后的净利率、带货视频数量、价格带、达人分布；再加上你的人工判断（卖点能否拍出来、自己想不想买），最后由 AI 结合数据和知识库写出选品理由与测款方案。'],
];

export async function render(view) {
  // 未登录时首页仍可访问，产品卡片显示示例
  const [d, prov] = session.user ? await Promise.all([api('/dashboard'), api('/providers').catch(() => ({ items: [] }))]) : [{ topProducts: [] }, { items: [] }];
  const active = prov.items?.find((p) => p.id === prov.activeId);
  const top = d.topProducts.find((p) => p.evaluation.verdict === '可以上') || d.topProducts[0];
  const demo = !top;
  const dimCheck = (dd) => ({ title: `${dd.label} ${dd.score ?? '—'}`, status: dd.score == null ? 'unknown' : dd.score >= 65 ? 'pass' : dd.score >= 45 ? 'warn' : 'fail' });
  const m = top
    ? { name: top.name, cur: top.evaluation.metrics.currency, price: top.evaluation.metrics.asp, sales: top.sales7d, growth: top.evaluation.metrics.momentum != null ? Math.round((top.evaluation.metrics.momentum - 1) * 100) : null, margin: top.evaluation.profit?.margin ?? null, ceiling: top.evaluation.profit?.ceilingCny, verdict: top.evaluation.verdict, checks: top.evaluation.dims.slice(0, 4).map(dimCheck), trend: [] }
    : { name: 'Mini Desk Fan', cur: '$', price: 15.99, sales: 12000, growth: 86, margin: 27.6, verdict: '可以上', checks: [{ title: '需求规模 82', status: 'pass' }, { title: '增长趋势 91', status: 'pass' }, { title: '达人带货验证 78', status: 'pass' }, { title: '竞争格局 64', status: 'warn' }] };
  const trend = Array.from({ length: 16 }, (_, i) => 40 + i * 4 + Math.sin(i * 1.3) * 10 + (i > 10 ? (i - 10) * 9 : 0));

  view.innerHTML = `<div class="lp">
  <section class="lp-hero">
    <div class="hero-fx" aria-hidden="true">
      <div class="spot-cone"></div>
      <div class="beams">${Array.from({ length: 9 }, (_, i) => `<i style="--x:${6 + i * 11}%;--d:${(i * 0.73) % 4}s;--t:${3.2 + (i % 4) * 0.9}s"></i>`).join('')}</div>
      <div class="horizon"><div class="floor"></div><div class="sun"></div></div>
    </div>
    <div>
      <span class="pill"><b>${active ? '已接入' : '开始使用'}</b>${active ? `${esc(active.name)} · ${esc(active.model)}` : 'TikTok Shop 跨境卖家的选品与内容工作台'}</span>
      <h1><span class="l1">把 FastMoss 数据</span><br>变成<span class="rotator" id="rot">${WORDS.map((w, i) => `<span class="grad-text ${i === 0 ? 'on' : ''}">${w}</span>`).join('')}</span></h1>
      <p class="lead">导入真实的商品数据，按硬指标逐项检查、算清每件利润，AI 说明为什么选、怎么测款；选好的品一键生成可直接开拍的带货脚本。</p>
      <div class="ctas">
        <a class="btn lg btn-solid" href="#/products">${icon('target')}开始选品</a>
        <a class="btn lg btn-glow" href="#/chat">${icon('bot')}问 Agent</a>
        <a class="btn lg ghost" href="#/dashboard">进入工作台 ${icon('arrow', 16)}</a>
      </div>
      <div class="note"><span>真实数据，无演示假数据</span><span>多模型一键切换</span><span>密钥只存在你的服务器</span></div>
    </div>
    <div class="mock-wrap" id="mockwrap">
      <div class="mock beam-border" id="mock"><div class="mock-inner">
        <div class="mock-bar"><i></i><i></i><i></i><span>tkagent / 智能选品</span></div>
        ${demo ? '<span class="label-demo">示例</span>' : ''}
        <div class="mock-head"><div><div class="muted small">今日推荐</div><b>${esc(m.name)}</b></div><span class="verdict ${m.verdict === '可以上' ? 'v-go' : m.verdict === '不建议上' ? 'v-drop' : 'v-watch'}">${esc(m.verdict)}</span></div>
        <div class="mock-kpis"><div><small>成交均价</small><b>${m.price != null ? esc(m.cur) + m.price : '—'}</b></div><div><small>7 天销量</small><b>${m.sales != null ? fmtNum(m.sales) : '—'}</b></div><div><small>趋势</small><b class="${(m.growth ?? 0) >= 0 ? 'up' : 'down'}">${m.growth != null ? (m.growth > 0 ? '+' : '') + m.growth + '%' : '—'}</b></div></div>
        <div class="mock-checks">${m.checks.map((c, i) => `<div style="animation-delay:${0.6 + i * 0.18}s"><i>${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : c.status === 'warn' ? '!' : '?'}</i>${esc(c.title)}</div>`).join('')}</div>
        <div class="mock-spark">${sparkline(trend, { w: 460, h: 70, color: '#ffb35c' })}</div>
      </div></div>
      <div class="float-chip c1"><small>${m.margin != null ? '单件净利率' : '采购 + 物流上限'}</small><b class="up">${m.margin != null ? m.margin + '%' : m.ceiling != null ? '¥' + m.ceiling : '—'}</b></div>
      <div class="float-chip c2"><small>测款方案</small><b>15 位达人 · 7 天</b></div>
      <div class="float-chip c3"><small>开场钩子</small>“Stop sweating at your desk!”</div>
    </div>
  </section>

  <section class="lp-logos"><p>接入的数据与模型</p><div class="logo-track-wrap"><div class="logo-track">${LOGOS.concat(LOGOS).map((l) => `<span>${l}</span>`).join('')}</div></div></section>

  <section class="lp-sec" id="features" data-reveal>
    <div class="sec-head"><div class="eyebrow">FEATURES</div><h2>从一张表格，<br>到一条能开拍的视频</h2><p>每一步都基于真实数据，每个结论都能追溯到原因。</p></div>
    <div class="bento">
      <div class="b1"><div class="tag">智能选品</div><h3>FastMoss 数据导入，AI 逐个研判能不能上</h3><p>导出文件原样拖进来，自动识别全部字段；按需求、趋势、达人、竞争、利润、风险六个维度打分，AI 写出类目报告，并说清每个商品可以上 / 谨慎测试 / 不建议上的理由。</p>
        <div class="viz"><div class="viz-bars">${[0.35, 0.5, 0.42, 0.66, 0.58, 0.8, 0.72, 0.95, 0.88, 1].map((h, i) => `<i style="--h:${h};animation-delay:${-i * 0.3}s"></i>`).join('')}</div></div></div>
      <div class="b2"><div class="tag">利润测算</div><h3>每件到底赚多少</h3><p>扣掉平台佣金、达人佣金、退货、广告、采购和物流。</p>
        <div class="viz viz-money"><div><span>售价</span><span>$15.99</span></div><div><span>− 佣金与预留</span><span>$6.08</span></div><div><span>− 采购 + 物流</span><span>$5.50</span></div><div class="tot"><span>净利</span><span>$4.41 · 27.6%</span></div></div></div>
      <div class="b3"><div class="tag">AI 选品分析</div><h3>为什么选，怎么测</h3><p>人群、卖点拍法、竞品切入点、风险、备货与止损线。</p>
        <div class="viz viz-ring"><svg viewBox="0 0 100 100"><defs><linearGradient id="rg"><stop offset="0" stop-color="#f3e9d2"/><stop offset="1" stop-color="#ff6a4d"/></linearGradient></defs><circle class="track" cx="50" cy="50" r="40"/><circle class="val" cx="50" cy="50" r="40"/></svg><div><b style="font-size:26px">7/7</b><div class="muted small">硬指标通过</div></div></div></div>
      <div class="b4"><div class="tag">视频脚本</div><h3>钩子 → 痛点 → 演示 → 证明 → CTA</h3><p>附 3 个备选开头，测款时 A/B 对比。</p>
        <div class="viz viz-type" id="typer"></div></div>
      <div class="b5"><div class="tag">Agent + 知识库</div><h3>依据官方文档回答</h3><p>上传 TikTok 官方文档，回答标注出处。</p>
        <div class="viz viz-chat"><div class="q">哪些类目需要资质？</div><div class="a">根据《TikTok Shop 平台规则》[1]，美妆、玩具、电子产品需要…</div></div></div>
    </div>
  </section>

  <section class="lp-sec" data-reveal>
    <div class="sec-head"><div class="eyebrow">HOW IT WORKS</div><h2>四步，从数据到开拍</h2></div>
    <div class="flow" id="flow">
      ${[['导入数据', '在 FastMoss 筛选导出，拖进来或粘贴'], ['检查与测算', '硬指标逐项判断，填入 1688 成本算净利'], ['AI 分析', '选品理由、卖点拍法、测款方案'], ['生成脚本', '选好的品一键出分镜，直接开拍']].map(([t, p], i) => `<div><div class="dot">0${i + 1}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}
    </div>
  </section>

  <section class="lp-sec" data-reveal>
    <div class="lp-stats">
      ${(d.stats
        ? [[d.stats.products, '选品库商品'], [d.stats.recommended, '可以上'], [d.stats.scripts, '已生成脚本'], [d.stats.docs, '知识库文档']]
        : [[6, '步选品方法'], [5, '项硬指标逐条检查'], [11, '家模型服务一键接入'], [100, '% 账号间数据隔离']]
      ).map(([v, l]) => `<div><b data-count="${v}">0</b><span>${l}</span></div>`).join('')}
    </div>
  </section>

  <section class="lp-sec" data-reveal>
    <div class="cta-band"><h2>今天就选出<br><span class="grad-text">第一个能卖的品</span></h2><p>从 FastMoss 导出一份候选清单，十分钟内拿到每个商品的利润、结论和测款方案。</p>
      <div class="ctas"><a class="btn lg btn-solid" href="#/products">${icon('upload')}导入 FastMoss 数据</a><a class="btn lg btn-glow" href="#/providers">${icon('link')}接入大模型</a></div></div>
  </section>

  <section class="lp-sec" style="padding-bottom:110px !important" data-reveal>
    <div class="sec-head"><div class="eyebrow">FAQ</div><h2>常见问题</h2></div>
    <div class="faq">${FAQ.map(([q, a], i) => `<details ${i === 0 ? 'open' : ''}><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  </section>
  </div>`;

  const timers = [];
  // 首屏关键词轮播
  const rot = view.querySelectorAll('#rot span');
  let wi = 0;
  timers.push(setInterval(() => {
    const cur = rot[wi];
    wi = (wi + 1) % rot.length;
    cur.classList.remove('on');
    cur.classList.add('out');
    rot[wi].classList.remove('out');
    rot[wi].classList.add('on');
    scramble(rot[wi], WORDS[wi]);
    setTimeout(() => cur.classList.remove('out'), 800);
  }, 2600));

  // 产品界面跟随鼠标倾斜
  // 产品界面自己会摇摆漂浮（CSS 动画）；鼠标只在外层叠加少量偏移
  const wrap = view.querySelector('#mockwrap');
  const onMove = (e) => {
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    wrap.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 6}deg)`;
  };
  addEventListener('pointermove', onMove, { passive: true });

  // 脚本打字机
  const lines = ['Stop sweating at your desk!', 'This tiny fan is whisper quiet.', 'Tap the orange cart before it sells out!'];
  const typer = view.querySelector('#typer');
  let li = 0, ci = 0;
  timers.push(setInterval(() => {
    const full = lines[li];
    ci++;
    typer.innerHTML = `${esc(full.slice(0, ci))}<span class="caret"></span>`;
    if (ci > full.length + 18) (ci = 0), (li = (li + 1) % lines.length);
  }, 70));

  // 流程线随滚动点亮
  const flow = view.querySelector('#flow');
  const onScroll = () => {
    const r = flow.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
    flow.style.setProperty('--p', p.toFixed(3));
    [...flow.children].forEach((c, i) => c.classList.toggle('lit', p >= i / 4 + 0.05));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const stopSparkles = sparkles(view.querySelector('.lp-hero h1'));

  return () => {
    stopSparkles();
    timers.forEach(clearInterval);
    removeEventListener('pointermove', onMove);
    removeEventListener('scroll', onScroll);
  };
}
