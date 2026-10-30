// 登录 / 注册：#/login、#/login/register；登录后回到 #/login/<原页面>
import { api, icon, $, $$, toast } from '../lib.js';
import { session, loadSession } from '../session.js';

const PERKS = [
  ['target', '自己的选品库', '导入的 FastMoss 数据只有你能看到'],
  ['link', '自己的模型 Key', '接入配置互相隔离，别人用不到你的额度'],
  ['book', '自己的知识库', '上传的官方文档、SOP 只供你的 Agent 检索'],
];

export async function render(view, rest) {
  await loadSession();
  let mode = rest[0] === 'register' ? 'register' : 'login';
  const next = rest.filter((x) => x !== 'register').join('/');
  const canRegister = session.allowRegister || session.firstUser;

  view.innerHTML = `<div class="auth">
    <div class="auth-beams" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <section class="auth-intro">
      <span class="pill"><b>${session.firstUser ? '首次使用' : '欢迎回来'}</b>${session.firstUser ? '第一个注册的账号将成为管理员' : 'TikTok Shop 跨境卖家的选品与内容工作台'}</span>
      <h1>每个人一个<br><span class="grad-text">独立的运营台</span></h1>
      <p class="lead">账号之间的数据完全隔离：你的商品、脚本、知识库、模型 Key 和对话记录，其他账号都看不到。</p>
      <div class="perks">${PERKS.map(([ic, t, d], i) => `<div style="--d:${i * 0.12 + 0.2}s"><span class="perk-ic">${icon(ic, 18)}</span><div><b>${t}</b><small>${d}</small></div></div>`).join('')}</div>
    </section>
    <section class="auth-card-wrap">
      <div class="orbit" aria-hidden="true">
        <div class="orbit-ring o1">${['target', 'script', 'book'].map((ic, i) => `<span style="--k:${i}">${icon(ic, 16)}</span>`).join('')}</div>
        <div class="orbit-ring o2">${['bot', 'link', 'chart', 'sparkles'].map((ic, i) => `<span style="--k:${i}">${icon(ic, 16)}</span>`).join('')}</div>
      </div>
      <div class="auth-card beam-border">
        <div class="auth-tabs" id="tabs"><i class="auth-tab-ind"></i><button data-m="login">登录</button><button data-m="register" ${canRegister ? '' : 'disabled title="管理员已关闭注册"'}>注册</button></div>
        <form id="f" autocomplete="on" novalidate>
          <h2 id="ttl"></h2>
          <p class="muted small" id="sub"></p>
          <label class="field">用户名<div class="input-icon">${icon('bot', 16)}<input class="input" name="username" autocomplete="username" required maxlength="32" placeholder="2–32 个字符"></div></label>
          <label class="field">密码<div class="input-icon pw">${icon('settings', 16)}<input class="input" name="password" type="password" required minlength="8" placeholder="至少 8 位"><button type="button" class="eye" id="eye" aria-label="显示密码">显示</button></div></label>
          <label class="field reg-only">确认密码<div class="input-icon">${icon('check', 16)}<input class="input" name="password2" type="password" placeholder="再输入一次"></div></label>
          <div class="auth-err" id="err" role="alert"></div>
          <button class="btn lg btn-solid auth-submit" id="go"><span id="go-t"></span>${icon('arrow', 16)}</button>
          ${canRegister ? '' : '<p class="muted small" style="text-align:center;margin:0">管理员已关闭注册，如需账号请联系管理员</p>'}
        </form>
      </div>
    </section>
  </div>`;

  const f = $('#f', view);
  function setMode(m) {
    mode = m;
    view.querySelector('.auth').dataset.mode = m;
    $$('#tabs button', view).forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#ttl', view).textContent = m === 'login' ? '登录你的运营台' : session.firstUser ? '创建管理员账号' : '创建新账号';
    $('#sub', view).textContent = m === 'login' ? '使用用户名和密码登录' : session.firstUser ? '你是第一个用户，注册后自动成为管理员，可以管理其他账号' : '注册后只能看到自己的数据';
    $('#go-t', view).textContent = m === 'login' ? '登录' : '注册并进入';
    f.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('#err', view).textContent = '';
    const enc = next ? `/${next}` : '';
    history.replaceState(null, '', `#/login${m === 'register' ? '/register' : ''}${enc}`);
  }
  $$('#tabs button', view).forEach((b) => (b.onclick = () => !b.disabled && setMode(b.dataset.m)));
  setMode(mode === 'register' && canRegister ? 'register' : 'login');
  if (session.firstUser) setMode('register');

  $('#eye', view).onclick = () => {
    const show = f.password.type === 'password';
    f.password.type = f.password2.type = show ? 'text' : 'password';
    $('#eye', view).textContent = show ? '隐藏' : '显示';
  };

  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err', view);
    const username = f.username.value.trim();
    const password = f.password.value;
    err.textContent = '';
    if (!username || !password) return (err.textContent = '请输入用户名和密码');
    if (mode === 'register' && password !== f.password2.value) return (err.textContent = '两次输入的密码不一致');
    const btn = $('#go', view);
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const r = await api(`/auth/${mode}`, { method: 'POST', body: { username, password } });
      session.user = r.user;
      session.firstUser = false;
      dispatchEvent(new CustomEvent('authchange'));
      toast(mode === 'login' ? `欢迎回来，${r.user.username}` : r.user.role === 'admin' ? '管理员账号已创建' : '注册成功', 'success');
      location.replace(`#/${next || 'dashboard'}`);
    } catch (ex) {
      err.textContent = ex.message;
      const card = view.querySelector('.auth-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  };
  f.username.focus();
}
