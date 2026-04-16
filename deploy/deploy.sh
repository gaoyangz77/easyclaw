#!/usr/bin/env bash
# ============================================================================
# DlxAI 一键部署脚本
#
# 使用方式:
#   1. cp .env.example .env && vim .env    # 填写配置
#   2. bash deploy.sh                       # 自动检测环境并部署
#
# 自动检测:
#   - Docker: 有 docker + docker-compose → 用 Docker 部署 (PostgreSQL + API)
#   - 裸机:   无 Docker → 需要已安装 Node 20+ / PostgreSQL / PM2
#   - Nginx:  检测到 Nginx → 自动配置反代 + SSE 支持
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="/opt/dlxai"

# ─── 加载 .env ────────────────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "❌ 未找到 .env 文件"
  echo "   请先: cp .env.example .env && vim .env"
  exit 1
fi
set -a; source "$SCRIPT_DIR/.env"; set +a

DOMAIN="${DOMAIN:-dlxai.app}"
DB_PASSWORD="${DB_PASSWORD:-dlxai2026}"
OPENROUTER_KEY="${OPENROUTER_KEY:-}"
ADMIN_KEY="${ADMIN_KEY:-change-me}"
FREE_CREDITS="${FREE_CREDITS:-100}"
DAILY_FREE_TOKENS="${DAILY_FREE_TOKENS:-100000}"
CLOUD_API_PORT=3100

echo "============================================="
echo "  DlxAI 部署"
echo "============================================="
echo "  域名:     $DOMAIN"
echo "  部署目录: $DEPLOY_DIR"
echo ""

# ─── 检测环境 ─────────────────────────────────────────────────────────
HAS_DOCKER=false
HAS_NODE=false
HAS_PM2=false
HAS_NGINX=false
HAS_PG=false

command -v docker &>/dev/null && docker info &>/dev/null && HAS_DOCKER=true
command -v node &>/dev/null && HAS_NODE=true
command -v pm2 &>/dev/null && HAS_PM2=true
command -v nginx &>/dev/null && HAS_NGINX=true
command -v psql &>/dev/null && HAS_PG=true

# docker compose 命令兼容
COMPOSE_CMD=""
if $HAS_DOCKER; then
  if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  fi
fi

echo "环境检测:"
echo "  Docker:     $($HAS_DOCKER && echo '✅' || echo '❌')"
echo "  Compose:    $([ -n "$COMPOSE_CMD" ] && echo '✅' || echo '❌')"
echo "  Node.js:    $($HAS_NODE && echo "✅ $(node -v)" || echo '❌')"
echo "  PM2:        $($HAS_PM2 && echo '✅' || echo '❌')"
echo "  Nginx:      $($HAS_NGINX && echo '✅' || echo '❌')"
echo "  PostgreSQL:  $($HAS_PG && echo '✅' || echo '❌')"
echo ""

# ─── 选择部署方式 ─────────────────────────────────────────────────────
USE_DOCKER=false
if [ -n "$COMPOSE_CMD" ]; then
  USE_DOCKER=true
  echo ">> 检测到 Docker Compose，使用 Docker 部署 PostgreSQL + API"
elif $HAS_NODE && $HAS_PM2; then
  echo ">> 使用裸机部署 (Node + PM2)"
else
  echo "❌ 需要以下环境之一:"
  echo "   - Docker + Docker Compose"
  echo "   - Node.js 20+ / PM2 / PostgreSQL"
  echo ""
  echo "   安装 Docker:  curl -fsSL https://get.docker.com | sh"
  echo "   安装 Node:    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  echo "   安装 PM2:     sudo npm i -g pm2"
  exit 1
fi

# ─── 创建部署目录 ─────────────────────────────────────────────────────
echo ">> 创建部署目录..."
sudo mkdir -p "$DEPLOY_DIR"/{cloud-api,website}
sudo chown -R "$USER:$USER" "$DEPLOY_DIR"

# ─── 复制文件 ─────────────────────────────────────────────────────────
echo ">> 复制 cloud-api..."
cp -r "$SCRIPT_DIR/cloud-api/"* "$DEPLOY_DIR/cloud-api/"

echo ">> 复制 website..."
cp -r "$SCRIPT_DIR/website/"* "$DEPLOY_DIR/website/"

# ─── 部署后端 ─────────────────────────────────────────────────────────
if $USE_DOCKER; then
  echo ">> Docker: 启动 PostgreSQL + cloud-api + Nginx..."

  # 复制 docker-compose、nginx.conf 和 .env
  cp "$SCRIPT_DIR/docker-compose.yml" "$DEPLOY_DIR/"
  cp "$SCRIPT_DIR/nginx.conf" "$DEPLOY_DIR/"
  cp "$SCRIPT_DIR/.env" "$DEPLOY_DIR/"

  cd "$DEPLOY_DIR"
  $COMPOSE_CMD down 2>/dev/null || true
  $COMPOSE_CMD up -d

  echo ">> 等待服务就绪..."
  for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1/health &>/dev/null; then
      echo "   全部就绪! (Nginx :80 → cloud-api → PostgreSQL)"
      break
    fi
    [ $i -eq 30 ] && echo "⚠️  超时，请检查: cd $DEPLOY_DIR && docker compose logs"
    sleep 2
  done

