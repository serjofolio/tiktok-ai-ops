import { api, icon, esc, toast, withLoading, $, $$, sparkline } from '../lib.js';
import { STYLES, currentStyle, applyStyle, swatch } from '../styles.js';
import { refreshMode } from '../app.js';

const PRESETS = {
  llm: [
    ['离线演示', { provider: 'mock' }],
    ['DeepSeek', { provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }],
    ['通义千问', { provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' }],
    ['豆包·火山方舟', { provider: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615' }],
    ['Kimi', { provider: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' }],
    ['硅基流动', { provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct' }],
    ['OpenAI', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' }],
    ['Claude', { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' }],
  ],
  embedding: [
    ['本地 BM25', { provider: 'local' }],
    ['OpenAI', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' }],
    ['硅基流动 bge-m3', { provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' }],
    ['通义 Embedding', { provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3' }],
  ],
  image: [
    ['离线演示', { provider: 'mock' }],
    ['火山方舟 Seedream', { provider: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-4-0-250828', size: '1440x2560' }],
    ['OpenAI gpt-image', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', size: '1024x1536' }],
    ['硅基流动 Kolors', { provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors', size: '768x1024' }],
  ],
  video: [
    ['本地合成', { provider: 'mock' }],
    ['火山方舟 Seedance', { provider: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedance-1-0-pro-250528' }],
    ['自定义异步接口', { provider: 'generic' }],
  ],
};

const SECTIONS = [
  ['llm', 'bot', '大语言模型', '驱动智能体对话、选品分析、脚本创作和知识问答。支持所有 OpenAI 兼容接口与 Anthropic Claude。', [['provider', '协议', 'select', ['mock:离线演示', 'openai:OpenAI 兼容', 'anthropic:Anthropic Claude']], ['baseUrl', 'Base URL'], ['apiKey', 'API Key', 'password'], ['model', '模型'], ['temperature', 'Temperature', 'number']]],
  ['embedding', 'layers', '向量模型（RAG）', '用于知识库向量检索；不配置时使用内置 BM25 中文分词检索，同样可用。', [['provider', '协议', 'select', ['local:本地 BM25', 'openai:OpenAI 兼容 Embedding']], ['baseUrl', 'Base URL'], ['apiKey', 'API Key', 'password'], ['model', '模型']]],
  ['image', 'image', '文生图模型', '用于分镜图、商品海报生成，兼容 OpenAI images/generations 接口。', [['provider', '协议', 'select', ['mock:离线演示', 'openai:OpenAI 兼容']], ['baseUrl', 'Base URL'], ['apiKey', 'API Key', 'password'], ['model', '模型'], ['size', '默认尺寸']]],
  ['video', 'video', '图生视频模型', '异步任务模式：提交 → 轮询 → 下载。离线模式下由浏览器本地合成分镜视频。', [['provider', '协议', 'select', ['mock:本地合成', 'ark:火山方舟 Seedance', 'generic:自定义异步接口']], ['baseUrl', 'Base URL'], ['apiKey', 'API Key', 'password'], ['model', '模型'], ['createPath', '创建任务路径', 'text', 'generic'], ['queryPath', '查询路径（{id}）', 'text', 'generic'], ['idField', '任务 ID 字段', 'text', 'generic'], ['statusField', '状态字段', 'text', 'generic'], ['urlField', '视频地址字段', 'text', 'generic']]],
  ['store', 'home', '店铺信息', '用于个性化欢迎语、默认口播语言和发布时间建议。', [['name', '店铺名称'], ['market', '主营站点', 'select', ['US:美国', 'UK:英国', 'SEA:东南亚', 'EU:欧洲', 'MX:墨西哥']], ['language', '默认口播语言', 'select', ['English:English', '中文:中文', 'Español:Español', 'Bahasa Indonesia:Bahasa Indonesia']]]],
];

export async function render(view) {
  const s = await api('/settings');
  view.innerHTML = `<div class="hero mb"><h2 style="font-size:28px">界面风格与<span class="mark">模型接入</span></h2><p style="margin:6px 0 0">所有 Key 仅保存在本机 <code>data/settings.json</code>。未配置时平台以<b>离线演示模式</b>运行，全部流程均可体验。</p></div>
  <div class="section-title" style="margin-top:0"><h3>界面风格</h3><span class="muted small">点击卡片即可切换，也可以在右上角「风格」里随时切换</span></div>
  <div class="style-gallery mb" id="styles">${STYLES.map((st) => `<div class="style-card ${st.key === currentStyle() ? 'on' : ''}" data-style="${st.key}" data-k="${st.key}">
    <div class="row" style="justify-content:space-between"><h4>${esc(st.name)}</h4>${swatch(st)}</div><div class="small text-2">${esc(st.desc)}</div>
    <div class="demo"><div class="row" style="justify-content:space-between"><span class="small muted">7 日 GMV</span><span class="grade grade-S">S</span></div>
      <div class="num">$2.1M</div>${sparkline([3, 4, 3.6, 5, 4.8, 6.2, 7, 6.6, 8.4], { w: 200, h: 34 })}
      <div class="row"><span class="btn sm">启动工作流</span><span class="chip">美妆个护</span></div></div></div>`).join('')}</div>
  <div class="section-title"><h3>模型与服务</h3></div>
  <div class="grid g2">${SECTIONS.map(([k, ic, title, desc, fields]) => `
    <div class="card provider-card" data-sec="${k}">
      <h3>${icon(ic)}${title}</h3><p class="muted small" style="margin:0 0 14px">${desc}</p>
      ${PRESETS[k] ? `<div class="row mb" style="gap:6px">${PRESETS[k].map(([n], i) => `<span class="chip click" data-preset="${i}">${n}</span>`).join('')}</div>` : ''}
      <div class="grid g2">${fields.map(([f, label, type = 'text', extra]) => {
        const val = s[k][f] ?? '';
        const only = typeof extra === 'string' ? `data-only="${extra}"` : '';
        if (f === 'model' && k !== 'store') return `<div class="field model-pick" style="grid-column:1/-1">${label}<div class="row"><input class="input" name="model" value="${esc(val)}" autocomplete="off" placeholder="输入或从上游获取"><button type="button" class="btn sm ghost" data-fetch data-loading="获取中…" style="height:38px">${icon('refresh', 14)}获取模型</button></div><span class="small muted" data-mcount></span></div>`;
        if (type === 'select') return `<label class="field" ${only}>${label}<select class="input" name="${f}">${extra.map((o) => { const [v, t] = o.split(':'); return `<option value="${v}" ${String(val) === v ? 'selected' : ''}>${t}</option>`; }).join('')}</select></label>`;
        return `<label class="field" ${only} ${f === 'baseUrl' ? 'style="grid-column:1/-1"' : ''}>${label}<input class="input" name="${f}" type="${type}" ${type === 'number' ? 'step="0.1" min="0" max="2"' : ''} value="${esc(val)}" autocomplete="off"></label>`;
      }).join('')}</div>
      <div class="row mt">${['llm', 'image', 'embedding'].includes(k) ? `<button class="btn sm ghost" data-test="${k}" data-loading="测试中…">${icon('zap', 14)}测试连接</button>` : ''}<span class="small muted" data-result></span><div class="spacer"></div><button class="btn sm" data-save data-loading="保存中…">${icon('check', 14)}保存</button></div>
    </div>`).join('')}
    <div class="card provider-card"><h3>${icon('link')}开放接口</h3><p class="muted small" style="margin:0 0 12px">本平台的选品、脚本、生图、视频、知识库能力可作为工具被外部 Agent 调用：</p>
      <div class="code">GET  ${location.origin}/api/tools
POST ${location.origin}/api/tools/{name}</div><a class="btn sm ghost mt" href="#/agents">${icon('bot', 14)}前往智能体页面查看文档</a></div>
  </div>`;

  $$('#styles .style-card', view).forEach((c) => (c.onclick = (e) => applyStyle(c.dataset.k, e)));
  const onStyle = () => $$('#styles .style-card', view).forEach((c) => c.classList.toggle('on', c.dataset.k === currentStyle()));
  window.addEventListener('stylechange', onStyle);

  $$('[data-sec]', view).forEach((card) => {
    const k = card.dataset.sec;
    const sync = () => {
      const p = card.querySelector('[name=provider]')?.value;
      $$('[data-only]', card).forEach((el) => (el.style.display = el.dataset.only === p ? '' : 'none'));
      $$('.field', card).forEach((el) => {
        const n = el.querySelector('[name]')?.name;
        if (n && n !== 'provider' && ['mock', 'local'].includes(p) && k !== 'store') el.style.display = 'none';
        else if (!el.dataset.only) el.style.display = '';
      });
    };
    card.querySelector('[name=provider]')?.addEventListener('change', sync);
    sync();
    $$('[data-preset]', card).forEach((chip) => (chip.onclick = () => {
      const [, preset] = PRESETS[k][chip.dataset.preset];
      for (const [f, v] of Object.entries(preset)) { const el = card.querySelector(`[name=${f}]`); if (el) el.value = v; }
      $$('[data-preset]', card).forEach((c) => c.classList.toggle('on', c === chip));
      sync();
      models = [];
      if (hasKey()) fetchModels(true);
    }));
    // ---------- 模型列表：从上游 /models 自动获取，输入即筛选 ----------
    let models = [];
    const pick = card.querySelector('.model-pick');
    const hasKey = () => !!card.querySelector('[name=apiKey]')?.value.trim() && !['mock', 'local'].includes(card.querySelector('[name=provider]')?.value);
    const closeMenu = () => pick?.querySelector('.model-menu')?.remove();
    const openMenu = (filter = false) => {
      if (!pick || !models.length) return;
      closeMenu();
      const input = pick.querySelector('[name=model]');
      // 点击/聚焦时展示全部，输入时才按关键词筛选
      const q = filter ? input.value.trim().toLowerCase() : '';
      const shown = models.filter((m) => !q || m.id.toLowerCase().includes(q)).slice(0, 200);
      const menu = document.createElement('div');
      menu.className = 'model-menu';
      menu.innerHTML = (shown.length ? shown.map((m) => `<button type="button" data-id="${esc(m.id)}" class="${m.id === input.value ? 'on' : ''}"><span>${esc(m.id)}</span>${m.match ? '' : '<span class="muted">其他用途</span>'}</button>`).join('') : '<div class="hint">没有匹配的模型，可直接输入模型名</div>');
      menu.onmousedown = (e) => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        e.preventDefault();
        input.value = b.dataset.id;
        closeMenu();
      };
      pick.appendChild(menu);
      menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };
    const fetchModels = async (auto) => {
      if (!pick) return;
      const tip = pick.querySelector('[data-mcount]');
      const body = collect()[k];
      tip.textContent = '正在从上游获取模型列表…';
      try {
        const r = await api(`/settings/models/${k}`, { method: 'POST', body });
        models = r.models;
        const matched = models.filter((m) => m.match).length;
        tip.innerHTML = models.length ? `已从上游获取 <b>${models.length}</b> 个模型，其中 ${matched} 个适用于此用途` : '上游未返回模型';
        if (!auto) openMenu();
      } catch (err) {
        models = [];
        tip.innerHTML = `<span class="down">获取失败：${esc(err.message.slice(0, 80))}</span>，可直接手动输入模型名`;
        if (!auto) throw err;
      }
    };
    if (pick) {
      const input = pick.querySelector('[name=model]');
      input.addEventListener('focus', () => openMenu());
      input.addEventListener('input', () => openMenu(true));
      input.addEventListener('blur', () => setTimeout(closeMenu, 120));
      input.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
      pick.querySelector('[data-fetch]').onclick = (e) => withLoading(e.currentTarget, () => fetchModels(false));
      card.querySelector('[name=apiKey]')?.addEventListener('change', () => hasKey() && fetchModels(true));
      card.querySelector('[name=baseUrl]')?.addEventListener('change', () => hasKey() && fetchModels(true));
      if (hasKey()) setTimeout(() => fetchModels(true));
    }
    const collect = () => {
      const body = {};
      $$('[name]', card).forEach((el) => (body[el.name] = el.type === 'number' ? Number(el.value) : el.value.trim()));
      return { [k]: body };
    };
    card.querySelector('[data-save]').onclick = (e) => withLoading(e.currentTarget, async () => {
      await api('/settings', { method: 'PUT', body: collect() });
      toast('配置已保存', 'success');
      refreshMode();
    });
    const t = card.querySelector('[data-test]');
    if (t) t.onclick = (e) => withLoading(e.currentTarget, async () => {
      const res = card.querySelector('[data-result]');
      res.textContent = '';
      await api('/settings', { method: 'PUT', body: collect() });
      refreshMode();
      try {
        const r = await api(`/settings/test/${k}`, { method: 'POST' });
        res.innerHTML = `<span class="up">${icon('check', 13)} ${esc(String(r.message).slice(0, 60))}（${r.ms}ms）</span>`;
      } catch (err) {
        res.innerHTML = `<span class="down">${icon('x', 13)} ${esc(err.message.slice(0, 80))}</span>`;
      }
    });
  });
  return () => window.removeEventListener('stylechange', onStyle);
}
