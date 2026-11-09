// 只传素材写脚本：看图认出商品（可以改）→ 写脚本 → 脚本记住素材 → 生成视频时素材当商品参考图，可以选模型、看花费
const { test, expect } = require('@playwright/test');
const path = require('path');

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
const sentRelay = async (model) => (await (await fetch(`${UP}/sent`)).json()).video.filter((x) => x.vendor === 'relay' && x.body.model === model);

test('只传素材：AI 看图认商品 → 改一改 → 写脚本 → 生成视频时素材当参考图，选模型看花费', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  const list = await json(await page.request.get('/api/providers'));
  let llm = list.items.find((x) => x.baseUrl === `${UP}/v1`);
  if (!llm) llm = await json(await page.request.post('/api/providers', { data: { name: '测试模型', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'glm-test' } }));
  await json(await page.request.post(`/api/providers/${llm.id}/activate`));
  for (const c of (await json(await page.request.get('/api/connectors'))).items.filter((x) => ['video', 'image', 'vision', 'asr'].includes(x.kind))) await json(await page.request.delete(`/api/connectors/${c.id}`));
  const relay = await json(await page.request.post('/api/connectors', { data: { vendor: 'videonewapi', name: '我的中转站', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1`, model: 'seedance-2.0-mini-720p' }, models: [{ label: 'Seedance Mini', id: 'seedance-2.0-mini-720p', price: 0.27, unit: '秒' }, { label: 'Seedance 2.0', id: 'seedance-2.0-720p', price: 0.756, unit: '秒' }] } }));

  // 不选商品、不填资料，只传两张商品图
  await page.goto('/#/scripts/new');
  await page.click('#srcs [data-src=assets]');
  await expect(page.locator('#assets-box')).toBeVisible();
  await expect(page.locator('#src-lib')).toBeHidden();
  await page.setInputFiles('#afile', [path.join(__dirname, '..', 'extension', 'icon128.png'), path.join(__dirname, '..', 'extension', 'icon48.png')]);
  await expect(page.locator('#athumbs .asset')).toHaveCount(2);
  // 自动看图认商品：名称、外观、看不出来要补的信息
  await expect(page.locator('#aname')).toHaveValue('金色锆石网球项链 · Gold Tennis Necklace', { timeout: 20000 });
  await expect(page.locator('#adesc')).toHaveValue(/外观：一条金色细链/);
  await expect(page.locator('.ai-prof')).toContainText('真实材质是不是 925 银镀金');
  // 认得不全的地方自己补上
  await page.fill('#adesc', `${await page.locator('#adesc').inputValue()}\n材质：925 银镀 14K 金（卖家确认）`);
  await page.selectOption('#count', '1');
  await page.click('#gen');
  await expect(page.locator('.src-assets')).toContainText('商品素材 2 张', { timeout: 30000 });
  const s = (await json(await page.request.get('/api/scripts'))).items[0];
  expect(s.productId).toBe('');
  expect(s.assetIds).toHaveLength(2);
  expect(s.productName).toContain('Gold Tennis Necklace');
  expect(s.productDesc).toContain('925 银镀 14K 金');

  // 生成视频：素材默认当参考图；可以选同一个中转站里的另一个模型，看到预计花费
  await page.click('#to-video');
  await expect(page.locator('.modal [name=refs]')).toBeChecked();
  await expect(page.locator('.modal .asset-row .asset')).toHaveCount(2);
  await page.locator('.modal [name=vm]').selectOption(`${relay.id}|seedance-2.0-720p`);
  await expect(page.locator('#plan')).toContainText('约 ¥');
  await page.click('#go');
  await expect(page).toHaveURL(/#\/scripts\/videos/);
  const job = (await json(await page.request.get('/api/video-jobs'))).items.find((j) => j.scriptId === s.id);
  expect(job.model).toBe('seedance-2.0-720p');
  expect(job.refs).toHaveLength(2);
  await expect.poll(async () => (await sentRelay('seedance-2.0-720p')).length, { timeout: 20000 }).toBeGreaterThan(0);
  const [first] = await sentRelay('seedance-2.0-720p');
  expect(first.body.images).toHaveLength(2);
  expect(first.body.images[0].role).toBe('reference_image');
  expect(first.body.images[0].url).toMatch(/^data:image\/jpeg;base64,/);
  expect(first.body.prompt).toContain('reference image');
  await expect.poll(async () => (await json(await page.request.get('/api/video-jobs'))).items.find((j) => j.id === job.id).status, { timeout: 40000 }).toBe('done');

  // 在 AI 出片里改分镜：素材直接变成商品参考图
  await page.goto(`/#/scripts/create/${s.id}`);
  await expect(page.locator('#refs .asset')).toHaveCount(2);
  // 回到这条脚本：来源自动是「只传素材」，素材和改过的商品介绍都在，可以接着写别的开头
  await page.goto(`/#/scripts/${s.id}`);
  await expect(page.locator('#srcs [data-src=assets]')).toHaveClass(/on/);
  await expect(page.locator('#athumbs .asset')).toHaveCount(2);
  await expect(page.locator('#adesc')).toHaveValue(/925 银镀 14K 金/);

  await json(await page.request.delete(`/api/video-jobs/${job.id}`));
  await json(await page.request.delete(`/api/scripts/${s.id}`));
  await json(await page.request.delete(`/api/connectors/${relay.id}`));
});
