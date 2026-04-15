#!/usr/bin/env bash
# ============================================================================
# DlxAI 一键部署脚本
# 部署 cloud-api (Node) + website (Astro 静态站) + Nginx 反代
#
# 使用方式:
#   1. 把整个 deploy/ 目录上传到服务器
#   2. 修改下面的配置变量
#   3. bash deploy.sh
#
# 前置要求: Node 20+, PostgreSQL, Nginx
# ============================================================================
set -euo pipefail

# ─── 配置 ──────────────────────────────────────────────────────────────
DOMAIN="dlxai.app"                          # 你的域名
CLOUD_API_PORT=3100                         # cloud-api 端口
DB_URL="postgresql://postgres:123@localhost:5432/dlxai_credits"
OPENROUTER_KEY=""                           # OpenRouter master key
ADMIN_KEY="change-me-to-a-secret"           # 发版管理密钥
DEPLOY_DIR="/opt/dlxai"                     # 服务器部署目录
# ───────────────────────────────────────────────────────────────────────

echo "=== DlxAI Deploy ==="

# 1. 创建目录
sudo mkdir -p "$DEPLOY_DIR"/{cloud-api,website}
sudo chown -R "$USER:$USER" "$DEPLOY_DIR"

# 2. 部署 cloud-api
echo ">> Deploying cloud-api..."
cp -r cloud-api/* "$DEPLOY_DIR/cloud-api/"

cat > "$DEPLOY_DIR/cloud-api/.env" <<EOF
DATABASE_URL=$DB_URL
OPENROUTER_MASTER_KEY=$OPENROUTER_KEY
ADMIN_KEY=$ADMIN_KEY
DAILY_FREE_TOKENS=100000
PORT=$CLOUD_API_PORT
NODE_ENV=production
EOF

cd "$DEPLOY_DIR/cloud-api"
npm install --omit=dev 2>/dev/null || npm install --production

# 初始化数据库
node -e "
const postgres = require('postgres');
const fs = require('fs');
const sql = postgres('$DB_URL');
(async () => {
  const schema = fs.readFileSync('schema.sql', 'utf-8');
  for (const stmt of schema.split(';').filter(s => s.trim())) {
    await sql.unsafe(stmt).catch(e => console.log('  skip:', e.message));
  }
  console.log('Database schema applied');
  await sql.end();
})();
"

# 3. 部署 website (静态文件)
echo ">> Deploying website..."
cp -r website/* "$DEPLOY_DIR/website/"

# 4. PM2 管理 cloud-api
echo ">> Setting up PM2..."
pm2 delete dlxai-api 2>/dev/null || true
pm2 start "$DEPLOY_DIR/cloud-api/dist/index.js" \
  --name dlxai-api \
  --cwd "$DEPLOY_DIR/cloud-api" \
  --env-path "$DEPLOY_DIR/cloud-api/.env" \
  --max-memory-restart 300M
pm2 save

# 5. Nginx 配置
echo ">> Configuring Nginx..."
sudo tee /etc/nginx/sites-available/dlxai <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # 官网 (Astro 静态站)
    root $DEPLOY_DIR/website;
    index index.html;

    location / {
        try_files \$uri \$uri/ \$uri/index.html =404;
    }

    # cloud-api 反代
    location /api/ {
        proxy_pass http://127.0.0.1:$CLOUD_API_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSE 支持 (版本更新推送)
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:$CLOUD_API_PORT;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/dlxai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== 部署完成 ==="
echo "  官网:      http://$DOMAIN"
echo "  API:       http://$DOMAIN/api/health"
echo "  发版:      curl -X POST http://$DOMAIN/api/releases -H 'X-Admin-Key: $ADMIN_KEY' -H 'Content-Type: application/json' -d '{\"version\":\"1.0.0\"}'"
echo ""
echo "下一步: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN  (启用 HTTPS)"
