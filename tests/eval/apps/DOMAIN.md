# Eval · apps — 测验 / 闪卡产物质量（2026-09-11 内容层）

> 上一轮打磨的是交互与表现（测验是一份试卷、闪卡是牌）；这一轮进入内容层：题怎么出、卡怎么出。
> 这里是"用真课看产物"的自动化那一半——人读产物仍是真正的门禁（`runs/*.jsonl` 的 `items` 就是给人读的）。

## 它测什么、不测什么

- **测**：模型产物经生产真件（`parseQuizDraft` / `buildQuizCards`、`parseFlashcardsDraft` / `buildFlashcardCards`：LaTeX 反斜杠修复、
  去重、题型收口、多选答案契约、正面泄答剔除、证据落地）之后，作为一套题 / 一叠卡最起码要成立的几件事：
  每题有解析、无重复题干、不出"以下哪个不是"式凑数题、干扰项不是模板空话、解析里不漏段号、多选答案是 `A、C` 字母契约、
  有掌握轨迹时不稳概念被覆盖（`mustCover`）；一张卡一个点、正面是提示不是词条、正面不把答案说出来、背面两行内、不复述摘要。
- **不测**：题好不好、卡好不好——那要人读。软项（题型不止一种、选择题解析说到了错项、题干短、上次没记住的原句不再原样出现、
  两问合一的卡比例）只计入 `score`，不决定 pass；`avgScore` 进 baseline，软项整体退化在 guard 里看得见。
- **dry-run 测的是产物契约与生产后处理，不是 prompt**：stubOutput 是冻结的模型原文，改 prompt 不会让 dry-run 变红。
  改了 `app-prompts-practice.ts` 或插件后要 `make eval-apps-real` 看真产物（`RECORD=1` 把这一版冻结成新的 dry-run 材料），然后**读 runs 里的 items**。

## 文件

| 文件 | 职责 |
|---|---|
| `runner.ts` | 加载 `datasets/*.jsonl`，按 fixture + learner（掌握轨迹）+ anchors 组 `AppExecutionContext`（`buildExecutionContext` 生产真件），模型原文 → 生产后处理 → grader；`--real` / `--record`；summary 一行 |
| `real-caller.ts` | `generateQuizDraft` / `generateFlashcardsDraft`（与生产同一份 prompt 与上下文组装），模型 `APPS_EVAL_MODEL` 或 `DEFAULT_WORKSHOP_MODEL_ID` |
| `load-env.ts` | runner 的第一个 import：插件 → llm-service → app.config 在加载时就按 env 挑默认模型，main() 里再 loadEnv 已经晚了（首次 --real 打到 StepFun 402 就是这个） |
| `graders/quiz-quality.ts` | 硬项：enoughQuestions / everyQuestionExplained / noDuplicateStems / noNegativeStems / noTemplateOptions / answersResolvable / mustCover / noSegmentIndexInExplanation；软项：typeVariety / choiceExplanationsExplainWrong / stemsShort / distractorsSubstantive / noSelfDebateInExplanation / unstableNotRepeatedVerbatim |
| `graders/flashcards-quality.ts` | 硬项：enoughCards / everyCardHasBothFaces / noFrontRevealsBack / noTitleLikeFronts / noDuplicateFronts / backsFitTwoLines / noSummaryRestatement / mustCover；软项：frontsArePrompts / backsShort / hintsDontLeak / frontsSingleQuestion / unstableNotRepeatedVerbatim |
| `graders/graders.test.ts` | grader 自身的单测（`make eval-unit`） |
| `fixtures/gaoshu-yingshe.json` | 真课转录：宋浩老师《高等数学》2.0 第 1 讲 映射（Bilibili 公开课，34 分钟 / 179 段 / 7.9k 字；从共享库导出并按 (startMs, text) 去重） |
| `datasets/practice-quality.jsonl` | 6 个 case：映射课 × {访客, 有掌握轨迹的学习者} × {测验, 闪卡} + 试听课（`demo-english`，`src/fixtures/demo-data`）× {测验, 闪卡}；`learner.mastery` 里有两条还没稳（逆映射为什么要单射 / 满射的定义）、一条刚记住（复合映射顺序）、一条已经稳（映射定义），`expect.mustCover` 要求两条不稳的被覆盖 |

## 2026-09-11 三轮真模型迭代（qwen3.7-plus）留下的判断

1. **段号会漏进解析**（"课堂原文段032明确指出"）——测验的转录上下文改成给时间戳不给段号（`buildQuizPromptMessages`），prompt 要求引用写时间点或原话；硬项 `noSegmentIndexInExplanation`。
2. **模型拿不准的多选题会在解析里自我讨论**（"注：若严格来说……"）——prompt：多选每个选项都要能用课堂原话一句定死，拿不准就改题；解析一段话说完。软项 `noSelfDebateInExplanation`（试听课 93 秒材料太薄时仍会出现，材料薄就该少出题）。
3. **prompt 里写反例会被原样复刻**——"被称为什么？它排除了哪种情况？"作为反面例子写进 prompt，模型就出了这张卡；改成不带例句的"正面只有一个问号，想问两件事就做两张卡"。仍偶发一张（11 张里 1 张），软项按比例看。
4. **"换角度"最难**：上次没答上"为什么只有单射才有逆映射"，模型会再出一道"为什么只有单射才能定义逆映射"。prompt 给了具体的换法（拿 $y=x^2$ 判断有没有逆映射），模型会**加**一道换角度的题，但原题往往也还在。软项 `unstableNotRepeatedVerbatim` 如实记着。
5. 给了掌握轨迹后模型会把题量缩成只考那两个点（4 题）——prompt 说明"在本来的题量上做加减，其他要点照常检验"后回到 6 题。

## 命令

```bash
make eval-apps                 # dry-run（CI）
make eval-apps-real            # 真模型跑一遍，读 runs/*.jsonl 的 items
RECORD=1 make eval-apps-real   # 真模型 + 把输出冻结进 dataset（确认产物更好之后再做）
npx tsx tests/eval/apps/runner.ts --id quiz-yingshe-unstable
make eval-guard                # baseline 在 tests/eval/baselines/apps.json（passRate + avgScore，5pp 容忍）
```
