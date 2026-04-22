#!/bin/bash
# 查看 OpenClaw 状态
set -e

OPENCLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$OPENCLAW_DIR/.state"

export OPENCLAW_STATE_DIR="$STATE_DIR"

echo "=== OpenClaw 状态 ==="
echo "版本: $(openclaw --version 2>&1)"
echo "状态目录: $STATE_DIR"
echo ""

echo "--- PM2 ---"
pm2 list 2>/dev/null | grep -E "openclaw|id.*name" || echo "PM2 未运行 openclaw-gateway"
echo ""

echo "--- Gateway ---"
openclaw gateway status 2>&1 || echo "Gateway 未运行"
echo ""

echo "--- Skills ---"
echo "自定义 Skills:"
ls -1 "$OPENCLAW_DIR/skills/" 2>/dev/null || echo "无"
echo ""
echo "运行时 Skills:"
ls -1 "$STATE_DIR/skills/" 2>/dev/null || echo "无"
echo ""

echo "--- 磁盘 ---"
du -sh "$STATE_DIR" 2>/dev/null || echo "状态目录为空"
