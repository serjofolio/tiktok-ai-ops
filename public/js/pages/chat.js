// Agent：普通 AI 聊天界面，流式输出，可引用知识库
import { api, icon, esc, toast, $, $$, md, confirmBox, timeAgo, copy } from '../lib.js';

const SUGGEST = [
  ['选品', '美区 TikTok Shop 现在适合新手做的类目有哪些？怎么用 FastMoss 筛选？'],
  ['利润', '售价 19.99 美元的商品，怎么算扣完佣金、物流、退货后的净利润？'],
  ['脚本', '带货视频前 3 秒的钩子有哪些写法？给我 5 个例子'],
  ['规则', 'TikTok Shop 哪些商品属于禁售或限售？需要什么资质？'],
];

export async function render(view) {
  let chats = (await api('/chats')).items;
  const prov = await api('/providers');
  const active = prov.items.find((p) => p.id === prov.activeId);
  let current = null;
  let ctrl = null;
  let useKb = true;
  try { useKb = localStorage.getItem('chat-kb') !== '0'; } catch {}

  view.innerHTML = `<div class="chat-layout">
    <aside class="card agent-list">
      <div class="card-head"><button class="btn block" id="new">${icon('plus', 15)}新对话</button></div>
      <div id="list" style="padding:8px;flex:1;overflow:auto"></div>
    </aside>
    <section class="card chat">
      <div class="card-head">
        <div class="avatar ai-orb"><i></i></div>
        <div style="min-width:0"><h3 id="ctitle">Agent</h3><div class="small muted">${active ? `${esc(active.name)} · <span class="money">${esc(active.model)}</span>` : '还没有接入模型'}</div></div>
        <div class="spacer"></div>
        <a class="btn sm ghost" href="#/providers">${icon('link', 14)}切换模型</a>
      </div>
      <div class="chat-msgs" id="msgs"></div>
      <div class="chat-input">
        <div class="input-shell">
          <textarea class="input" id="inp" rows="1" placeholder="${active ? '问点什么… Enter 发送，Shift+Enter 换行' : '请先在「接入配置」添加并启用一个模型'}"></textarea>
          <div class="input-bar">
            <label class="switch"><input type="checkbox" id="kb" ${useKb ? 'checked' : ''}><span></span>引用知识库</label>
            <div class="spacer"></div>
            <button class="btn" id="send">${icon('send', 15)}发送</button>
          </div>
        </div>
      </div>
    </section>
  </div>`;

  const msgsEl = $('#msgs', view);
  const inp = $('#inp', view);
  const sendBtn = $('#send', view);

  function renderList() {
    $('#list', view).innerHTML = chats.length
      ? chats.map((c) => `<div class="list-item ${c.id === current?.id ? 'on' : ''}" data-id="${c.id}"><div style="flex:1;min-width:0"><div class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title)}</div><span class="muted" style="font-size:11px">${timeAgo(c.updatedAt || c.createdAt)}</span></div><button class="icon-btn danger" data-del style="width:26px;height:26px">${icon('trash', 13)}</button></div>`).join('')
      : '<p class="muted small" style="padding:8px">还没有对话</p>';
    $$('#list .list-item', view).forEach((el) => (el.onclick = async (e) => {
      if (e.target.closest('[data-del]')) {
        if (!(await confirmBox('删除这个对话？'))) return;
        await api(`/chats/${el.dataset.id}`, { method: 'DELETE' });
        chats = chats.filter((c) => c.id !== el.dataset.id);
        if (current?.id === el.dataset.id) current = null;
        renderList();
        renderMsgs();
        return;
      }
      if (ctrl) return toast('正在生成中，请先停止');
      current = await api(`/chats/${el.dataset.id}`);
      renderList();
      renderMsgs();
    }));
  }

  const cites = (list) => list?.length ? `<div class="cites">${list.map((c) => `<details><summary>[${c.n}] ${esc(c.docTitle)}</summary><div>${esc(c.content)}</div></details>`).join('')}</div>` : '';
  const thinkBlock = (t, open) => t ? `<details class="think" ${open ? 'open' : ''}><summary>思考过程</summary><div>${esc(t)}</div></details>` : '';

  function msgHTML(m) {
    if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
    return `<div class="msg ai"><div class="avatar ai-orb sm"><i></i></div><div class="bubble">${thinkBlock(m.think)}<div class="md">${md(m.content)}</div>${cites(m.citations)}
      <div class="msg-tools"><button class="icon-btn" data-copy title="复制">${icon('copy', 13)}</button><span class="muted" style="font-size:11px">${esc(m.model || '')}</span></div></div></div>`;
  }

  function renderMsgs() {
    $('#ctitle', view).textContent = current?.title && current.title !== '新对话' ? current.title : 'Agent';
    const msgs = current?.messages || [];
    if (!msgs.length) {
      msgsEl.innerHTML = `<div class="chat-empty"><div class="ai-orb xl"><i></i></div><h2>有什么可以帮你？</h2><p class="muted">我是你的 TikTok 跨境电商运营助手。打开「引用知识库」后，会优先依据你上传的 TikTok 官方文档回答。</p>
        <div class="suggest-grid">${SUGGEST.map(([t, q]) => `<button class="suggest" data-q="${esc(q)}"><b>${t}</b><span>${esc(q)}</span></button>`).join('')}</div></div>`;
      $$('.suggest', msgsEl).forEach((b) => (b.onclick = () => send(b.dataset.q)));
      return;
    }
    msgsEl.innerHTML = msgs.map(msgHTML).join('');
    bindCopy(msgs);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function bindCopy(msgs) {
    const ai = msgs.filter((m) => m.role !== 'user');
    $$('.msg.ai [data-copy]', msgsEl).forEach((b, i) => (b.onclick = () => copy(ai[i]?.content || '')));
  }

  async function send(text) {
    text = (text ?? inp.value).trim();
    if (!text) return;
    if (ctrl) return;
    if (!active) return toast('请先在「接入配置」添加并启用一个模型', 'error');
    inp.value = '';
    autoGrow();
    if (!current) {
      current = await api('/chats', { method: 'POST' });
      chats.unshift({ ...current, count: 0 });
    }
    current.messages.push({ role: 'user', content: text });
    renderMsgs();
    msgsEl.insertAdjacentHTML('beforeend', `<div class="msg ai" id="live"><div class="avatar ai-orb sm thinking"><i></i></div><div class="bubble"><div class="think-live"></div><div class="md"><span class="typing"><i></i><i></i><i></i></span></div><div class="cites-live"></div></div></div>`);
    const live = $('#live', msgsEl);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    ctrl = new AbortController();
    sendBtn.innerHTML = `${icon('pause', 15)}停止`;
    sendBtn.classList.add('stop');
    let out = '', think = '', meta = null, raf = 0, failed = null;
    const paint = () => {
      raf = 0;
      if (think) live.querySelector('.think-live').innerHTML = thinkBlock(think, !out);
      if (out) live.querySelector('.md').innerHTML = md(out) + '<span class="caret"></span>';
      const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 140;
      if (nearBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
    };
    try {
      const res = await fetch(`/api/chats/${current.id}/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, useKb: $('#kb', view).checked }), signal: ctrl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.+)$/m)?.[1];
          const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] || '{}');
          if (ev === 'meta') meta = data;
          else if (ev === 'delta') out += data.text;
          else if (ev === 'think') think += data.text;
          else if (ev === 'error') failed = data.error;
          if (!raf) raf = requestAnimationFrame(paint);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') failed = e.message;
    }
    cancelAnimationFrame(raf);
    ctrl = null;
    sendBtn.innerHTML = `${icon('send', 15)}发送`;
    sendBtn.classList.remove('stop');
    if (failed) {
      live.querySelector('.md').innerHTML = `<div class="err-box">${icon('x', 14)} ${esc(failed)}${/接入配置|API Key|上游/.test(failed) ? ' <a href="#/providers">去接入配置 →</a>' : ''}</div>`;
      live.querySelector('.avatar').classList.remove('thinking');
      live.removeAttribute('id');
      return;
    }
    current = await api(`/chats/${current.id}`);
    const idx = chats.findIndex((c) => c.id === current.id);
    if (idx >= 0) chats[idx] = { ...chats[idx], title: current.title, updatedAt: current.updatedAt };
    renderList();
    renderMsgs();
  }

  const autoGrow = () => {
    inp.style.height = 'auto';
    inp.style.height = `${Math.min(200, inp.scrollHeight)}px`;
  };
  inp.addEventListener('input', autoGrow);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  sendBtn.onclick = () => (ctrl ? ctrl.abort() : send());
  $('#kb', view).onchange = (e) => { try { localStorage.setItem('chat-kb', e.target.checked ? '1' : '0'); } catch {} };
  $('#new', view).onclick = () => { if (ctrl) return; current = null; renderList(); renderMsgs(); inp.focus(); };

  renderList();
  renderMsgs();
  return () => ctrl?.abort();
}
