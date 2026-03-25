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