else
  echo ">> 裸机: 配置 cloud-api..."

  # 写 .env
  cat > "$DEPLOY_DIR/cloud-api/.env" <<EOF
DATABASE_URL=postgresql://postgres:$DB_PASSWORD@localhost:5432/dlxai_credits
OPENROUTER_MASTER_KEY=$OPENROUTER_KEY
ADMIN_KEY=$ADMIN_KEY
FREE_CREDITS=$FREE_CREDITS
DAILY_FREE_TOKENS=$DAILY_FREE_TOKENS
PORT=$CLOUD_API_PORT
NODE_ENV=production
EOF

  cd "$DEPLOY_DIR/cloud-api"
  npm install --omit=dev

  # 初始化数据库
  echo ">> 初始化数据库..."
  DB_URL="postgresql://postgres:$DB_PASSWORD@localhost:5432/dlxai_credits"
  node -e "
const postgres = require('postgres');
const fs = require('fs');
const sql = postgres('$DB_URL');
(async () => {
  const schema = fs.readFileSync('schema.sql', 'utf-8');
  for (const stmt of schema.split(';').filter(s => s.trim())) {
    await sql.unsafe(stmt).catch(e => console.log('  skip:', e.message));
  }
  console.log('  数据库表就绪');
  await sql.end();
})();
"

  # PM2
  echo ">> PM2: 启动 cloud-api..."
  cat > "$DEPLOY_DIR/cloud-api/ecosystem.config.cjs" <<'PMEOF'
module.exports = {
  apps: [{
    name: "dlxai-api",
    script: "dist/index.js",
    env_file: ".env",
    max_memory_restart: "300M",
    autorestart: true,
  }]
};
PMEOF

  cd "$DEPLOY_DIR/cloud-api"
  pm2 delete dlxai-api 2>/dev/null || true
  pm2 start ecosystem.config.cjs
  pm2 save
fi

# ─── Nginx 配置（仅裸机模式需要，Docker 自带 Nginx 容器）────────────
if $USE_DOCKER; then
  echo ">> Docker 模式已包含 Nginx 容器，跳过宿主机 Nginx 配置"
elif $HAS_NGINX; then
  echo ">> 配置 Nginx..."

  if [ -d /etc/nginx/sites-available ]; then
    NGINX_CONF="/etc/nginx/sites-available/dlxai"
    NGINX_LINK="/etc/nginx/sites-enabled/dlxai"
  else
    NGINX_CONF="/etc/nginx/conf.d/dlxai.conf"
    NGINX_LINK=""
  fi

  sudo tee "$NGINX_CONF" > /dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # 官网
    root $DEPLOY_DIR/website;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    # cloud-api 反代
    location /api/ {
        proxy_pass http://127.0.0.1:$CLOUD_API_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # SSE 支持
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    location /health {
        proxy_pass http://127.0.0.1:$CLOUD_API_PORT;
    }
}
NGINX

  [ -n "$NGINX_LINK" ] && sudo ln -sf "$NGINX_CONF" "$NGINX_LINK"

  if sudo nginx -t 2>/dev/null; then
    sudo systemctl reload nginx
    echo "   Nginx 配置完成"
  else
    echo "⚠️  Nginx 配置检测失败，请手动检查: sudo nginx -t"
  fi
else
  echo "⚠️  未检测到 Nginx，跳过反代配置"
  echo "   API 直接通过 http://服务器IP:$CLOUD_API_PORT 访问"
fi

# ─── 完成 ─────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  ✅ 部署完成!"
echo "============================================="
echo ""
if $HAS_NGINX; then
  echo "  官网:   http://$DOMAIN"
  echo "  API:    http://$DOMAIN/health"
else
  echo "  API:    http://127.0.0.1:$CLOUD_API_PORT/health"
fi
echo ""
echo "  发版推送:"
echo "    curl -X POST http://$DOMAIN/api/releases \\"
echo "      -H 'X-Admin-Key: $ADMIN_KEY' \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"version\":\"1.0.0\"}'"
echo ""
if $USE_DOCKER; then
  echo "  查看日志: cd $DEPLOY_DIR && docker compose logs -f"
else
  echo "  查看日志: pm2 logs dlxai-api"
fi
echo ""
if $HAS_NGINX; then
  echo "  启用 HTTPS:"
  echo "    sudo apt install -y certbot python3-certbot-nginx"
  echo "    sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi
echo ""
