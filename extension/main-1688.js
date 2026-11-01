// 运行在 1688 页面自身环境里。平时什么都不做；只有插件自动以图搜、即将替你点「搜索」时才启用 20 秒：
// 插件模拟的点击不算用户手势，1688 若用新窗口打开结果会被浏览器的弹窗拦截，所以改成在当前标签页打开
(() => {
  let on = false;
  let timer = null;
  const nativeOpen = window.open;
  const go = (url) => location.assign(new URL(String(url), location.href).href);
  // 1688 拿到的「新窗口」：之后再给它设地址，就在当前标签页跳转
  const fakeWindow = () => {
    const loc = { assign: go, replace: go, set href(v) { go(v); }, get href() { return location.href; } };
    const w = { closed: false, opener: null, focus() {}, blur() {}, close() {}, postMessage() {} };
    Object.defineProperty(w, 'location', { get: () => loc, set: go });
    return w;
  };
  function sameTabOpen(url) {
    if (url && !/^about:blank$/i.test(String(url))) go(url);
    return fakeWindow();
  }
  document.addEventListener('tkops:same-tab', () => {
    on = true;
    window.open = sameTabOpen;
    clearTimeout(timer);
    timer = setTimeout(() => {
      on = false;
      window.open = nativeOpen;
    }, 20000);
  });
  // 链接和表单的 target=_blank 同样改成当前标签页
  document.addEventListener('click', (e) => {
    const a = on && e.target?.closest?.('a[target]');
    if (a && a.target !== '_self') a.target = '_self';
  }, true);
  document.addEventListener('submit', (e) => {
    if (on && e.target?.target && e.target.target !== '_self') e.target.target = '_self';
  }, true);
})();
