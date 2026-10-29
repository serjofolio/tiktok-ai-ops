#!/usr/bin/env bash
# macOS / Linux 启动脚本
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "请先安装 Node.js 18+：https://nodejs.org"; exit 1; }
[ -d node_modules/express ] || npm install --omit=dev
PORT=${PORT:-3800} node server/index.js --open
