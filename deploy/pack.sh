#!/usr/bin/env bash
# ============================================================================
# 本地打包脚本 — 在开发机上运行，生成 deploy/ 下的产物
#
# 使用方式:
#   bash deploy/pack.sh
#   然后把 deploy/ 整个目录上传到服务器，执行 bash deploy.sh
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK_DIR="$REPO_ROOT/deploy"

echo "=== Packing for deployment ==="

# 1. Build cloud-api
echo ">> Building cloud-api..."
cd "$REPO_ROOT/apps/cloud-api"
npx tsc -p tsconfig.json

mkdir -p "$PACK_DIR/cloud-api/dist"
cp -r dist/* "$PACK_DIR/cloud-api/dist/"
cp package.json "$PACK_DIR/cloud-api/"
cp src/db/schema.sql "$PACK_DIR/cloud-api/"

# 2. Build website
echo ">> Building website..."
cd "$REPO_ROOT/apps/website"
npx astro build

mkdir -p "$PACK_DIR/website"
cp -r dist/* "$PACK_DIR/website/"

echo ""
echo "=== Pack complete ==="
echo "  deploy/cloud-api/   — Node API (dist + package.json + schema.sql)"
echo "  deploy/website/     — 静态文件 (直接用 Nginx 托管)"
echo "  deploy/deploy.sh    — 服务器部署脚本"
echo ""
echo "下一步: 上传 deploy/ 到服务器，修改 deploy.sh 里的配置，然后 bash deploy.sh"
