// 所有上传框都能 Ctrl+V 粘贴复制的图片：主上传框默认接收，鼠标停在哪个框上就给哪个，弹窗优先；输入框里粘贴文字不受影响
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
// 模拟「复制图片」后按 Ctrl+V：在当前焦点上触发 paste 事件，剪贴板里是一张 PNG（可以再带一段文字）
async function paste(page, { text } = {}) {
  await page.evaluate(async (txt) => {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#d4af37';
    g.fillRect(0, 0, 96, 96);
    g.fillStyle = '#ffffff';
    g.fillRect(24, 24, 48, 48);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    if (txt) dt.setData('text/plain', txt);
    (document.activeElement || document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text || '');
}

test('粘贴图片：AI 出片的参考图和镜头首帧、写脚本素材、批量出片素材、生成视频的首帧', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  const list = await json(await page.request.get('/api/providers'));
  let llm = list.items.find((x) => x.baseUrl === `${UP}/v1`);
  if (!llm) llm = await json(await page.request.post('/api/providers', { data: { name: '测试模型', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'glm-test' } }));
  await json(await page.request.post(`/api/providers/${llm.id}/activate`));

  // AI 出片：默认进商品参考图
  await page.goto('/#/scripts/create');
  await expect(page.locator('#refdrop')).toContainText('Ctrl+V');
  await paste(page);
  await expect(page.locator('#refs .asset')).toHaveCount(1);
  // 鼠标停在第 1 个镜头的首帧框上粘贴：变成这个镜头的首帧，参考图不变
  await page.hover('.shot[data-i="0"] .shot-frame');
  await paste(page);
  await expect(page.locator('.shot[data-i="0"] .shot-frame img')).toBeVisible();
  await expect(page.locator('#refs .asset')).toHaveCount(1);
  // 在输入框里粘贴文字（剪贴板里同时有图片，比如从 Excel 复制）：照常粘贴文字，不上传
  await page.mouse.move(0, 0);
  await page.locator('.shot-prompt').first().focus();
  await paste(page, { text: 'A hand lifts the necklace' });
  await page.waitForTimeout(500);
  await expect(page.locator('#refs .asset')).toHaveCount(1);

  // 写脚本：不是「只传素材」时提示先切换；切过去后粘贴的图直接当素材，AI 自动认商品
  await page.goto('/#/scripts/new');
  await page.click('#srcs [data-src=lib]');
  await page.locator('#gen').focus();
  await paste(page);
  await expect(page.locator('.toast').last()).toContainText('只传素材');
  await page.click('#srcs [data-src=assets]');
  await paste(page);
  await expect(page.locator('#athumbs .asset')).toHaveCount(1);
  await expect(page.locator('#aname')).toHaveValue(/Gold Tennis Necklace/, { timeout: 20000 });

  // 批量出片：进商品素材
  await page.goto('/#/scripts/studio');
  await paste(page);
  await expect(page.locator('#assets .asset')).toHaveCount(1);

  // 生成视频的对话框：粘贴的图自动当首帧
  const relay = await json(await page.request.post('/api/connectors', { data: { vendor: 'videonewapi', name: '粘贴测试中转站', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1`, model: 'seedance-2.0-mini-720p' } } }));
  const s = await json(await page.request.post('/api/scripts/manual', { data: { title: '粘贴首帧测试', shots: [{ prompt: 'A hand holds the necklace', duration: 5 }] } }));
  await page.goto(`/#/scripts/${s.id}`);
  await page.click('#to-video');
  await expect(page.locator('#img-field')).toBeHidden();
  await paste(page);
  await expect(page.locator('[name=imageSource]')).toHaveValue('upload');
  await expect(page.locator('#img-field')).toBeVisible();
  expect(await page.locator('[name=image]').evaluate((i) => i.files.length)).toBe(1);
  await page.locator('.modal [data-close]').first().click();

  await json(await page.request.delete(`/api/scripts/${s.id}`));
  await json(await page.request.delete(`/api/connectors/${relay.id}`));
});
