// 浏览器插件「运营台助手」端到端：真实加载插件 → 弹窗配置令牌 → 1688 搜索页 / 详情页识别货源 → 发送到运营台
// 1688 页面用本地假页面代替（结构参照 1688 搜索结果卡片和详情页里的脚本数据），其他外网请求一律拦截
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXT = path.join(__dirname, '..', 'extension');
const ADMIN = { username: 'admin', password: 'admin-pass-123' };

const card = ([id, t, p, s, c, l, m]) => `<div class="search-offer-item">
  <a href="https://detail.1688.com/offer/${id}.html" target="_blank"><img src="https://cbu01.alicdn.com/img/${id}.jpg" alt=""></a>
  <div class="offer-title"><a href="https://detail.1688.com/offer/${id}.html" title="${t}">${t}</a></div>
  <div class="offer-price"><span>¥</span><span>${p}</span></div><div>${s}</div><div>${m}</div>
  <div class="company-name">${c}</div><div>${l}</div></div>`;
const SEARCH = `<!doctype html><html><head><meta charset="utf-8"><title>1688</title></head><body>${[
  ['770000001', '睡眠耳机无线蓝牙隐形侧睡不压耳 迷你入耳式', '18.50', '成交1.2万+件', '深圳声悦电子有限公司', '广东 深圳', '2件起批'],
  ['770000002', '隐形睡眠蓝牙耳机 超小 降噪 长续航', '16.00', '成交3200件', '东莞小耳朵电子', '广东 东莞', '5件起批'],
  ['770000003', '运动蓝牙耳机 挂耳式 防水', '12.00', '已售1.5万件', '义乌耳机厂', '浙江 金华', '10件起批'],
].map(card).join('')}</body></html>`;
const DETAIL = `<!doctype html><html><head><meta charset="utf-8"><title>睡眠耳机-阿里巴巴</title></head><body>
<h1 class="title-text">睡眠耳机无线蓝牙隐形侧睡不压耳 迷你入耳式</h1><div class="price-box"><span>¥</span><span class="price-text">17.20</span></div>
<div class="company-name">深圳声悦电子有限公司</div>
<script>window.__INIT_DATA = {"skuModel":{"skuInfoMap":{"黑色":{"skuId":1},"白色":{"skuId":2},"粉色":{"skuId":3}}},"offerBaseInfo":{"unitWeight":0.045,"sendGoodsAddressText":"广东省深圳市","amountOnSale":26000,"priceRanges":[{"startQuantity":2,"price":"19.50"},{"startQuantity":50,"price":"18.50"},{"startQuantity":500,"price":"17.20"}]}};</script></body></html>`;

