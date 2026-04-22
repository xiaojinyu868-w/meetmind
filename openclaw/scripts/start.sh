#!/bin/bash
# 启动 OpenClaw Gateway（PM2 托管）
set -e

OPENCLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$OPENCLAW_DIR/.state"

# 性能优化
export NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
mkdir -p /var/tmp/openclaw-compile-cache
export OPENCLAW_NO_RESPAWN=1

# 状态目录
export OPENCLAW_STATE_DIR="$STATE_DIR"

# 加载 .env
if [ -f "$STATE_DIR/.env" ]; then
  set -a
  source "$STATE_DIR/.env"
  set +a
else
  echo "⚠️  未找到 $STATE_DIR/.env，请先运行: cp $STATE_DIR/.env.example $STATE_DIR/.env && vim $STATE_DIR/.env"
  exit 1
fi

echo "启动 OpenClaw Gateway (PM2)..."
echo "状态目录: $STATE_DIR"
echo "端口: ${OPENCLAW_GATEWAY_PORT:-4000}"

# 用 PM2 托管
pm2 start openclaw --name openclaw-gateway -- gateway run --port "${OPENCLAW_GATEWAY_PORT:-4000}"

echo ""
echo "✓ Gateway 已启动"
echo "  Canvas UI: http://127.0.0.1:${OPENCLAW_GATEWAY_PORT:-4000}/__openclaw__/canvas/"
echo "  查看日志: pm2 logs openclaw-gateway"
echo "  停止: bash scripts/stop.sh"
