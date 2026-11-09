// 商品的爆款视频：粘贴 TikTok 链接 → 不点进去就能看到播放 / 点赞 / 评论 / 收藏 / 分享 → 存到服务器 → 播放、保存 → 一键拆解
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

test('爆款视频：贴链接看数据 → 存视频 → 播放和保存 → 一键拆解；拆解页也能直接贴链接', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  const list = await json(await page.request.get('/api/providers'));
  let llm = list.items.find((x) => x.baseUrl === `${UP}/v1`);
  if (!llm) llm = await json(await page.request.post('/api/providers', { data: { name: '测试模型', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'glm-test' } }));
  await json(await page.request.post(`/api/providers/${llm.id}/activate`));
  const prod = await json(await page.request.post('/api/products', { data: { name: 'Crushed Ice Tennis Necklace Viral Test', price: 29 } }));
  // 没有链接时说清楚链接长什么样
  const bad = await page.request.post(`/api/products/${prod.id}/videos`, { data: { text: '这里没有链接' } });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain('没找到 TikTok 视频链接');

  await page.goto('/#/products');
  await page.locator('.prow', { hasText: 'Viral Test' }).first().click();
  await page.click('#pdtabs [data-tab=videos]');
  await expect(page.locator('.pv-add')).toContainText('粘贴 TikTok 视频链接');
  await expect(page.locator('.pv-add a[href*="tiktok.com/search"]')).toContainText('Crushed Ice Tennis Necklace');
  await page.fill('#pv-text', '对标 https://www.tiktok.com/@ariana_25111/video/7300000000000000001?lang=en 还有短链接 https://www.tiktok.com/t/ZTshort/ 和一条删了的 https://www.tiktok.com/@gone/video/7300000000000000009');
  await page.click('#pv-go');
  await expect(page.locator('.pv-card')).toHaveCount(2);
  await expect(page.locator('#pv-err')).toContainText('看不到');
  const card = page.locator('.pv-card', { hasText: '@ariana_25111' });
  await expect(card.locator('.pv-stats')).toContainText('813');
  await expect(card.locator('.pv-stats')).toContainText('收藏');
  await expect(card.locator('.pv-author')).toContainText('粉丝 1.3万');
  await expect(card.locator('.pv-cover img')).toBeVisible();
  await expect(page.locator('.pv-card', { hasText: '@shorty' })).toHaveCount(1);

  // 存到服务器 → 播放、保存到电脑
  await card.locator('[data-act=dl]').click();
  const save = card.locator('a', { hasText: '保存到电脑' });
  await expect(save).toBeVisible({ timeout: 20000 });
  const file = await page.request.get(await save.getAttribute('href'));
  expect(file.ok()).toBeTruthy();
  expect(file.headers()['content-type']).toContain('video/mp4');
  expect(file.headers()['content-disposition']).toContain('attachment');
  await card.locator('[data-act=play]').click();
  await expect(page.locator('.pv-player video')).toHaveAttribute('src', /\/api\/media\//);
  await page.locator('.modal-mask').last().locator('[data-close]').first().click();

  // 刷新数据：显示比上次多了多少点赞
  await card.locator('[data-act=refresh]').click();
  await expect(card.locator('.pv-meta')).toContainText('点赞比上次 +');

  // 一键拆解：播放、点赞、链接一起带过去
  await card.locator('[data-act=analyze]').click();
  const see = card.locator('a', { hasText: '看拆解' });
  await expect(see).toBeVisible({ timeout: 20000 });
  const viralId = (await see.getAttribute('href')).split('/').pop();
  const v = await json(await page.request.get(`/api/viral/${viralId}`));
  expect(v.context.url).toBe('https://www.tiktok.com/@ariana_25111/video/7300000000000000001');
  expect(v.context.views).toBe(344500);
  expect(v.context.notes).toContain('收藏 813');
  await see.click();
  await expect(page).toHaveURL(new RegExp(`#/scripts/viral/${viralId}`));

  // 爆款拆解页：直接贴链接
  await page.fill('#v-link', 'https://www.tiktok.com/@linky/video/7300000000000000004');
  await page.click('#v-link-go');
  await expect(page.locator('#vlist .list-item', { hasText: '@linky' })).toHaveCount(1, { timeout: 20000 });

  // 删除商品时爆款视频一起删掉
  const ids = (await json(await page.request.get(`/api/products/${prod.id}/videos`))).items.map((x) => x.id);
  expect(ids).toHaveLength(2);
  await json(await page.request.delete(`/api/products/${prod.id}`));
  expect((await page.request.get(`/api/tt-videos/${ids[0]}`)).status()).toBe(404);
  for (const x of (await json(await page.request.get('/api/viral'))).items.filter((i) => i.title.includes('@ariana_25111') || i.title.includes('@linky'))) await json(await page.request.delete(`/api/viral/${x.id}`));
});
