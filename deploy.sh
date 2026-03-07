#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  LocalChat 一键部署脚本
#  适用系统：Ubuntu 20.04 / 22.04 / 24.04
#  运行方式：chmod +x deploy.sh && sudo ./deploy.sh
# ═══════════════════════════════════════════════════════════

set -euo pipefail

# ─── 颜色输出 ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── 配置变量（按需修改）───
APP_NAME="localchat"
# 自动检测真实用户（sudo 调用时取 SUDO_USER，否则取当前用户）
# 部署完成后所有文件归该用户所有，后续 start.sh / stop.sh 无需 sudo
APP_USER="${SUDO_USER:-$(whoami)}"
APP_GROUP="$(id -gn "$APP_USER" 2>/dev/null || echo "$APP_USER")"
NODE_VERSION="20"                      # Node.js LTS 版本
HTTPS_PORT="3443"
HTTP_PORT="3001"
DOMAIN=""                              # 可选：填入你的域名，用于 Let's Encrypt 证书
USE_NGINX="true"                       # 是否使用 Nginx 反向代理（推荐 true）
NGINX_PORT="443"                       # Nginx 监听的外部 HTTPS 端口

# ─── 检查 root 权限 ───
if [[ $EUID -ne 0 ]]; then
  log_error "请使用 root 权限运行此脚本：sudo ./deploy.sh"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "   LocalChat 部署脚本"
echo "═══════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════
# 步骤 1：更新系统软件包
# ═══════════════════════════════════════════════
log_info "步骤 1/8：更新系统软件包..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget git openssl ufw fail2ban
log_ok "系统软件包更新完成"

# ═══════════════════════════════════════════════
# 步骤 2：安装 Node.js
# ═══════════════════════════════════════════════
log_info "步骤 2/8：安装 Node.js ${NODE_VERSION}..."
if command -v node &>/dev/null; then
  CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [[ "$CURRENT_NODE" -ge "$NODE_VERSION" ]]; then
    log_ok "Node.js $(node -v) 已安装，跳过"
  else
    log_warn "当前 Node.js 版本过低，升级中..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
  fi
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
log_ok "Node.js $(node -v)，npm $(npm -v)"

# 安装 PM2（进程守护）
log_info "安装 PM2 进程管理器..."
npm install -g pm2 --quiet
log_ok "PM2 $(pm2 -v) 安装完成"

# ═══════════════════════════════════════════════
# 步骤 3：确定应用目录（脚本所在目录）
# ═══════════════════════════════════════════════
log_info "步骤 3/8：确定应用目录..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR"
log_ok "应用目录：${APP_DIR}"

# ═══════════════════════════════════════════════
# 步骤 4：初始化应用目录
# ═══════════════════════════════════════════════
log_info "步骤 4/8：初始化应用目录 ${APP_DIR}..."

# 确保数据目录存在
mkdir -p "$APP_DIR/data/files"

# 安装 npm 依赖
log_info "安装 npm 依赖包..."
cd "$APP_DIR"
npm install --production --quiet
log_ok "npm 依赖安装完成"

# ═══════════════════════════════════════════════
# 步骤 5：生成 SSL 自签名证书（如未提供域名）
# ═══════════════════════════════════════════════
log_info "步骤 5/8：配置 SSL 证书..."

if [[ -n "$DOMAIN" ]]; then
  # ── 使用 Let's Encrypt 证书（需要域名指向此服务器）──
  log_info "检测到域名 ${DOMAIN}，安装 Certbot..."
  apt-get install -y certbot
  if [[ "$USE_NGINX" == "true" ]]; then
    apt-get install -y python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@${DOMAIN}" || {
      log_warn "Let's Encrypt 申请失败，回退到自签名证书"
      DOMAIN=""
    }
  else
    certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --email "admin@${DOMAIN}" || {
      log_warn "Let's Encrypt 申请失败，回退到自签名证书"
      DOMAIN=""
    }
    if [[ -n "$DOMAIN" ]]; then
      ln -sf "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "$APP_DIR/key.pem"
      ln -sf "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "$APP_DIR/cert.pem"
    fi
  fi
fi

