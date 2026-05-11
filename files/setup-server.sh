#!/bin/bash
# scripts/setup-server.sh
# Run once on a fresh Ubuntu 22.04 VPS to prepare it for deployment.
# Usage: bash setup-server.sh

set -euo pipefail
DEPLOY_USER="erp"
APP_DIR="/opt/factory-erp"

echo "==> Updating system packages"
apt-get update -y && apt-get upgrade -y

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

echo "==> Installing Docker Compose v2"
apt-get install -y docker-compose-plugin

echo "==> Creating deploy user: $DEPLOY_USER"
id "$DEPLOY_USER" &>/dev/null || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

echo "==> Creating app directory"
mkdir -p "$APP_DIR" "$APP_DIR/logs" "$APP_DIR/nginx/ssl"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "==> Setting up firewall (UFW)"
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Installing Certbot for Let's Encrypt SSL"
apt-get install -y certbot

echo ""
echo "✅  Server setup complete!"
echo ""
echo "Next steps:"
echo "  1. Copy your .env file to $APP_DIR/.env"
echo "  2. Copy docker-compose.yml to $APP_DIR/"
echo "  3. Run: certbot certonly --standalone -d api.yourfactory.com"
echo "  4. Copy SSL certs: cp /etc/letsencrypt/live/api.yourfactory.com/*.pem $APP_DIR/nginx/ssl/"
echo "  5. cd $APP_DIR && docker compose up -d"
echo "  6. Add GitHub secrets (SSH_HOST, SSH_USER, SSH_PRIVATE_KEY)"
