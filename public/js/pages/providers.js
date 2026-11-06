// 接入配置：模型供应商管理（类似 CC Switch：添加 / 编辑 / 删除 / 一键启用 / 测试），数据源与店铺信息
import { api, icon, esc, toast, withLoading, $, $$, modal, confirmBox } from '../lib.js';

const initial = (name) => esc((String(name || '?').match(/[一-龥]|[A-Za-z0-9]/) || ['?'])[0].toUpperCase());

export async function render(view) {
  let d = await api('/providers');
  const changed = () => window.dispatchEvent(new Event('providerschange'));

  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">接入配置 · API</div>
    <h2>接入<em>大模型</em>和视频模型</h2>
    <p>添加多个模型供应商，点「启用」即可切换整个平台（选品分析、视频脚本、Agent）使用的模型。在下面的「视频模型」接入后，脚本可以直接生成视频。页面只显示脱敏后的密钥。</p>
    <div class="actions"><button class="btn lg primary-glow" id="add">${icon('plus')}添加供应商</button></div>
  </section>
  <div class="section-title" style="margin-top:0"><h3>模型供应商</h3><span class="muted small" id="pcount"></span></div>
  <div class="col" id="plist"></div>

  <div class="section-title section-wrap"><h3>视频模型</h3><span class="muted small">从脚本直接生成视频；拆解爆款时看画面、听口播</span><div class="spacer"></div><button class="btn sm" id="add-media">${icon('plus', 14)}添加模型</button></div>
  <div id="media-conns"></div>

  <div class="section-title"><h3>数据源与 ERP</h3><span class="muted small">FastMoss 选品数据 → 1688 找货 → ERP 上品；接口没申请下来的环节，用浏览器插件或通用 Webhook 兜底</span><div class="spacer"></div><button class="btn sm" id="add-conn">${icon('plus', 14)}添加连接</button></div>
  <div id="conns"></div>
  <div class="section-title"><h3>浏览器插件与 API 令牌</h3><span class="muted small">插件在你自己登录的 1688 和 FastMoss 页面发送数据；n8n、影刀等程序也用令牌调用运营台接口</span></div>
  <div class="card card-pad" id="tokens"></div>

  <div class="section-title"><h3>店铺信息</h3><span class="muted small">影响脚本默认语言和分析时的目标市场</span></div>
  <div class="card card-pad"><form class="grid g3" id="store">
    <label class="field">店铺名称<input class="input" name="name" value="${esc(d.store.name)}"></label>
    <label class="field">主营站点<select class="input" name="market">${['US:美国', 'UK:英国', 'SEA:东南亚', 'EU:欧洲', 'MX:墨西哥', 'JP:日本'].map((o) => { const [v, t] = o.split(':'); return `<option value="${v}" ${d.store.market === v ? 'selected' : ''}>${t}</option>`; }).join('')}</select></label>
    <label class="field">脚本默认语言<select class="input" name="language">${['English', '中文', 'Español', 'Bahasa Indonesia', 'ภาษาไทย', 'Tiếng Việt', '日本語'].map((v) => `<option ${d.store.language === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  </form><div class="row mt" style="justify-content:flex-end"><button class="btn sm" id="save-store" data-loading="保存中…">${icon('check', 14)}保存</button></div></div>`;

  function renderList() {
    const box = $('#plist', view);
    $('#pcount', view).textContent = `${d.items.length} 个`;
    if (!d.items.length) {
      box.innerHTML = `<div class="card card-pad empty"><p>还没有接入任何模型。点击「添加供应商」，选择智谱 GLM 等预设，填入 API Key 即可。</p><button class="btn" id="add2">${icon('plus', 15)}添加第一个供应商</button></div>`;
      $('#add2', box).onclick = () => editor();
      return;
    }
    box.innerHTML = d.items.map((p) => {
      const on = p.id === d.activeId;
      return `<div class="card provider-item ${on ? 'on' : ''}" data-id="${p.id}">
        <div class="pv-avatar">${initial(p.name)}</div>
        <div class="pv-main"><div class="row" style="gap:8px"><b>${esc(p.name)}</b>${on ? '<span class="verdict v-go">当前使用</span>' : ''}<span class="chip">${p.protocol === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 兼容'}</span><span class="chip">${esc(p.model || '未选模型')}</span></div>
          <div class="pv-url">${esc(p.baseUrl)}</div><div class="small muted" data-result></div></div>
        <div class="pv-actions">
          ${on ? '' : `<button class="btn sm" data-act="use">${icon('zap', 14)}启用</button>`}
          <button class="btn sm ghost" data-act="test" data-loading="测试中…">${icon('refresh', 14)}测试</button>
          <button class="icon-btn" data-act="edit" title="编辑">${icon('settings', 15)}</button>
          <button class="icon-btn danger" data-act="del" title="删除">${icon('trash', 15)}</button>
        </div></div>`;
    }).join('');
    $$('.provider-item', box).forEach((el) => {
      const p = d.items.find((x) => x.id === el.dataset.id);
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'use') {
          await api(`/providers/${p.id}/activate`, { method: 'POST' });
          d.activeId = p.id;
          renderList();
          changed();
          toast(`已切换到 ${p.name}`, 'success');
        } else if (act === 'test') {
          withLoading(b, async () => {
            const out = $('[data-result]', el);
            try {
              const r = await api(`/providers/${p.id}/test`, { method: 'POST' });
              out.innerHTML = `<span class="up">${icon('check', 13)} ${esc(r.text)} · ${r.ms}ms</span>`;
            } catch (err) {
              out.innerHTML = `<span class="down">${icon('x', 13)} ${esc(err.message)}</span>`;
            }
          });
        } else if (act === 'edit') editor(p);
        else if (act === 'del') {
          if (!(await confirmBox(`确定删除「${p.name}」？`))) return;
          await api(`/providers/${p.id}`, { method: 'DELETE' });
          d = await api('/providers');
          renderList();
          changed();
        }
      });
    });
  }

  // 添加 / 编辑：先选预设，再填写
  function editor(p) {
    const isNew = !p;
    let form = p ? { ...p } : null;
    const m = modal({ title: isNew ? '添加供应商' : `编辑 ${esc(p.name)}`, wide: true, body: '<div id="ed"></div>' });
    const root = $('#ed', m.el);
    const pickPreset = () => {
      root.innerHTML = `<p class="muted small" style="margin-top:0">选择一个预设，地址和协议会自动填好；你只需要填 API Key。</p>
        <div class="preset-cards">${d.presets.map((x) => `<button class="preset-card" data-id="${x.id}"><b>${esc(x.name)}</b><span>${x.protocol === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 兼容'}</span><small>${esc(x.tip || x.baseUrl || '自己填写地址')}</small></button>`).join('')}</div>`;
      $$('.preset-card', root).forEach((b) => (b.onclick = () => {
        const x = d.presets.find((y) => y.id === b.dataset.id);
        form = { presetId: x.id, name: x.id === 'custom' ? '' : x.name, protocol: x.protocol, baseUrl: x.baseUrl, apiKey: '', model: x.models[0] || '', website: x.website, temperature: 0.7 };
        fill();
      }));
    };
    const fill = () => {
      const preset = d.presets.find((x) => x.id === form.presetId);
      root.innerHTML = `<form class="col" id="pf" autocomplete="off">
        <div class="grid g2"><label class="field">名称<input class="input" name="name" value="${esc(form.name || '')}" placeholder="例如：智谱 GLM 编码套餐"></label>
        <div class="field">协议<div class="seg" id="proto"><button type="button" data-v="openai" class="${form.protocol !== 'anthropic' ? 'on' : ''}">OpenAI 兼容</button><button type="button" data-v="anthropic" class="${form.protocol === 'anthropic' ? 'on' : ''}">Anthropic</button></div></div></div>
        <label class="field">Base URL<input class="input" name="baseUrl" value="${esc(form.baseUrl || '')}" placeholder="https://open.bigmodel.cn/api/paas/v4"></label>
        <label class="field">API Key ${form.website ? `<a class="small" href="${esc(form.website)}" target="_blank" rel="noopener" style="color:var(--lime)">去获取 Key ↗</a>` : ''}<input class="input" name="apiKey" type="password" value="" placeholder="${p?.hasKey ? '已保存（留空则不修改）' : '粘贴 API Key'}"></label>
        <div class="field">模型<div class="row" style="flex-wrap:nowrap"><input class="input" name="model" value="${esc(form.model || '')}" placeholder="例如 glm-4.6"><button type="button" class="btn sm ghost" id="fetch" data-loading="获取中…" style="height:38px">${icon('refresh', 14)}获取模型</button></div>
          <div class="model-chips" id="models">${(preset?.models || []).map((x) => `<button type="button" class="chip click ${x === form.model ? 'on' : ''}" data-m="${esc(x)}">${esc(x)}</button>`).join('')}</div><span class="small muted" id="mtip">${preset?.models?.length ? '预设常用模型，点「获取模型」可从上游拉取完整列表' : ''}</span></div>
        <p class="small muted" style="margin:0">${form.protocol === 'anthropic' ? 'Anthropic 协议会自动请求 {Base URL}/v1/messages，地址末尾不用写 /v1。' : 'OpenAI 兼容协议会请求 {Base URL}/chat/completions。'}</p>
      </form>`;
      const f = $('#pf', root);
      const read = () => Object.assign(form, Object.fromEntries(new FormData(f)));
      $$('#proto button', root).forEach((b) => (b.onclick = () => { read(); form.protocol = b.dataset.v; fill(); }));
      const bindChips = () => $$('#models [data-m]', root).forEach((c) => (c.onclick = () => { f.model.value = c.dataset.m; $$('#models [data-m]', root).forEach((x) => x.classList.toggle('on', x === c)); }));
      bindChips();
      $('#fetch', root).onclick = (e) => withLoading(e.currentTarget, async () => {
        read();
        const r = await api('/providers/models', { method: 'POST', body: { id: p?.id, protocol: form.protocol, baseUrl: form.baseUrl, apiKey: form.apiKey, presetId: form.presetId } });
        $('#models', root).innerHTML = r.models.map((x) => `<button type="button" class="chip click ${x.id === f.model.value ? 'on' : ''}" data-m="${esc(x.id)}">${esc(x.id)}</button>`).join('');
        $('#mtip', root).textContent = r.error || `已从上游获取 ${r.models.length} 个模型`;
        bindChips();
      });
      m.el.querySelector('.modal-foot')?.remove();
      m.el.querySelector('.modal').insertAdjacentHTML('beforeend', `<div class="modal-foot">${isNew ? '<button class="btn ghost" id="back">重新选预设</button><div class="spacer"></div>' : ''}<button class="btn ghost" data-close>取消</button><button class="btn" id="save" data-loading="保存中…">${icon('check', 15)}保存${isNew ? '并启用' : ''}</button></div>`);
      const back = $('#back', m.el);
      if (back) back.onclick = () => { m.el.querySelector('.modal-foot').remove(); pickPreset(); };
      $('#save', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
        read();
        if (!form.name) throw new Error('请填写名称');
        if (!form.baseUrl) throw new Error('请填写 Base URL');
        if (isNew && !form.apiKey) throw new Error('请填写 API Key');
        if (!form.model) throw new Error('请选择或填写模型');
        const body = { name: form.name, protocol: form.protocol, baseUrl: form.baseUrl, model: form.model, presetId: form.presetId, website: form.website };
        if (form.apiKey) body.apiKey = form.apiKey;
        const saved = isNew ? await api('/providers', { method: 'POST', body }) : await api(`/providers/${p.id}`, { method: 'PUT', body });
        if (isNew) await api(`/providers/${saved.id}/activate`, { method: 'POST' });
        d = await api('/providers');
        renderList();
        changed();
        m.close();
        toast(isNew ? `已添加并启用 ${saved.name}` : '已保存', 'success');
      });
    };
    if (isNew) pickPreset();
    else fill();
  }

  // ---------- 数据源与 ERP 连接器 ----------
  const KIND = { product: ['选品数据', 'target'], sourcing: ['1688 找货', 'search'], erp: ['ERP 上品', 'upload'] };
  const MEDIA_KIND = { video: ['生成视频', 'video', '接入后，脚本页点「生成视频」就能直接出片。没有接入时其他功能不受影响'], vision: ['看画面', 'image', '拆解爆款视频时用。不接也行：当前大模型能看图时会直接用它'], asr: ['听口播', 'file', '拆解爆款视频时把口播转成文字。不接时只能从字幕读'] };
  const STATUS = { ready: ['可用', 'v-go'], beta: ['测试版', 'v-watch'], pending: ['待开放接口', 'v-na'] };
  let conn = { catalog: {}, items: [] };
  async function loadConns() {
    conn = await api('/connectors');
    renderConns();
  }
  function renderConns() {
    const box = $('#conns', view);
    drawGroups($('#media-conns', view), MEDIA_KIND, (k) => MEDIA_KIND[k][2]);
    box.innerHTML = Object.entries(KIND).map(([k, [label, ic]]) => {
      const items = conn.items.filter((c) => c.kind === k);
      const builtin = Object.entries(conn.catalog).filter(([, v]) => v.kind === k && v.builtin);
      return `<div class="conn-group"><div class="conn-head">${icon(ic, 16)}<b>${label}</b><span class="muted small">${k === 'product' ? 'FastMoss 接口开通前：在「智能选品」导入导出文件' : k === 'sourcing' ? '官方 API / 第三方数据接口 / 浏览器插件，三选一即可' : '妙手 ERP、其他 ERP，或通用 Webhook 接 n8n / 影刀'}</span></div>
        <div class="conn-list">${items.map((c) => { const st = STATUS[c.status] || STATUS.pending; return `<div class="conn ${c.enabled === false ? 'off' : ''}" data-id="${c.id}"><div class="conn-ic">${initial(c.name)}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted small">${esc(conn.catalog[c.vendor]?.name || c.vendor)} · <span class="verdict ${st[1]}" style="padding:1px 8px;font-size:11px">${st[0]}</span> ${c.configured ? '' : '<span class="down small">凭证未填完整</span>'}</div><div class="small muted" data-result></div></div>
            <button class="btn sm ghost" data-act="test" data-loading="测试中…">测试</button><button class="btn sm ghost" data-act="edit">编辑</button><button class="icon-btn danger" data-act="del">${icon('trash', 14)}</button></div>`; }).join('')}
          ${builtin.map(([key, v]) => `<div class="conn builtin"><div class="conn-ic">${icon('link', 15)}</div><div style="flex:1"><b>${esc(v.name)}</b><div class="muted small">${esc(v.desc)}</div></div><a class="btn sm ghost" href="#tokens-anchor" data-goto-tokens>设置插件</a></div>`).join('')}
          ${!items.length && !builtin.length ? `<div class="conn empty-conn muted small">还没有添加，点右上角「添加连接」</div>` : ''}</div></div>`;
    }).join('');
    bindConns(box);
    $$('[data-goto-tokens]', box).forEach((a) => (a.onclick = (e) => { e.preventDefault(); $('#tokens', view).scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  }

  function bindConns(box) {
    $$('.conn[data-id]', box).forEach((el) => {
      const c = conn.items.find((x) => x.id === el.dataset.id);
      el.querySelector('[data-act=edit]').onclick = () => connEditor(c.vendor, c);
      el.querySelector('[data-act=del]').onclick = async () => {
        if (!(await confirmBox(`删除连接「${c.name}」？`))) return;
        await api(`/connectors/${c.id}`, { method: 'DELETE' });
        loadConns();
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
  }

  // 视频模型分组
  function drawGroups(box, kinds, hint) {
    box.innerHTML = Object.entries(kinds).map(([k, [label, ic]]) => {
      const items = conn.items.filter((c) => c.kind === k);
      return `<div class="conn-group"><div class="conn-head">${icon(ic, 16)}<b>${label}</b><span class="muted small">${esc(hint(k))}</span></div>
        <div class="conn-list">${items.map((c) => { const st = STATUS[c.status] || STATUS.pending; return `<div class="conn ${c.enabled === false ? 'off' : ''}" data-id="${c.id}"><div class="conn-ic">${initial(c.name)}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted small">${esc(c.options?.model || conn.catalog[c.vendor]?.name || '')}</div><div class="small" data-result></div></div><span class="verdict ${st[1]}" style="font-size:11px">${st[0]}</span><button class="btn sm ghost" data-act="test" data-loading="测试中…">测试</button><button class="btn sm ghost" data-act="edit">编辑</button><button class="icon-btn danger" data-act="del">${icon('trash', 14)}</button></div>`; }).join('')}${items.length ? '' : `<div class="conn empty-conn muted small">还没有添加</div>`}</div></div>`;
    }).join('');
    bindConns(box);
  }

  function mediaPicker() {
    const m = modal({
      title: '添加模型', wide: true,
      body: `<p class="small muted" style="margin-top:0">视频模型按生成的秒数或条数收费，费用在你自己的模型账号里扣。标着「测试版」的是按官方文档接好、还没用真实密钥跑过的，第一次用先生成一条短的试试。</p>${Object.entries(MEDIA_KIND).map(([k, [label]]) => `<h4 class="rp-h" style="margin-top:6px">${label}</h4><div class="preset-grid conn-pick">${Object.entries(conn.catalog).filter(([, v]) => v.kind === k).map(([key, v]) => { const st = STATUS[v.status]; return `<div class="preset-card" data-v="${key}"><div class="row" style="justify-content:space-between"><b>${esc(v.name)}</b><span class="verdict ${st[1]}" style="font-size:10px">${st[0]}</span></div><small>${esc(v.desc)}</small></div>`; }).join('')}</div>`).join('')}`,
      onMount(el, close) {
        $$('[data-v]', el).forEach((c) => (c.onclick = () => { close(); connEditor(c.dataset.v); }));
      },
    });
    return m;
  }

  function connPicker() {
    const m = modal({
      title: '添加连接', wide: true,
      body: Object.entries(KIND).map(([k, [label]]) => `<h4 class="rp-h" style="margin-top:6px">${label}</h4><div class="preset-grid conn-pick">${Object.entries(conn.catalog).filter(([, v]) => v.kind === k && !v.builtin).map(([key, v]) => { const st = STATUS[v.status]; return `<div class="preset-card" data-v="${key}"><div class="row" style="gap:8px"><b>${esc(v.name)}</b><span class="verdict ${st[1]}" style="padding:1px 8px;font-size:11px">${st[0]}</span></div><p class="small muted" style="margin:6px 0 0">${esc(v.desc)}</p></div>`; }).join('')}</div>`).join(''),
      onMount(el, close) {
        $$('[data-v]', el).forEach((c) => (c.onclick = () => { close(); connEditor(c.dataset.v); }));
      },
    });
    return m;
  }

  function connEditor(vendor, c) {
    const v = conn.catalog[vendor];
    modal({
      title: `${c ? '编辑' : '添加'}：${esc(v.name)}`, wide: true,
      body: `<p class="small muted" style="margin-top:0">${esc(v.desc)} ${v.link ? `<a href="${esc(v.link)}" target="_blank" rel="noopener" style="color:var(--lime)">申请入口 ↗</a>` : ''}</p>
        <form class="grid g2" id="cf"><label class="field">名称<input class="input" name="name" value="${esc(c?.name || v.name)}"></label><label class="field">状态<select class="input" name="enabled"><option value="1" ${c?.enabled !== false ? 'selected' : ''}>启用</option><option value="0" ${c?.enabled === false ? 'selected' : ''}>停用</option></select></label>
          ${v.fields.map((f) => `<label class="field">${esc(f.label)}<input class="input" data-cred="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" value="${esc(c?.creds?.[f.key] || '')}" placeholder="${c && f.secret ? '留空则不修改' : ''}"></label>`).join('')}
          ${v.options.map((o) => `<label class="field">${esc(o.label)}<input class="input" data-opt="${o.key}" ${o.choices?.length ? `list="dl-${o.key}"` : ''} value="${esc(c?.options?.[o.key] ?? o.default ?? '')}">${o.choices?.length ? `<datalist id="dl-${o.key}">${o.choices.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}</label>`).join('')}</form>
        ${v.status === 'pending' ? '<p class="small down">这个厂商还没有开放接口，保存后会记录凭证，接口开放后即可使用；上品请先用「通用 Webhook」。</p>' : ''}`,
      footer: `<button class="btn ghost" data-close>取消</button><button class="btn" id="ok" data-loading="保存中…">保存</button>`,
      onMount(el, close) {
        $('#ok', el).onclick = (e) => withLoading(e.currentTarget, async () => {
          const body = { vendor, name: $('[name=name]', el).value, enabled: $('[name=enabled]', el).value === '1', creds: Object.fromEntries($$('[data-cred]', el).map((i) => [i.dataset.cred, i.value])), options: Object.fromEntries($$('[data-opt]', el).map((i) => [i.dataset.opt, i.value])) };
          if (c) await api(`/connectors/${c.id}`, { method: 'PUT', body });
          else await api('/connectors', { method: 'POST', body });
          close();
          toast('已保存，可以点「测试」检查连接', 'success');
          loadConns();
        });
      },
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

  $('#add', view).onclick = () => editor();
  $('#save-store', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    await api('/settings', { method: 'PUT', body: { store: Object.fromEntries(new FormData($('#store', view))) } });
    toast('店铺信息已保存', 'success');
  });
  $('#add-conn', view).onclick = connPicker;
  $('#add-media', view).onclick = mediaPicker;
  renderList();
  await Promise.all([loadConns(), loadTokens()]);
}
