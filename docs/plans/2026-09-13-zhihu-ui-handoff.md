# 知乎线前端 / 交互交接（2026-09-13）

> 写给接手 `feat/zhihu-ui` 的同学（人或 agent）。本 worktree **只打磨前端表现与交互**；试用实例仍在 `/mnt/meetmind-zhihu`。

## 目录 / 分支 / 端口

| | |
|---|---|
| 目录 | `/mnt/meetmind-zhihu-ui` |
| 分支 | `feat/zhihu-ui` |
| 开自 | `feat/zhihu-hackathon` @ `87f5c0b`（`docs(changelog): 2026-09-13 课的单位 / 课的物化 / 能力层 / OAuth 定稿`） |
| 开发 | `PORT=3013 NEXT_DEV_DIST_DIR=.next-dev-zhihu-ui make dev` |
| 试用实例（勿占） | PM2 `meetmind-zhihu` @ **3012** · cwd `/mnt/meetmind-zhihu` · https://zhihu.meetmind.online |

**3012 是试用实例，不要占用。** 本目录不是第二个 PM2 实例，不要在这里 `make deploy` / `make deploy-zhihu`。

## 为何从 `feat/zhihu-hackathon` 开，而不是 `release/prod`

知乎线代码**还没合进** `release/prod`（生产目录 `/mnt/meetmind-prod`）。从生产检出拿不到 `/apps/zhihu`、`src/components/zhihu/`、`copy-zhihu.ts`、材料课物化。规范默认「新线从 `release/prod` 开」在这里不成立，所以本线从试用实例所在分支开出。

## 本线范围

**做**：前端表现 + 交互。

- `src/components/zhihu/*`（第一屏 / 收藏夹页 / 课堂页壳 / 材料栏 / 继续看 / API 客户端）
- `src/app/apps/zhihu/**`（页面只是壳）
- `src/lib/ui/copy-zhihu.ts`（用户面文案唯一入口）
- 复习页材料附件相关 UI 若动到也算：`src/components/review/LessonMaterialsCard.tsx`，以及复习页里挂「继续看」插槽的那一处

**默认不动**：后端能力层 / OAuth / `services/material-lessons/` 契约、`api/zhihu/*` 请求体与错误码、teach-live 协议、schema。确需改 API 契约，先对齐 `/mnt/meetmind-zhihu` 主线同学，不要在本分支 silently 改薄壳。

## 必读顺序

1. `AGENTS.md` §1 工作方式（不变量、文案走 COPY、git 边界）
2. `skills/making-changes/SKILL.md`
3. `docs/PRODUCT_TASTE.md`（安静、有根、零提问、智能优先）
4. `docs/DESIGN_SYSTEM.md`（v7：pine / vermilion、纸感、`shadow-card`、少卡片堆叠）
5. `docs/plans/2026-09-12-zhihu-line.md`（旅程、分组、G11 能力层已抽完）
6. `src/app/api/zhihu/DOMAIN.md`（页面与路由契约；改 UI 前对照，不要猜字段）
7. `src/components/zhihu/DOMAIN.md` + **现有组件源码**（地图会过期，源码是真相）

契约层（只读、除非对齐主线）：`src/lib/services/zhihu/DOMAIN.md`、`docs/plans/2026-09-13-material-lessons.md`。

## 铁律（`docs/RELEASE_FLOW.md`）

- 只 `git add <路径>` / `git commit -- <路径>`；禁止 `git add -A`、`git commit -a`、`git stash`
- 不进别人的目录跑任何 git（尤其不要进 `/mnt/meetmind-zhihu`、`/mnt/meetmind-prod`）
- 本 worktree 一个分支，不切分支
- **不在本目录** `make deploy` / `make deploy-zhihu`（试用部署只在 `/mnt/meetmind-zhihu` 由主线执行）

## 怎么开发

```bash
cd /mnt/meetmind-zhihu-ui
PORT=3013 NEXT_DEV_DIST_DIR=.next-dev-zhihu-ui make dev
# 浏览器：http://127.0.0.1:3013/apps/zhihu
```

工作区已按规范初始化：`node_modules` / `data` / `public/{uploads,downloads,wechat-media}` 软链到 `/mnt/meetmind-capture-v1-server-handoff/`，`.env` 从试用实例复制（`DATABASE_URL` 绝对路径，与生产共库）。不要 `pnpm install` 除非 Node 主版本变了。

同一时刻最多两个 `next dev`；开之前看一眼 `free -m`。

## 验收

- 改了 `.ts` / `.tsx`：`make check`
- 知乎旅程相关：`make smoke-zhihu-lesson`（可加 `SMOKE_BROWSER=chromium` 出桌面 + 手机截图）
- 文案只改 `src/lib/ui/copy-zhihu.ts`，组件里不写死用户可见句
- 对齐 Taste / Design：不播报、不催、不堆卡片、动效克制；签名色 pine / vermilion，投影用 `shadow-card`

文档-only 改动不跑 eval。

## 交付路径

1. 本目录推送：`git push origin feat/zhihu-ui`
2. **合进** `feat/zhihu-hackathon`：在 `/mnt/meetmind-zhihu` 由主线同学 merge（不是你在本目录合，也不是合进 `release/prod`）
3. 主线执行 `make deploy-zhihu` → 试用子域 https://zhihu.meetmind.online

合进生产 `release/prod` 仍由产品负责人试用后决定，本线不负责。

## 建议打磨切入点（基于 09-13 现状）

1. **第一屏三种状态**（未登录 / 已登录未连接或过期 / 已连接）的视觉层次与动效克制——现在能用，但还偏「三种表单」。
2. **收藏夹页**：分线还在加载时「讲这篇」仍可点；忙碌态 / 禁用态要一致，不要让人点了以为卡住。
3. **课堂页侧栏**：`材料` / `继续看` 与讲完一轮才长出「考一考 / 去复习」的时机——节奏要对，不要一进页就堆动作。
4. **移动端断点**：smoke 已有手机截图；窄屏侧栏、按钮、第一屏三态要过一眼。
5. **去 Demo 感**：列表 / 按钮做成 v7 纸感（pine / vermilion、`shadow-card`、少卡片堆叠），不要再加一层玻璃或计数仪表盘。
6. **文案**只动 `copy-zhihu.ts`。

## 不要碰（除非对齐主线）

- `src/lib/services/zhihu/`、`src/lib/services/material-lessons/`
- `src/app/api/zhihu/`、`src/app/api/auth/zhihu/`
- `src/lib/services/teach-live/` 协议与 prompt
- `ecosystem.config.js`、`scripts/deploy.sh`、nginx、`.env` 里的 `ZHIHU_*`
- schema / Prisma
