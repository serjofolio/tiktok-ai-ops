// 网络慢或断了：页面不再一直空着——选商品用精简列表；加载失败给出原因和「重试」
const { test, expect } = require('@playwright/test');

const ADMIN = { username: 'admin', password: 'admin-pass-123' };
async function admin(page) {
  const r = await page.request.post('/api/auth/login', { data: ADMIN });
  if (r.status() === 401) expect((await page.request.post('/api/auth/register', { data: ADMIN })).ok()).toBeTruthy();
}

test('选商品的下拉框只拉精简列表；接口断了显示原因，点重试能打开', async ({ page }) => {
  await admin(page);
  const sampleBefore = (await (await page.request.get('/api/products')).json()).items.some((x) => x.sample);
  if (!sampleBefore) expect((await page.request.post('/api/sample')).ok()).toBeTruthy();
  const pick = await (await page.request.get('/api/products?sort=score&pick=1')).json();
  expect(pick.items.length).toBeGreaterThan(0);
  const allowed = ['id', 'name', 'nameZh', 'image', 'category', 'status', 'evaluation'];
  for (const p of pick.items) expect(Object.keys(p).filter((k) => !allowed.includes(k))).toEqual([]);
  expect(Object.keys(pick.items[0].evaluation.metrics)).toEqual(['group']);

  // 写脚本页用的就是精简列表
  const asked = [];
  page.on('request', (r) => r.url().includes('/api/products') && asked.push(r.url()));
  await page.goto('/#/scripts');
  await expect(page.locator('#gen')).toBeVisible();
  expect(asked.some((u) => u.includes('pick=1'))).toBeTruthy();

  // 连不上服务器：说清楚原因，有重试按钮；网络恢复后点重试就打开了
  await page.goto('/#/dashboard');
  await page.route('**/api/playbook', (r) => r.abort('internetdisconnected'));
  await page.goto('/#/scripts');
  await expect(page.locator('#view')).toContainText('连不上服务器', { timeout: 15000 });
  await page.unroute('**/api/playbook');
  await page.click('#route-retry');
  await expect(page.locator('#gen')).toBeVisible();
  if (!sampleBefore) await page.request.delete('/api/sample');
});