if [[ -z "$DOMAIN" ]] && [[ ! -f "$APP_DIR/key.pem" ]]; then
  log_info "生成自签名 SSL 证书（有效期 3650 天）..."
  openssl req -x509 -newkey rsa:4096 \
    -keyout "$APP_DIR/key.pem" \
    -out "$APP_DIR/cert.pem" \
    -days 3650 -nodes \
    -subj "/C=CN/ST=Beijing/L=Beijing/O=LocalChat/CN=localchat" \
    -addext "subjectAltName=IP:127.0.0.1" \
    2>/dev/null
  log_ok "自签名证书生成完成（key.pem / cert.pem）"
elif [[ -f "$APP_DIR/key.pem" ]]; then
  log_ok "SSL 证书已存在，跳过生成"
fi

# ═══════════════════════════════════════════════
# 步骤 6：配置文件权限
# ═══════════════════════════════════════════════
log_info "步骤 6/8：配置目录权限..."
# 将所有应用文件归还给真实用户，后续 start.sh/stop.sh 无需 sudo
mkdir -p "$APP_DIR/logs"
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
chmod 700 "$APP_DIR/data"
if [[ -f "$APP_DIR/key.pem" ]]; then
  chmod 600 "$APP_DIR/key.pem"
  chmod 644 "$APP_DIR/cert.pem"
fi
if [[ -f "$APP_DIR/data/secret.key" ]]; then
  chmod 600 "$APP_DIR/data/secret.key"
fi
log_ok "目录权限配置完成"

# ═══════════════════════════════════════════════
# 步骤 7：配置 Nginx 反向代理（可选）
# ═══════════════════════════════════════════════
if [[ "$USE_NGINX" == "true" ]]; then
  log_info "步骤 7/8：配置 Nginx 反向代理..."
  apt-get install -y -qq nginx

  cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
# LocalChat Nginx 配置
# 自动生成于 $(date)

# HTTP → HTTPS 重定向
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN:-_};
    return 301 https://\$host\$request_uri;
}

# HTTPS 反向代理
server {
    listen ${NGINX_PORT} ssl http2;
    listen [::]:${NGINX_PORT} ssl http2;
    server_name ${DOMAIN:-_};

    # SSL 证书
    ssl_certificate     ${APP_DIR}/cert.pem;
    ssl_certificate_key ${APP_DIR}/key.pem;

    # 安全 SSL 配置
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    # 防止点击劫持
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    # 文件上传大小限制（无大小限制设为 0）
    client_max_body_size 0;

    # 代理到 Node.js 应用
    location / {
        proxy_pass         https://127.0.0.1:${HTTPS_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        # 关闭代理缓冲，确保 SSE/WebSocket 实时性
        proxy_buffering    off;

        # 忽略自签名证书错误（当 Node.js 使用自签名证书时）
        proxy_ssl_verify   off;
    }

    # Socket.IO WebSocket 专用路径
    location /socket.io/ {
        proxy_pass         https://127.0.0.1:${HTTPS_PORT}/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 86400s;
        proxy_buffering    off;
        proxy_ssl_verify   off;
    }
}
EOF

  # 启用站点
  ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  rm -f /etc/nginx/sites-enabled/default

  # 测试配置
  nginx -t && systemctl reload nginx
  log_ok "Nginx 配置完成"
else
  log_info "步骤 7/8：跳过 Nginx 配置"
fi

# ═══════════════════════════════════════════════
# 步骤 8：配置防火墙 & Fail2Ban
# ═══════════════════════════════════════════════
log_info "步骤 8/8：配置防火墙..."

# UFW 防火墙
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh          # SSH 22
ufw allow 80/tcp       # HTTP（用于重定向）
ufw allow 443/tcp      # HTTPS（Nginx）
if [[ "$USE_NGINX" != "true" ]]; then
  ufw allow "${HTTPS_PORT}/tcp"   # 直接暴露 Node.js
fi
ufw --force enable
log_ok "防火墙规则配置完成"

# Fail2Ban（防暴力 SSH 攻击）
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime  = 86400
EOF
systemctl enable fail2ban
systemctl restart fail2ban
log_ok "Fail2Ban 配置完成"

