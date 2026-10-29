// 端到端测试：Playwright 无头模式，离线演示模式下覆盖全部核心功能
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

let errors = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|status of 502/.test(m.text()) && errors.push(m.text()));
});
test.afterEach(async () => {
  expect(errors, `页面存在 JS 错误：\n${errors.join('\n')}`).toEqual([]);
});

const PAGES = [
  ['dashboard', '总览'],
  ['workflows', '一键工作流'],
  ['agents', 'AI 智能体'],
  ['products', '智能选品'],
  ['scripts', '脚本工坊'],
  ['images', '图片工坊'],
  ['videos', '视频工坊'],
  ['knowledge', '知识库'],
  ['settings', '系统设置'],
];

test('所有页面均可正常打开', async ({ page }) => {
  for (const [p, title] of PAGES) {
    await page.goto(`/#/${p}`);
    await expect(page.locator('#page-title')).toHaveText(title);
    await expect(page.locator('#view .skeleton').first()).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('#view')).not.toContainText('页面加载失败');
  }
});

test('总览：统计与潜力爆品', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero h2')).toContainText('今天打造哪款爆品');
  await expect(page.locator('.stat-strip > div')).toHaveCount(4);
  await expect(page.locator('.stat-value').first()).not.toHaveText('0');
  await expect(page.locator('.ticker-item').first()).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(6);
  await expect(page.locator('#mode-chip')).toContainText('离线演示模式');
});

test('智能选品：筛选、排序、详情与 AI 分析、选品池', async ({ page }) => {
  await page.goto('/#/products');
  await expect(page.locator('.product').first()).toBeVisible();
  const total = await page.locator('.product').count();
  expect(total).toBeGreaterThan(30);
  await page.selectOption('#cat', '宠物用品');
  await expect(page.locator('.product')).toHaveCount(4);
  await page.click('#sort button[data-k=growth]');
  await page.locator('.product .fav').first().click();
  await expect(page.locator('.toast').last()).toContainText('已加入选品池');
  await page.locator('.product').first().click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.click('#an');
  await expect(page.locator('#an-box')).toContainText('核心卖点');
  await page.keyboard.press('Escape');
  await page.click('#vmode button[data-v=table]');
  await expect(page.locator('table tbody tr')).toHaveCount(4);
});

test('智能选品：CSV 导入', async ({ page }) => {
  await page.goto('/#/products');
  await page.click('#import');
  await page.fill('#csv', 'name,nameCn,category,price,cost,commissionRate,sales7d,salesGrowth,competition,rating\nTest Desk Fan,测试桌面风扇,3C数码,15.99,4.5,15,5200,86,38,4.6');
  await page.click('#go');
  await expect(page.locator('.toast').last()).toContainText('成功导入 1 个商品');
  await page.fill('#q', '测试桌面风扇');
  await expect(page.locator('.product')).toHaveCount(1);
});

