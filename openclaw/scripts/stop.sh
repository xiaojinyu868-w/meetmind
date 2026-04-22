#!/bin/bash
# 停止 OpenClaw Gateway
set -e

echo "停止 OpenClaw Gateway..."
pm2 stop openclaw-gateway 2>/dev/null && pm2 delete openclaw-gateway 2>/dev/null && echo "✓ 已停止" || echo "Gateway 未在运行"
