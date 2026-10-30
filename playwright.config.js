// Playwright 无头浏览器端到端测试配置
const { defineConfig } = require('@playwright/test');
const path = require('path');

const PORT = 3899;
module.exports = defineConfig({
  testDir: './tests',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/serve.js',
    url: `http://localhost:${PORT}/api/auth/me`,
    reuseExistingServer: false,
    timeout: 30000,
    env: { PORT: String(PORT), DATA_DIR: path.join(__dirname, 'test-results', 'data') },
  },
});
