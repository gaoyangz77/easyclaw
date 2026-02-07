#!/usr/bin/env bash
# =============================================================================
# init-letsencrypt.sh
#
# Initial SSL certificate setup for EasyClaw website.
#
# This script:
#   1. Creates dummy self-signed certificates so nginx can start.
#   2. Starts nginx via Docker Compose.
#   3. Removes the dummy certificates.
#   4. Requests real certificates from Let's Encrypt via certbot (webroot).
#   5. Reloads nginx to use the real certificates.
#
# Usage:
#   chmod +x init-letsencrypt.sh
#   ./init-letsencrypt.sh
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - DNS A records for easy-claw.com and www.easy-claw.com pointing to this server
#   - Port 80 and 443 open and reachable from the internet
#
# Environment variables (optional — defaults below):
#   DOMAIN       — primary domain   (default: www.easy-claw.com)
#   DOMAIN_SANS  — SAN domains      (default: easy-claw.com)
#   EMAIL        — Let's Encrypt notification email
#   STAGING      — set to "1" to use LE staging (for testing)
# =============================================================================
set -euo pipefail

# ---- Change to script's directory (where docker-compose.yml lives) ----
cd "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")")"

# ---- Configuration ----
DOMAIN="${DOMAIN:-www.easy-claw.com}"
DOMAIN_SANS="${DOMAIN_SANS:-easy-claw.com}"
EMAIL="${EMAIL:-admin@easy-claw.com}"
STAGING="${STAGING:-0}"

DATA_PATH="./certs/certbot"
RSA_KEY_SIZE=4096
COMPOSE_CMD="docker compose"

# ---- Helpers ----
info()  { echo "[INFO]  $*"; }
warn()  { echo "[WARN]  $*" >&2; }
error() { echo "[ERROR] $*" >&2; exit 1; }

# ---- Pre-flight checks ----
if ! command -v docker &>/dev/null; then
  error "docker is not installed. Please install Docker first."
fi

if ! $COMPOSE_CMD version &>/dev/null; then
  # Fall back to legacy docker-compose
  COMPOSE_CMD="docker-compose"
  if ! command -v docker-compose &>/dev/null; then
    error "docker compose (or docker-compose) is not installed."
  fi
fi

# ---- Check for existing certificates ----
if [ -d "$DATA_PATH/conf/live/$DOMAIN" ]; then
  read -r -p "Existing certificates found for $DOMAIN. Replace them? (y/N) " decision
  if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
    info "Keeping existing certificates. Exiting."
    exit 0
  fi
fi

# ---- Build domain arguments for certbot ----
DOMAIN_ARGS="-d $DOMAIN"
for san in $DOMAIN_SANS; do
  DOMAIN_ARGS="$DOMAIN_ARGS -d $san"
done

# ---- Staging flag ----
STAGING_ARG=""
if [ "$STAGING" = "1" ]; then
  STAGING_ARG="--staging"
  warn "Using Let's Encrypt STAGING environment (certificates will NOT be trusted)."
fi

# ---- Step 1: Create dummy certificate ----
info "Creating dummy certificate for $DOMAIN ..."
CERT_PATH="$DATA_PATH/conf/live/$DOMAIN"
mkdir -p "$CERT_PATH"

openssl req -x509 -nodes -newkey rsa:2048 \
  -days 1 \
  -keyout "$CERT_PATH/privkey.pem" \
  -out "$CERT_PATH/fullchain.pem" \
  -subj "/CN=localhost" \
  2>/dev/null

info "Dummy certificate created."

# ---- Step 2: Start nginx ----
info "Starting nginx ..."
$COMPOSE_CMD up -d --force-recreate nginx
info "Waiting for nginx to become ready ..."
sleep 5

# ---- Step 3: Remove dummy certificate ----
info "Removing dummy certificate ..."
rm -rf "$CERT_PATH"
info "Dummy certificate removed."

# ---- Step 4: Request real certificate from Let's Encrypt ----
info "Requesting Let's Encrypt certificate for: $DOMAIN $DOMAIN_SANS ..."
$COMPOSE_CMD run --rm --entrypoint "" certbot certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  $STAGING_ARG \
  $DOMAIN_ARGS \
  --email "$EMAIL" \
  --rsa-key-size "$RSA_KEY_SIZE" \
  --agree-tos \
  --no-eff-email \
  --force-renewal

if [ $? -ne 0 ]; then
  error "certbot failed to obtain certificates. Check DNS and firewall settings."
fi

info "Certificates obtained successfully."

# ---- Step 5: Reload nginx ----
info "Reloading nginx with real certificates ..."
$COMPOSE_CMD exec nginx nginx -s reload
info "nginx reloaded."

# ---- Done ----
echo ""
info "==============================================="
info "  SSL setup complete for $DOMAIN"
info "  Certificates stored in: $DATA_PATH/conf/"
info "  Certbot will auto-renew via the certbot service."
info "==============================================="
echo ""
info "You can now run: $COMPOSE_CMD up -d"
