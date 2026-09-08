# tests/eval/teach —— teach-engine 出题（quiz-maker）闭环评测域

> 沿用 tests/eval/ 的 SWE-Bench 风格约定（见 ../README.md）。
> 设计依据：`docs/TEACH_TUTOR_ENGINE.md` §8 eval 闭环；skill 治理见 `assets/teach-skills/DOMAIN.md`。

评测对象：AI 家教「上课」线（teach-engine）的**出题—作答—判分闭环**（quiz-maker skill）。

- **dry-run（默认）**：case 带 `stubOutput`（冻结的模型 DSL 输出），每 case 建内存
  stage + ActionEngine + AudioPacer，每轮新 EngineRunner 切块喂入 —— 解析器 /
  动作引擎 / 事件捕获全是生产真件，只有模型输出冻结。这就是出题 e2e。
- **--real**：`real-caller.ts` 直驱等效生产链路（loadTeachingSkills +
  buildTeachEngineInstructions + streamText 多轮，assistant 回复用原始 DSL 文本
  累积），不经 teach-engine-service（避免污染 dev.db / 事件日志）。需 TEACH
  provider 的 key（`resolveTeachProvider()` 报什么 env 就配什么），缺 key exit 2。

## 契约

- case（`datasets/*.jsonl`）：`{ id, topic, turns: [{ studentMessage, stubOutput? }], expect: { quizElementIds, verdicts, requireDiscussionPause? } }`；类型定义在 `runner.ts`（grader 共用）。
- grader 输入 `TurnCapture[]`（events / speechText / summary），返回 `{ pass, score, reason }`（reason 中文列失败项）：
  - `graders/quiz-loop.ts` —— 闭环结构断言：出题轮 quiz_qN 锚点落板 + discussion 暂停在最后出题动作之后；判分轮讲评落板且引用 quiz_qN；每轮闭合、无越表动作。
  - `graders/grading-accuracy.ts` —— 判分准确率（门禁核心指标）：`parseVerdicts` 从判分轮口播 + 新落板文本按出现顺序提取对/部分对/错三态（优先级 partial > wrong > correct），与 expect.verdicts 逐题比对；缺判定按 wrong 计。
- dataset 全部是期望 pass 的正例；grader 区分度由同目录 `*.test.ts` 的负例验证。

## 命令

```bash
npx tsx tests/eval/teach/runner.ts --dry-run        # 或 make eval-teach
npx tsx tests/eval/teach/runner.ts --id <case-id>   # 单条调试
npx tsx tests/eval/teach/runner.ts --real           # 或 make eval-teach-real（需 key）
```

run 结果写 `runs/<ts>.jsonl`（gitignore）；regression-guard teach 段对比
`tests/eval/baselines/teach.json`（passRate 与 gradingAccuracy 各容忍 -5pp）。
摘要行：`[teach-eval] 6/6 passed | loop=100.0% grading=100.0% | Nms`。
