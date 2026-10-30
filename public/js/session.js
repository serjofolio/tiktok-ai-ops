// 当前登录状态（全站共享）
export const session = { user: null, allowRegister: true, firstUser: false };

export async function loadSession() {
  try {
    const r = await fetch('/api/auth/me').then((x) => x.json());
    Object.assign(session, { user: r.user || null, allowRegister: !!r.allowRegister, firstUser: !!r.firstUser });
  } catch {
    session.user = null;
  }
  return session;
}
