// 商品详情 →「爆款视频」：粘贴 TikTok 链接，不点进去就能看到播放、点赞、评论、收藏、分享；
// 视频存到自己服务器后可以在这里播放、保存到电脑、一键送去拆解
import { api, icon, esc, toast, withLoading, modal, timeAgo, $, $$, confirmBox } from '../lib.js';

// 中文习惯的大数：1.2万、3.4亿
export const fmtCount = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  n = Number(n);
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}万`;
  return n.toLocaleString();
};
const STATS = [['play', '播放', 'play'], ['like', '点赞', 'heart'], ['comment', '评论', 'msg'], ['collect', '收藏', 'bookmark'], ['share', '分享', 'share']];
const SORTS = [['like', '按点赞'], ['play', '按播放'], ['collect', '按收藏'], ['comment', '按评论'], ['share', '按分享'], ['rate', '按互动率'], ['new', '按发布时间']];
// 互动率 =（点赞 + 评论 + 收藏 + 分享）÷ 播放
const rate = (s) => (s?.play ? ((s.like || 0) + (s.comment || 0) + (s.collect || 0) + (s.share || 0)) / s.play : null);
const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
// 去 TikTok 搜同款：用英文标题前几个有意义的词
const searchWords = (p) => String(p.name || '').replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^(for|and|the|with|women|men|gift|gifts|plated)$/i.test(w)).slice(0, 4).join(' ');

export function mountVideos(box, p) {
  let items = [];
  let sort = 'like';
  let timer = null;

  const sorted = () => {
    const key = { rate: (x) => rate(x.stats) ?? -1, new: (x) => Date.parse(x.postedAt || 0) || 0 }[sort] || ((x) => x.stats?.[sort] ?? -1);
    return [...items].sort((a, b) => key(b) - key(a));
  };
  const delta = (x) => {
    const d = x.prevStats && x.stats?.like != null && x.prevStats.like != null ? x.stats.like - x.prevStats.like : null;
    return d ? ` · 点赞比上次 ${d > 0 ? '+' : ''}${fmtCount(d)}` : '';
  };
  const card = (x) => {
    const r = rate(x.stats);
    const dl = x.dl === 'done' && x.mediaId
      ? `<a class="btn sm ghost" href="/api/media/${x.mediaId}?download=1" download>${icon('download', 13)}保存到电脑</a>`
      : x.dl === 'running' ? `<span class="pv-busy"><span class="spinner"></span>正在存到服务器…</span>` : `<button class="btn sm ghost" data-act="dl" data-loading="提交中…">${icon('download', 13)}下载视频</button>`;
    const an = x.viralId
      ? `<a class="btn sm" href="#/scripts/viral/${x.viralId}" data-close>${icon('search', 13)}看拆解</a>`
      : x.then === 'analyze' ? '<span class="pv-busy">下载好自动拆解</span>' : `<button class="btn sm" data-act="analyze" data-loading="提交中…">${icon('sparkles', 13)}拆解这条</button>`;
    return `<div class="pv-card" data-id="${x.id}">
      <div class="pv-cover">${x.coverId ? `<img src="/api/media/${x.coverId}" alt="" loading="lazy">` : `<span class="pv-ph">${icon('video', 24)}</span>`}
        ${x.duration ? `<span class="pv-dur">${dur(x.duration)}</span>` : ''}
        ${x.mediaId ? `<button class="pv-play" data-act="play" title="播放">${icon('play', 22)}</button>` : ''}</div>
      <div class="pv-body">
        <div class="pv-author"><b>@${esc(x.author)}</b>${x.followers != null ? `<span>粉丝 ${fmtCount(x.followers)}</span>` : ''}</div>
        <p class="pv-desc" title="${esc(x.desc)}">${esc(x.desc || '（没有文案）')}</p>
        <div class="pv-stats">${STATS.map(([k, t, ic]) => `<span title="${t}">${icon(ic, 13)}<b>${fmtCount(x.stats?.[k])}</b><i>${t}</i></span>`).join('')}</div>
        <div class="pv-meta">${x.postedAt ? `发布 ${esc(x.postedAt.slice(0, 10))}` : ''}${r != null ? ` · 互动率 ${(r * 100).toFixed(1)}%` : ''} · 数据 ${timeAgo(x.fetchedAt)}${delta(x)}</div>
        <div class="pv-acts"><a class="btn sm ghost" href="${esc(x.url)}" target="_blank" rel="noopener">${icon('link', 13)}TikTok</a>${dl}${an}<div class="spacer"></div>
          <button class="icon-btn" data-act="refresh" title="刷新数据">${icon('refresh', 14)}</button><button class="icon-btn danger" data-act="del" title="删除">${icon('trash', 14)}</button></div>
        ${x.dl === 'failed' ? `<div class="small down">下载失败：${esc(x.dlError || '')}</div>` : ''}
      </div></div>`;
  };

  function draw() {
    const fm = p.fastmossLink ? `<a href="${esc(p.fastmossLink)}" target="_blank" rel="noopener">${icon('link', 13)}FastMoss 详情里找带货视频</a>` : '';
    const kw = searchWords(p);
    box.innerHTML = `<div class="pv">
      <div class="pv-add">
        <div class="row" style="gap:8px;flex-wrap:wrap"><b>粘贴 TikTok 视频链接</b><span class="small muted">一行一条，也可以把一整段文字粘进来，系统自己找链接（一次最多 20 条）</span></div>
        <textarea class="input" id="pv-text" rows="3" placeholder="https://www.tiktok.com/@用户名/video/7xxxxxxxxxxxxxxxxxx&#10;https://vm.tiktok.com/xxxxxx/"></textarea>
        <div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn" id="pv-go" data-loading="读取中…（每条几秒）">${icon('download', 14)}读取数据</button>
          <span class="small muted">去哪找链接：</span><span class="ext-links">${fm}${kw ? `<a href="https://www.tiktok.com/search?q=${encodeURIComponent(kw)}" target="_blank" rel="noopener">${icon('search', 13)}在 TikTok 搜「${esc(kw)}」</a>` : ''}</span></div>
        <div id="pv-err"></div>
      </div>
      ${items.length ? `<div class="row pv-bar"><b>${items.length} 条视频</b><select class="input" id="pv-sort" aria-label="排序">${SORTS.map(([k, t]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="small muted">互动率 =（点赞 + 评论 + 收藏 + 分享）÷ 播放</span></div>
      <div class="pv-grid">${sorted().map(card).join('')}</div>` : '<p class="small muted" style="margin:4px 0 0">还没有视频。在 FastMoss 商品详情的带货视频里，或者 TikTok 上，复制视频链接粘到上面。</p>'}
      <p class="small muted pv-note">视频存在你自己的服务器上，只用来拆解学习。别人的视频不要直接重发：侵犯原作者版权，TikTok 也会判成非原创内容限流。</p>
    </div>`;
    bind();
  }

  async function load() {
    clearTimeout(timer);
    if (!box.isConnected) return;
    items = (await api(`/products/${p.id}/videos`)).items;
    draw();
    // 有正在下载或等着拆解的：过几秒再看一次
    if (items.some((x) => x.dl === 'running' || (x.then === 'analyze' && !x.viralId))) timer = setTimeout(load, 3000);
  }

  function play(x) {
    modal({ title: `@${esc(x.author)}`, body: `<div class="pv-player"><video src="/api/media/${x.mediaId}" controls autoplay playsinline></video></div>
      <div class="row" style="gap:8px;margin-top:10px"><a class="btn sm ghost" href="/api/media/${x.mediaId}?download=1" download>${icon('download', 13)}保存到电脑</a><a class="btn sm ghost" href="${esc(x.url)}" target="_blank" rel="noopener">${icon('link', 13)}在 TikTok 打开</a></div>` });
  }

  function bind() {
    $('#pv-go', box).onclick = (e) => withLoading(e.currentTarget, async () => {
      const text = $('#pv-text', box).value;
      const r = await api(`/products/${p.id}/videos`, { method: 'POST', body: { text } });
      items = r.items;
      draw();
      const ok = r.added + r.updated;
      if (ok) toast(`读到 ${ok} 条${r.updated ? `（${r.updated} 条已有，更新了数据）` : ''}`, 'success');
      if (r.errors.length) $('#pv-err', box).innerHTML = `<div class="note-card warn small">${r.errors.map((x) => `<div><b>${esc(x.link)}</b>：${esc(x.error)}</div>`).join('')}</div>`;
    });
    const s = $('#pv-sort', box);
    if (s) s.onchange = () => { sort = s.value; draw(); };
    $$('.pv-card', box).forEach((el) => {
      const x = items.find((i) => i.id === el.dataset.id);
      el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = (e) => withLoading(e.currentTarget, async () => {
        const act = b.dataset.act;
        if (act === 'play') return play(x);
        if (act === 'del') {
          if (!(await confirmBox('删除这条视频？存在服务器上的视频文件也会删除'))) return;
          await api(`/tt-videos/${x.id}`, { method: 'DELETE' });
        } else if (act === 'refresh') {
          await api(`/tt-videos/${x.id}/refresh`, { method: 'POST' });
          toast('数据已更新', 'success');
        } else if (act === 'dl') {
          await api(`/tt-videos/${x.id}/download`, { method: 'POST' });
        } else if (act === 'analyze') {
          const r = await api(`/tt-videos/${x.id}/analyze`, { method: 'POST' });
          toast(r.viralId ? '已送去拆解，点「看拆解」看进度' : '先把视频存到服务器，存好自动开始拆解', 'success');
        }
        await load();
      })));
    });
  }

  load();
  return () => clearTimeout(timer);
}
