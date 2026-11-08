#!/usr/bin/env bash
# TikTok AI 运营台 —— 服务器最小化安装脚本（在服务器上以 root 运行）
# 用法：bash install.sh /tmp/tkagent.tar.gz
#  - 仅安装运行所需：Node.js 运行时（官方二进制）+ 生产依赖，不装数据库、不装 Nginx
#  - 服务只监听 127.0.0.1:5100，外网无法用 IP+端口访问；由 Cloudflare 隧道转发到 tkagent.hyff.cc.cd
set -euo pipefail

BUNDLE="${1:-/tmp/tkagent.tar.gz}"
# 私密配置（隧道 token 等）随安装包上传到 /tmp/tkagent.env，读取后立即删除
if [ -f /tmp/tkagent.env ]; then set -a; . <(sed "s/\r$//" /tmp/tkagent.env); set +a; rm -f /tmp/tkagent.env; fi
APP_DIR=/opt/tkagent
DATA_DIR=/var/lib/tkagent
SVC_USER=tkagent
PORT="${PORT:-5100}"
DOMAIN="${DOMAIN:-tkagent.hyff.cc.cd}"
NODE_MAJOR=22

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "请以 root 运行"
[ -f "$BUNDLE" ] || die "找不到安装包 $BUNDLE"
command -v systemctl >/dev/null || die "需要 systemd"
command -v curl >/dev/null || { log "安装 curl"; (apt-get update -qq && apt-get install -y -qq curl ca-certificates) || (dnf -y install curl || yum -y install curl); }

# ---------- 1. Node.js 运行时（已有 18+ 则复用）----------
need_node=1
if command -v node >/dev/null; then
  v=$(node -v | sed 's/^v//; s/\..*//')
  [ "$v" -ge 20 ] && need_node=0 && log "复用已安装的 Node.js $(node -v)"
fi
if [ $need_node = 1 ]; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) die "不支持的架构 $(uname -m)" ;;
  esac
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  file=$(curl -fsSL "$base/SHASUMS256.txt" | awk '{print $2}' | grep -E "^node-v[0-9.]+-linux-${arch}\.tar\.gz$" | head -1)
  [ -n "$file" ] || die "无法获取 Node.js 版本列表"
  log "安装 Node.js：$file"
  tmp=$(mktemp -d)
  curl -fsSL "$base/$file" -o "$tmp/$file"
  curl -fsSL "$base/SHASUMS256.txt" | grep " $file\$" | (cd "$tmp" && sha256sum -c -) >/dev/null || die "Node.js 校验失败"
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xzf "$tmp/$file" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm
  rm -rf "$tmp"
fi
NODE_BIN=$(command -v node)

# ---------- 2. 运行账户与目录 ----------
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"

# ---------- 3. 部署代码：先在旁边装好新版本，再停服务切换（装依赖失败时旧版本照常运行）----------
STAGE="$APP_DIR.new"
OLD="$APP_DIR.old"
log "解压新版本到 $STAGE"
rm -rf "$STAGE" && mkdir -p "$STAGE"
tar -xzf "$BUNDLE" -C "$STAGE"
# 复用旧版本的依赖，npm 只补差异
[ -d "$APP_DIR/node_modules" ] && cp -a "$APP_DIR/node_modules" "$STAGE/"
cd "$STAGE"
log "安装生产依赖（旧版本还在运行）"
npm install --omit=dev --no-audit --no-fund --loglevel=error || { rm -rf node_modules; npm ci --omit=dev --no-audit --no-fund --loglevel=error; }
# 记下版本，自动更新据此判断要不要装
if [ -n "${DEPLOY_SHA:-}" ]; then echo "$DEPLOY_SHA" > "$STAGE/.deployed-sha"; fi
# 拆解和合并视频要用 ffmpeg：npm 的可选依赖没装上时用系统包
if [ ! -x "$STAGE/node_modules/ffmpeg-static/ffmpeg" ] && ! command -v ffmpeg >/dev/null; then
  log "安装 ffmpeg"
  (apt-get update -qq && apt-get install -y -qq ffmpeg) || (dnf -y install ffmpeg || yum -y install ffmpeg) || log "ffmpeg 安装失败：爆款拆解和视频合并不可用"
