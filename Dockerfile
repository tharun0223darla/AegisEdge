# =============================================================================
#  MediTrack AI — Production Dockerfile (multi-stage, distroless-style)
#
#  Build :  docker build -t meditrack-api:latest .
#  Run   :  docker run --rm -p 3000:3000 --env-file .env meditrack-api:latest
# =============================================================================

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — install ALL deps (incl. dev) + build TypeScript + generate Prisma
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# System deps required by Prisma & sharp/tesseract native bindings
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
RUN npm ci --include=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build && npm prune --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — slim runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_LOGLEVEL=warn

RUN apk add --no-cache openssl libc6-compat tini \
 && addgroup -S meditrack && adduser -S meditrack -G meditrack

# Copy only what the runtime needs
COPY --from=builder --chown=meditrack:meditrack /app/node_modules ./node_modules
COPY --from=builder --chown=meditrack:meditrack /app/dist ./dist
COPY --from=builder --chown=meditrack:meditrack /app/prisma ./prisma
COPY --from=builder --chown=meditrack:meditrack /app/package*.json ./

# Persistent volume mount points
RUN mkdir -p /app/uploads /app/logs \
 && chown -R meditrack:meditrack /app/uploads /app/logs

USER meditrack

EXPOSE 3000

# Container-level health check (independent of orchestrator)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1

# tini = proper PID 1 (handles SIGTERM → graceful shutdown)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
