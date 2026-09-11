#!/usr/bin/env bash
#
# MeetMind 部署脚本 —— 旁路构建 + 原子切换 + 失败回滚
#
# 用法:
#   ./scripts/deploy.sh          # 完整部署：在 .next-staging 构建 → 切换到 .next → PM2 重载 → 健康检查（失败自动回滚）
#   ./scripts/deploy.sh --quick  # 跳过 build，仅重载（配置变更 / 构建产物已就位）
#   ./scripts/deploy.sh --build  # 仅构建到 .next-staging，不切换不重载
#
# 为什么旁路构建（2026-09-08）：next build 一开始就清空 distDir，而生产进程正是从 .next 懒加载
# 页面与静态资源——此前每次部署的整个构建期（曾长达 30 分钟）线上 /_next/static/* 全部 500，
# 新访客白屏。现在生产目录在构建期间原样不动，构建完成后毫秒级 mv 切换，随即重载。
#
set -euo pipefail

# 生产专用检出（git worktree，分支 release/prod）；开发工作树不再是运行目录——见 docs/RELEASE_FLOW.md
PROJECT_DIR="${MEETMIND_PROD_DIR:-/mnt/meetmind-prod}"
APP_NAME="meetmind"
PORT=3002
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
MAX_WAIT=30  # 健康检查最大等待秒数

LIVE_DIR=".next"
STAGING_DIR=".next-staging"
PREVIOUS_DIR=".next-previous"

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

# ── Step 1: Build（旁路目录，生产目录不动）──────────────────────
if [[ "$MODE" != "--quick" ]]; then
  log "📦 Building into ${STAGING_DIR} (live ${LIVE_DIR} untouched)..."
  rm -rf "$STAGING_DIR"
  mkdir -p "$STAGING_DIR"
  # webpack 持久缓存跟着构建目录走；生产进程不需要它，先挪过来复用
  if [[ -d "$LIVE_DIR/cache" ]]; then
    mv "$LIVE_DIR/cache" "$STAGING_DIR/cache"
  fi
  BUILD_START=$(date +%s)
  if ! NEXT_DIST_DIR="$STAGING_DIR" make build; then
    # 构建失败：把缓存还回去，生产完全不受影响
    if [[ -d "$STAGING_DIR/cache" && ! -d "$LIVE_DIR/cache" ]]; then
      mkdir -p "$LIVE_DIR" && mv "$STAGING_DIR/cache" "$LIVE_DIR/cache"
    fi
    fail "Build failed! Live ${LIVE_DIR} was never touched."
  fi
  log "✅ Build succeeded in $(( $(date +%s) - BUILD_START ))s"
fi

if [[ "$MODE" == "--build" ]]; then
  log "Build-only mode: artifacts in ${STAGING_DIR}, not switched."
  exit 0
fi

# ── Step 2: Switch（原子级 mv，保留上一版供回滚）────────────────
if [[ "$MODE" != "--quick" ]]; then
  [[ -f "$STAGING_DIR/BUILD_ID" ]] || fail "${STAGING_DIR}/BUILD_ID missing; refusing to switch."
  rm -rf "$PREVIOUS_DIR"
  if [[ -d "$LIVE_DIR" ]]; then
    mv "$LIVE_DIR" "$PREVIOUS_DIR"
  fi
  mv "$STAGING_DIR" "$LIVE_DIR"
  log "🔁 Switched ${STAGING_DIR} → ${LIVE_DIR} (previous kept at ${PREVIOUS_DIR})"
fi

# ── Step 3: Reload ─────────────────────────────────────────────
log "🔄 Applying pm2 process definition: ${APP_NAME}..."
pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --update-env

# ── Step 4: Health Check（失败回滚到上一版）─────────────────────
log "🏥 Waiting for health check (${HEALTH_URL})..."
WAITED=0
HEALTHY=0
while [[ $WAITED -lt $MAX_WAIT ]]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || true)
  HTTP_CODE="${HTTP_CODE:-000}"
  if [[ "$HTTP_CODE" == "200" ]]; then
    HEALTHY=1
    log "✅ Health check passed (HTTP ${HTTP_CODE}) after ${WAITED}s"
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [[ $HEALTHY -ne 1 ]]; then
  if [[ "$MODE" != "--quick" && -d "$PREVIOUS_DIR" ]]; then
    warn "Health check failed; rolling back to previous build..."
    rm -rf ".next-failed"
    mv "$LIVE_DIR" ".next-failed"
    mv "$PREVIOUS_DIR" "$LIVE_DIR"
    pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --update-env
    fail "Rolled back. Failed build kept at .next-failed for inspection."
  fi
  fail "Health check failed after ${MAX_WAIT}s"
fi

# 静态资源抽样：HTML 壳里引用的第一个 chunk 必须 200（防止"壳能出、资源 500"的假健康）
FIRST_CHUNK=$(curl -s "http://127.0.0.1:${PORT}/app?guest=1" | grep -oE '/_next/static/chunks/[^"]+\.js' | head -1 || true)
if [[ -n "$FIRST_CHUNK" ]]; then
  CHUNK_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}${FIRST_CHUNK}" 2>/dev/null || true)
  if [[ "$CHUNK_CODE" == "200" ]]; then
    log "✅ Static chunk check passed (${FIRST_CHUNK})"
  else
    warn "Static chunk returned ${CHUNK_CODE}: ${FIRST_CHUNK}"
  fi
fi

log "🎉 Deploy complete!"
pm2 describe "$APP_NAME" | grep -E "status|restarts|uptime|pid path|unstable" || true
