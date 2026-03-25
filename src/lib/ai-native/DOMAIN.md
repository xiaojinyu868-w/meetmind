# AI-Native — 应用插件系统

> Workshop 应用的插件架构。每个「应用」（测验/闪卡/思维导图/播客等）是一个 Plugin。

## 架构

```
page.tsx → /api/apps/execute → context-builder → registry → plugin.execute()
```

1. 前端发起执行请求，带上转录 + 锚点 + 术语上下文
2. `context-builder.ts` 构建 `AppExecutionContext`
3. `registry.ts` 查找对应 plugin
4. Plugin 的 `execute()` 方法调用 LLM 生成结果
5. 前端浮窗渲染结果

## 文件索引

### 核心

| 文件 | 行数 | 职责 |
|------|------|------|
| `types.ts` | 138 | 核心类型（AppPlugin, AppExecutionContext, AppCard 等） |
| `app-catalog.ts` | 99 | 应用目录定义（6 个应用） |
| `context-builder.ts` | 83 | 从请求构建执行上下文 |
| `registry.ts` | 65 | 插件注册中心 |
| `prompt-context.ts` | 101 | Prompt 上下文构建（转录 + 锚点 + 术语） |
| `tools.ts` | 48 | 插件工具注入 |
| `index.ts` | 20 | barrel 导出 |

### plugins/

| 文件 | 行数 | 职责 |
|------|------|------|
| `studio-workshop.plugin.ts` | ~340 | Studio Workshop 主文件（manifest + canHandle + run + generateStudioOutput） |
| `studio-workshop.types.ts` | ~210 | 类型/接口（7个） + MODE_HINTS + 模式检测/解析辅助函数 |
| `studio-workshop.podcast.ts` | ~290 | 播客管线（plan 生成/文本组装/时间戳污染检测/round cards/叙述清洗） |
| `studio-workshop.renderers.ts` | ~180 | 渲染负载构建器（slides/infographic/table/audio/script/document） |
| `mindmap.plugin.ts` | 372 | 思维导图（含 tree↔markdown 转换） |
| `flashcards.plugin.ts` | 308 | 闪卡 |
| `quiz.plugin.ts` | 275 | 测验 |
| `knowledge-cards.plugin.ts` | 188 | 知识卡片 |
| `confusion-drill.plugin.ts` | 128 | 困惑点训练 |
| `review-plan.plugin.ts` | 78 | 复习计划 |
| `fallback.plugin.ts` | 43 | 兜底 |
| `index.ts` | 29 | 插件注册 |

## 新增插件步骤

1. 在 `plugins/` 创建 `xxx.plugin.ts`，实现 `AppPlugin` 接口
2. 在 `plugins/index.ts` 注册
3. 在 `app-catalog.ts` 添加目录项
4. 在 `components/apps/windows/` 创建对应浮窗组件
