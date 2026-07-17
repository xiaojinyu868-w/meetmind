# AI-Native — 应用插件系统

> Workshop 应用的插件架构。每个「应用」（测验/闪卡/思维导图/播客等）是一个 Plugin。

## 架构

```
page.tsx → /api/apps/readiness → /api/apps/execute → context-builder → registry → plugin.execute()
```

1. 前端先带转录 + 锚点 + 术语上下文调用 readiness；允许返回无推荐或不可生成
2. 用户选择仍适配当前材料的应用后发起执行请求
3. `/api/apps/execute` 再做一次服务端 readiness 校验，避免绕过前端硬生成
4. `context-builder.ts` 构建 `AppExecutionContext`
5. `registry.ts` 查找对应 plugin，Plugin 调用 LLM 生成结果
6. 前端浮窗渲染结果

## 文件索引

### 核心

| 文件 | 行数 | 职责 |
|------|------|------|
| `types.ts` | ~270 | 核心类型（AppPlugin, AppExecutionContext, AppCard 等）+ ContextPack 上下文契约 + Workshop readiness 契约 |
| `context-pack.ts` | ~420 | ContextPack 适配器 + 标记渲染；unit/exam 多课按时间展平供插件消费，同时保留 session/title/offset 供引用还原 |
| `app-catalog.ts` | ~175 | 应用目录全集定义（含 learningAction / bestFor / timeLabel 与 supportedTiers / primaryTier）；单课不包含考试速查表 |
| `app-catalog.test.ts` | — | 应用目录用户面文案护栏 |
| `workshop-readiness.ts` | ~175 | 浏览器 / 服务端共用的纯内容证据门：安全 fallback、模型结果清洗、按 class / unit / exam 收口应用白名单 |
| `evidence-grounding.ts` | ~115 | 生成后证据校验：模型时间戳仅作候选，题面 / 条目 / 节点必须与真实原文语义匹配；匹配失败由各插件降级或剔除 |
| `context-builder.ts` | 83 | 从请求构建执行上下文 |
| `registry.ts` | 65 | 插件注册中心 |
| `prompt-context.ts` | 101 | Prompt 上下文构建（转录 + 锚点 + 术语） |
| `tools.ts` | 48 | 插件工具注入 |
| `index.ts` | 38 | barrel 导出 |

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
| `class-check.plugin.ts` | 264 | 随堂检验（智能版，基于知识点结构；视频内触发，不在 catalog） |
| `cheatsheet.plugin.ts` | — | unit/exam 考试速查表；课堂、大纲、真题分源回锚 |
| `fallback.plugin.ts` | 43 | 兜底 |
| `index.ts` | — | 插件注册（7 个插件） |

## 新增插件步骤

1. 在 `plugins/` 创建 `xxx.plugin.ts`，实现 `AppPlugin` 接口
2. 在 `plugins/index.ts` 注册
3. 在 `app-catalog.ts` 添加目录项
4. 在 `components/apps/windows/` 创建对应浮窗组件
