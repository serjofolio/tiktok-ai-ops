// 测试专用启动：全新的数据目录 + 本地模拟大模型上游（127.0.0.1:3902）
const fs = require('fs');
const path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'test-results', 'data');
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;
require('./fake-upstream').start(Number(process.env.FAKE_PORT) || 3902).then(() => require('../server/index.js').main());
