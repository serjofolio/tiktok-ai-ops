// 爆款方法论：研究总结，每条标注证据等级和来源
import { api, icon, esc, $, $$ } from '../lib.js';

export async function render(view) {
  const pb = await api('/playbook');
  const ev = (k, src) => {
    const e = pb.evidence[k];
    if (!e) return '';
    const s = src && pb.sources[src];
    const badge = `<span class="ev ev-${k}" title="${esc(e.hint)}${s ? `：${esc(s.name)}` : ''}">${esc(e.label)}</span>`;
    return s?.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="ev-link">${badge}</a>` : badge;
  };
  const SECTIONS = [['p-sum', '一页结论'], ['p-funnel', '四道关'], ['p-why', '为什么会爆'], ['p-hooks', '钩子库'], ['p-styles', '风格库'], ['p-pain', '抓痛点'], ['p-ret', '留人和时长'], ['p-jewelry', '首饰专章'], ['p-cases', '案例'], ['p-rules', '合规'], ['p-test', '怎么测'], ['p-sample', '样本和来源']];

  view.innerHTML = `<div class="pb">
    <div class="card card-pad pb-head"><div class="kicker-s">${esc(pb.meta.version)} 研究</div><h3>${esc(pb.meta.title)}</h3><p>${esc(pb.meta.method)}</p>
      <details class="more"><summary>这份总结的局限（先看）</summary><ul class="plain">${pb.meta.limits.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
      <div class="legend-ev">${Object.entries(pb.evidence).map(([k, e]) => `<span>${ev(k)} ${esc(e.hint)}</span>`).join('')}</div></div>
    <nav class="pb-nav">${SECTIONS.map(([id, t]) => `<a href="#" data-to="${id}">${t}</a>`).join('')}</nav>

    <section id="p-sum"><h3 class="pb-h">一页结论</h3><div class="pb-sum">${pb.summary.map((s, i) => `<div class="pb-point"><span class="n">${i + 1}</span><div><b>${esc(s.point)}</b> ${ev(s.ev, s.src)}<p>${esc(s.detail)}</p></div></div>`).join('')}</div></section>

    <section id="p-funnel"><h3 class="pb-h">爆款要连过四道关</h3><div class="pb-funnel">${pb.funnel.map((f, i) => `<div class="card card-pad"><div class="kicker-s">第 ${i + 1} 关 ${ev(f.ev, f.src)}</div><h4>${esc(f.stage)}</h4><p class="small muted">${esc(f.goal)}</p><p class="small">${esc(f.what)}</p><ul class="plain small">${f.action.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`).join('')}</div>
      <div class="pb-drop"><div style="--w:100%"><b>100%</b><span>看到视频</span></div><div style="--w:31%"><b>31%</b><span>看过 2 秒</span></div><div style="--w:10.4%"><b>10.4%</b><span>看过 6 秒</span></div><div style="--w:4.8%"><b>4.8%</b><span>看到一半</span></div><div style="--w:1.8%"><b>1.8%</b><span>看完</span></div></div>
      <p class="small muted">1,393 条英国 TikTok Shop 投放视频的中位数（Pear Growth，2026 年 7–10 月）。自然流量可能不同。</p></section>

    <section id="p-why"><h3 class="pb-h">为什么会爆</h3><div class="pb-grid">${pb.why.map((w) => `<div class="card card-pad"><h4>${esc(w.title)} ${ev(w.ev, w.src)}</h4><p class="small">${esc(w.body)}</p></div>`).join('')}</div></section>

    <section id="p-hooks"><h3 class="pb-h">钩子库</h3><p class="small muted">一个好钩子是三样东西：第一帧、屏幕字、第一句话，三者说同一件事。带「真实」的例子来自样本或公开报道。</p><div class="pb-grid">${pb.hooks.map((h) => `<div class="card card-pad ${h.avoid ? 'pb-avoid' : ''}"><h4>${esc(h.name)} ${ev(h.ev, h.src)}</h4><p class="formula">${esc(h.formula)}</p><p class="small muted">第一帧：${esc(h.frame)}</p>${h.examples.map((e) => `<p class="small quote">${esc(e.text)} <i>${e.real ? '真实' : '示例'}</i></p>`).join('')}<p class="small">适合：${esc(h.fit)}</p><p class="small warn-text">注意：${esc(h.trap)}</p></div>`).join('')}</div></section>

    <section id="p-styles"><h3 class="pb-h">风格库</h3>${pb.groups.map((g) => `<h4 class="pb-sub">${esc(g.name)} <small class="muted">${esc(g.hint)}</small></h4><div class="pb-grid">${pb.styles.filter((s) => s.group === g.id).map((s) => `<div class="card card-pad"><h4>${esc(s.name)} ${ev(s.ev, s.src)}</h4><p class="small muted">${esc(s.tagline)}</p><div class="beats">${s.beats.map((b) => `<span>${esc(b)}</span>`).join('')}</div><p class="small">适合：${esc(s.fit)}</p><p class="small muted">${esc(s.example)}</p><p class="small warn-text">注意：${esc(s.risk)}</p></div>`).join('')}</div>`).join('')}</section>

    <section id="p-pain"><h3 class="pb-h">怎么抓痛点</h3><p>${esc(pb.pain.intro)}</p><div class="pb-grid">${pb.pain.sources.map((s) => `<div class="card card-pad"><h4>${esc(s.name)}</h4><p class="small">${esc(s.how)}</p></div>`).join('')}</div>
      <div class="table-wrap mt"><table><thead><tr><th>层次</th><th>例子</th><th>适合的视频</th></tr></thead><tbody>${pb.pain.ladder.map((l) => `<tr><td><b>${esc(l.level)}</b></td><td>${esc(l.example)}</td><td>${esc(l.use)}</td></tr>`).join('')}</tbody></table></div>
      <p class="mt">${esc(pb.pain.naming)} ${ev('data', pb.pain.naming_src)}</p><div class="hit"><div class="muted small">写之前问自己</div><ul class="plain">${pb.pain.check.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></section>

    <section id="p-ret"><h3 class="pb-h">怎么留住人</h3><div class="pb-grid">${pb.retention.map((r) => `<div class="card card-pad"><h4>${esc(r.name)} ${ev(r.ev, r.src)}</h4><p class="small">${esc(r.how)}</p></div>`).join('')}</div>
      <div class="hit mt"><b>${esc(pb.length.title)}</b> ${pb.length.src.map((s) => ev(pb.sources[s].ev, s)).join(' ')}<p class="small">${esc(pb.length.body)}</p><p class="small"><b>建议：</b>${esc(pb.length.advice)}</p></div></section>

    <section id="p-jewelry"><h3 class="pb-h">首饰专章</h3><p>${esc(pb.jewelry.intro)} ${ev('data', 'branvas')}</p>
      <div class="table-wrap"><table><thead><tr><th>品类</th><th>月 GMV</th><th>每件均价</th><th>销售渠道</th><th>打法</th></tr></thead><tbody>${pb.jewelry.market.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.gmv)}</td><td>${esc(m.aov)}</td><td>${esc(m.channel)}</td><td>${esc(m.advice)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small mt">${esc(pb.jewelry.creators)} ${esc(pb.jewelry.sold)}</p>
      <h4 class="pb-sub">首饰的痛点和写法</h4><div class="table-wrap"><table><thead><tr><th>痛点</th><th>钩子示例</th><th>怎么证明</th><th>注意</th></tr></thead><tbody>${pb.jewelry.pains.map((p) => `<tr><td><b>${esc(p.pain)}</b></td><td>${esc(p.hook)}</td><td>${esc(p.proof)}</td><td class="warn-text">${esc(p.caution)}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid g2 mt"><div class="hit"><div class="muted small">常用镜头 ${ev('sample', 'sample')}</div><ul class="plain">${pb.jewelry.shots.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div class="hit"><div class="muted small">样本里最常说的词 ${ev('sample', 'sample')}</div><div class="tag-list" style="margin-top:8px">${pb.jewelry.words.map((w) => `<span class="chip">${esc(w)}</span>`).join('')}</div><p class="small warn-text mt">${esc(pb.jewelry.brand)}</p></div></div></section>

    <section id="p-cases"><h3 class="pb-h">案例拆解</h3><div class="pb-grid wide">${pb.cases.map((c) => `<div class="card card-pad"><h4>${esc(c.name)} ${ev(pb.sources[c.src].ev, c.src)}</h4><p class="small"><b>${esc(c.result)}</b></p><p class="small">${esc(c.what)}</p><ul class="plain small">${c.lesson.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`).join('')}</div></section>

    <section id="p-rules"><h3 class="pb-h">合规红线</h3><div class="table-wrap"><table><tbody>${pb.compliance.map((c) => `<tr><td class="nowrap"><b>${esc(c.rule)}</b> ${ev('official', c.src)}</td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div>
      <div class="note-card warn mt"><b>${esc(pb.aiVideo.title)}</b> ${ev('official', pb.aiVideo.src)}<ul class="plain">${pb.aiVideo.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div></section>

    <section id="p-test"><h3 class="pb-h">怎么测，怎么改</h3><p>${esc(pb.testing.intro)}</p><ol class="steps-ol">${pb.testing.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><p class="small muted">${esc(pb.testing.benchmarks)}</p></section>

    <section id="p-sample"><h3 class="pb-h">样本数据</h3><p class="small muted">${esc(pb.sample.summary)}</p><div class="table-wrap"><table><thead><tr><th>分组</th><th class="r">条数</th><th class="r">播放中位数</th><th class="r">时长中位数</th><th class="r">粉丝不足 1 万</th><th class="r">转发率中位数</th><th class="r">收藏率中位数</th></tr></thead><tbody>${pb.sample.table.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td class="r">${r.n}</td><td class="r">${esc(r.plays)}</td><td class="r">${esc(r.dur)}</td><td class="r">${esc(r.small)}</td><td class="r">${esc(r.share)}</td><td class="r">${esc(r.save)}</td></tr>`).join('')}</tbody></table></div>
      <ul class="plain mt">${pb.sample.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <h4 class="pb-sub">全部来源</h4><ul class="plain small">${Object.values(pb.sources).map((s) => `<li>${ev(s.ev)} ${s.url ? `<a class="link-lime" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>` : esc(s.name)}</li>`).join('')}</ul></section>
  </div>`;
  $$('.pb-nav a', view).forEach((a) => (a.onclick = (e) => { e.preventDefault(); $(`#${a.dataset.to}`, view).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
}
