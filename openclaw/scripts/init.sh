#!/bin/bash
# OpenClaw 初始化脚本 — 首次运行时使用
set -e

OPENCLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$OPENCLAW_DIR/.state"

echo "=== OpenClaw 初始化 ==="
echo "项目目录: $OPENCLAW_DIR"
echo "状态目录: $STATE_DIR"

# 确保状态目录存在
mkdir -p "$STATE_DIR"/{workspace,sessions,skills}

# 检查 .env 是否存在
if [ ! -f "$STATE_DIR/.env" ]; then
  echo ""
  echo "⚠️  未找到 $STATE_DIR/.env"
  echo "请创建并填入你的 API Key："
  echo ""
  echo "  cat > $STATE_DIR/.env << EOF"
  echo "  ANTHROPIC_API_KEY=sk-ant-..."
  echo "  OPENAI_API_KEY=sk-..."
  echo "  DEEPSEEK_API_KEY=sk-..."
  echo "  EOF"
  echo ""
  echo "创建 .env 后重新运行此脚本。"
  exit 1
fi

# 设置环境变量
export OPENCLAW_STATE_DIR="$STATE_DIR"

# 运行 onboard（跳过交互，使用默认配置）
echo ""
echo "正在运行 openclaw onboard..."
openclaw onboard --no-onboard 2>/dev/null || true

# 复制 persona 到 workspace
if [ -f "$OPENCLAW_DIR/personas/ye-design.md" ]; then
  cp "$OPENCLAW_DIR/personas/ye-design.md" "$STATE_DIR/workspace/SOUL.md"
  echo "✓ 已复制默认 persona (ye-design) 到 workspace/SOUL.md"
fi

# 复制 Skills 到状态目录
if [ -d "$OPENCLAW_DIR/skills" ]; then
  cp -r "$OPENCLAW_DIR/skills/"* "$STATE_DIR/skills/" 2>/dev/null || true
  echo "✓ 已复制自定义 Skills"
fi

echo ""
echo "=== 初始化完成 ==="
echo "运行 bash scripts/start.sh 启动 Gateway"