test('脚本工坊：生成分镜脚本 → 分镜图 → 合成视频', async ({ page }) => {
  await page.goto('/#/scripts');
  await page.click('#styles .preset[data-k=unboxing]');
  await page.selectOption('#dur', '15');
  await page.click('#gen');
  await expect(page.locator('#viewer .scene')).toHaveCount(4);
  await expect(page.locator('#viewer')).toContainText('黄金 3 秒钩子');
  await page.click('#toimg');
  await expect(page).toHaveURL(/#\/videos\/vi_/, { timeout: 20000 });
  await expect(page.locator('.modal canvas')).toBeVisible();
});

test('图片工坊：文生图与图库', async ({ page }) => {
  await page.goto('/#/images');
  await page.selectOption('#pp', { index: 1 });
  await expect(page.locator('#prompt')).not.toHaveValue('');
  await page.click('#st .preset[data-i="1"]');
  await page.selectOption('#count', '2');
  const before = await page.locator('#gal .media').count();
  await page.click('#gen');
  await expect(page.locator('#gal .media')).toHaveCount(before + 2);
  const src = await page.locator('#gal .media img').first().getAttribute('src');
  const res = await page.request.get(src);
  expect(res.ok()).toBeTruthy();
});

test('图片上传 + 视频工坊：图生视频与播放', async ({ page }) => {
  const png = path.join(__dirname, '..', 'test-results', 'pixel.png');
  fs.mkdirSync(path.dirname(png), { recursive: true });
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.goto('/#/images');
  await page.setInputFiles('#file', png);
  await expect(page.locator('.toast').last()).toContainText('上传成功');
  await page.goto('/#/videos');
  await page.click('#mo .preset[data-i="2"]');
  await page.fill('#cap', 'Stop scrolling!');
  await page.click('#gen');
  await expect(page.locator('.toast').last()).toContainText('视频任务已提交');
  await expect(page.locator('#list .media').first()).toContainText('Stop scrolling!');
  await expect(page.locator('#list .media').first().locator('.badge')).toHaveText('完成', { timeout: 10000 });
  await page.locator('#list .media').first().click();
  await expect(page.locator('.modal canvas')).toBeVisible();
  await expect(page.locator('.modal .player-time')).not.toHaveText('0.0s / 0.0s');
});

test('知识库：上传文档、检索与问答', async ({ page }) => {
  const doc = path.join(__dirname, '..', 'test-results', '售后话术.md');
  fs.writeFileSync(doc, '# 售后话术\n\n## 退款处理\n买家申请退款时，先安抚情绪，48 小时内给出解决方案，优先补发或部分退款，避免差评。\n\n## 物流延迟\n主动告知物流单号并赠送优惠券。');
  await page.goto('/#/knowledge');
  await expect(page.locator('#kbs .list-item')).toHaveCount(1);
  await expect(page.locator('#pane table tbody tr')).toHaveCount(5);
  await page.setInputFiles('#file', doc);
  await expect(page.locator('#pane table tbody tr')).toHaveCount(6, { timeout: 10000 });
  await page.click('#tabs button[data-t=search]');
  await page.fill('#q', '退款 差评');
  await page.click('#s');
  await expect(page.locator('#hits .hit').first()).toContainText('售后话术');
  await page.click('#tabs button[data-t=ask]');
  await page.fill('#q', '视频前3秒怎么写钩子');
  await page.click('#ask');
  await expect(page.locator('#ans')).toContainText('引用来源');
  await expect(page.locator('#ans')).toContainText('爆款短视频脚本公式');
});

test('知识库：新建知识库并粘贴文本', async ({ page }) => {
  await page.goto('/#/knowledge');
  await page.click('#new-kb');
  await page.fill('.modal #n', '产品资料库');
  await page.click('.modal #ok');
  await expect(page.locator('#kbs .list-item')).toHaveCount(2);
  await page.click('#paste');
  await page.fill('.modal #t', '迷你风扇参数');
  await page.fill('.modal #c', '风扇续航 12 小时，三档风速，USB-C 充电。');
  await page.click('.modal #ok');
  await expect(page.locator('#pane table tbody tr')).toHaveCount(1);
});

test('智能体：对话触发工具调用', async ({ page }) => {
  await page.goto('/#/agents');
  await expect(page.locator('#agents .agent-item')).toHaveCount(3);
  await page.locator('#sug .chip').first().click();
  await expect(page.locator('.tool-call').first()).toContainText('搜索商品库', { timeout: 15000 });
  await expect(page.locator('.msg.ai .bubble table')).toBeVisible();
  await page.fill('#inp', '给厨房类爆品写一个开箱脚本');
  await page.keyboard.press('Enter');
  await expect(page.locator('#msgs')).toContainText('脚本：', { timeout: 15000 });
  await expect(page.locator('#sessions .list-item')).toHaveCount(1);
});

test('智能体：新建自定义智能体', async ({ page }) => {
  await page.goto('/#/agents');
  await page.click('#new-agent');
  await page.fill('.modal [name=name]', '直播运营 Mia');
  await page.click('.modal #save');
  await expect(page.locator('#agents .agent-item')).toHaveCount(4);
  await expect(page.locator('#chat-head')).toContainText('直播运营 Mia');
  await page.click('#api-doc');
  await expect(page.locator('.modal #tl')).toContainText('search_products');
});

test('一键工作流：选品 → 脚本 → 生图 → 视频 → 素材包', async ({ page }) => {
  await page.goto('/#/workflows');
  await page.selectOption('#cat', '美妆个护');
  await page.selectOption('#ic', '3');
  await page.click('#go');
  await expect(page.locator('#detail .pipe-node.done')).toHaveCount(5, { timeout: 30000 });
  await expect(page.locator('#detail')).toContainText('发布素材包');
  await expect(page.locator('#detail .scene img')).toHaveCount(3);
  await expect(page.locator('#wf-player canvas')).toBeVisible();
  await expect(page.locator('#hist .list-item').first()).toContainText('完成');
});

test('系统设置：预设切换与保存', async ({ page }) => {
  await page.goto('/#/settings');
  const card = page.locator('[data-sec=store]');
  await card.locator('[name=name]').fill('Feng 的美妆小店');
  await card.locator('[data-save]').click();
  await expect(page.locator('.toast').last()).toContainText('配置已保存');
  const llm = page.locator('[data-sec=llm]');
  await llm.locator('[data-preset="1"]').click();
  await expect(llm.locator('[name=baseUrl]')).toHaveValue('https://api.deepseek.com/v1');
  await expect(llm.locator('[name=apiKey]')).toBeVisible();
  await page.goto('/');
  await expect(page.locator('.hero h2')).toContainText('Feng 的美妆小店');
});

test('主题切换与移动端布局', async ({ page }) => {
  await page.goto('/');
  await page.click('#theme-btn');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#theme-btn');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#menu-btn');
  await expect(page.locator('#app')).toHaveClass(/nav-open/);
  await page.click('.nav a[data-path=products]');
  await expect(page.locator('#page-title')).toHaveText('智能选品');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBeFalsy();
});

test('开放工具 API', async ({ request }) => {
  const r = await request.get('/api/tools');
  const { tools } = await r.json();
  expect(tools.map((t) => t.name)).toContain('write_script');
  const s = await request.post('/api/tools/search_products', { data: { category: '3C数码', limit: 3 } });
  const { result } = await s.json();
  expect(result).toHaveLength(3);
});

test('系统设置：从上游自动获取模型列表', async ({ page }) => {
  // 启动一个模拟的 OpenAI 兼容上游
  const http = require('http');
  const upstream = http.createServer((req, res) => {
    if (req.url === '/v1/models' && req.headers.authorization === 'Bearer sk-test') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'text-embedding-v3' }, { id: 'doubao-seedream-4-0' }] }));
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: 'invalid key' } }));
  });
  await new Promise((r) => upstream.listen(3901, r));
  try {
    await page.goto('/#/settings');
    const llm = page.locator('[data-sec=llm]');
    await llm.locator('[data-preset="1"]').click();
    await llm.locator('[name=baseUrl]').fill('http://localhost:3901/v1');
    await llm.locator('[name=apiKey]').fill('sk-wrong');
    await llm.locator('[data-fetch]').click();
    await expect(llm.locator('[data-mcount]')).toContainText('获取失败');
    await llm.locator('[name=apiKey]').fill('sk-test');
    await llm.locator('[data-fetch]').click();
    await expect(llm.locator('[data-mcount]')).toContainText('4 个模型');
    await expect(llm.locator('.model-menu button')).toHaveCount(4);
    await expect(llm.locator('.model-menu button').first()).toContainText('deepseek-chat');
    await llm.locator('.model-menu button', { hasText: 'deepseek-reasoner' }).click();
    await expect(llm.locator('[name=model]')).toHaveValue('deepseek-reasoner');
    await llm.locator('[data-save]').click();
    // 已保存 key 后再次进入页面会自动拉取
    await page.goto('/#/dashboard');
    await page.goto('/#/settings');
    await expect(page.locator('[data-sec=llm] [data-mcount]')).toContainText('4 个模型');
    const emb = page.locator('[data-sec=embedding]');
    await emb.locator('[data-preset="1"]').click();
    await emb.locator('[name=baseUrl]').fill('http://localhost:3901/v1');
    await emb.locator('[name=apiKey]').fill('sk-test');
    await emb.locator('[data-fetch]').click();
    await expect(emb.locator('.model-menu button').first()).toContainText('text-embedding-v3');
    // 恢复离线模式，避免影响其他用例
    await page.locator('[data-sec=llm] [data-preset="0"]').click();
    await page.locator('[data-sec=llm] [data-save]').click();
    await expect(page.locator('#mode-chip')).toContainText('离线演示模式');
  } finally {
    upstream.close();
  }
});
