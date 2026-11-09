// 界面整理：商品中文名 + 原标题、可搜索的商品选择器、每页的使用说明、使用指南
const { test, expect } = require('@playwright/test');

const UP = 'http://127.0.0.1:3902';
const ADMIN = { username: 'admin', password: 'admin-pass-123' };
async function admin(page) {
  const r = await page.request.post('/api/auth/login', { data: ADMIN });
  if (r.status() === 401) expect((await page.request.post('/api/auth/register', { data: ADMIN })).ok()).toBeTruthy();
}
const json = async (r) => {
  const t = await r.text();
  expect(r.ok(), t.slice(0, 300)).toBeTruthy();
  return JSON.parse(t);
};

test('商品显示中文短名和原标题；选择器能按中文搜；每页有使用说明；使用指南汇总全部功能', async ({ page }) => {
  test.setTimeout(90000);
  await admin(page);
  const list = await json(await page.request.get('/api/providers'));
  let p = list.items.find((x) => x.baseUrl === `${UP}/v1`);
  if (!p) p = await json(await page.request.post('/api/providers', { data: { name: '测试模型', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'glm-test' } }));
  await json(await page.request.post(`/api/providers/${p.id}/activate`));
  const sampleBefore = (await json(await page.request.get('/api/products'))).items.some((x) => x.sample);
  if (!sampleBefore) await json(await page.request.post('/api/sample'));

  // 没有中文名的商品：打开选品库时后台用大模型翻译
  const manual = await json(await page.request.post('/api/products', { data: { name: 'Waterproof Stainless Steel Snake Chain Necklace 18K Gold Plated', price: 39 } }));
  await page.goto('/#/products');
  await expect.poll(async () => (await json(await page.request.get(`/api/products/${manual.id}`))).nameZh, { timeout: 20000 }).toMatch(/^测试商品\d+$/);
  await page.reload();
  const row = page.locator('.prow', { hasText: 'Snake Chain Necklace' });
  await expect(row.locator('.pname')).toHaveText(/测试商品\d+/);
  await expect(row.locator('.pname-en')).toContainText('Snake Chain Necklace');

  // 写脚本：选择器显示中文名，按中文搜索
  await page.goto('/#/scripts/new');
  await page.locator('.picker-btn').first().click();
  await page.fill('.picker-q', '脚链');
  await expect(page.locator('.picker-item')).toHaveCount(1);
  await expect(page.locator('.picker-item')).toContainText('蝴蝶吊坠可调节脚链');
  await expect(page.locator('.picker-item .pname-en')).toContainText('Butterfly Charm Anklet');
  await page.locator('.picker-item').click();
  await expect(page.locator('.picker-btn').first()).toContainText('蝴蝶吊坠可调节脚链');
  const chosen = await page.locator('#pid').inputValue();
  expect((await json(await page.request.get(`/api/products/${chosen}`))).name).toContain('Butterfly');

  // 每个页面的「?」打开当前页的说明
  await page.goto('/#/scripts/create');
  await expect(page.locator('.tab-hint')).toContainText('不用等脚本');
  await page.click('#help-btn');
  await expect(page.locator('.help-panel')).toContainText('AI 出片');
  await expect(page.locator('.help-steps li')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-drawer')).toHaveCount(0);
  await page.goto('/#/launch');
  await page.click('#help-btn');
  await expect(page.locator('.help-panel')).toContainText('保本');
  await page.locator('.help-panel a[href="#/guide"]').click();
  await expect(page).toHaveURL(/#\/guide/);
  await expect(page.locator('.gf-step')).toHaveCount(4);
  await expect(page.locator('.guide-card')).toHaveCount(13);
  await expect(page.locator('#g-scripts-studio')).toContainText('批量出片');

  await json(await page.request.delete(`/api/products/${manual.id}`));
  if (!sampleBefore) await json(await page.request.delete('/api/sample'));
});
