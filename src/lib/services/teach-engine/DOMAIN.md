# teach-engine —— AI 家教「上课」线新引擎（pi loop + vendor OpenMAIC）

> 上游设计：`docs/TEACH_TUTOR_ENGINE.md`（§3 架构 / §5.1 动作协议 / §7 fork 策略 / §11 迁移决策）。
> spike 事实源：`out/tutor-engine-spike/REPORT.md`。
> **状态：P1-B 已接线——API 路由按线程引擎归属分发（`TEACH_ENGINE=codex|engine`
> 决定新建线程走哪套；TeachThread.engine 快照归属，null 旧线程走 codex），
> 前端 boardEffectOf 双词汇分支已落地。**

## 数据流（接线后完整链路）

```
浏览器 EventSource ←SSE─ /api/teach/threads/[id]/stream（event-bus 扇出，两引擎共用）
浏览器 POST → threads / messages / interrupt（薄壳）
  → 按 TeachThread.engine 分发：
    engine → teach-engine-service（本目录）：pi Agent + StreamFn 桥
      → LLM text_delta → EngineRunner 增量解析 → 闭合动作进 vendor ActionEngine
      → emit → event-bus publish + thread-store 落盘（data/teach-events/<id>.jsonl）
    codex/null → teach-session-service（codex app-server 底座，不变）
前端 /teach：tool-call name 双词表在 teach-events.ts boardEffectOf 各自分支
  映射到同一套 BoardAction（新词表 wb_draw_text/wb_draw_latex/spotlight/wb_clear 上板，
  laser 降级 none；wb_clear → BoardClearAction，BoardCanvas 经 flattenPage 截断渲染）。
```

## 职责

teach-session-service（codex app-server 底座）的继任编排：每线程一个 pi Agent
（显式 initialState 压掉 coding 心智 + 全量 StreamFn 自控模型层），模型直出
结构化动作数组（`[{type:"text"...},{type:"action"...}]` 交织），增量解析、
闭合动作立即进 vendor ActionEngine 执行——**边生成边执行**（spike 是整轮后补）。

## 结构

```
teach-engine/
├── teach-engine-service.ts   # 编排服务（对外契约见下）
├── runtime/                  # 自研接缝（每个文件一个职责，行数预算 500）
│   ├── stream-fn.ts          # pi StreamFn → AI SDK v6 streamText 桥（晋升 spike，
│   │                         # 主仓库 @ai-sdk/openai v3 下实测，加 providerOptions 透传）
│   ├── engine-runner.ts      # text_delta 增量喂 vendor 解析器 → 闭合动作立即执行；
│   │                         # 串行队列维持 blocking 契约；未闭合兜底 + unknownActions 统计
│   ├── stage-store.ts        # 每线程内存 stage store（去全局化：createThreadStageStore
│   │                         # 构造注入 recorder，非 spike 的模块级 setStageRecorder）
│   ├── board-stores.ts       # canvas/whiteboard-history/media-generation 三合一工厂
│   │                         #（去全局化，经 ActionEngine 构造函数注入）
│   ├── audio-pacer.ts        # AudioPlayer 接口 + AudioPacer：estimateSpeechDurationMs
│   │                         # 估时 pacing；不接真实 TTS（出声走 /api/teach/tts + 前端）
│   ├── action-map.ts         # KNOWN_ACTIONS / ACTIONS_V1 词表 + TEACH_ACTIONS_FULL=0 收回开关（默认全量）
│   │                         # + actionToToolCallEvent 映射 + elementId 缺省补 a_${n}
│   └── skills.ts             # pi 原生 loadSkills/createReadTool/formatSkillsForSystemPrompt；
│                             # TEACH_SKILLS_DIR（默认 assets/teach-skills/）不存在返回空不报错
├── vendor/openmaic/          # THU-MAIC/OpenMAIC（MIT），见 vendor/openmaic/VENDOR.md
└── __tests__/                # vitest（parser 回归 / action-map / runner 集成 / service mock / jsonrepair 兜底）
```

## 对外契约（路由层按此接线；改契约 = 同时改路由、前端 `teach-events.ts` 与本节，并考虑旧事件日志的回放）

```ts
preflightTeachEngine(): { ok: true } | { ok: false; error: string }
sendTeachEngineMessage(threadId: string, text: string): Promise<void>
  // 同步错误抛 TeachEngineError（code/status）：404 thread-not-found、409 turn-active
  // （防并发语义同旧 teach-session-service）；resolve 时机 = 会话就绪、turn 已 kickoff
interruptTeachEngineThread(threadId: string, text?: string): Promise<void>
  // abort 贯通（pi agent.abort → stream-fn signal → streamText 断流；runner 清队列 +
  // pacer 放行当前 speech）；附 text 时等 interrupted 落地后同线程续讲
```

