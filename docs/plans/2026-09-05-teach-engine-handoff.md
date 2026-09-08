# Teach Engine 线交接（P2 → P3）

> 2026-09-05。给下一个 coding agent：读完 AGENTS.md §1 铁律 + 本文件 + `docs/TEACH_TUTOR_ENGINE.md`，再动手。

## 0. 第一优先级：工作树未提交

teach-engine 这条线的**全部代码此刻只在 working tree 里，没有任何 commit**：

- untracked：`src/lib/services/teach-engine/`（整个服务）、`docs/TEACH_TUTOR_ENGINE.md`、`assets/teach-skills/`（10 个 skill）、`tests/eval/teach/`（eval 门禁）、`out/tutor-engine-spike/`
- dirty modified：`src/app/api/teach/threads/**`（双引擎分发）、`prisma/schema.prisma`（TeachThread.engine）、`src/lib/config/teach.config.ts`、`src/components/teach/teach-events.ts`（双词表）、`next.config.js`、`Makefile`、`tests/eval/regression-guard.ts` 等

**不换机器/分支之前必须先整理提交**，否则"P1/P2 已完成"在其他环境不存在。接手第一件事：`git status` 确认这批文件是否已入库；没入库就先提交（用户明确要求时才 commit）。

## 1. 这条线是什么

AI 家教「上课」线的引擎迁移：codex 底座（旧，每线程一进程）→ teach-engine（新，`src/lib/services/teach-engine/`：pi agent loop 进程内 + vendor OpenMAIC 28 动作引擎 + 模型直出结构化动作、边生成边执行）。**双线并存**：`TEACH_ENGINE=codex|engine`（默认 codex）决定新建线程归属，路由按 `TeachThread.engine` 快照分发；前端 SSE 契约不变、tool-call name 双词表（legacy 分支永久保留）。事故回滚阀：`TEACH_ACTIONS_FULL=0`。

## 2. 当前进度（2026-09-05 收口状态）

| 期 | 状态 |
|---|---|
| P0 spike | ✅ |
| P1 引擎落地 | ✅（check/test/build 绿、双引擎分发实测） |
| P2 skill 体系 | ✅ 2026-09-05 收口：10 skill + 出题 e2e + eval 门禁（`tests/eval/teach/`，dry-run 6/6，baseline 已入 `tests/eval/baselines/teach.json`，regression-guard teach 段已接线） |
| P3 交互闭环 | 🔶 部分（见 §3） |
| P4 迁移收尾 | 未开始 |

## 3. 下一步（P3 缺口，按建议顺序）

1. **quiz 锚点纪律 prompt 收敛**（门槛最低、有现成量化闭环）：P2 real 首测暴露——Gemini 判分 5/6 准，但判分轮不引用 `quiz_qN` elementId 锚点（5/6 例）、不落讲评板（1 例）。改 `src/lib/prompts/teach-teacher-prompt.ts` 的 `buildTeachEngineInstructions` 和/或 `assets/teach-skills/quiz-maker/SKILL.md`，验收 = `npx tsx tests/eval/teach/runner.ts --real` 的 loop 通过率（需 TEACH provider key，dotenv 已接）。
2. **插话三拍 eval**：打断→回应→续讲的语义 eval，复用 tests/eval/teach 结构加 grader。
3. **学生模型（LearnerProfile）消费**：设计文档 §学生模型，目前 prompt 里没有消费。
4. **节奏层 / finish/done 语义**：一轮结束信号的语义收敛。
5. **换肤实现**：设计稿 `design-demo/teach-classroom-v1/` 六页，**先过 Taste 评审再动工**。

P4（codex 退役评估、CHANGELOG、给上游 OpenMAIC 提解析器修复 PR）在 P3 之后。

## 4. 关键命令

```bash
nvm use && npm ci          # Node 24 铁律（.nvmrc）
make check                 # 每次改完必跑（tsc）
make eval-teach            # 出题闭环 dry-run 门禁（改 prompt/skill/teach-engine 必跑）
make eval-teach-real       # 真实链路（烧额度，验收锚点纪律用）
make eval-ci               # 全套：单测 + asr + tutor + teach + guard
npx tsx scripts/teach-engine-bench.ts   # 引擎 bench（token/板书密度）
```

## 5. 关键文件

- 编排：`src/lib/services/teach-engine/teach-engine-service.ts`（对外契约在文件头注）
- 接缝：`runtime/`（stream-fn / engine-runner / action-map 词表 / skills / stage-store / board-stores / audio-pacer）
- prompt：`src/lib/prompts/teach-teacher-prompt.ts` 的 `buildTeachEngineInstructions`
- 词表单一事实源：`runtime/action-map.ts`；前端双词表：`src/components/teach/teach-events.ts` `boardEffectOf`
- skill 治理：`assets/teach-skills/DOMAIN.md`；门禁：`tests/eval/teach/DOMAIN.md`
- 设计与分期：`docs/TEACH_TUTOR_ENGINE.md`（§9 分期表是状态真相源，收口时更新）

## 6. 这条线的特殊纪律

- **事件契约不可破**：SSE 事件名与旧线一致（text-delta/tool-call/tool-result/turn-complete/interrupted/error）；engine v1 不发 image-ready。
- **旧线程回放不可破**：engine=null 走 codex；teach-events.ts legacy 词表分支永久保留（15 个 legacy 线程依赖）。
- **vendor 树不改写**：`vendor/openmaic/` 整树豁免 500 行铁律，bug 修复以 `[FIX vs upstream]` 标注（已有一处：解析器吞口播修复，待提上游 PR）。
- **可变状态挂 globalThis**（Next dev 每路由独立编译 entry，模块级 Map 会被复制）。
- 改完同步文档：TEACH_TUTOR_ENGINE.md §9 分期表 + 对应 DOMAIN.md（铁律）。