test('浏览器插件：加载 → 填令牌连接 → 1688 搜索页和详情页识别货源 → 发送到运营台', async ({ request, baseURL }) => {
  test.setTimeout(90000);
  // 准备：管理员、马来西亚 3C 样例、插件令牌
  if ((await request.post('/api/auth/login', { data: ADMIN })).status() === 401) await request.post('/api/auth/register', { data: ADMIN });
  const pv = await (await request.post('/api/products/import/preview', { multipart: { file: { name: 'fm.xlsx', mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'fastmoss-my-3c.xlsx')) } } })).json();
  await request.post('/api/products/import/commit', { data: { token: pv.token, mapping: pv.mapping } });
  const { token } = await (await request.post('/api/tokens', { data: { name: '插件测试' } })).json();
  const ear = (await (await request.get('/api/products')).json()).items.find((p) => /Sleep Earbuds/.test(p.name));

  const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];

    // 插件弹窗：填地址和令牌，测试连接
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html`);
    await pop.fill('#server', baseURL);
    await pop.fill('#token', token);
    await pop.click('#save');
    await expect(pop.locator('#msg')).toHaveText('已连接：admin');

    const page = await ctx.newPage();
    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 's.1688.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: SEARCH });
      if (host === 'detail.1688.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: DETAIL });
      return route.abort();
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // 搜索结果页：识别 3 个货源，发给「睡眠耳机」
    await page.goto('https://s.1688.com/selloffer/offer_search.htm?keywords=sleep');
    await page.click('.tkops-fab');
    await expect(page.locator('.tkops-found')).toHaveText('本页识别到 3 个货源');
    await expect(page.locator(`.tkops-sel option[value="${ear.id}"]`)).toHaveCount(1);
    await page.selectOption('.tkops-sel', ear.id);
    await page.click('.tkops-send');
    await expect(page.locator('.tkops-msg')).toContainText(/已发送，这个商品现在有 \d+ 个货源/);
    // 识别不准时一键上报页面结构到运营台（去掉脚本和样式）
    await page.click('.tkops-report');
    await expect(page.locator('.tkops-msg')).toContainText('已上报到你的运营台');
    const dbg = path.join(__dirname, '..', 'test-results', 'data', 'ext-debug');
    const snap = JSON.parse(fs.readFileSync(path.join(dbg, fs.readdirSync(dbg).sort().pop()), 'utf8'));
    expect(snap).toMatchObject({ reason: 'manual', user: 'admin', url: 'https://s.1688.com/selloffer/offer_search.htm?keywords=sleep' });
    expect(snap.html).toContain('search-offer-item');
    expect(snap.html).not.toContain('tkops-panel');

    // 详情页：补全阶梯价、库存、发货地、重量、SKU，默认选中上次的商品
    await page.goto('https://detail.1688.com/offer/770000001.html');
    await page.click('.tkops-fab');
    await expect(page.locator('.tkops-found')).toHaveText('本页识别到 1 个货源');
    await expect(page.locator('.tkops-sel')).toHaveValue(ear.id);
    await page.click('.tkops-send');
    await expect(page.locator('.tkops-msg')).toContainText('已发送');
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }

  // 运营台里：同一个货源的搜索页信息和详情页信息合并在一起
  const p = await (await request.get(`/api/products/${ear.id}`)).json();
  const o = p.sourcing.offers.find((x) => x.offerId === '770000001');
  expect(o).toMatchObject({ moq: 2, amountOnSale: 26000, sendGoodsAddress: '广东省深圳市', unitWeight: 0.045, skuCount: 3, sales: 12000, shop: '深圳声悦电子有限公司', source: '浏览器插件' });
  expect(o.priceRanges).toEqual([{ startQuantity: 2, price: 19.5 }, { startQuantity: 50, price: 18.5 }, { startQuantity: 500, price: 17.2 }]);
  expect(p.sourcing.offers.find((x) => x.offerId === '770000003').sendGoodsAddress).toBe('浙江 金华');
});

// 新版 1688 搜索 / 以图搜结果：整张卡片就是一个链接（没有 title 属性），价格拆成「¥」「18」「.50」几段，销量写成「2600+件」，
// 发货地只能从店名里的城市看出来；还有卡片上没有链接、只有 data-offerid 的商品，和只在页面数据里的商品
const NEW_CARD = ([id, t, yuan, jiao, sales, shop, tag]) => `<div class="offer-item-wrap"><a class="search-offer-wrapper cardui-normal" href="//detail.1688.com/offer/${id}.html?spm=a26352.13672862.offerlist.1" target="_blank">
  <div class="img-container"><img class="main-img" src="https://cbu01.alicdn.com/img/ibank/O1CN${id}.jpg_460x460q100.jpg_.webp" style="width:220px;height:220px"></div>
  <div class="offer-title-row"><span class="offer-tag">${tag}</span><div class="title-text">${t}</div></div>
  <div class="offer-sub-title">款式齐全 支持定制</div>
  <div class="offer-price-row"><div class="price-item"><span>¥</span><span class="text-main">${yuan}</span><span>${jiao}</span></div><span class="freight">运费3元</span><span>${sales}</span></div>
  <div class="offer-desc-row"><span>1件起购</span><span>退货包运费</span><span>明天达</span></div>
  <div class="offer-shop-row"><div class="desc-text">${shop}</div></div></a></div>`;
const SEARCH_NEW = `<!doctype html><html><head><meta charset="utf-8"><title>1688</title></head><body>${[
  ['771000001', '睡眠耳机无线蓝牙隐形侧睡不压耳', '18', '.50', '2600+件', '深圳市龙华区声悦电子商行', '新品'],
  ['771000002', '隐形睡眠蓝牙耳机 超小 降噪 长续航', '16', '.00', '30+件', '东莞市小耳朵电子有限公司', '人气新品'],
  ['771000003', '运动蓝牙耳机 挂耳式 防水', '12', '.00', '1.5万+件', '金华市耳机厂', '跨境'],
].map(NEW_CARD).join('')}
<div class="offer-item-wrap" data-offerid="771000004"><div class="img-container"><img src="https://cbu01.alicdn.com/img/ibank/O1CN771000004.jpg" style="width:220px;height:220px"></div>
  <div class="title-text">隐形睡眠耳机 无线 小巧</div><div class="price-item">¥<span>21</span><span>.50</span></div><div>已售860件</div><div class="desc-text">东莞市小耳朵电子有限公司</div></div>
