// 测试专用启动：每次使用全新的数据目录
const fs = require('fs');
const path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'test-results', 'data');
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;
require('../server/index.js').main();
