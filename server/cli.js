// 命令行工具（服务停止时运行，避免与运行中的进程同时写数据文件）
//   node server/cli.js admin <用户名> [密码]   创建管理员或重置管理员密码（不填密码则随机生成）
//   node server/cli.js users                     列出所有账号
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const seed = require('./seed');

async function main() {
  const [cmd, name, pw] = process.argv.slice(2);
  await seed.run(); // 先完成升级初始化（内置知识库标记为共享），再认领旧数据
  if (cmd === 'admin' && name) {
    const password = pw || crypto.randomBytes(9).toString('base64url');
    const u = await auth.upsertAdmin(name, password);
    console.log(`管理员：${u.username}\n密码：${password}`);
  } else if (cmd === 'users') {
    for (const u of auth.listUsers()) console.log(`${u.role.padEnd(5)} ${u.username}${u.disabled ? '（已停用）' : ''}  注册于 ${u.createdAt}`);
  } else {
    console.log('用法：\n  node server/cli.js admin <用户名> [密码]\n  node server/cli.js users');
    process.exitCode = 1;
  }
  db.flushAll();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
