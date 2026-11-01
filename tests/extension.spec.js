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

// 1688 首页：搜索栏的相机图标点开后出现图片上传框；上传后跳到以图搜结果页。首页本身也有推荐商品（不能被当成结果采集）
const HOME = `<!doctype html><html><head><meta charset="utf-8"><title>阿里巴巴1688.com</title></head><body>
<div class="search-bar"><input class="search-input"><span class="image-search-camera" onclick="document.getElementById('up').hidden=false">相机</span>
<div id="up" hidden><input type="file" accept="image/*" id="file"></div></div>
<div class="recommend">${card(['880000001', '首页推荐 女装连衣裙', '39.00', '成交5000件', '杭州服饰', '浙江 杭州', '1件起批'])}</div>
<script>document.getElementById('file').onchange = (e) => { const f = e.target.files[0]; setTimeout(() => (location.href = 'https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageId=' + f.size + '&type=' + encodeURIComponent(f.type)), 300); };</script></body></html>`;

test('浏览器插件自动找货：选商品 → 自动打开 1688 关键词搜 → 采集 → 自动补详情；网页链接触发自动以图搜', async ({ request, baseURL }) => {
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
    // 插件新开的标签页也要走假 1688
    const opened = [];
    await ctx.route(/^https:\/\/[a-z]+\.1688\.com\//, (route) => {
      const u = new URL(route.request().url());
      opened.push(u.href);
      const body = u.hostname === 'www.1688.com' ? HOME : u.hostname === 'detail.1688.com' ? DETAIL : SEARCH;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];

    // 弹窗：连接后出现「给哪个商品找货」，选睡眠耳机 → 关键词搜
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html`);
    await pop.fill('#server', baseURL);
    await pop.fill('#token', token);
    await pop.click('#save');
    await expect(pop.locator('#hunt')).toBeVisible();
    await pop.selectOption('#product', ear.id);
    const [search] = await Promise.all([ctx.waitForEvent('page'), pop.click('[data-mode="keyword"]')]);
    await search.waitForURL(/s\.1688\.com\/selloffer\/offer_search\.htm\?keywords=.+&charset=utf8/);
    expect(opened.every((u) => /1688\.com/.test(u) && !/login/.test(u))).toBe(true);
    // 自动采集 → 自动打开详情页补数据 → 完成
    await expect(search.locator('.tkops-status.done')).toContainText('完成：补全了', { timeout: 60000 });
    expect(opened.filter((u) => u.includes('detail.1688.com')).length).toBeGreaterThan(0);
    const p = await (await request.get(`/api/products/${ear.id}`)).json();
    const detailed = p.sourcing.offers.filter((o) => o.unitWeight === 0.045);
    expect(detailed.length).toBeGreaterThan(0);
    expect(p.sourcing.offers.length).toBeGreaterThanOrEqual(3);
    await expect.poll(() => ctx.pages().filter((x) => x.url().includes('detail.1688.com')).length).toBe(0); // 详情标签采完自动关闭

    // 运营台网页上的「插件自动以图搜」链接：打开 1688 首页 → 点相机 → 上传主图 → 结果页自动采集（首页推荐商品不采）
    const page = await ctx.newPage();
    await page.goto(`https://www.1688.com/#tkops=${spk.id}&mode=image&d=0`);
    await page.waitForURL(/youyuan/, { timeout: 30000 });
    expect(Number(new URL(page.url()).searchParams.get('imageId'))).toBeGreaterThan(100);
    expect(new URL(page.url()).searchParams.get('type')).toBe('image/jpeg');
    await expect(page.locator('.tkops-status.done')).toContainText('完成：发送了 3 个货源', { timeout: 30000 });
    const s = await (await request.get(`/api/products/${spk.id}`)).json();
    expect(s.sourcing.offers.map((o) => o.offerId).sort()).toEqual(['770000001', '770000002', '770000003']);
  } finally {
    await ctx.close();
  }
});
