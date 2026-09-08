# VENDOR.md — vendor/openmaic 来源与本地修改清单

## 来源

- 上游：[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)，**MIT**（LICENSE 在本目录，dsl/ 子目录另有一份）。
- 晋升路径：`out/openmaic-study/`（源码研究）→ `out/tutor-engine-spike/vendor/openmaic/`（字节级 vendor + spike 修复）→ **本目录**（P1 产品化晋升，import 改写）。
- 维护策略（设计文档 §7）：vendor 一次、当自有代码维护；上游迭代只选择性 cherry-pick（安全修复、解析器修复），功能分歧不追。**LGPL 雷区**：上游 `packages/mathml2omml`（PPTX 公式导出）永不引入。

## 运行时真正用上的模块

| 文件 | 用途 |
|---|---|
| `action/engine.ts` | 动作执行引擎：blocking 二分契约（spotlight/laser fire-and-forget vs speech/wb_* synchronous） |
| `choreography/{timing,cursor,timeline,descriptors/*}` | `resolveActionTimeline` 时序预言 + `estimateSpeechDurationMs`（CJK 150ms/char）+ spotlight/laser descriptor（zod schema） |
| `orchestration/stateless-generate.ts` | 流式结构化解析器（含 `[FIX vs upstream]` 修复，见下） |
| `dsl/`（全量 20 文件） | 类型级 + 分区常量（`FIRE_AND_FORGET_ACTIONS` / `SLIDE_ONLY_ACTIONS`）；runtime/pbl/slides 等为类型编译服务 |
| `orchestration/tool-schemas.ts` | `getActionDescriptions`：prompt 动作词表生成（teach-teacher-prompt 消费） |
| `logger.ts` | spike 遗留的 vendor logger（运行时无人 import，carried 备查；引擎实际用主仓库 `@/lib/logger`） |
| `playback/*`、`orchestration/types.ts` | P3 playback 状态机的备件，当前零 import |

## 本地修改清单

### `[FIX vs upstream]`（spike 阶段已修，计划提 PR 回上游）

- `orchestration/stateless-generate.ts`：Step 2 判结从 `trimmed.endsWith(']')` 改为
  `findTopLevelArrayCloseIndex` 顶层深度扫描（嵌套数组参数在 SSE 停顿点提前判结、
  吞掉后续口播的 bug；teach-harness-ab 实测 4/54 turn 中招）。回归测试：
  `__tests__/parser-regression.test.ts`。

### `[ADAPT vs upstream]`（P1 产品化改写）

- `action/engine.ts` import 8 处：
  - `@/lib/api/stage-api` → `../../../runtime/stage-store`（每线程内存 stage store）
  - `@/lib/store/{canvas,whiteboard-history,media-generation}` → `../../../runtime/board-stores`，
    且**模块级 zustand 单例改为构造注入**（`ActionEngine` 构造函数第 4 参数 `stores`，
    类内 `useCanvasStore.getState()` 等 21 处改为 `this.stores.*`）——上游一页一课堂，
    主路多线程并发用模块单例会串板
  - `@/lib/utils/audio-player` → `../../../runtime/audio-pacer`（AudioPlayer 接口）
  - `@/lib/types/action` → `../dsl`（上游该文件本就是 dsl 重导出 + `LegacySpeechAction`，
    后者在 engine.ts 就地定义）
  - `@/lib/media/media-task-resolution` → 内联 undefined stub（v1 无 slide/视频场景）
  - `@/lib/choreography` → `../choreography`（上游即纯转发）
  - `@openmaic/dsl` → `../dsl`
  - `@/lib/logger` **保留不改**——恰好命中主仓库真实 logger（`src/lib/logger.ts`）
- `playback/action-navigation.ts`、`orchestration/tool-schemas.ts`：`@/lib/types/action` → `../dsl`
- `choreography/timeline.ts`、`choreography/cursor.ts`：`@openmaic/dsl` → `../dsl`

### 验证不变式

`grep -rn "@/lib" vendor/openmaic` 应只剩 `@/lib/logger` 两处（engine.ts、stateless-generate.ts）；
`grep -rn "from '@openmaic" vendor/openmaic` 应为零。
