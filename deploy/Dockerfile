# ===========================================
# 展贸中心智能化中控系统 - Backend Dockerfile
# 仅作预留, 当前 Sprint-01 不强制使用
# ===========================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm install --no-audit --no-fund

COPY backend/ ./
RUN npm run build

# ===========================================
# Runtime image
# ===========================================
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/database/smart-control.db \
    LOG_DIR=/data/logs

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/database /data/logs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

VOLUME ["/data/database", "/data/logs"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
