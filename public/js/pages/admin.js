// 用户管理（仅管理员）：开关注册、停用 / 启用、重置密码、删除账号
import { api, icon, esc, $, $$, toast, modal, confirmBox, timeAgo, empty } from '../lib.js';
import { session } from '../session.js';

export async function render(view) {
  let d = await api('/admin/users');

  view.innerHTML = `<section class="page-hero">
    <div class="kicker">管理员 · 用户管理</div>
    <h2>谁能<em>进来</em>，由你决定</h2>
    <p>每个账号只能看到自己的数据。你可以关闭注册、停用账号或重置密码；删除账号会同时删除该账号的全部数据。</p>
  </section>
  <div class="stat-strip mb" id="stats"></div>
  <div class="card">
    <div class="card-head"><h3>${icon('layers')}账号列表</h3><div class="spacer"></div>
      <label class="toggle" title="关闭后新用户无法注册"><input type="checkbox" id="reg"><span class="track"><i></i></span><span>开放注册</span></label>
    </div>
    <div id="list"></div>
  </div>`;

  function draw() {
    const users = d.items;
    const n = (k) => users.reduce((a, u) => a + (u.usage[k] || 0), 0);
    $('#stats', view).innerHTML = [
      ['账号', users.length], ['已停用', users.filter((u) => u.disabled).length], ['商品', n('products')], ['对话', n('chats')],
    ].map(([l, v]) => `<div><div class="stat-label">${l}</div><div class="stat-value" data-count="${v}">${v}</div></div>`).join('');
    $('#reg', view).checked = !!d.system.allowRegister;
    $('#list', view).innerHTML = users.length
      ? `<div class="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>商品</th><th>脚本</th><th>文档</th><th>对话</th><th>注册</th><th>上次登录</th><th>状态</th><th></th></tr></thead><tbody>
        ${users.map((u) => {
          const me = u.id === session.user.id;
          return `<tr data-id="${u.id}"><td><span class="avatar sm">${esc(u.username.slice(0, 1).toUpperCase())}</span> <b>${esc(u.username)}</b>${me ? ' <span class="chip">我</span>' : ''}</td>
          <td>${u.role === 'admin' ? '<span class="badge badge-run">管理员</span>' : '<span class="badge badge-muted">普通用户</span>'}</td>
          <td>${u.usage.products || 0}</td><td>${u.usage.scripts || 0}</td><td>${u.usage.documents || 0}</td><td>${u.usage.chats || 0}</td>
          <td class="muted small">${timeAgo(u.createdAt)}</td><td class="muted small">${u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}</td>
          <td>${u.disabled ? '<span class="badge badge-err">已停用</span>' : '<span class="badge badge-ok">正常</span>'}</td>
          <td><div class="row-actions">${me ? '' : `<button class="btn sm ghost" data-act="toggle">${u.disabled ? '启用' : '停用'}</button><button class="btn sm ghost" data-act="reset">重置密码</button><button class="btn sm ghost" data-act="role">${u.role === 'admin' ? '设为普通用户' : '设为管理员'}</button><button class="icon-btn danger" data-act="del" title="删除账号">${icon('trash', 14)}</button>`}</div></td></tr>`;
        }).join('')}</tbody></table></div>`
      : empty('还没有账号');
    $$('[data-act]', view).forEach((b) => (b.onclick = () => act(b.dataset.act, d.items.find((u) => u.id === b.closest('tr').dataset.id))));
  }

  async function reload() {
    d = await api('/admin/users');
    draw();
  }

  async function act(kind, u) {
    try {
      if (kind === 'toggle') {
        await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } });
        toast(u.disabled ? '已启用' : '已停用，该账号已被强制退出', 'success');
      } else if (kind === 'role') {
        if (!(await confirmBox(u.role === 'admin' ? `把「${u.username}」降为普通用户？` : `把「${u.username}」设为管理员？管理员可以管理所有账号（但仍看不到你的数据）。`))) return;
        await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role: u.role === 'admin' ? 'user' : 'admin' } });
      } else if (kind === 'reset') {
        if (!(await confirmBox(`为「${u.username}」生成一个新密码？对方当前的登录会失效。`))) return;
        const r = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST' });
        modal({ title: '新密码', body: `<p>请把新密码告诉「${esc(u.username)}」，对方登录后可以在「账号与密码」里修改：</p><div class="pw-box" id="pw">${esc(r.password)}</div>`, footer: '<button class="btn" data-close>好的</button>' });
      } else if (kind === 'del') {
        if (!(await confirmBox(`删除账号「${u.username}」？该账号的商品、脚本、知识库、模型配置和对话会全部删除，无法恢复。`))) return;
        await api(`/admin/users/${u.id}`, { method: 'DELETE' });
        toast('账号已删除', 'success');
      }
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  $('#reg', view).onchange = async (e) => {
    try {
      d.system = await api('/admin/system', { method: 'PUT', body: { allowRegister: e.target.checked } });
      toast(d.system.allowRegister ? '已开放注册' : '已关闭注册，新用户无法注册', 'success');
    } catch (ex) {
      toast(ex.message, 'error');
      e.target.checked = !e.target.checked;
    }
  };
  draw();
}
