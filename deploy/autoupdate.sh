#!/usr/bin/env bash
# 自动更新：服务器定时查 GitHub，main 分支有新的、CI 全部通过（测试 + 密钥扫描）的提交时，下载并安装
# 由 install.sh 安装成 systemd 定时器 tkagent-update.timer（每 5 分钟），不需要在 GitHub 上存任何服务器信息
# 关闭：systemctl disable --now tkagent-update.timer    手动跑一次：systemctl start tkagent-update.service
set -euo pipefail

CONF=/etc/tkagent/deploy.conf
[ -f "$CONF" ] && . "$CONF"
REPO="${REPO:-serjofolio/tiktok-ai-ops}"
WORKFLOW="${WORKFLOW:-test.yml}"
APP_DIR=/opt/tkagent
STAMP="$APP_DIR/.deployed-sha"
NODE_BIN="$(command -v node)"

exec 9>/run/tkagent-update.lock
flock -n 9 || { echo "上一次更新还没结束"; exit 0; }

# 最近一次 CI 成功的 main 提交
api="https://api.github.com/repos/$REPO/actions/workflows/$WORKFLOW/runs?branch=main&status=success&event=push&per_page=1"
sha=$(curl -fsSL -m 30 -H 'Accept: application/vnd.github+json' "$api" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).workflow_runs||[];process.stdout.write(r[0]?.head_sha||"")})')
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "没有读到 CI 通过的提交"; exit 0; }
current=$(cat "$STAMP" 2>/dev/null || true)
[ "$sha" = "$current" ] && exit 0

echo "发现新版本 ${sha:0:7}（当前 ${current:0:7}），开始更新"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -m 300 "https://codeload.github.com/$REPO/tar.gz/$sha" -o "$tmp/src.tar.gz"
mkdir "$tmp/src"
tar -xzf "$tmp/src.tar.gz" -C "$tmp/src" --strip-components=1
# 和手动部署打的包一样：不带设计稿和测试产物
tar -czf "$tmp/tkagent.tar.gz" --exclude=./design --exclude=./test-results --exclude=./playwright-report -C "$tmp/src" .
# 用新版本自己的安装脚本（安装流程有改动时一起生效）；失败会自动回滚到旧版本
DEPLOY_SHA="$sha" PORT="${PORT:-5100}" DOMAIN="${DOMAIN:-tkagent.hyff.cc.cd}" bash "$tmp/src/deploy/install.sh" "$tmp/tkagent.tar.gz"
echo "已更新到 ${sha:0:7}"
