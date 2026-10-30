// 接入配置：模型供应商管理（类似 CC Switch：添加 / 编辑 / 删除 / 一键启用 / 测试），数据源与店铺信息
import { api, icon, esc, toast, withLoading, $, $$, modal, confirmBox } from '../lib.js';

const initial = (name) => esc((String(name || '?').match(/[一-龥]|[A-Za-z0-9]/) || ['?'])[0].toUpperCase());

export async function render(view) {
  let d = await api('/providers');
  const changed = () => window.dispatchEvent(new Event('providerschange'));

  view.innerHTML = `
  <section class="page-hero">
    <div class="kicker">接入配置 · API</div>
    <h2>接入你的<em>大模型</em>，一键切换</h2>
    <p>添加多个模型供应商，点「启用」即可切换整个平台（选品分析、视频脚本、Agent）使用的模型。密钥只保存在你自己的服务器上，页面只显示脱敏后的值。</p>
    <div class="actions"><button class="btn lg primary-glow" id="add">${icon('plus')}添加供应商</button></div>
  </section>
  <div class="section-title" style="margin-top:0"><h3>模型供应商</h3><span class="muted small" id="pcount"></span></div>
  <div class="col" id="plist"></div>

  <div class="section-title"><h3>数据源接口</h3><span class="muted small">审批通过后填写；目前选品通过导入 FastMoss 导出文件完成</span></div>
  <div class="grid g2" id="sources"></div>

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

  function renderSources() {
    const s = d.dataSources;
    const card = (key, title, desc, fields, link) => {
      const filled = fields.some(([f]) => s[key][f]);
      return `<div class="card card-pad" data-src="${key}"><div class="row"><h3 style="font-size:15px">${title}</h3><span class="verdict ${filled ? 'v-go' : 'v-na'}">${filled ? '已填写' : '待申请'}</span><div class="spacer"></div><a class="small" href="${link}" target="_blank" rel="noopener" style="color:var(--lime)">申请入口 ↗</a></div>
        <p class="small muted">${desc}</p><div class="grid g2">${fields.map(([f, l]) => `<label class="field">${l}<input class="input" name="${f}" type="password" value="${esc(s[key][f] || '')}" autocomplete="off"></label>`).join('')}</div>
        <div class="row mt" style="justify-content:flex-end"><button class="btn sm ghost" data-save data-loading="保存中…">保存</button></div></div>`;
    };
    $('#sources', view).innerHTML =
      card('fastmoss', 'FastMoss 开放接口', '审批通过后自动拉取商品榜单与详情，替代手动导出。', [['apiKey', 'API Key'], ['apiSecret', 'API Secret']], 'https://www.fastmoss.com/') +
      card('ali1688', '1688 开放平台', '审批通过后自动按商品搜同款货源和采购价，填入利润测算。', [['appKey', 'AppKey'], ['appSecret', 'AppSecret']], 'https://open.1688.com/');
    $$('[data-src]', view).forEach((c) => (c.querySelector('[data-save]').onclick = (e) => withLoading(e.currentTarget, async () => {
      const vals = Object.fromEntries([...c.querySelectorAll('[name]')].map((i) => [i.name, i.value.trim()]));
      const v = await api('/settings', { method: 'PUT', body: { dataSources: { [c.dataset.src]: vals } } });
      d.dataSources = v.dataSources;
      renderSources();
      toast('已保存', 'success');
    })));
  }

  $('#add', view).onclick = () => editor();
  $('#save-store', view).onclick = (e) => withLoading(e.currentTarget, async () => {
    await api('/settings', { method: 'PUT', body: { store: Object.fromEntries(new FormData($('#store', view))) } });
    toast('店铺信息已保存', 'success');
  });
  renderList();
  renderSources();
}
