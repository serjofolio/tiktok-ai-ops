// 接入配置：模型只有一个入口（仿 CC Switch）——填一次地址和 Key，文本、看图、图片、视频、语音模型自动分类、单独开关，
// 每类先用首选，出错自动换下一个启用的；另外是数据源与 ERP、浏览器插件令牌、店铺信息
import { api, icon, esc, toast, withLoading, $, $$, modal, confirmBox } from '../lib.js';

const initial = (name) => esc((String(name || '?').match(/[一-龥]|[A-Za-z0-9]/) || ['?'])[0].toUpperCase());
// 调用时的几类：图片包括对话出图，文本也能用看图模型当备用
const POOL = [['text', '文本', 'file', '写脚本、选品分析、Agent'], ['vision', '看图', 'eye', '拆解爆款看画面、只传素材认商品'], ['image', '图片', 'image', '出关键帧、首帧'], ['video', '视频', 'video', '脚本出片、批量出片'], ['asr', '语音转写', 'file', '拆解爆款听口播']];
const inPool = (pool, k) => (pool === 'text' ? k === 'text' || k === 'vision' : pool === 'image' ? k === 'image' || k === 'imagechat' : k === pool);
const poolOf = (k) => (k === 'imagechat' ? 'image' : k);
const MEDIA = ['video', 'image', 'vision', 'asr'];
// 统一接入能代替的旧类型，不再单独列出来
const REPLACED = ['videonewapi', 'imageopenai', 'imagechat', 'visionopenai', 'visionclaude', 'asropenai', 'asrsiliconflow'];
const STATUS = { ready: ['可用', 'v-go'], beta: ['测试版', 'v-watch'], pending: ['待开放接口', 'v-na'] };