# ═══════════════════════════════════════════════
# 配置 PM2 守护进程
# ═══════════════════════════════════════════════
log_info "配置 PM2 进程守护..."

# 创建 PM2 生态系统配置文件
cat > "$APP_DIR/ecosystem.config.js" <<EOF
module.exports = {
  apps: [{
    name: '${APP_NAME}',
    script: './server.js',
    cwd: '${APP_DIR}',
    instances: 1,
    exec_mode: 'fork',
    // stdio: 'interactive' 允许启动时终端交互（输入安全码）
    // 注意：首次通过 pm2 start 启动需要在交互模式下授权
    restart_delay: 5000,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production'
    },
    // 日志写到应用目录，普通用户可读写
    out_file: '${APP_DIR}/logs/out.log',
    error_file: '${APP_DIR}/logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
};
EOF

# 日志目录已在步骤6创建并归真实用户所有
chown "$APP_USER:$APP_GROUP" "$APP_DIR/ecosystem.config.js"

# 配置 PM2 开机自启（以真实用户身份运行，无需 sudo 启停）
APP_USER_HOME=$(getent passwd "$APP_USER" | cut -d: -f6 2>/dev/null || echo "/home/$APP_USER")
su -c "pm2 startup systemd -u \"$APP_USER\" --hp \"$APP_USER_HOME\"" root 2>/dev/null || \
  pm2 startup systemd -u "$APP_USER" --hp "$APP_USER_HOME" > /dev/null 2>&1 || true

log_ok "PM2 配置完成"

# ═══════════════════════════════════════════════
# 配置 Logrotate 日志轮转
# ═══════════════════════════════════════════════
cat > "/etc/logrotate.d/${APP_NAME}" <<EOF
${APP_DIR}/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    su ${APP_USER} ${APP_GROUP}
    create 640 ${APP_USER} ${APP_GROUP}
}
EOF

# ═══════════════════════════════════════════════
# 完成
# ═══════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}   ✅ 部署完成！${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "  应用目录：   ${BLUE}${APP_DIR}${NC}"
echo -e "  文件归属：   ${BLUE}${APP_USER}:${APP_GROUP}${NC}（后续操作无需 sudo）"
echo -e "  配置文件：   ${BLUE}${APP_DIR}/config.json${NC}"
echo -e "  SSL 证书：   ${BLUE}${APP_DIR}/key.pem${NC} / ${BLUE}${APP_DIR}/cert.pem${NC}"
echo -e "  日志目录：   ${BLUE}${APP_DIR}/logs/${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  下一步操作：${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  1. 编辑 config.json 添加您的域名/IP 白名单："
echo -e "     ${BLUE}nano ${APP_DIR}/config.json${NC}"
echo ""
echo -e "  2. 首次启动服务（交互输入安全码，无需 sudo）："
echo -e "     ${BLUE}./start.sh${NC}"
echo ""
echo -e "  3. 停止服务（无需 sudo）："
echo -e "     ${BLUE}./stop.sh${NC}"
echo ""
echo -e "  4. 或使用 PM2 后台管理（以 ${APP_USER} 身份运行）："
echo -e "     ${BLUE}cd ${APP_DIR} && pm2 start ecosystem.config.js${NC}"
echo -e "     ${BLUE}pm2 save${NC}           # 保存进程列表（开机自启）"
echo -e "     ${BLUE}pm2 logs ${APP_NAME}${NC}  # 查看日志"
echo ""
echo -e "  4. 访问地址："
if [[ "$USE_NGINX" == "true" ]]; then
  SERVER_IP=$(hostname -I | awk '{print $1}')
  echo -e "     ${GREEN}https://${DOMAIN:-$SERVER_IP}${NC}"
else
  SERVER_IP=$(hostname -I | awk '{print $1}')
  echo -e "     ${GREEN}https://${SERVER_IP}:${HTTPS_PORT}${NC}"
fi
echo ""
echo -e "  5. 防火墙状态：${BLUE}ufw status${NC}"
echo -e "     PM2 状态：    ${BLUE}pm2 status${NC}"
echo -e "     Nginx 状态：  ${BLUE}systemctl status nginx${NC}"
echo ""
