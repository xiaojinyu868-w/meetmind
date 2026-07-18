# Prompts

> 代码内可评测的 AI 行为基线。管理员运行时控制只能追加实验指令，不能替换这些基线或不可覆盖合同。

## 文件

| 文件 | 职责 |
|------|------|
| `tutor-prompts.ts` | 六种 Tutor mode 的统一 system prompt、版本与场景合同 |
| `tutor-prompts.test.ts` | Tutor prompt 合同测试 |
| `learning-understanding-prompts.ts` | 深度学习意图确认与长期学习理解整理的 system prompt 和独立版本号；供真实链路与管理员控制中心共同复用 |

## 依赖边界

- Prompt 文件只负责确定性拼装，不访问数据库、模型或用户状态。
- 运行时追加指令与模型路由由 `ai-control-service.ts` 处理。
- 用户当前表达、真实证据、隐私与结构化输出合同不得被管理员追加指令覆盖。

