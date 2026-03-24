#!/usr/bin/env bash
#
# MeetMind 快速部署脚本
# 用法:
#   ./scripts/deploy.sh          # 完整部署 (build + restart)
#   ./scripts/deploy.sh --quick  # 跳过 build，仅重启 (热加载配置变更)
#   ./scripts/deploy.sh --build  # 仅 build，不重启
#
set -euo pipefail

PROJECT_DIR="/mnt/meetmind-capture-v1-server-handoff"
APP_NAME="meetmind"
PORT=3002
HEALTH_URL="http://127.0.0.1:${PORT}/app"
MAX_WAIT=30  # 健康检查最大等待秒数

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
fail() { echo -e "${RED}[deploy]${NC} $*"; exit 1; }

cd "$PROJECT_DIR"

MODE="${1:-full}"

# ── Step 1: Build ──────────────────────────────────────────────
if [[ "$MODE" != "--quick" ]]; then
  log "📦 Building Next.js production bundle..."
  npm run build || fail "Build failed!"
  log "✅ Build succeeded"
fi

if [[ "$MODE" == "--build" ]]; then
  log "Build-only mode, skipping restart."
  exit 0
fi

# ── Step 2: Restart ────────────────────────────────────────────
log "🔄 Restarting pm2 process: ${APP_NAME}..."

# Check if process exists
if pm2 describe "$APP_NAME" &>/dev/null; then
  pm2 restart "$APP_NAME" --update-env
else
  warn "Process not found, starting fresh..."
  pm2 start ecosystem.config.js
fi

# ── Step 3: Health Check ───────────────────────────────────────
log "🏥 Waiting for health check (${HEALTH_URL})..."
WAITED=0
while [[ $WAITED -lt $MAX_WAIT ]]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    log "✅ Health check passed (HTTP ${HTTP_CODE}) after ${WAITED}s"
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [[ $WAITED -ge $MAX_WAIT ]]; then
  warn "⚠️  Health check timed out after ${MAX_WAIT}s (last HTTP: ${HTTP_CODE})"
  warn "Check logs: pm2 logs ${APP_NAME} --lines 50"
  exit 1
fi

# ── Step 4: Save process list ──────────────────────────────────
pm2 save --force &>/dev/null

# ── Summary ────────────────────────────────────────────────────
log "🎉 Deploy complete!"
pm2 show "$APP_NAME" | grep -E "status|memory|uptime|pid|restarts" | head -10
echo ""