fi
systemctl stop tkagent 2>/dev/null || true
# 升级前备份数据目录（保留最近 10 份）
if [ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
  mkdir -p /var/backups/tkagent
  # 视频文件很大且部署不会动它，不进备份
  tar -czf "/var/backups/tkagent/data-$(date +%Y%m%d-%H%M%S).tar.gz" --exclude=./media --exclude=./uploads -C "$DATA_DIR" .
  ls -1t /var/backups/tkagent/data-*.tar.gz | tail -n +11 | xargs -r rm -f
  log "数据已备份到 /var/backups/tkagent"
fi
# 切换：旧版本留在 $OLD，新版本启动失败时自动换回去
rm -rf "$OLD"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$OLD"; fi
mv "$STAGE" "$APP_DIR"
cd "$APP_DIR"
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR" "$DATA_DIR"
chmod 750 "$DATA_DIR"
# 还没有任何账号时，在服务启动前先创建管理员，避免别人抢先注册成为管理员
# ADMIN_USER / ADMIN_PASSWORD 可放在 deploy.env；不填密码则随机生成并打印
if [ -n "${ADMIN_USER:-}" ] && ! grep -q '"username"' "$DATA_DIR/users.json" 2>/dev/null; then
  log "创建管理员账号 $ADMIN_USER"
  runuser -u "$SVC_USER" -- env DATA_DIR="$DATA_DIR" "$NODE_BIN" server/cli.js admin "$ADMIN_USER" ${ADMIN_PASSWORD:-}
fi

# ---------- 4. systemd 服务 ----------
log "写入 systemd 服务 tkagent.service"
cat > /etc/systemd/system/tkagent.service <<EOF
[Unit]
Description=TikTok AI 运营台
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
Environment=ALLOWED_HOSTS=$DOMAIN
ExecStart=$NODE_BIN server/index.js
Restart=on-failure
RestartSec=3
# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tkagent

# ---------- 5. 防火墙：再加一道保险，外网访问 5100 一律丢弃 ----------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw deny "$PORT"/tcp >/dev/null && log "ufw 已拒绝外部访问 $PORT"
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --remove-port="$PORT"/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null && log "firewalld 未放行 $PORT"
elif command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport "$PORT" ! -i lo -j DROP 2>/dev/null || iptables -I INPUT -p tcp --dport "$PORT" ! -i lo -j DROP
  log "iptables 已丢弃非本机访问 $PORT（重启后由服务监听 127.0.0.1 继续保证不可外部访问）"
fi

# ---------- 6. Cloudflare 隧道（提供了 CF_TUNNEL_TOKEN 时安装）----------
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  if ! command -v cloudflared >/dev/null; then
    log "安装 cloudflared"
    if command -v apt-get >/dev/null; then
      mkdir -p --mode=0755 /usr/share/keyrings
      curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
      echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
      apt-get update -qq && apt-get install -y -qq cloudflared
    else
      case "$(uname -m)" in x86_64) cfa=amd64 ;; aarch64|arm64) cfa=arm64 ;; esac
      curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cfa}" -o /usr/local/bin/cloudflared
      chmod +x /usr/local/bin/cloudflared
    fi
  fi
  if systemctl list-unit-files cloudflared.service >/dev/null 2>&1 && systemctl is-enabled cloudflared >/dev/null 2>&1; then
    log "cloudflared 服务已存在，重启以应用"
    systemctl restart cloudflared
  else
    log "以系统服务方式安装 Cloudflare 隧道"
    cloudflared service install "$CF_TUNNEL_TOKEN"
  fi
  sleep 3
  systemctl is-active --quiet cloudflared && log "cloudflared 运行中" || { journalctl -u cloudflared -n 20 --no-pager; die "cloudflared 未能启动"; }
fi

# ---------- 7. 自检 ----------
log "等待服务启动"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/auth/me" || true)
  [ "$code" = 200 ] && break
  sleep 1
done
if [ "$code" != 200 ]; then
  journalctl -u tkagent -n 40 --no-pager
  if [ -d "$OLD" ]; then
    log "新版本没有启动起来，换回旧版本"
    systemctl stop tkagent || true
    rm -rf "$APP_DIR.failed" && mv "$APP_DIR" "$APP_DIR.failed" && mv "$OLD" "$APP_DIR"
    systemctl start tkagent
  fi
  die "服务未能启动（失败的版本留在 $APP_DIR.failed 方便排查）"
fi
ip_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: 1.2.3.4:$PORT" "http://127.0.0.1:$PORT/" || true)
listen=$(ss -tlnp 2>/dev/null | grep ":$PORT " | awk '{print $4}' | head -1)

# ---------- 8. 自动更新：每 5 分钟查一次 GitHub，main 上 CI 全部通过的新提交自动安装 ----------
# deploy.env 里写 AUTO_UPDATE=0 可以关闭
mkdir -p /etc/tkagent
printf 'PORT=%s\nDOMAIN=%s\n' "$PORT" "$DOMAIN" > /etc/tkagent/deploy.conf
if [ "${AUTO_UPDATE:-1}" != 0 ]; then
  install -m 755 "$APP_DIR/deploy/autoupdate.sh" /usr/local/sbin/tkagent-autoupdate
  cat > /etc/systemd/system/tkagent-update.service <<UNIT
[Unit]
Description=TikTok AI 运营台自动更新
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/tkagent-autoupdate
TimeoutStartSec=1800
UNIT
  cat > /etc/systemd/system/tkagent-update.timer <<UNIT
[Unit]
Description=每 5 分钟检查运营台新版本

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now tkagent-update.timer >/dev/null 2>&1
  log "自动更新已开启：GitHub 上 CI 通过的新版本 5 分钟内自动安装（日志 journalctl -u tkagent-update）"
else
  systemctl disable --now tkagent-update.timer >/dev/null 2>&1 || true
  log "自动更新已关闭（AUTO_UPDATE=0）"
fi

echo
log "部署完成"
echo "   监听地址：$listen（仅本机）"
echo "   本机访问：200  ·  IP 直连 Host 头：$ip_code（应为 403）"
echo "   数据目录：$DATA_DIR"
echo "   查看日志：journalctl -u tkagent -f"
echo "   Cloudflare 隧道服务地址填写：http://127.0.0.1:$PORT  ，公网主机名：$DOMAIN"
