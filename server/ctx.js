// 请求上下文：记录当前登录用户，数据读写按用户隔离（无上下文 = 系统任务，如启动初始化、命令行）
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

module.exports = {
  run: (user, fn) => als.run({ user: user || null }, fn),
  // undefined：系统任务；{ user: null }：未登录请求
  store: () => als.getStore(),
  user: () => als.getStore()?.user || null,
};
