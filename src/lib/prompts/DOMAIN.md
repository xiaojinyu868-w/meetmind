# Prompts

> 代码内可评测的 AI 行为基线。管理员运行时控制只能追加实验指令，不能替换这些基线或不可覆盖合同。

## 文件

| 文件 | 职责 |
|------|------|
| `tutor-prompts.ts` | 六种 Tutor mode 的统一 system prompt、版本与场景合同 |
| `tutor-prompts.test.ts` | Tutor prompt 合同测试 |
| `learning-understanding-prompts.ts` | 深度学习意图确认与长期学习理解整理的 system prompt 和独立版本号；供真实链路与管理员控制中心共同复用 |
| `teach-back-panel-prompt.ts` | 「讲给同桌听」连续讲述版评委席（`/api/apps/teach-back/turn`）的 system / user prompt（`teach-back-panel-v2`，2026-09-11 开口预算：一次开口 = 一句话 + 一个问题，或只一句"接着说"，二三十个字读出来五六秒，针对刚讲的这一段；两件事只说更要紧的一件。v1 是"一次 1-3 句"，实测 TTS 10-13 秒，不像通话。服务端 `JUDGE_SAY_MAX_CHARS` 220→90、maxTokens 320→160 只是保险丝）。给场景（费曼讲述）、给人（直言 / 引导 / 追问三位评委的性格）、给上下文（课堂原文——2026-09-11 起服务端给的是与刚讲这段相关的 ≤5k 字窗口，`transcriptWindowed` 为真时标题句注明"节选之外不要断言老师没讲过"，人设不动；目标点；最近两回合记录；刚讲完的一段；最近谁开口过）、给判断权（谁说、说什么、还是沉默让他继续）；渲染契约只有两行——第一行开口者代号 direct / guide / probe / none，之后是这个人的话（口语、无 Markdown / LaTeX，因为会被读出声）。`check-in` 模式描述"他安静了 40 秒"这个时刻。评委名字与 copy-apps 的用户面名字一致（`JUDGE_PROMPT_NAMES`） |
| `teach-teacher-prompt.ts` / `fenshen-persona-prompt.ts` / `rehearsal-prompts.ts` | teach 新引擎老师 / 分身人格 / 清小搭「上场前」的 prompt（各线 DOMAIN 有详述） |

## 依赖边界

- Prompt 文件只负责确定性拼装，不访问数据库、模型或用户状态。
- 运行时追加指令与模型路由由 `ai-control-service.ts` 处理。
- 用户当前表达、真实证据、隐私与结构化输出合同不得被管理员追加指令覆盖。

