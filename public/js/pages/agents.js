import { api, icon, esc, toast, withLoading, $, $$, md, modal, confirmBox, timeAgo, copy } from '../lib.js';

// 智能体头像：取名称首字（英文取首字母）
const ini = (a) => esc((String(a?.name || '?').match(/[\u4e00-\u9fa5]|[A-Za-z]/) || ['?'])[0].toUpperCase());

const SUGGEST = ['推荐 5 个宠物类潜力爆品', '分析评分最高的美妆商品', '给厨房类爆品写一个开箱脚本', '为最火的家居商品生成一张海报图', 'TikTok Shop 有哪些违规风险？', '启动一键全流程工作流'];

export async function render(view, [agentId]) {
  const [{ items: agents, tools }, { items: kbs }] = await Promise.all([api('/agents'), api('/kbs')]);
  let agent = agents.find((a) => a.id === agentId) || agents[0];
  let session = null;
  let busy = false;

  view.innerHTML = `<div class="chat-layout">
    <div class="card agent-list">
      <div class="card-head"><h3>${icon('bot')}智能体</h3><div class="spacer"></div><button class="btn sm" id="new-agent">${icon('plus', 14)}新建</button></div>
      <div id="agents" style="padding:8px"></div>
      <div class="card-head" style="border-top:1px solid var(--line)"><h3 class="small">历史会话</h3><div class="spacer"></div><button class="icon-btn" id="new-sess" title="新对话">${icon('plus', 15)}</button></div>
      <div id="sessions" style="padding:8px;flex:1"></div>
      <div style="padding:12px;border-top:1px solid var(--line)"><button class="btn sm ghost block" id="api-doc">${icon('link', 14)}外部 Agent 接入（工具 API）</button></div>
    </div>
    <div class="card chat">
      <div class="card-head" id="chat-head"></div>
      <div class="chat-msgs" id="msgs"></div>
      <div class="suggests" id="sug"></div>
      <div class="chat-input"><textarea class="input" id="inp" placeholder="向智能体描述你的任务，Enter 发送，Shift+Enter 换行"></textarea><button class="btn lg" id="send">${icon('send', 16)}发送</button></div>
    </div>
  </div>`;

  function renderAgents() {
    $('#agents', view).innerHTML = agents.map((a) => `<div class="agent-item ${a.id === agent?.id ? 'on' : ''}" data-id="${a.id}"><div class="avatar">${ini(a)}</div><div style="min-width:0;flex:1"><b>${esc(a.name)}</b><div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.type === 'external' ? '外部智能体' : esc(a.role)}</div></div></div>`).join('');
    $$('#agents .agent-item', view).forEach((el) => (el.onclick = () => { agent = agents.find((a) => a.id === el.dataset.id); session = null; history.replaceState(null, '', `#/agents/${agent.id}`); renderAgents(); loadSessions(); }));
  }

  async function loadSessions() {
    renderHead();
    const { items } = await api(`/agents/${agent.id}/sessions`);
    $('#sessions', view).innerHTML = items.length
      ? items.map((s) => `<div class="list-item ${s.id === session?.id ? 'on' : ''}" data-id="${s.id}" style="padding:8px 10px"><div style="flex:1;min-width:0"><div class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</div><span class="muted" style="font-size:11px">${timeAgo(s.updatedAt || s.createdAt)}</span></div><button class="icon-btn danger" data-del="${s.id}" style="width:26px;height:26px">${icon('trash', 13)}</button></div>`).join('')
      : '<p class="muted small" style="padding:6px 10px;margin:0">暂无会话</p>';
    $$('#sessions .list-item', view).forEach((el) => (el.onclick = async (e) => {
      if (e.target.closest('[data-del]')) {
        if (!(await confirmBox('删除该会话？'))) return;
        await api(`/sessions/${el.dataset.id}`, { method: 'DELETE' });
        if (session?.id === el.dataset.id) session = null;
        loadSessions();
        return;
      }
      session = await api(`/sessions/${el.dataset.id}`);
      loadSessions();
    }));
    renderMsgs();
  }

  function renderHead() {
    $('#chat-head', view).innerHTML = `<div class="avatar">${ini(agent)}</div><div style="min-width:0"><h3>${esc(agent.name)}</h3><div class="muted small">${esc(agent.description || agent.role)}</div></div><div class="spacer"></div>
      <div class="row" style="gap:4px">${agent.type === 'external' ? `<span class="chip">${esc(agent.endpoint || '')}</span>` : (agent.tools || []).map((t) => `<span class="chip" title="${esc(tools.find((x) => x.name === t)?.description || '')}">${esc(tools.find((x) => x.name === t)?.title || t)}</span>`).join('')}</div>
      <button class="icon-btn" id="edit-agent" title="编辑智能体">${icon('settings', 16)}</button>`;
    $('#edit-agent', view).onclick = () => agentDialog(agent);
  }

  function msgHTML(m, all) {
    if (m.role === 'user') return `<div class="msg user"><div class="avatar me">我</div><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
    if (m.role === 'tool') return '';
    if (m.toolCalls?.length) {
      return m.toolCalls.map((c) => {
        const res = all.find((x) => x.role === 'tool' && x.toolCallId === c.id);
        let pretty = res?.content || '';
        try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch {}
        const t = tools.find((x) => x.name === c.name);
        return `<div class="msg ai"><div class="avatar" style="width:42px;background:transparent;border:0">${icon('zap', 18)}</div><details class="tool-call"><summary>${res ? icon('check', 14) : '<span class="spinner"></span>'} 调用工具 <b>${esc(t?.title || c.name)}</b> <code>${esc(JSON.stringify(c.args)).slice(0, 90)}</code></summary><pre>${esc(pretty)}</pre></details></div>`;
      }).join('') + (m.content ? `<div class="msg ai"><div class="avatar">${ini(agent)}</div><div class="bubble md">${md(m.content)}</div></div>` : '');
    }
    return `<div class="msg ai"><div class="avatar">${ini(agent)}</div><div class="bubble md">${md(m.content)}<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="icon-btn" data-cp="${esc(m.content)}" style="width:26px;height:26px" title="复制">${icon('copy', 13)}</button></div></div></div>`;
  }

  function renderMsgs(pending) {
    const box = $('#msgs', view);
    const msgs = session?.messages || [];
    box.innerHTML = msgs.length || pending
      ? msgs.map((m) => msgHTML(m, msgs)).join('') + (pending ? `<div class="msg user"><div class="avatar me">我</div><div class="bubble">${esc(pending).replace(/\n/g, '<br>')}</div></div><div class="msg ai"><div class="avatar">${ini(agent)}</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span> <span class="muted small">思考中，可能会调用多个工具…</span></div></div>` : '')
      : `<div class="empty" style="margin:auto">${`<div class="avatar" style="width:64px;height:64px;font-size:26px">${ini(agent)}</div>`}<h3 style="color:var(--text)">我是 ${esc(agent.name)}</h3><p style="max-width:440px">${esc(agent.description || '')}</p></div>`;
    $$('[data-cp]', box).forEach((b) => (b.onclick = () => copy(b.dataset.cp)));
    box.scrollTop = box.scrollHeight;
    $('#sug', view).innerHTML = msgs.length ? '' : SUGGEST.map((s) => `<span class="chip click">${s}</span>`).join('');
    $$('#sug .chip', view).forEach((c) => (c.onclick = () => send(c.textContent)));
  }

  async function send(text) {
    text = (text ?? $('#inp', view).value).trim();
    if (!text || busy) return;
    busy = true;
    $('#inp', view).value = '';
    $('#send', view).disabled = true;
    try {
      if (!session) session = await api(`/agents/${agent.id}/sessions`, { method: 'POST' });
      renderMsgs(text);
      const r = await api(`/sessions/${session.id}/chat`, { method: 'POST', body: { message: text } });
      session.messages.push(...r.messages);
      loadSessions();
    } catch (e) {
      toast(e.message, 'error');
      renderMsgs();
    } finally {
      busy = false;
      $('#send', view).disabled = false;
      $('#inp', view).focus();
    }
  }

  $('#send', view).onclick = () => send();
  $('#inp', view).onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  $('#new-sess', view).onclick = () => { session = null; loadSessions(); };
  $('#new-agent', view).onclick = () => agentDialog(null);
  $('#api-doc', view).onclick = apiDoc;

  function agentDialog(a) {
    const isNew = !a;
    a = a || { name: '', avatar: '', role: '', description: '', systemPrompt: '你是一名 TikTok 跨境电商运营专家。', tools: tools.map((t) => t.name), kbIds: kbs.map((k) => k.id), type: 'builtin' };
    modal({
      title: isNew ? '新建智能体' : `编辑 ${esc(a.name)}`, wide: true,
      body: `<form id="af" class="col">
        <div class="grid g2"><label class="field">名称 *<input class="input" name="name" value="${esc(a.name)}" placeholder="如：直播运营 Mia"></label><label class="field">角色<input class="input" name="role" value="${esc(a.role)}" placeholder="直播运营专家"></label></div>
        <label class="field">简介<input class="input" name="description" value="${esc(a.description)}"></label>
        <div class="field">接入方式<div class="seg" id="atype"><button type="button" data-t="builtin" class="${a.type !== 'external' ? 'on' : ''}">平台内置（可调用工具）</button><button type="button" data-t="external" class="${a.type === 'external' ? 'on' : ''}">外部智能体（OpenAI 兼容端点）</button></div></div>
        <div id="ext" class="grid g3" style="${a.type === 'external' ? '' : 'display:none'}"><label class="field">Base URL<input class="input" name="endpoint" value="${esc(a.endpoint || '')}" placeholder="https://api.dify.ai/v1"></label><label class="field">API Key<input class="input" name="apiKey" type="password" placeholder="${a.hasKey ? '已保存（留空不修改）' : 'sk-...'}"></label><label class="field">模型名<input class="input" name="model" value="${esc(a.model || '')}" placeholder="可选"></label>
          <p class="muted small" style="grid-column:1/-1;margin:0">支持 Dify、Coze、FastGPT、OneAPI、LobeChat 等提供 OpenAI 兼容 <code>/chat/completions</code> 接口的智能体平台。</p></div>
        <label class="field">系统提示词<textarea class="input" name="systemPrompt" rows="4">${esc(a.systemPrompt)}</textarea></label>
        <div id="intern" style="${a.type === 'external' ? 'display:none' : ''}" class="col">
          <div class="field">可调用的工具<div class="switch-grid">${tools.map((t) => `<label class="check hit" style="padding:8px 10px"><input type="checkbox" name="tool" value="${t.name}" ${a.tools?.includes(t.name) ? 'checked' : ''}><span><b>${esc(t.title)}</b><br><span class="muted small">${esc(t.description)}</span></span></label>`).join('')}</div></div>
          <div class="field">绑定知识库<div class="row">${kbs.map((k) => `<label class="check chip"><input type="checkbox" name="kb" value="${k.id}" ${a.kbIds?.includes(k.id) ? 'checked' : ''}>${esc(k.name)}</label>`).join('')}</div></div>
        </div></form>`,
      footer: `${!isNew ? `<button class="btn ghost" id="del" style="color:var(--err)">${icon('trash', 15)}删除</button><div class="spacer"></div>` : ''}<button class="btn ghost" data-close>取消</button><button class="btn" id="save">保存</button>`,
      onMount(el, close) {
        let type = a.type || 'builtin';
        $$('#atype button', el).forEach((b) => (b.onclick = () => {
          type = b.dataset.t;
          $$('#atype button', el).forEach((x) => x.classList.toggle('on', x === b));
          $('#ext', el).style.display = type === 'external' ? '' : 'none';
          $('#intern', el).style.display = type === 'external' ? 'none' : '';
        }));
        $('#save', el).onclick = (e) => withLoading(e.currentTarget, async () => {
          const fd = new FormData($('#af', el));
          const body = Object.fromEntries([...fd].filter(([k]) => !['tool', 'kb'].includes(k)));
          body.tools = fd.getAll('tool');
          body.kbIds = fd.getAll('kb');
          body.type = type;
          if (!body.name) throw new Error('请输入名称');
          const saved = isNew ? await api('/agents', { method: 'POST', body }) : await api(`/agents/${a.id}`, { method: 'PATCH', body });
          if (isNew) agents.push(saved);
          else Object.assign(agents.find((x) => x.id === a.id), saved);
          agent = agents.find((x) => x.id === saved.id);
          session = null;
          renderAgents();
          loadSessions();
          close();
          toast('已保存', 'success');
        });
        const del = $('#del', el);
        if (del) del.onclick = async () => {
          if (!(await confirmBox(`确定删除智能体「${a.name}」？`))) return;
          await api(`/agents/${a.id}`, { method: 'DELETE' });
          agents.splice(agents.findIndex((x) => x.id === a.id), 1);
          agent = agents[0];
          session = null;
          renderAgents();
          loadSessions();
          close();
        };
      },
    });
  }

  renderAgents();
  if (agent) await loadSessions();
}

function apiDoc() {
  const base = location.origin;
  modal({
    title: '外部 Agent 接入', wide: true,
    body: `<div class="col"><p class="text-2" style="margin:0">平台的全部能力都以 HTTP 工具形式开放，可被 <b>Dify、Coze、n8n、LangChain、Claude / OpenAI Function Calling</b> 等任意 Agent 框架调用；反过来也可以在「新建智能体」中把外部智能体接入本平台对话。</p>
      <h4>1. 获取工具清单（JSON Schema）</h4><div class="code">GET ${base}/api/tools</div>
      <h4>2. 调用工具</h4><div class="code">POST ${base}/api/tools/search_products
Content-Type: application/json

{"category": "宠物用品", "sort": "growth", "limit": 5}</div>
      <h4>3. 可用工具</h4><div id="tl" class="col"><span class="spinner"></span></div></div>`,
    async onMount(el) {
      const { tools } = await api('/tools');
      $('#tl', el).innerHTML = tools.map((t) => `<div class="hit"><b><code>${t.name}</code></b> — ${esc(t.description)}<div class="code" style="margin-top:6px">${esc(JSON.stringify(t.parameters.properties))}</div></div>`).join('');
    },
  });
}