<script>window.__SEARCH_DATA__ = {"data":{"offerList":[{"offerId":"771000006","subject":"<font color=red>睡眠</font>耳机 降噪","priceInfo":{"price":"15.80"},"image":{"imgUrl":"//cbu01.alicdn.com/img/ibank/O1CN771000006.jpg"},"companyName":"义乌声乐电子商行","province":"浙江","city":"义乌","tradeQuantity":{"saleQuantity":"3500"}}]}};</script>
</body></html>`;

// 1688 首页：点「以图搜款」出现上传框；上传后弹出「以图搜款 已上传1张图」+ 预览 +「搜索」，点搜索用新窗口打开结果。
// 顶部还有关键词搜索的「搜索」按钮（不能点错）；首页推荐商品不能被当成结果采集
const HOME = `<!doctype html><html><head><meta charset="utf-8"><title>阿里巴巴1688.com</title></head><body>
<div class="search-bar"><input class="search-input" placeholder="搜索货源"><button class="search-btn">搜索</button>
  <span class="image-search-camera" onclick="document.getElementById('up').hidden=false">以图搜款</span>
  <div id="up" hidden><input type="file" accept="image/*" id="file"></div></div>
<div id="pop" hidden><div class="pop-head">以图搜款 <span id="tip"></span></div><div class="pop-body"><img id="preview" style="width:120px;height:120px"></div><div class="pop-foot"><div class="pop-search" id="go">搜索</div></div></div>
<div class="recommend">${card(['880000001', '首页推荐 女装连衣裙', '39.00', '成交5000件', '杭州服饰', '浙江 杭州', '1件起批'])}</div>
<script>
let size = 0, type = '';
document.getElementById('file').onchange = (e) => { const f = e.target.files[0]; size = f.size; type = f.type; document.getElementById('preview').src = URL.createObjectURL(f); document.getElementById('tip').textContent = '已上传1张图'; document.getElementById('pop').hidden = false; };
document.querySelector('.search-btn').onclick = () => (location.href = 'https://s.1688.com/selloffer/offer_search.htm?keywords=WRONG');
document.getElementById('go').onclick = () => window.open('https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageId=' + size + '&type=' + encodeURIComponent(type), '_blank');
</script></body></html>`;

test('浏览器插件自动找货：选商品 → 自动打开 1688 关键词搜 → 采集新版卡片 → 慢慢补详情；网页链接触发自动以图搜（自动点弹出框里的「搜索」）', async ({ request, baseURL }) => {
  test.setTimeout(120000);
  if ((await request.post('/api/auth/login', { data: ADMIN })).status() === 401) await request.post('/api/auth/register', { data: ADMIN });
  // 带主图的商品（以图搜用）
  const text = '商品名称\t售价\t7天销量\t28天销量\t商品图片\nPortable Mini Bluetooth Speaker Waterproof\tRM25.90\t800\t2400\thttp://127.0.0.1:3902/img/product.png';
  for (const multipart of [{ file: { name: 'fm.xlsx', mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'fastmoss-my-3c.xlsx')) } }, { text }]) {
    const pv = await (await request.post('/api/products/import/preview', { multipart })).json();
    await request.post('/api/products/import/commit', { data: { token: pv.token, mapping: pv.mapping } });
  }
  const all = (await (await request.get('/api/products')).json()).items;
  const ear = all.find((p) => /Sleep Earbuds/.test(p.name));
  const spk = all.find((p) => /Bluetooth Speaker/.test(p.name));
  expect(spk.image).toContain('/img/product.png');
  const { token } = await (await request.post('/api/tokens', { data: { name: '自动找货测试' } })).json();

  const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    // 插件新开的标签页也要走假 1688；商品图片不去外网
    const opened = [];
    await ctx.route(/^https:\/\/[a-z]+\.1688\.com\//, (route) => {
      const u = new URL(route.request().url());
      opened.push(u.href);
      const body = u.hostname === 'www.1688.com' ? HOME : u.hostname === 'detail.1688.com' ? DETAIL : SEARCH_NEW;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    await ctx.route(/alicdn\.com/, (route) => route.abort());
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];

    // 弹窗：连接后出现「给哪个商品找货」，选睡眠耳机 → 关键词搜（测试里把操作节奏调快 20 倍）
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html`);
    await pop.evaluate(() => chrome.storage.local.set({ pace: 0.05 }));
    await pop.fill('#server', baseURL);
    await pop.fill('#token', token);
    await pop.click('#save');
    await expect(pop.locator('#hunt')).toBeVisible();
    await pop.selectOption('#product', ear.id);
    const [search] = await Promise.all([ctx.waitForEvent('page'), pop.click('[data-mode="keyword"]')]);
    await search.waitForURL(/s\.1688\.com\/selloffer\/offer_search\.htm\?keywords=.+&charset=utf8/);
    expect(opened.every((u) => /1688\.com/.test(u) && !/login/.test(u))).toBe(true);
    // 自动采集 → 后台逐个打开详情页补数据 → 完成
    await expect(search.locator('.tkops-status.done')).toContainText('完成：补全了', { timeout: 60000 });
    expect(opened.filter((u) => u.includes('detail.1688.com')).length).toBeGreaterThan(0);
    const p = await (await request.get(`/api/products/${ear.id}`)).json();
    expect(p.sourcing.offers.filter((o) => o.unitWeight === 0.045).length).toBeGreaterThan(0);
    expect(p.sourcing.offers.map((o) => o.offerId)).toEqual(expect.arrayContaining(['771000001', '771000002', '771000003', '771000004', '771000006']));
    await expect.poll(() => ctx.pages().filter((x) => x.url().includes('detail.1688.com')).length).toBe(0); // 详情标签采完自动关闭

    // 运营台网页上的「插件自动以图搜」链接：打开 1688 首页 → 点「以图搜款」→ 上传主图 → 点弹出框里的「搜索」→ 结果在当前标签打开 → 自动采集
    const page = await ctx.newPage();
    await page.goto(`https://www.1688.com/#tkops=${spk.id}&mode=image&d=0`);
    await page.waitForURL(/youyuan/, { timeout: 30000 });
    expect(Number(new URL(page.url()).searchParams.get('imageId'))).toBeGreaterThan(100);
    expect(new URL(page.url()).searchParams.get('type')).toBe('image/jpeg');
    await expect(page.locator('.tkops-status.done')).toContainText('完成：发送了 5 个货源', { timeout: 30000 });
    const s = await (await request.get(`/api/products/${spk.id}`)).json();
    const by = (id) => s.sourcing.offers.find((o) => o.offerId === id);
    expect(s.sourcing.offers.map((o) => o.offerId).sort()).toEqual(['771000001', '771000002', '771000003', '771000004', '771000006']);
    expect(by('771000001')).toMatchObject({ title: '睡眠耳机无线蓝牙隐形侧睡不压耳', price: 18.5, sales: 2600, moq: 1, shop: '深圳市龙华区声悦电子商行', sendGoodsAddress: '广东 深圳' });
    expect(by('771000001').image).toContain('O1CN771000001');
    expect(by('771000003')).toMatchObject({ sales: 15000, sendGoodsAddress: '浙江 金华' });
    expect(by('771000004')).toMatchObject({ title: '隐形睡眠耳机 无线 小巧', price: 21.5, sales: 860, shop: '东莞市小耳朵电子有限公司', sendGoodsAddress: '广东 东莞' });
    expect(by('771000006')).toMatchObject({ title: '睡眠耳机 降噪', price: 15.8, sales: 3500, shop: '义乌声乐电子商行', sendGoodsAddress: '浙江 义乌' });
    expect(opened.some((u) => /WRONG/.test(u))).toBe(false); // 没点错成关键词搜索
  } finally {
    await ctx.close();
  }
});
