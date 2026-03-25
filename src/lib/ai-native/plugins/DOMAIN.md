# AI-Native Plugins — 应用插件

> Workshop 应用的 LLM 执行插件，每个插件对应一种应用类型。

## 文件索引

| 文件 | 职责 |
|------|------|
| `quiz.plugin.ts` | 测验插件（LLM 生成选择题/判断题） |
| `studio-workshop.plugin.ts` | Studio Workshop 主文件（~340 行），子模块如下 |
| `studio-workshop.types.ts` | 类型/模式检测/解析辅助（~210 行，有测试） |
| `studio-workshop.podcast.ts` | 播客管线（~290 行） |
| `studio-workshop.renderers.ts` | 渲染负载构建器（~180 行） |

## 已有测试

- `studio-workshop.types.test.ts` — 44 tests，覆盖模式检测/时间戳/数组/对话解析