export async function render(view) {
  let [d, prov] = await Promise.all([api('/connectors'), api('/providers')]);
  const changed = () => window.dispatchEvent(new Event('providerschange'));
  const openPanels = new Set();
  const filters = new Map();

  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">接入配置 · API</div>
    <h2>接入<em>模型</em></h2>
    <p>填一次地址和 Key，文本、看图、图片、视频、语音模型自动读出来、分好类，每个模型单独开关。写脚本、出图、出视频都先用首选模型，出错（没额度、Key 失效、超时）自动换下一个启用的同类模型。页面只显示脱敏后的密钥。</p>
    <div class="actions"><button class="btn lg primary-glow" id="add">${icon('plus')}添加模型</button></div>
  </section>
  <div class="section-title" style="margin-top:0"><h3>现在用的模型</h3><span class="muted small">每类先用这里选的首选模型</span><div class="spacer"></div><label class="switch" title="首选模型出错时，自动换下一个启用的同类模型（文本最多再试 3 个，图片、视频最多再试 2 个）"><input type="checkbox" id="auto-fb"><span></span>出错自动换模型</label></div>
  <div class="card card-pad" id="now"></div>
  <div class="section-title"><h3>已接入</h3><span class="muted small" id="pcount"></span></div>
  <div class="col" id="hubs"></div>

  <div class="section-title"><h3>数据源与 ERP</h3><span class="muted small">FastMoss 选品数据 → 1688 找货 → ERP 上品；接口没申请下来的环节，用浏览器插件或通用 Webhook 兜底</span><div class="spacer"></div><button class="btn sm" id="add-conn">${icon('plus', 14)}添加连接</button></div>
  <div id="conns"></div>
  <div class="section-title"><h3>浏览器插件与 API 令牌</h3><span class="muted small">插件在你自己登录的 1688 和 FastMoss 页面发送数据；n8n、影刀等程序也用令牌调用运营台接口</span></div>
  <div class="card card-pad" id="tokens"></div>

  <div class="section-title"><h3>店铺信息</h3><span class="muted small">影响脚本默认语言和分析时的目标市场</span></div>
  <div class="card card-pad"><form class="grid g3" id="store">
    <label class="field">店铺名称<input class="input" name="name" value="${esc(prov.store.name)}"></label>
    <label class="field">主营站点<select class="input" name="market">${['US:美国', 'UK:英国', 'SEA:东南亚', 'EU:欧洲', 'MX:墨西哥', 'JP:日本'].map((o) => { const [v, t] = o.split(':'); return `<option value="${v}" ${prov.store.market === v ? 'selected' : ''}>${t}</option>`; }).join('')}</select></label>
    <label class="field">脚本默认语言<select class="input" name="language">${['English', '中文', 'Español', 'Bahasa Indonesia', 'ภาษาไทย', 'Tiếng Việt', '日本語'].map((v) => `<option ${prov.store.language === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  </form><div class="row mt" style="justify-content:flex-end"><button class="btn sm" id="save-store" data-loading="保存中…">${icon('check', 14)}保存</button></div></div>`;

  async function reload() {
    d = await api('/connectors');
    renderAll();
    changed();
  }
  function renderAll() {
    renderNow();
    renderHubs();
    renderConns();
  }

  // ---------- 现在用的模型：每类一个首选 ----------
  const modelsOfConn = (c) => (c.models?.length ? c.models : c.options?.model ? [{ id: c.options.model, label: c.options.model }] : []);
  function candidates(pool) {
    const out = [];
    for (const c of d.items) {
      if (c.enabled === false) continue;
      if (c.vendor === 'hub') {
        for (const m of c.models || []) if (m.enabled !== false && inPool(pool, m.kind)) out.push({ ref: `${c.id}|${m.id}`, label: `${c.name} · ${m.label && m.label !== m.id ? `${m.label}（${m.id}）` : m.id}` });
      } else if (pool !== 'text' && c.kind === pool && c.configured) {
        for (const m of modelsOfConn(c)) if (m.enabled !== false) out.push({ ref: `${c.id}|${m.id}`, label: `${c.name} · ${m.label || m.id}` });
      }
    }
    return out;
  }
  function renderNow() {
    const box = $('#now', view);
    $('#auto-fb', view).checked = d.autoFallback;
    box.innerHTML = `<div class="mh-now">${POOL.map(([k, label, ic, use]) => {
      const list = candidates(k);
      const cur = d.primary[k];
      return `<div class="mh-now-item"><div class="row" style="gap:6px">${icon(ic, 14)}<b>${label}</b><span class="small muted">${use}</span></div>
        ${list.length ? `<select class="input" data-pref="${k}" aria-label="首选${label}模型">${list.map((x) => `<option value="${esc(x.ref)}" ${x.ref === cur ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        <span class="small muted">${list.length > 1 ? `启用了 ${list.length} 个，首选出错时按顺序换` : '只启用了 1 个，出错时没有备用'}</span>` : `<span class="small muted mh-none">没有启用的${label}模型${k === 'vision' ? '：会先试文本模型能不能看图' : k === 'text' ? '：点「添加模型」' : ''}</span>`}</div>`;
    }).join('')}</div>`;
    $$('[data-pref]', box).forEach((s) => (s.onchange = async () => {
      const r = await api('/models/prefs', { method: 'PUT', body: { kind: s.dataset.pref, ref: s.value } });
      Object.assign(d, { prefs: r.modelPrefs, primary: r.primary });
      renderAll();
      changed();
      toast('已换首选模型', 'success');
    }));
  }
  $('#auto-fb', view).onchange = async (e) => {
    const r = await api('/models/prefs', { method: 'PUT', body: { autoFallback: e.target.checked } });
    d.autoFallback = r.autoFallback;
    toast(r.autoFallback ? '已打开：出错自动换下一个启用的模型' : '已关闭：出错就直接报错，不换模型', 'success');
  };

  // ---------- 已接入的模型 ----------
  function card(c) {
    const isHub = c.vendor === 'hub';
    const models = isHub ? c.models || [] : modelsOfConn(c);
    const counts = isHub
      ? POOL.map(([k, l]) => {
        const all = models.filter((m) => inPool(k, m.kind) && (k !== 'text' || m.kind === 'text'));
        const on = all.filter((m) => m.enabled !== false);
        return all.length ? `<span class="mh-count ${on.length ? 'on' : ''}" title="启用 ${on.length} 个，共 ${all.length} 个">${l} <b>${on.length}</b>/${all.length}</span>` : '';
      }).join('')
      : `<span class="mh-count on">${esc(POOL.find(([k]) => k === c.kind)?.[1] || '')} <b>${models.length}</b> 个模型</span>`;
    const firsts = POOL.filter(([k]) => String(d.primary[k] || '').split('|')[0] === c.id).map(([, l]) => `<span class="verdict v-go">首选${l}</span>`).join('');
    const st = STATUS[c.status] || STATUS.pending;
    return `<div class="card mh-card ${c.enabled === false ? 'off' : ''} ${firsts ? 'on' : ''}" data-id="${c.id}">
      <div class="mh-top">
        <div class="pv-avatar">${initial(c.name)}</div>
        <div class="pv-main"><div class="row" style="gap:8px;flex-wrap:wrap"><b>${esc(c.name)}</b>${firsts}${isHub ? `<span class="chip">${c.options?.protocol === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 兼容'}</span>` : `<span class="chip">${esc(d.catalog[c.vendor]?.name || c.vendor)}</span><span class="verdict ${st[1]}" style="font-size:11px">${st[0]}</span>`}${c.note ? `<span class="muted small">${esc(c.note)}</span>` : ''}${c.configured ? '' : '<span class="down small">Key 没填</span>'}</div>
          <div class="pv-url">${esc(c.options?.baseUrl || c.options?.submitUrl || '')}</div>
          <div class="mh-counts">${counts || '<span class="small muted">还没有模型：点「编辑」→「获取模型列表」</span>'}</div>
          <div class="small" data-result></div></div>
        <div class="pv-actions">
          ${isHub ? `<button class="btn sm ${openPanels.has(c.id) ? 'on' : ''}" data-act="models">${icon('layers', 14)}模型开关</button>` : ''}
          <button class="btn sm ghost" data-act="test" data-loading="测试中…">${icon('refresh', 14)}测试</button>
          <button class="icon-btn" data-act="edit" title="编辑">${icon('settings', 15)}</button>
          <button class="icon-btn danger" data-act="del" title="删除">${icon('trash', 15)}</button>
        </div>
      </div>
      <div class="mh-panel" ${openPanels.has(c.id) ? '' : 'hidden'}></div></div>`;
  }
  function renderHubs() {
    const box = $('#hubs', view);
    const items = d.items.filter((c) => c.vendor === 'hub' || MEDIA.includes(c.kind));
    $('#pcount', view).textContent = `${items.length} 个`;
    if (!items.length) {
      box.innerHTML = `<div class="card card-pad empty"><p>还没有接入模型。点「添加模型」，用中转站就选「中转站」，填域名和 Key，文本、图片、视频模型一次读出来。</p><button class="btn" id="add2">${icon('plus', 15)}添加模型</button></div>`;
      $('#add2', box).onclick = picker;
      return;
    }
    box.innerHTML = items.map(card).join('');
    $$('.mh-card', box).forEach((el) => {
      const c = d.items.find((x) => x.id === el.dataset.id);
      if (openPanels.has(c.id)) drawPanel(el, c);
      el.querySelector('.mh-top').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'models') {
          if (openPanels.has(c.id)) openPanels.delete(c.id);
          else openPanels.add(c.id);
          b.classList.toggle('on', openPanels.has(c.id));
          const panel = $('.mh-panel', el);
          panel.hidden = !openPanels.has(c.id);
          if (!panel.hidden) drawPanel(el, c);
        } else if (act === 'test') {
          withLoading(b, async () => {
            const out = $('[data-result]', el);
            try {
              const r = await api(`/connectors/${c.id}/test`, { method: 'POST' });
              out.innerHTML = `<span class="up">${icon('check', 13)} ${esc(r.message)}</span>`;
            } catch (err) {
              out.innerHTML = `<span class="down">${icon('x', 13)} ${esc(err.message)}</span>`;
            }
          });
        } else if (act === 'edit') connEditor(c.vendor, c);
        else if (act === 'del') {
          if (!(await confirmBox(`确定删除「${c.name}」？里面的模型都会停用`))) return;
          await api(`/connectors/${c.id}`, { method: 'DELETE' });
          openPanels.delete(c.id);
          await reload();
        }
      });
    });
  }

  // 模型开关：按类型筛、搜索、一键全部启用 / 停用、改类型、设首选，改了马上生效
  function drawPanel(el, c) {
    const panel = $('.mh-panel', el);
    const f = filters.get(c.id) || { kind: 'all', q: '' };
    filters.set(c.id, f);
    const models = c.models || [];
    const match = (m) => (f.kind === 'all' || (f.kind === 'other' ? m.kind === 'other' : f.kind === 'text' ? m.kind === 'text' : inPool(f.kind, m.kind))) && (!f.q || m.id.toLowerCase().includes(f.q.toLowerCase()));
    const shown = models.filter(match);
    const count = (k) => models.filter((m) => (k === 'other' ? m.kind === 'other' : k === 'text' ? m.kind === 'text' : inPool(k, m.kind))).length;
    const tabs = [['all', '全部', models.length], ...POOL.map(([k, l]) => [k, l, count(k)]), ['other', '其他', count('other')]].filter((t) => t[0] === 'all' || t[2]);
    const label = tabs.find((t) => t[0] === f.kind)?.[1] || '';
    const prim = (m) => d.primary[poolOf(m.kind)] === `${c.id}|${m.id}`;
    panel.innerHTML = `<div class="mh-bar"><div class="seg" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" data-f="${k}" class="${f.kind === k ? 'on' : ''}">${l} ${n}</button>`).join('')}</div>
        <input class="input mh-q" placeholder="搜模型名" value="${esc(f.q)}" aria-label="搜模型名">
        <div class="spacer"></div>
        <button type="button" class="btn sm" data-all="1" data-loading="启用中…">${icon('check', 13)}${f.kind === 'all' ? '一键全部启用' : `启用全部${label}`}</button><button type="button" class="btn sm ghost" data-all="0" data-loading="停用中…">${f.kind === 'all' ? '全部停用' : `停用全部${label}`}</button></div>
      <div class="mh-list">${shown.map((m) => `<div class="mh-row ${m.enabled !== false ? 'on' : ''}" data-m="${esc(m.id)}">
          <label class="switch" title="${m.enabled !== false ? '已启用，点一下停用' : '点一下启用'}"><input type="checkbox" data-toggle ${m.enabled !== false ? 'checked' : ''}><span></span></label>
          <div class="mh-name"><b>${esc(m.id)}</b>${m.label && m.label !== m.id ? `<span class="small muted">${esc(m.label)}</span>` : ''}${m.price !== '' && m.price != null ? `<span class="small muted">¥${esc(m.price)}/${esc(m.unit || (m.kind === 'video' ? '秒' : m.kind === 'image' ? '张' : '次'))}</span>` : ''}</div>
          ${prim(m) ? '<span class="verdict v-go">首选</span>' : m.enabled !== false && m.kind !== 'other' ? '<button type="button" class="btn sm ghost" data-prefer>设为首选</button>' : '<span></span>'}
          <select class="input mh-kind" data-kind aria-label="${esc(m.id)} 的类型">${Object.entries(d.kinds).map(([k, l]) => `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>`).join('') || '<p class="small muted" style="margin:8px 0">没有匹配的模型</p>'}</div>
      <p class="small muted" style="margin:8px 0 0">类型是按模型名自动认的，认错了在右边改。「其他」（向量、重排、语音合成等）不会被调用。</p>`;
    const patch = async (body, msg) => {
      await api(`/connectors/${c.id}/models`, { method: 'PATCH', body });
      await reload();
      if (msg) toast(msg, 'success');
    };
    $$('[data-f]', panel).forEach((b) => (b.onclick = () => { f.kind = b.dataset.f; drawPanel(el, c); }));
    const q = $('.mh-q', panel);
    q.oninput = () => {
      f.q = q.value;
      const pos = q.selectionStart;
      drawPanel(el, c);
      const nq = $('.mh-q', panel);
      nq.focus();
      nq.setSelectionRange(pos, pos);
    };
    $$('[data-all]', panel).forEach((b) => (b.onclick = (e) => withLoading(e.currentTarget, () => patch({ all: b.dataset.all === '1', ...(f.kind === 'all' ? {} : { kind: f.kind }) }, b.dataset.all === '1' ? `已启用${f.kind === 'all' ? '全部' : `全部${label}`}模型` : '已停用'))));
    $$('.mh-row', panel).forEach((r) => {
      const id = r.dataset.m;
      $('[data-toggle]', r).onchange = (e) => patch(e.target.checked ? { enable: [id] } : { disable: [id] });
      $('[data-kind]', r).onchange = (e) => patch({ kinds: { [id]: e.target.value } }, '已改类型');
      const pf = $('[data-prefer]', r);
      if (pf) pf.onclick = async () => {
        const m = models.find((x) => x.id === id);
        const r2 = await api('/models/prefs', { method: 'PUT', body: { kind: poolOf(m.kind), ref: `${c.id}|${id}` } });
        Object.assign(d, { prefs: r2.modelPrefs, primary: r2.primary });
        renderAll();
        changed();
        toast(`已设为首选${POOL.find(([k]) => k === poolOf(m.kind))?.[1] || ''}模型`, 'success');
      };
    });
  }

  // ---------- 添加模型：一个入口 ----------
  function prefillOf(id) {
    if (id === 'relay') return { title: '中转站', name: '', options: { baseUrl: '', protocol: 'openai', presetId: 'relay' }, models: [] };
    const p = d.presets.find((x) => x.id === id);
    return { title: p.name, name: p.id === 'custom' ? '' : p.name, keyUrl: p.website || '', options: { baseUrl: p.baseUrl, protocol: p.protocol, presetId: p.id }, models: (p.models || []).map((m, i) => ({ label: m, id: m, kind: 'text', enabled: i === 0, price: '', unit: '' })) };
  }
  function picker() {
    const official = Object.entries(d.catalog).filter(([k, v]) => MEDIA.includes(v.kind) && !REPLACED.includes(k));
    modal({
      title: '添加模型', wide: true,
      body: `<p class="small muted" style="margin-top:0">填一次地址和 Key，文本、看图、图片、视频、语音模型自动读出来、分好类，在列表里单独开关。用中转站就选第一个。</p>
        <h4 class="rp-h" style="margin-top:6px">一次接入全部模型</h4>
        <div class="preset-grid conn-pick">
          <div class="preset-card rec" data-preset="relay"><b>中转站（new-api / one-api 等）</b><span class="rec-tag">${icon('check', 12)}大多数中转站选这个</span><small>后台有「令牌」「模型广场」的就是。只填域名和 Key，文本、图片、视频模型一次读出来，不用分开加。</small></div>
          ${d.presets.map((p) => `<div class="preset-card" data-preset="${p.id}"><b>${esc(p.name)}</b><span class="small muted">${p.protocol === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 兼容'}</span><small>${esc(p.tip || p.baseUrl || '自己填地址，OpenAI 兼容或 Anthropic 协议都行')}</small></div>`).join('')}
        </div>
        <h4 class="rp-h" style="margin-top:16px">官方专用接口（格式特殊，不走中转站时才用）</h4>
        <div class="preset-grid conn-pick">${official.map(([key, v]) => { const st = STATUS[v.status]; return `<div class="preset-card" data-v="${key}"><div class="row" style="justify-content:space-between"><b>${esc(v.name)}</b><span class="verdict ${st[1]}" style="font-size:10px">${st[0]}</span></div><small>${esc(v.desc)}</small></div>`; }).join('')}</div>`,
      onMount(el, close) {
        $$('[data-preset]', el).forEach((c) => (c.onclick = () => { close(); connEditor('hub', null, prefillOf(c.dataset.preset)); }));
        $$('[data-v]', el).forEach((c) => (c.onclick = () => { close(); connEditor(c.dataset.v); }));
      },
    });
  }

  // ---------- 数据源与 ERP 连接器 ----------
  const KIND = { product: ['选品数据', 'target'], sourcing: ['1688 找货', 'search'], erp: ['ERP 上品', 'upload'] };
  function renderConns() {
    const box = $('#conns', view);
    box.innerHTML = Object.entries(KIND).map(([k, [label, ic]]) => {
      const items = d.items.filter((c) => c.kind === k);
      const builtin = Object.entries(d.catalog).filter(([, v]) => v.kind === k && v.builtin);
      return `<div class="conn-group"><div class="conn-head">${icon(ic, 16)}<b>${label}</b><span class="muted small">${k === 'product' ? 'FastMoss 接口开通前：在「智能选品」导入导出文件' : k === 'sourcing' ? '官方 API / 第三方数据接口 / 浏览器插件，三选一即可' : '妙手 ERP、其他 ERP，或通用 Webhook 接 n8n / 影刀'}</span></div>
        <div class="conn-list">${items.map((c) => { const st = STATUS[c.status] || STATUS.pending; return `<div class="conn ${c.enabled === false ? 'off' : ''}" data-id="${c.id}"><div class="conn-ic">${initial(c.name)}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted small">${esc(d.catalog[c.vendor]?.name || c.vendor)} · <span class="verdict ${st[1]}" style="padding:1px 8px;font-size:11px">${st[0]}</span> ${c.configured ? '' : '<span class="down small">凭证未填完整</span>'}</div><div class="small muted" data-result></div></div>
            <button class="btn sm ghost" data-act="test" data-loading="测试中…">测试</button><button class="btn sm ghost" data-act="edit">编辑</button><button class="icon-btn danger" data-act="del">${icon('trash', 14)}</button></div>`; }).join('')}
          ${builtin.map(([, v]) => `<div class="conn builtin"><div class="conn-ic">${icon('link', 15)}</div><div style="flex:1"><b>${esc(v.name)}</b><div class="muted small">${esc(v.desc)}</div></div><a class="btn sm ghost" href="#tokens-anchor" data-goto-tokens>设置插件</a></div>`).join('')}
          ${!items.length && !builtin.length ? `<div class="conn empty-conn muted small">还没有添加，点右上角「添加连接」</div>` : ''}</div></div>`;
    }).join('');
    $$('.conn[data-id]', box).forEach((el) => {
      const c = d.items.find((x) => x.id === el.dataset.id);
      el.querySelector('[data-act=edit]').onclick = () => connEditor(c.vendor, c);
      el.querySelector('[data-act=del]').onclick = async () => {
        if (!(await confirmBox(`删除连接「${c.name}」？`))) return;
        await api(`/connectors/${c.id}`, { method: 'DELETE' });
        reload();
      };
      el.querySelector('[data-act=test]').onclick = (e) => withLoading(e.currentTarget, async () => {
        const out = el.querySelector('[data-result]');
        try {
          const r = await api(`/connectors/${c.id}/test`, { method: 'POST' });
          out.innerHTML = `<span class="up">${esc(r.message)}</span>`;
        } catch (ex) {
          out.innerHTML = `<span class="down">${esc(ex.message)}</span>`;
        }
      });
    });
    $$('[data-goto-tokens]', box).forEach((a) => (a.onclick = (e) => { e.preventDefault(); $('#tokens', view).scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  }

  function connPicker() {
    modal({
      title: '添加连接', wide: true,
      body: Object.entries(KIND).map(([k, [label]]) => `<h4 class="rp-h" style="margin-top:6px">${label}</h4><div class="preset-grid conn-pick">${Object.entries(d.catalog).filter(([, v]) => v.kind === k && !v.builtin).map(([key, v]) => { const st = STATUS[v.status]; return `<div class="preset-card" data-v="${key}"><div class="row" style="gap:8px"><b>${esc(v.name)}</b><span class="verdict ${st[1]}" style="padding:1px 8px;font-size:11px">${st[0]}</span></div><p class="small muted" style="margin:6px 0 0">${esc(v.desc)}</p></div>`; }).join('')}</div>`).join(''),
      onMount(el, close) {
        $$('[data-v]', el).forEach((c) => (c.onclick = () => { close(); connEditor(c.dataset.v); }));
      },
    });
  }

  // 编辑：仿 CC Switch 的供应商编辑页。Logo → 名称和备注 → 官网 → 密钥（可显示）→ 请求地址（可看完整地址）→ 模型 → 高级选项 → 原始配置
  // 统一接入（hub）的模型表多两列：开关和类型；读模型列表时全部列出来、自动分类，用的人勾选或一键全部启用
  const ENDPOINT = {
    hub: (o) => (o.protocol === 'anthropic' ? `${o.baseUrl.replace(/\/v1$/, '')}/v1/messages` : `${o.baseUrl}/chat/completions`),
    seedance: (o) => `${o.baseUrl}/contents/generations/tasks`, kling: (o) => `${o.baseUrl}/image-to-video/${o.model || '{model}'}`, wan: (o) => `${o.baseUrl}/services/aigc/video-generation/video-synthesis`, minimax: (o) => `${o.baseUrl}/v1/video_generation`,
    videonewapi: (o) => `${o.baseUrl}${o.endpoint || '/videos'}`, seedream: (o) => `${o.baseUrl}/images/generations`, imageopenai: (o) => `${o.baseUrl}/images/generations`, imagechat: (o) => `${o.baseUrl}/chat/completions`,
    visionglm: (o) => `${o.baseUrl}/chat/completions`, visionopenai: (o) => `${o.baseUrl}/chat/completions`, visionclaude: (o) => `${o.baseUrl}/v1/messages`, asrsiliconflow: (o) => `${o.baseUrl}/audio/transcriptions`, asrglm: (o) => `${o.baseUrl}/audio/transcriptions`, asropenai: (o) => `${o.baseUrl}/audio/transcriptions`,
  };
  const UNIT_HINT = { video: '秒', image: '张' };
  // 中转站地址只填了域名时补 /v1（和服务端一致）
  const relayBase = (u) => {
    const t = String(u || '').trim().replace(/\/+$/, '');
    try {
      const x = new URL(t);
      return x.pathname === '/' || x.pathname === '' ? `${x.origin}/v1` : t;
    } catch {
      return t;
    }
  };
  // 自定义接口没有接口地址，只有提交地址：从提交地址推出 /v1 那一级，用来读模型列表
  const baseOf = (u) => {
    try {
      const x = new URL(String(u || '').trim());
      const i = x.pathname.indexOf('/v1');
      return i >= 0 ? x.origin + x.pathname.slice(0, i + 3) : `${x.origin}/v1`;
    } catch {
      return '';
    }
  };
  function connEditor(vendor, c, prefill = {}) {
    const v = d.catalog[vendor];
    const isHub = vendor === 'hub';
    const urlKey = v.options.find((o) => o.key === 'baseUrl') ? 'baseUrl' : v.options.find((o) => o.key === 'submitUrl') ? 'submitUrl' : '';
    const hasModels = isHub || (v.options.some((o) => o.key === 'model') && MEDIA.includes(v.kind));
    const st = {
      name: c?.name || prefill.name || (isHub ? '' : v.name), note: c?.note || prefill.note || '', enabled: c?.enabled !== false,
      creds: { ...(c?.creds || {}), ...(prefill.creds || {}) },
      options: Object.fromEntries(v.options.map((o) => [o.key, c?.options?.[o.key] ?? prefill.options?.[o.key] ?? o.default ?? ''])),
      models: (c?.models?.length ? c.models : prefill.models || v.models || []).map((m) => ({ ...m })),
    };
    if (hasModels && !isHub && !st.models.length && st.options.model) st.models = [{ label: st.options.model, id: st.options.model, price: '', unit: '' }];
    let showFull = false;
    let fetched = [];
    let prices = {};
    let fetchMsg = '';
    let kindFilter = 'all';
    const keyUrl = prefill.keyUrl || (isHub ? (d.presets.find((p) => p.id === st.options.presetId)?.website || '') : v.keyUrl || v.link || '');
    const tip = isHub ? '用中转站只填域名就行，会自动补 /v1；选了预设的地址已经填好' : v.relay ? '填到 /v1 为止，例如 https://你的中转站域名/v1；接口路径系统会自动拼上' : urlKey === 'baseUrl' ? '默认是官方地址。你的中转站也转发这家的原厂格式时，把它换成中转站地址就行' : '';
    const title = isHub ? (c ? `编辑：${esc(c.name)}` : `添加：${esc(prefill.title || '模型接入')}`) : `${c ? '编辑' : '添加'}：${esc(v.name)}`;
    const m = modal({ title, wide: true, body: '<div id="cc"></div>', footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="ok" data-loading="保存中…">${icon('check', 15)}保存</button>` });
    const root = $('#cc', m.el);
    const raw = () => JSON.stringify({ name: st.name, note: st.note, enabled: st.enabled, options: st.options, ...(hasModels ? { models: st.models } : {}) }, null, 2);
    const kindMatch = (x) => kindFilter === 'all' || (kindFilter === 'other' ? x.kind === 'other' : kindFilter === 'text' ? x.kind === 'text' : inPool(kindFilter, x.kind));

    function collect() {
      const q = (s) => $(s, root);
      if (!q('[name=name]')) return;
      st.name = q('[name=name]').value;
      st.note = q('[name=note]').value;
      st.enabled = q('[name=enabled]').value === '1';
      $$('[data-cred]', root).forEach((i) => (st.creds[i.dataset.cred] = i.value));
      $$('[data-opt]', root).forEach((i) => (st.options[i.dataset.opt] = i.value));
      if (hasModels) {
        // 只更新显示出来的行（按类型筛选时其余的不动）
        for (const r of $$('.cc-tr[data-i]', root)) {
          const i = Number(r.dataset.i);
          const x = st.models[i];
          if (!x) continue;
          Object.assign(x, { label: $('[data-m=label]', r).value.trim(), id: $('[data-m=id]', r).value.trim(), price: $('[data-m=price]', r).value, unit: $('[data-m=unit]', r).value });
          if (isHub) Object.assign(x, { enabled: $('[data-m=on]', r).checked, kind: $('[data-m=kind]', r).value });
        }
        const def = $('[name=defm]:checked', root);
        if (def) st.options.model = st.models[Number(def.closest('.cc-tr').dataset.i)]?.id || st.options.model;
      }
    }
    const preview = () => {
      const fn = ENDPOINT[vendor];
      const o = { ...st.options, baseUrl: String(st.options.baseUrl || '').trim().replace(/\/+$/, '') };
      return fn ? fn(o) : o[urlKey] || '';
    };
    const unitSel = (x) => `<select class="input" data-m="unit">${['', '秒', '条', '张'].map((u) => `<option value="${u}" ${x.unit === u ? 'selected' : ''}>${u ? `每${u}` : `每${UNIT_HINT[isHub ? x.kind : v.kind] || '次'}`}</option>`).join('')}</select>`;
    const modelRow = (x, i) => isHub
      ? `<div class="cc-tr hub ${x.enabled ? 'on' : ''}" data-i="${i}"><label class="switch" title="启用"><input type="checkbox" data-m="on" ${x.enabled ? 'checked' : ''}><span></span></label><select class="input" data-m="kind" aria-label="类型">${Object.entries(d.kinds).map(([k, l]) => `<option value="${k}" ${k === (x.kind || 'text') ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input" data-m="label" value="${esc(x.label || '')}" placeholder="显示名"><input class="input" data-m="id" value="${esc(x.id || '')}" placeholder="实际请求的模型名"><input class="input" data-m="price" type="number" min="0" step="0.001" value="${esc(x.price ?? '')}" placeholder="单价" title="${esc(x.note || '人民币')}">${unitSel(x)}<button type="button" class="icon-btn danger" data-del title="删除">${icon('trash', 14)}</button></div>`
      : `<div class="cc-tr" data-i="${i}"><label class="cc-def" title="默认模型"><input type="radio" name="defm" ${x.id === st.options.model ? 'checked' : ''}></label><input class="input" data-m="label" value="${esc(x.label || '')}" placeholder="显示名"><input class="input" data-m="id" value="${esc(x.id || '')}" placeholder="实际请求的模型名"><input class="input" data-m="price" type="number" min="0" step="0.001" value="${esc(x.price ?? '')}" placeholder="单价" title="${esc(x.note || '人民币')}">${unitSel(x)}<button type="button" class="icon-btn danger" data-del title="删除">${icon('trash', 14)}</button></div>`;
    const kindCount = (k) => st.models.filter((x) => (k === 'other' ? x.kind === 'other' : k === 'text' ? x.kind === 'text' : inPool(k, x.kind))).length;

    function modelsSection() {
      if (!isHub) {
        return `<div class="cc-sec"><div class="cc-sec-h"><b>模型映射</b><span class="muted small">第一列选默认模型；单价用来算批量出片的花费（人民币，以账单为准）</span><div class="spacer"></div>
            <button type="button" class="btn sm ghost" id="fm" data-loading="获取中…">${icon('download', 14)}获取模型列表</button>${v.relay ? `<button type="button" class="btn sm ghost" id="fp" data-loading="读取中…">${icon('chart', 14)}读取价格</button>` : ''}<button type="button" class="btn sm ghost" id="am">${icon('plus', 14)}添加模型</button></div>
          <div class="cc-table"><div class="cc-tr cc-th"><span>默认</span><span>菜单显示名</span><span>实际请求模型</span><span>单价 ¥</span><span>单位</span><span></span></div>${st.models.map(modelRow).join('') || '<div class="muted small cc-empty">还没有模型：点「获取模型列表」从上游读取，或「添加模型」手动填</div>'}</div>
          <div class="cc-fetched" id="fetched">${fetched.length ? `<span class="small muted">点一下加入映射（${fetched.length} 个）：</span>${fetched.map((id) => `<button type="button" class="chip click ${st.models.some((x) => x.id === id) ? 'on' : ''}" data-add="${esc(id)}">${esc(id)}${prices[id]?.price !== '' && prices[id]?.price != null ? ` · ¥${prices[id].price}/${prices[id].unit}` : ''}</button>`).join('')}` : ''}</div></div>`;
      }
      const on = st.models.filter((x) => x.enabled).length;
      const tabs = [['all', '全部', st.models.length], ...POOL.map(([k, l]) => [k, l, kindCount(k)]), ['other', '其他', kindCount('other')]].filter((t) => t[0] === 'all' || t[2]);
      const rows = st.models.map((x, i) => [x, i]).filter(([x]) => kindMatch(x));
      return `<div class="cc-sec"><div class="cc-sec-h"><b>模型</b><span class="muted small">启用 ${on} / ${st.models.length} 个。类型按名字自动认，认错了可以改；单价用来估算花费（人民币，以账单为准）</span><div class="spacer"></div>
          <button type="button" class="btn sm" id="fm" data-loading="读取中…">${icon('download', 14)}获取模型列表</button>${st.options.protocol !== 'anthropic' ? `<button type="button" class="btn sm ghost" id="fp" data-loading="读取中…">${icon('chart', 14)}读取价格</button>` : ''}<button type="button" class="btn sm ghost" id="am">${icon('plus', 14)}手动添加</button></div>
        ${fetchMsg ? `<div class="cc-tip">${icon('sparkles', 14)}<span>${esc(fetchMsg)}</span></div>` : ''}
        ${st.models.length ? `<div class="mh-bar"><div class="seg">${tabs.map(([k, l, n]) => `<button type="button" data-ef="${k}" class="${kindFilter === k ? 'on' : ''}">${l} ${n}</button>`).join('')}</div><div class="spacer"></div><button type="button" class="btn sm" id="all-on">${icon('check', 13)}${kindFilter === 'all' ? '一键全部启用' : '启用这一类'}</button><button type="button" class="btn sm ghost" id="all-off">${kindFilter === 'all' ? '全部停用' : '停用这一类'}</button></div>` : ''}
        <div class="cc-table hub"><div class="cc-tr hub cc-th"><span>启用</span><span>类型</span><span>显示名</span><span>实际请求模型</span><span>单价 ¥</span><span>单位</span><span></span></div>${rows.map(([x, i]) => modelRow(x, i)).join('') || '<div class="muted small cc-empty">还没有模型：填好地址和 Key 后点「获取模型列表」，全部模型会读出来并分好类</div>'}</div></div>`;
    }

    function draw() {
      const others = v.options.filter((o) => o.key !== urlKey && !(hasModels && o.key === 'model') && !(isHub && ['protocol', 'presetId'].includes(o.key)));
      root.innerHTML = `<div class="cc">
        <div class="cc-logo" aria-hidden="true">${initial(st.name || prefill.title || v.name)}</div>
        ${vendor === 'videocustom' && !c ? `<div class="note-card warn cc-switch"><div><b>用的是一般的中转站？</b>请改用「中转站」：只填地址和 Key，文本、图片、视频模型一次读出来，不用写请求模板。自定义接口只给格式特殊的接口用。</div><button type="button" class="btn sm" id="to-relay">${icon('refresh', 14)}改用中转站</button></div>` : ''}
        <div class="grid g2"><label class="field">名称<input class="input" name="name" value="${esc(st.name)}" placeholder="${isHub ? '例如：aihubx、我的中转站' : ''}"></label><label class="field">备注<input class="input" name="note" value="${esc(st.note)}" placeholder="例如：朋友推荐的中转站 / 公司账号"></label></div>
        ${isHub ? `<div class="field">协议<div class="seg" id="proto"><button type="button" data-v="openai" class="${st.options.protocol !== 'anthropic' ? 'on' : ''}">OpenAI 兼容</button><button type="button" data-v="anthropic" class="${st.options.protocol === 'anthropic' ? 'on' : ''}">Anthropic</button></div><span class="small muted">中转站和大多数国内模型都是 OpenAI 兼容；Claude 官方和 Claude Code 用的端点选 Anthropic</span></div>` : ''}
        ${!isHub && v.link ? `<label class="field">官网链接<div class="cc-inline"><input class="input" value="${esc(v.link)}" readonly><a class="btn sm ghost" href="${esc(v.link)}" target="_blank" rel="noopener">打开 ↗</a></div></label>` : ''}
        ${v.fields.map((f) => `<div class="field"><span>${esc(f.label)}</span><div class="cc-secret"><input class="input" data-cred="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" value="${esc(st.creds[f.key] || '')}" placeholder="${c && f.secret ? '留空则不修改' : ''}">${f.secret ? `<button type="button" class="icon-btn cc-eye" data-eye title="显示 / 隐藏">${icon('eye', 15)}</button>` : ''}</div>${f.secret && keyUrl ? `<a class="cc-sub link-lime" href="${esc(keyUrl)}" target="_blank" rel="noopener">获取 API Key ↗</a>` : ''}</div>`).join('')}
        ${urlKey ? `<div class="field"><div class="row" style="gap:10px"><span>API 请求地址</span><button type="button" class="cc-toggle ${showFull ? 'on' : ''}" id="full">${icon('link', 13)}完整 URL<i></i></button></div>
          <input class="input" data-opt="${urlKey}" value="${esc(st.options[urlKey] || '')}" placeholder="${v.relay ? 'https://你的中转站域名' : ''}">
          ${showFull ? `<div class="cc-preview" id="pv">POST ${esc(preview())}</div>` : ''}
          ${tip ? `<div class="cc-tip">${icon('sparkles', 14)}${esc(tip)}</div>` : ''}</div>` : ''}
        ${hasModels ? modelsSection() : ''}
        <details class="cc-adv"><summary>${icon('chevron', 14)}高级选项</summary><div class="grid g2" style="padding-bottom:14px">
          <label class="field">状态<select class="input" name="enabled"><option value="1" ${st.enabled ? 'selected' : ''}>启用</option><option value="0" ${st.enabled ? '' : 'selected'}>停用</option></select></label>
          ${others.map((o) => `<label class="field">${esc(o.label)}<input class="input" data-opt="${o.key}" ${o.choices?.length ? `list="dl-${o.key}"` : ''} value="${esc(st.options[o.key] ?? '')}">${o.choices?.length ? `<datalist id="dl-${o.key}">${o.choices.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}</label>`).join('')}</div></details>
        <details class="cc-adv" id="raw-box"><summary>${icon('chevron', 14)}原始配置（JSON）</summary><div style="padding-bottom:14px"><textarea class="input cc-raw" id="raw" spellcheck="false">${esc(raw())}</textarea>
          <div class="row" style="margin-top:8px"><button type="button" class="btn sm ghost" id="fmt">${icon('wand', 14)}格式化</button><span class="small muted" id="raw-msg">不含密钥。改完点格式化或点别处，上面的表单会跟着变</span></div></div></details>
        ${v.status === 'pending' ? '<p class="small down">这个厂商还没有开放接口，保存后会记录凭证，接口开放后即可使用；上品请先用「通用 Webhook」。</p>' : ''}
        ${v.status === 'beta' ? '<p class="small muted" style="margin:0">测试版：按官方文档接好，还没用真实密钥跑过。第一次先生成一条短的试试。</p>' : ''}
      </div>`;
      bind();
    }
    // 调用前先 collect() 把表单读进 st，再改 st；这里只重画
    const redraw = () => {
      const open = $$('details', root).map((x) => x.open);
      draw();
      $$('details', root).forEach((x, i) => (x.open = open[i]));
    };
    function bind() {
      $$('[data-eye]', root).forEach((b) => (b.onclick = () => {
        const i = b.parentElement.querySelector('input');
        i.type = i.type === 'password' ? 'text' : 'password';
        b.innerHTML = icon(i.type === 'password' ? 'eye' : 'eyeOff', 15);
      }));
      const full = $('#full', root);
      if (full) full.onclick = () => { collect(); showFull = !showFull; redraw(); };
      $$('#proto button', root).forEach((b) => (b.onclick = () => { collect(); st.options.protocol = b.dataset.v; redraw(); }));
      $$('[data-ef]', root).forEach((b) => (b.onclick = () => { collect(); kindFilter = b.dataset.ef; redraw(); }));
      const setAll = (on) => { collect(); for (const x of st.models) if (kindMatch(x) && (!on || x.kind !== 'other')) x.enabled = on; redraw(); };
      const allOn = $('#all-on', root);
      if (allOn) allOn.onclick = () => setAll(true);
      const allOff = $('#all-off', root);
      if (allOff) allOff.onclick = () => setAll(false);
      root.oninput = (e) => {
        if (e.target.id === 'raw') return;
        collect();
        const pv = $('#pv', root);
        if (pv) pv.textContent = `POST ${preview()}`;
        if (document.activeElement?.id !== 'raw') $('#raw', root).value = raw();
      };
      root.onchange = (e) => {
        if (e.target.matches('[data-m=on]')) e.target.closest('.cc-tr').classList.toggle('on', e.target.checked);
      };
      $$('[data-del]', root).forEach((b) => (b.onclick = () => { collect(); st.models.splice(Number(b.closest('.cc-tr').dataset.i), 1); redraw(); }));
      $$('[data-add]', root).forEach((b) => (b.onclick = () => {
        collect();
        const id = b.dataset.add;
        if (st.models.some((x) => x.id === id)) st.models = st.models.filter((x) => x.id !== id);
        else st.models.push({ label: id, id, price: prices[id]?.price ?? '', unit: prices[id]?.unit || '', note: prices[id]?.note || '' });
        if (!st.models.some((x) => x.id === st.options.model)) st.options.model = st.models[0]?.id || '';
        redraw();
      }));
      const am = $('#am', root);
      if (am) am.onclick = () => {
        collect();
        kindFilter = 'all';
        st.models.push(isHub ? { label: '', id: '', price: '', unit: '', kind: 'text', enabled: true } : { label: '', id: '', price: '', unit: '' });
        draw();
        $$('.cc-tr[data-i] [data-m=id]', root).at(-1)?.focus();
      };
      const body = () => ({ id: c?.id, vendor, apiKey: st.creds.apiKey, baseUrl: urlKey === 'baseUrl' ? st.options.baseUrl : baseOf(st.options[urlKey]), protocol: st.options.protocol, presetId: st.options.presetId });
      const toRelay = $('#to-relay', root);
      if (toRelay) toRelay.onclick = () => {
        collect();
        const url = st.options.submitUrl ? baseOf(st.options.submitUrl) : '';
        m.close();
        connEditor('hub', null, { title: '中转站', creds: { apiKey: st.creds.apiKey }, options: { baseUrl: url, protocol: 'openai', presetId: 'relay' }, note: st.note });
      };
      // 中转站地址只填了域名：离开输入框时自动补 /v1
      const urlInput = urlKey && v.relay ? $(`[data-opt=${urlKey}]`, root) : null;
      if (urlInput) urlInput.onchange = () => {
        const fixed = relayBase(urlInput.value);
        if (fixed === urlInput.value.trim()) return;
        urlInput.value = fixed;
        collect();
        const pv = $('#pv', root);
        if (pv) pv.textContent = `POST ${preview()}`;
        toast('已在地址后面补上 /v1（中转站的接口都在 /v1 下）', 'info');
      };
      const fm = $('#fm', root);
      if (fm) fm.onclick = (e) => withLoading(e.currentTarget, async () => {
        collect();
        if (!isHub) {
          fetched = (await api('/connectors/models', { method: 'POST', body: body() })).models;
          return redraw();
        }
        const r = await api('/connectors/models', { method: 'POST', body: body() });
        if (r.baseUrl && r.baseUrl !== String(st.options.baseUrl || '').trim().replace(/\/+$/, '')) st.options.baseUrl = r.baseUrl;
        let added = 0;
        for (const x of r.models) {
          const old = st.models.find((y) => y.id === x.id);
          if (old) {
            if ((old.price === '' || old.price == null) && x.price !== undefined && x.price !== '') Object.assign(old, { price: x.price, unit: x.unit || '', note: x.note || '' });
            continue;
          }
          // 新读到的先不启用：用的人勾选，或者一键全部启用；一个都没启用时先启用第一个文本模型
          st.models.push({ label: x.id, id: x.id, kind: x.kind, enabled: false, price: x.price ?? '', unit: x.unit || '', note: x.note || '' });
          added++;
        }
        if (!st.models.some((y) => y.enabled)) {
          const t = st.models.find((y) => y.kind === 'text');
          if (t) t.enabled = true;
        }
        const sum = POOL.map(([k, l]) => [l, r.models.filter((x) => (k === 'text' ? x.kind === 'text' : inPool(k, x.kind))).length]).filter(([, n]) => n).map(([l, n]) => `${l} ${n}`).join('、');
        fetchMsg = `读到 ${r.models.length} 个模型${added < r.models.length ? `（新加 ${added} 个）` : ''}，按名字分好了：${sum || '没认出类型'}。勾选要用的，或者点「一键全部启用」。${r.error ? ` ${r.error}` : ''}`;
        kindFilter = 'all';
        redraw();
      });
      const fp = $('#fp', root);
      if (fp) fp.onclick = (e) => withLoading(e.currentTarget, async () => {
        collect();
        prices = (await api('/connectors/pricing', { method: 'POST', body: body() })).prices;
        let n = 0;
        for (const x of st.models) if (prices[x.id] && prices[x.id].price !== '') { x.price = prices[x.id].price; x.unit = prices[x.id].unit; x.note = prices[x.id].note; n++; }
        if (!isHub && !fetched.length) fetched = Object.keys(prices).sort();
        redraw();
        toast(n ? `已填好 ${n} 个模型的单价（中转站价格表，以账单为准）` : isHub ? '读到了价格表，但没对上列表里的模型：先点「获取模型列表」' : '读到了价格表，但映射里的模型都没对上：先从下面的列表加模型', n ? 'success' : 'info');
      });
      const applyRaw = () => {
        const msg = $('#raw-msg', root);
        try {
          const j = JSON.parse($('#raw', root).value);
          if (typeof j.name === 'string') st.name = j.name;
          if (typeof j.note === 'string') st.note = j.note;
          if (typeof j.enabled === 'boolean') st.enabled = j.enabled;
          if (j.options && typeof j.options === 'object') for (const k of Object.keys(st.options)) if (j.options[k] != null) st.options[k] = String(j.options[k]);
          if (hasModels && Array.isArray(j.models)) st.models = j.models.filter((x) => x && x.id).map((x) => ({ label: String(x.label || x.id), id: String(x.id), price: x.price ?? '', unit: x.unit || '', note: x.note || '', ...(isHub ? { kind: d.kinds[x.kind] ? x.kind : 'text', enabled: x.enabled !== false } : {}) }));
          redraw();
        } catch (e) {
          msg.className = 'small down';
          msg.textContent = `JSON 格式不对：${e.message}`;
        }
      };
      $('#fmt', root).onclick = applyRaw;
      $('#raw', root).onchange = applyRaw;
    }
    draw();
    $('#ok', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
      collect();
      st.models = st.models.filter((x) => x.id);
      if (isHub && !st.name) st.name = prefill.title && prefill.title !== '中转站' ? prefill.title : (() => { try { return new URL(st.options.baseUrl).hostname; } catch { return '模型接入'; } })();
      if (isHub && !st.models.some((x) => x.enabled && x.kind !== 'other')) throw new Error('至少启用一个模型：先点「获取模型列表」，再勾选要用的，或者点「一键全部启用」');
      const out = { vendor, name: st.name, note: st.note, enabled: st.enabled, creds: st.creds, options: st.options };
      if (hasModels) {
        out.models = st.models;
        if (!isHub && !st.models.some((x) => x.id === st.options.model)) out.options = { ...st.options, model: st.models[0]?.id || st.options.model };
      }
      if (c) await api(`/connectors/${c.id}`, { method: 'PUT', body: out });
      else await api('/connectors', { method: 'POST', body: out });
      m.close();
      toast(isHub ? '已保存：启用的模型马上就能用，可以点「测试」检查' : '已保存，可以点「测试」检查连接', 'success');
      await reload();
    });
  }

  // ---------- 浏览器插件与 API 令牌 ----------
  async function loadTokens() {
    const { items } = await api('/tokens');
    const box = $('#tokens', view);
    box.innerHTML = `<div class="grid g2" style="align-items:start">
      <div><b>运营台助手（Chrome / Edge 插件）</b>
        <ol class="small" style="padding-left:18px;line-height:1.9;margin:8px 0">
          <li><a href="/extension.zip?v=${Date.now()}" download="tiktok-ops-helper.zip" style="color:var(--lime)">下载插件压缩包</a>，右键「全部解压缩」，得到 <code>tiktok-ops-helper</code> 文件夹（打开能直接看到 manifest.json）；</li>
          <li>浏览器打开 <code>chrome://extensions</code>（Edge 是 <code>edge://extensions</code>），打开右上角「开发者模式」，点左上角<b>「加载未打包的扩展程序」</b>（不是「打包扩展程序」），选这个文件夹；</li>
          <li>点插件图标，填运营台地址 <code>${esc(location.origin)}</code> 和下面生成的令牌；</li>
          <li><b>自动找货</b>：点插件图标选商品 →「关键词搜 / 以图搜」，插件自动打开 1688 搜索或上传主图，采集结果并打开前 3 个详情页补数据，全部送回运营台比价；在商品详情「1688 找货」里点「插件自动搜」效果相同。</li><li><b>FastMoss 当前页</b>：打开 FastMoss 的商品搜索或榜单页，右下角点「发送本页商品到运营台」，不占用每周导出次数。只发你正在看的这一页，翻一页点一次（测试版，第一次用请确认数据对不对）。</li><li>也可以在任意 1688 搜索 / 详情页点右下角「运营台找货 → 发送本页货源」手动发送。</li></ol></div>
      <div><div class="row"><b>API 令牌</b><div class="spacer"></div><button class="btn sm" id="new-token" data-loading="生成中…">${icon('plus', 14)}生成令牌</button></div>
        <div id="new-token-box"></div>
        ${items.length ? `<div class="col" style="margin-top:10px">${items.map((t) => `<div class="row token-row"><code>${esc(t.prefix)}…</code><span>${esc(t.name)}</span><span class="muted small">${t.lastUsedAt ? '最近使用 ' + esc(t.lastUsedAt.slice(0, 16).replace('T', ' ')) : '未使用'}</span><div class="spacer"></div><button class="icon-btn danger" data-revoke="${t.id}" title="作废">${icon('trash', 14)}</button></div>`).join('')}</div>` : '<p class="small muted">还没有令牌</p>'}</div></div>`;
    $('#new-token', box).onclick = (e) => withLoading(e.currentTarget, async () => {
      const t = await api('/tokens', { method: 'POST', body: { name: '浏览器插件' } });
      await loadTokens();
      $('#new-token-box', view).innerHTML = `<div class="pw-box" style="font-size:13px;word-break:break-all">${esc(t.token)}</div><p class="small down" style="margin:6px 0 0">只显示这一次，请马上复制到插件里。</p>`;
    });
    $$('[data-revoke]', box).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('作废这个令牌？用它的插件或程序会立即失效。'))) return;
      await api(`/tokens/${b.dataset.revoke}`, { method: 'DELETE' });
      loadTokens();
    }));
  }

  $('#add', view).onclick = picker;
  $('#save-store', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    await api('/settings', { method: 'PUT', body: { store: Object.fromEntries(new FormData($('#store', view))) } });
    toast('店铺信息已保存', 'success');
  });
  $('#add-conn', view).onclick = connPicker;
  renderAll();
  await loadTokens();
}