## 事件契约（复用 teach-codex 共享件，SSE 事件名不变）

publish 走 `teach-codex/event-bus.ts` publishTeachEvent；落盘走 thread-store
appendThreadEvent（与旧服务同一 `data/teach-events/<threadId>.jsonl`，格式不变）。

| 引擎内部 | SSE 事件 |
|---|---|
| 口播 text 增量（解析器吐出的可见切片） | `text-delta` |
| 闭合动作执行前 | `tool-call`（id 稳定 `tc_<uuid>`，name=新动作名如 `wb_draw_text`，args 原样透传 params） |
| 落板确认后 | `tool-result`（result 对齐旧 BoardEnv digest：`{ok:true, board}`，board 为板书清单文本） |
| 一轮结束 | `turn-complete`（在板上最后一个动作执行完之后发） |
| 打断 | `interrupted` |
| stream-fn fail | `error` |
| 学生消息 | `student-message`（只落盘不广播，同旧服务） |

**v1 不发 `image-ready`**（无 image 动作；dashscope 生图保留作装饰性用途）。

## 关键行为

- **词表默认全量 KNOWN**（runtime/action-map.ts；P3 渲染器补齐后于 2026-09-05 翻转）：
  v1 降级集 = speech / wb_open / wb_close / wb_draw_text / wb_draw_latex / wb_clear /
  spotlight / laser / discussion；shape/table/line/code/edit_code 前端渲染器已落地
  （teach-events.ts 分支 + blackboard/BoardBlocks.tsx），widget_show 仍 v2 预留。
  `TEACH_ACTIONS_FULL=0` 收回 v1（事故回滚）；越表动作跳过执行并计 unknownActions。
- **标题**：prompt 约定首条 wb_draw_text 写正式课题标题 → renameThread（仅在
  title 仍等于 topic 时覆盖，双锁语义同旧服务）；否则停留 topic。
- **重启恢复**：首次发消息从事件日志重建 pi 上下文（student-message→user、
  text-delta 拼接→assistant）+ wb_* tool-call silent 重放重建 stage store。
- **多线程隔离**：注册表挂 globalThis（Next dev 模块复制教训）；stage/board
  stores/pacer 全部每线程实例化，无模块级可变全局。
- **口播 pacing**：AudioPacer 按估时阻塞后续动作（引擎 blocking 契约），speech
  时长 = vendor estimateSpeechDurationMs（CJK 150ms/char）；真实 TTS 出声不在本层。

## 依赖边界

- 允许：teach-codex 共享件（event-bus / thread-store）、lib/config、lib/prompts、
  lib/logger、vendor/*、runtime/*、npm（pi-agent-core / pi-ai / ai / @ai-sdk/openai /
  partial-json / jsonrepair / zod / katex）。
- 禁止：import 前端组件 / stores / hooks；pi 的 baseInstructions / 内置 coding 工具
  （edit/bash/grep 一个不进）；`@openmaic/storage` 真包（引擎栈对存储层零依赖）。
- fenshen 边界：本目录与 fenshen 零耦合；teach-codex 通用件（shim-server /
  codex-app-server / teach.config provider 注册表）原样保留，fenshen 继续消费。

## vendor 树与行数预算

`vendor/openmaic/` 整树不受行数预算约束（设计文档 §7「vendor 一次、当自有代码维护」；
engine.ts 909 行为上游单文件，拆分会偏离上游 diff 可维护性）。vendor 内必要的 bug 修复以
`[FIX vs upstream]` 注释标注，攒够就提上游 PR（已有一处：解析器吞口播）。
runtime/* 与 teach-engine-service.ts 按 500 行预算写；超了先看是不是职责混了，不是机械拆。

## 运维

- env：`TEACH_ENGINE`（codex/engine，**新建线程的引擎归属开关**，创建时快照进
  TeachThread.engine；旧线程 null 永远走 codex）、`TEACH_SKILLS_DIR`、
  `TEACH_ENGINE_MAX_OUTPUT_TOKENS`、`TEACH_ACTIONS_FULL`——见 `.env.example`。
- bench：`npx tsx scripts/teach-engine-bench.ts [providerId] [reps]`
  （`TEACH_ENGINE_SIM_SPEED` 加速口播估时）。
- Next/webpack 兼容（P1-B 实测修复）：vendor dsl 内部用 ESM 风格 `.js` 后缀
  import 同目录 `.ts`，webpack 默认解析不了 → `next.config.js` 加了
  `resolve.extensionAlias { '.js': ['.ts', '.js'] }`（在构建层解决，vendor 树不用为此改写）。
