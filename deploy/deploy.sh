#!/usr/bin/env bash
# 在你自己的 macOS / Linux 电脑上运行：打包 → 上传 → 远程安装
# 用法：./deploy/deploy.sh [root@服务器IP] [ssh端口]
# 服务器地址不写进仓库：不带参数时读 deploy/deploy.env 里的 DEPLOY_SERVER=root@服务器IP（该文件已被 git 忽略）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_SERVER=""
if [ -f "$ROOT/deploy/deploy.env" ]; then ENV_SERVER="$(sed -n 's/^DEPLOY_SERVER=//p' "$ROOT/deploy/deploy.env" | tr -d '\r' | tail -n 1)"; fi
SERVER="${1:-$ENV_SERVER}"
if [ -z "$SERVER" ]; then echo "用法：./deploy/deploy.sh root@服务器IP（或在 deploy/deploy.env 里写 DEPLOY_SERVER=root@服务器IP）"; exit 1; fi
SSH_PORT="${2:-22}"
APP_PORT="${APP_PORT:-5100}"
DOMAIN="${DOMAIN:-tkagent.hyff.cc.cd}"
BUNDLE="$(mktemp -d)/tkagent.tar.gz"
echo "[1/3] 打包代码"
tar -czf "$BUNDLE" --exclude=node_modules --exclude=data --exclude=test-results --exclude=playwright-report --exclude=.git --exclude=design --exclude=deploy.env -C "$ROOT" .
echo "[2/3] 上传到 $SERVER"
FILES=("$BUNDLE" "$ROOT/deploy/install.sh")
if [ -f "$ROOT/deploy/deploy.env" ]; then cp "$ROOT/deploy/deploy.env" "$(dirname "$BUNDLE")/tkagent.env"; FILES+=("$(dirname "$BUNDLE")/tkagent.env"); fi
scp -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new "${FILES[@]}" "$SERVER:/tmp/"
echo "[3/3] 远程安装"
ssh -p "$SSH_PORT" -t "$SERVER" "PORT=$APP_PORT DOMAIN=$DOMAIN bash /tmp/install.sh /tmp/tkagent.tar.gz && rm -f /tmp/tkagent.tar.gz"
