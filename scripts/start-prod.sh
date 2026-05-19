#!/usr/bin/env bash
# 生产模式启动 (PM2)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
npm run build
cd "$ROOT"
pm2 start deploy/ecosystem.config.js --update-env
pm2 save
