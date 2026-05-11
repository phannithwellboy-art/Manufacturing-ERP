# FactoryOS ERP — Backend

Production-ready Node.js backend with Google OAuth2, JWT auth, role-based permissions, Docker, and GitHub Actions CI/CD.

---

## Quick start (local)

```bash
git clone https://github.com/YOUR_ORG/factory-erp.git
cd factory-erp
cp .env.example .env        # fill in your values
docker compose up -d        # starts PostgreSQL + app
docker compose exec app npm run migrate
docker compose exec app npm run seed
```

API available at **http://localhost:4000**

---

## Deploy to GitHub + VPS in 5 steps

### Step 1 — Push to GitHub

```bash
git init
git remote add origin https://github.com/YOUR_ORG/factory-erp.git
git add .
git commit -m "Initial commit"
git push -u origin main
```

### Step 2 — Get Google OAuth2 credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create project → **APIs & Services** → **Credentials** → **Create OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Authorized redirect URIs:
   - Dev: `http://localhost:4000/auth/google/callback`
   - Prod: `https://api.yourfactory.com/auth/google/callback`
5. Copy **Client ID** and **Client Secret**

### Step 3 — Provision a VPS

Any Ubuntu 22.04 server works (DigitalOcean, Linode, Hetzner, AWS EC2).

```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Download and run setup script
curl -sO https://raw.githubusercontent.com/YOUR_ORG/factory-erp/main/scripts/setup-server.sh
bash setup-server.sh

# Get SSL certificate (replace with your domain)
certbot certonly --standalone -d api.yourfactory.com

# Copy SSL certs to app directory
cp /etc/letsencrypt/live/api.yourfactory.com/fullchain.pem /opt/factory-erp/nginx/ssl/
cp /etc/letsencrypt/live/api.yourfactory.com/privkey.pem   /opt/factory-erp/nginx/ssl/

# Create .env on server
nano /opt/factory-erp/.env    # fill in all values

# Copy docker-compose.yml
scp docker-compose.yml user@YOUR_SERVER_IP:/opt/factory-erp/
```

### Step 4 — Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret name | Value |
|---|---|
| `SSH_HOST` | Your server IP address |
| `SSH_USER` | `erp` (the deploy user) |
| `SSH_PRIVATE_KEY` | Your SSH private key (`cat ~/.ssh/id_rsa`) |
| `SSH_PORT` | `22` (or your custom SSH port) |

The `GITHUB_TOKEN` secret is automatic — GitHub provides it.

### Step 5 — First manual deploy

```bash
# On your server
cd /opt/factory-erp
docker compose pull
docker compose up -d
docker compose exec app npm run migrate
docker compose exec app npm run seed
```

After this, every push to `main` deploys automatically via GitHub Actions.

---

## CI/CD pipeline

```
Push to main
  │
  ├─► [test job]
  │     Install deps → Lint → Migrate test DB → Run Jest tests
  │
  ├─► [build job] (only if tests pass)
  │     Build Docker image → Push to ghcr.io/YOUR_ORG/factory-erp:latest
  │
  └─► [deploy job] (only after build)
        SSH to server → Pull new image → Run migrations → Restart container → Health check
```

Each commit gets a status comment with deploy result.

---

## Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
# Required
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
JWT_SECRET=$(openssl rand -hex 64)
SESSION_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=strong_password_here

# Your server
GOOGLE_CALLBACK_URL=https://api.yourfactory.com/auth/google/callback
FRONTEND_URL=https://yourfactory.com

# Optional — restrict login to company email only
ALLOWED_EMAIL_DOMAINS=yourcompany.com
```

---

## API reference

### Auth

| Method | Route | Description |
|---|---|---|
| `GET` | `/auth/google` | Start Google OAuth login |
| `GET` | `/auth/google/callback` | OAuth callback — issues JWT cookie |
| `GET` | `/auth/me` | Current user + permissions |
| `GET` | `/auth/permissions` | Current user's permission map |
| `POST` | `/auth/logout` | Clear session |

### Admin _(Admin role only)_

| Method | Route | Description |
|---|---|---|
| `GET` | `/admin/users` | List all users |
| `POST` | `/admin/users/invite` | Invite by email + role |
| `PATCH` | `/admin/users/:id` | Change role / status |
| `DELETE` | `/admin/users/:id` | Remove user |
| `GET` | `/admin/permissions` | Full role × department matrix |
| `PATCH` | `/admin/permissions` | Update one permission cell |
| `GET` | `/admin/audit` | Paginated audit log |

### ERP _(permission-guarded)_

| Method | Route | Min permission |
|---|---|---|
| `GET` | `/erp/production` | production: view |
| `POST` | `/erp/production/lines` | production: edit |
| `GET` | `/erp/inventory` | inventory: view |
| `POST` | `/erp/inventory` | inventory: edit |
| `PATCH` | `/erp/inventory/:id` | inventory: edit |
| `GET` | `/erp/work-orders` | work_orders: view |
| `POST` | `/erp/work-orders` | work_orders: edit |
| `PATCH` | `/erp/work-orders/:id` | work_orders: edit |
| `GET` | `/erp/quality` | quality: view |
| `POST` | `/erp/quality` | quality: edit |
| `GET` | `/erp/machines` | machines: view |
| `POST` | `/erp/machines` | machines: edit |
| `PATCH` | `/erp/machines/:id` | machines: edit |
| `GET` | `/erp/reports/summary` | reports: view |

---

## Default permission matrix

|  | Admin | Manager | Operator | Viewer |
|---|:---:|:---:|:---:|:---:|
| Production | Edit | Edit | Edit | View |
| Inventory | Edit | View | — | View |
| Work Orders | Edit | Edit | — | View |
| Quality | Edit | View | Edit | View |
| Reports | View | View | View | View |
| Machines | Edit | View | — | View |

Admin can change any row except Admin itself via `PATCH /admin/permissions`.

---

## Project structure

```
factory-erp/
├── .github/workflows/ci-cd.yml   ← GitHub Actions pipeline
├── src/
│   ├── server.js                 ← Express entry point
│   ├── config/passport.js        ← Google OAuth2 strategy
│   ├── middleware/
│   │   ├── auth.js               ← JWT, requireRole, requirePermission
│   │   └── validate.js           ← express-validator schemas
│   ├── routes/
│   │   ├── auth.js               ← /auth/*
│   │   ├── admin.js              ← /admin/*
│   │   └── erp.js                ← /erp/*
│   ├── db/
│   │   ├── index.js              ← PostgreSQL pool + retry
│   │   ├── migrate.js            ← Schema migrations
│   │   └── seed.js               ← Seed data
│   └── utils/logger.js           ← Winston structured logging
├── tests/auth.test.js            ← Jest test suite
├── nginx/nginx.conf              ← Reverse proxy + SSL
├── scripts/setup-server.sh       ← VPS provisioning
├── Dockerfile                    ← Multi-stage production image
├── docker-compose.yml            ← Local dev stack
└── .env.example                  ← Environment template
```

---

## Production checklist

- [ ] `NODE_ENV=production` in `.env`
- [ ] `ALLOWED_EMAIL_DOMAINS` set to your company domain
- [ ] SSL certificate installed via Certbot
- [ ] GitHub Secrets configured (SSH_HOST, SSH_USER, SSH_PRIVATE_KEY)
- [ ] Firewall: only ports 22, 80, 443 open
- [ ] Database backups scheduled (`pg_dump` cron or managed DB)
- [ ] Log rotation configured (docker logs or winston rotate)
- [ ] Monitoring: add UptimeRobot or similar on `/health`
