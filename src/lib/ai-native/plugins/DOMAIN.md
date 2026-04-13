# AI-Native Plugins — 应用插件

> Workshop 应用的 LLM 执行插件，每个插件对应一种应用类型。

## 文件索引

| 文件 | 职责 |
|------|------|
| `quiz.plugin.ts` | 测验插件（LLM 生成选择题/判断题） |
| `class-check.plugin.ts` | 随堂检验插件（基于知识点结构的智能随堂检验） |
| `study-report.plugin.ts` | 听课报告插件（面向家长的专注度 + 掌握度分析） |
| `studio-workshop.plugin.ts` | Studio Workshop 主文件（~340 行），子模块如下 |
| `studio-workshop.types.ts` | 类型/模式检测/解析辅助（~210 行，有测试） |
| `studio-workshop.podcast.ts` | 播客管线（~290 行） |
| `studio-workshop.renderers.ts` | 渲染负载构建器（~180 行） |
| `flashcards.plugin.ts` | 闪卡 |
| `mindmap.plugin.ts` | 思维导图 |
| `knowledge-cards.plugin.ts` | 知识卡片 |
| `confusion-drill.plugin.ts` | 困惑点训练 |
| `review-plan.plugin.ts` | 复习计划 |
| `fallback.plugin.ts` | 兜底 |
| `index.ts` | 插件注册（10 个插件） |

## 已有测试

- `studio-workshop.types.test.ts` — 44 tests，覆盖模式检测/时间戳/数组/对话解析
