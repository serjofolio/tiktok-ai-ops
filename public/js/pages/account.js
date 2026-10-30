// 账号与密码
import { api, icon, esc, $, toast, withLoading, timeAgo } from '../lib.js';
import { session } from '../session.js';

export async function render(view) {
  const u = session.user;
  view.innerHTML = `<section class="page-hero">
    <div class="kicker">账号 · ${u.role === 'admin' ? '管理员' : '普通用户'}</div>
    <h2>你好，<em>${esc(u.username)}</em></h2>
    <p>${u.role === 'admin' ? '你是管理员：可以在「用户管理」里查看所有账号、关闭注册、停用或删除账号。其他账号看不到你的商品、知识库和模型 Key。' : '你的商品、脚本、知识库、模型配置和对话只有你自己能看到。'}</p>
  </section>
  <div class="g-2-1">
    <div class="card card-pad">
      <h3 class="mb">${icon('settings')}修改密码</h3>
      <form class="col" id="pf" style="max-width:420px">
        <label class="field">当前密码<input class="input" type="password" name="oldPassword" autocomplete="current-password" required></label>
        <label class="field">新密码（至少 8 位）<input class="input" type="password" name="newPassword" autocomplete="new-password" minlength="8" required></label>
        <label class="field">确认新密码<input class="input" type="password" name="newPassword2" autocomplete="new-password" required></label>
        <div><button class="btn" id="save" data-loading="保存中…">${icon('check', 15)}保存新密码</button></div>
        <p class="muted small" style="margin:0">修改后，其他设备上的登录会全部失效。</p>
      </form>
    </div>
    <div class="card card-pad">
      <h3 class="mb">${icon('bot')}账号信息</h3>
      <dl class="kv">
        <dt>用户名</dt><dd>${esc(u.username)}</dd>
        <dt>角色</dt><dd>${u.role === 'admin' ? '管理员' : '普通用户'}</dd>
        <dt>注册时间</dt><dd>${new Date(u.createdAt).toLocaleString()}</dd>
        ${u.lastLoginAt ? `<dt>上次登录</dt><dd>${timeAgo(u.lastLoginAt)}</dd>` : ''}
      </dl>
      ${u.role === 'admin' ? `<a class="btn ghost mt" href="#/admin">${icon('layers', 15)}用户管理</a>` : ''}
    </div>
  </div>`;
  const f = $('#pf', view);
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading($('#save', view), async () => {
      if (f.newPassword.value !== f.newPassword2.value) throw new Error('两次输入的新密码不一致');
      await api('/auth/password', { method: 'POST', body: { oldPassword: f.oldPassword.value, newPassword: f.newPassword.value } });
      f.reset();
      toast('密码已修改', 'success');
    });
  };
}
