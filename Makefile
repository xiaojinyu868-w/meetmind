# MeetMind Golden Commands
# Agent 和人类都只用这些命令。不要发明新脚本。

# === 日常开发 ===

.PHONY: dev
dev: ## 启动开发服务器
	npm run dev

.PHONY: check
check: ## 类型检查（最常用，每次改完必跑）
	npx tsc --noEmit

.PHONY: build
build: ## 生产构建
	NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1024" npm run build

.PHONY: deploy
deploy: build ## 构建 + 重启 PM2
	pm2 restart meetmind

# === 代码质量 ===

.PHONY: test
test: ## 运行单元测试
	npx vitest run

.PHONY: test-watch
test-watch: ## 运行单元测试（watch 模式）
	npx vitest

.PHONY: test-server
test-server: ## 运行 server/ 下的 ASR 工具函数单测
	npx vitest run --config vitest.server.config.ts

.PHONY: test-all
test-all: test test-server eval-unit ## 运行全部单元测试（src/ + server/ + eval/）

.PHONY: smoke
smoke: ## 端到端 smoke：路由/WS/auth/API 全通（需本地 dev server 在 3101 跑）
	SMOKE_BASE=$${SMOKE_BASE:-http://localhost:3101} npx tsx tests/smoke/smoke.ts

.PHONY: smoke-intent
smoke-intent: ## 「聊聊你想要的」goal 模式 e2e（双路径：首次会面 + 回访）
	@PORT=$${PORT:-3002} \
	 SMOKE_BYPASS_TOKEN=$$(grep -E '^SMOKE_BYPASS_TOKEN=' .env 2>/dev/null | cut -d= -f2-) \
	 npx tsx tests/smoke/smoke-intent-mode.ts

.PHONY: smoke-review
smoke-review: ## 复习态 review 模式 e2e（验证 bio 注入 + 时间戳 + inline app）
	@PORT=$${PORT:-3002} \
	 SMOKE_BYPASS_TOKEN=$$(grep -E '^SMOKE_BYPASS_TOKEN=' .env 2>/dev/null | cut -d= -f2-) \
	 npx tsx tests/smoke/smoke-review-mode.ts

.PHONY: smoke-in-class
smoke-in-class: ## 课堂同桌 in-class 模式 e2e（验证 recentFocus + Skill chip + bio）
	@PORT=$${PORT:-3002} \
	 SMOKE_BYPASS_TOKEN=$$(grep -E '^SMOKE_BYPASS_TOKEN=' .env 2>/dev/null | cut -d= -f2-) \
	 npx tsx tests/smoke/smoke-in-class-mode.ts

.PHONY: smoke-shared
smoke-shared: ## 分享态 shared 模式 e2e（隐私铁律：不出时间戳/不出 marker/不注入访客画像）
	@PORT=$${PORT:-3002} \
	 SMOKE_BYPASS_TOKEN=$$(grep -E '^SMOKE_BYPASS_TOKEN=' .env 2>/dev/null | cut -d= -f2-) \
	 npx tsx tests/smoke/smoke-shared-mode.ts

.PHONY: smoke-all
smoke-all: ## 跑全部 4 个 mode 的 e2e smoke（goal + review + in-class + shared）
	@$(MAKE) smoke-intent && $(MAKE) smoke-review && $(MAKE) smoke-in-class && $(MAKE) smoke-shared

# === Eval Harness ===
# 设计原则：见 tests/eval/README.md
# 每次改 ASR / Agent 前后必跑，数字变动 = 回归信号

.PHONY: eval
eval: eval-unit eval-asr eval-tutor ## 跑完整评测套件（单测 + ASR + Tutor）

.PHONY: eval-unit
eval-unit: ## Eval harness 本身的 grader 单测
	npx vitest run --config vitest.eval.config.ts

.PHONY: eval-asr
eval-asr: ## ASR 评测（dry-run，基于 seed 数据集 + 未来真实 Qwen3-ASR 调用）
	npx tsx tests/eval/asr/runner.ts --dry-run

.PHONY: eval-asr-real
eval-asr-real: ## ASR 评测（真实调用 Qwen3-ASR-Flash，需 DASHSCOPE_API_KEY + 公网 audio URL）
	npx tsx tests/eval/asr/runner.ts --real

.PHONY: eval-tutor
eval-tutor: ## Tutor 评测（含工具选择、时间戳引用、LLM rubric）
	npx tsx tests/eval/tutor/runner.ts --dry-run

.PHONY: eval-tutor-real
eval-tutor-real: ## Tutor 评测（真实调用 LLM + tools，需 OPENAI_API_KEY 或 DASHSCOPE_API_KEY）
	npx tsx tests/eval/tutor/runner.ts --real

.PHONY: eval-guard
eval-guard: ## Harness 回归 guard（CI gate；baseline 在 tests/eval/baselines/）
	npx tsx tests/eval/regression-guard.ts

.PHONY: eval-guard-update
eval-guard-update: ## 接受当前数字为新 baseline（慎用；确认改动是正收益后才跑）
	npx tsx tests/eval/regression-guard.ts --update

.PHONY: eval-ci
eval-ci: eval-unit eval-asr eval-tutor eval-guard ## CI 完整流程：单测 + 跑 harness + guard

.PHONY: lint
lint: ## ESLint 检查
	npx eslint src/ --ext .ts,.tsx --max-warnings 0

.PHONY: clean-logs
clean-logs: ## 清理所有 console.log
	node scripts/clean-console-logs.js

.PHONY: clean-logs-dry
clean-logs-dry: ## 预览清理效果（不实际修改）
	node scripts/clean-console-logs.js --dry-run

# === 数据库 ===

.PHONY: db-push
db-push: ## 同步 Prisma schema 到数据库
	npx prisma db push

.PHONY: db-studio
db-studio: ## 打开 Prisma Studio
	npx prisma studio

# === 诊断 ===

.PHONY: stats
stats: ## 项目统计（文件数、行数、大文件）
	@echo "=== 文件统计 ==="
	@find src -name "*.ts" -o -name "*.tsx" | wc -l | xargs echo "TS/TSX files:"
	@echo ""
	@echo "=== 超标文件（>500行） ==="
	@find src -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | sort -rn | awk '$$1 > 500 && $$2 != "total" { print $$1, $$2 }' | head -20
	@echo ""
	@echo "=== console.log 残留 ==="
	@grep -r "console\.log" src/ --include="*.ts" --include="*.tsx" -c 2>/dev/null | grep -v ":0$$" | sort -t: -k2 -rn | head -10

.PHONY: help
help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
