# ── Stage 1: dependencies ─────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ── Stage 2: production image ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 erp

# Copy deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=erp:nodejs . .

# Remove dev files from image
RUN rm -rf tests/ .github/ docker/ nginx/ scripts/*.sh

USER erp

EXPOSE 4000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]
