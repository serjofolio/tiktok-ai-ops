// FastMoss 页面：把「当前这一页」看到的商品发到运营台。不占用导出次数
// 只读你已经打开的这一页，点一次发一次，不会自动翻页、不会批量抓取（避免账号风险）
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const bg = (msg) => new Promise((resolve, reject) => chrome.runtime.sendMessage(msg, (r) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error || '插件未连接运营台，点浏览器右上角的插件图标设置')))));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // 找页面上最像商品列表的表格：优先真实 table，其次 Ant Design 表格的 div 结构；商品详情链接最多的那个
  function findTable() {
    const candidates = [...document.querySelectorAll('table')].filter((t) => t.querySelectorAll('tbody tr').length >= 1);
    return candidates.sort((a, b) => b.querySelectorAll('a[href*="/detail/"]').length - a.querySelectorAll('a[href*="/detail/"]').length || b.querySelectorAll('tr').length - a.querySelectorAll('tr').length)[0] || null;
  }

  // FastMoss 的表头和表体可能拆成两个 table（固定表头）
  function headersOf(table) {
    const own = [...table.querySelectorAll('thead th')].map((th) => clean(th.innerText));
    if (own.some(Boolean)) return own;
    const root = table.closest('.ant-table, .ant-table-wrapper') || document;
    return [...root.querySelectorAll('thead th')].map((th) => clean(th.innerText));
  }

  function readRow(tr) {
    const cells = [...tr.children].map((td) => clean(td.innerText));
    const link = tr.querySelector('a[href*="/e-commerce/detail/"], a[href*="/detail/"]');
    const img = tr.querySelector('img[src]:not([src^="data:"])');
    // 商品列通常把标题、价格、店铺放在一格：标题优先取链接文字
    const title = clean(link?.innerText) || clean(img?.alt) || '';
    return { cells, title, url: link ? new URL(link.getAttribute('href'), location.href).href : '', image: img?.src || '' };
  }

  function collect() {
    const table = findTable();
    if (!table) return null;
    const heads = headersOf(table);
    const rows = [...table.querySelectorAll('tbody tr')].map(readRow).filter((r) => r.cells.filter(Boolean).length >= 2);
    if (!rows.length) return null;
    const hasName = heads.some((h) => /商品名称|商品标题|product name|^title$/i.test(h));
    const headers = [...heads, ...(hasName ? [] : ['商品名称']), 'FastMoss商品详情页地址', '商品图片'];
    const data = rows.map((r) => {
      const line = [...r.cells];
      while (line.length < heads.length) line.push('');
      const firstLine = r.cells.find((c) => c.length > 10) || r.cells[0];
      return [...line.slice(0, heads.length), ...(hasName ? [] : [r.title || firstLine]), r.url, r.image];
    });
    return { headers, rows: data };
  }

  const box = document.createElement('div');
  box.id = 'tkops-fm';
  box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;gap:6px;align-items:flex-end;font:13px system-ui,"Microsoft YaHei",sans-serif';
  const msg = document.createElement('div');
  msg.style.cssText = 'display:none;max-width:280px;padding:8px 12px;border-radius:10px;background:#161615;color:#edede9;line-height:1.5';
  const btn = document.createElement('button');
  btn.textContent = '发送本页商品到运营台';
  btn.style.cssText = 'padding:9px 16px;border:0;border-radius:999px;background:linear-gradient(100deg,#f3e9d2,#ffb35c 45%,#ff6a4d);color:#140c06;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35)';
  const say = (text, bad) => { msg.textContent = text; msg.style.display = 'block'; msg.style.color = bad ? '#ff6b5a' : '#86d6a2'; };
  btn.onclick = async () => {
    const data = collect();
    if (!data) {
      say('这一页没有识别到商品表格。打开「商品搜索」或榜单页再试；还是不行请告诉开发者，已上报页面结构。', true);
      bg({ type: 'api', path: '/ext/debug', method: 'POST', body: { reason: 'fastmoss-no-table', url: location.href, title: document.title, version: VERSION, html: document.body.innerHTML.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '').slice(0, 300000) } }).catch(() => {});
      return;
    }
    btn.disabled = true;
    say(`正在发送 ${data.rows.length} 个商品…`);
    try {
      const r = await bg({ type: 'api', path: '/ext/fastmoss', method: 'POST', body: { ...data, title: `FastMoss 页面 · ${document.title}`.slice(0, 80), today: new Date().toLocaleDateString('en-CA') } });
      say(`已发送：新增 ${r.created}，更新 ${r.updated}，识别 ${r.recognized} 列。翻到下一页可以再点一次。`);
    } catch (e) {
      say(e.message, true);
    } finally {
      btn.disabled = false;
    }
  };
  box.append(msg, btn);
  document.documentElement.append(box);
})();
