# AI-Native — 应用插件系统

> Workshop 应用的插件架构。每个「应用」（测验/闪卡/思维导图/播客等）是一个 Plugin。

## 架构

```
page.tsx → /api/apps/readiness → /api/apps/execute → context-builder → registry → plugin.execute()
```

1. 前端先带转录 + 锚点 + 术语上下文调用 readiness；客观证据门守住空内容底线，模型只负责内容分类与可选推荐
2. 客观证据充足时，当前 `contextTier` 的全部应用都可由用户主动执行；模型误判不得降为整页不可用
3. `/api/apps/execute` 再做一次服务端 readiness 校验，只阻止证据不足或跨层调用
4. `context-builder.ts` 构建 `AppExecutionContext`；服务端执行路由再为已治理应用注入 `runtimeControl`
5. `registry.ts` 查找对应 plugin，Plugin 调用 LLM 生成结果；运行故障继续包装成稳定结果，但 `CONTENT_NOT_READY` 这类语义拒绝必须透传给 API，不能伪装成成功产物
6. 前端浮窗渲染结果。插件不得直接依赖 Prisma-backed 管理服务，因为部分插件模块也被客户端渲染器复用

## 文件索引

### 核心

| 文件 | 行数 | 职责 |
|------|------|------|
| `types.ts` | ~270 | 核心类型（AppPlugin, AppExecutionContext, AppCard 等）+ ContextPack 上下文契约 + Workshop readiness 契约 |
| `context-pack.ts` | ~420 | ContextPack 适配器 + 标记渲染；unit/exam 多课按时间展平供插件消费，同时保留 session/title/offset 供引用还原 |
| `app-catalog.ts` | ~175 | 应用目录全集定义（含 learningAction / bestFor / timeLabel 与 supportedTiers / primaryTier）；单课不包含考试速查表 |
| `app-catalog.test.ts` | — | 应用目录用户面文案护栏 |
| `workshop-readiness.ts` | ~190 | 浏览器 / 服务端共用的内容证据门：安全 fallback、模型结果清洗、按 class / unit / exam 收口应用白名单；客观证据充足时模型只能推荐、不能撤销能力 |
| `evidence-grounding.ts` | ~115 | 生成后证据校验：模型时间戳仅作候选，题面 / 条目 / 节点必须与真实原文语义匹配；匹配失败由各插件降级或剔除 |
| `context-builder.ts` | 83 | 从请求构建执行上下文 |
| `registry.ts` | ~85 | 插件注册中心；区分运行故障与 `CONTENT_NOT_READY` 语义拒绝 |
| `registry.test.ts` | — | 插件运行故障兜底与内容拒绝透传契约 |
| `prompt-context.ts` | ~130 | Prompt 上下文构建（转录 + 锚点 + 术语）；超预算时逐段压缩但保留段号/时间戳，并在注入文本前声明"…处有内容缺失、残句非完整原话"（朗读语料可用 `truncationNotice: false` 关闭） |
| `app-prompts.ts` | ~450 | 应用矩阵六类应用的版本化 System/User Prompt 基线；含速查表跨课来源拼装、播客去时间戳朗读语料与带时间戳章节证据的分离构建，真实插件、产品现场管理员透镜与控制中心共同复用 |
| `app-prompts.test.ts` | ~150 | 六类应用 Prompt 的证据、认知动作、防泄题、打印 / 手机阅读、音频章节定位与输出格式合同测试 |
| `tools.ts` | 48 | 插件工具注入 |
| `index.ts` | 38 | barrel 导出 |

### plugins/

| 文件 | 行数 | 职责 |
|------|------|------|
| `studio-workshop.plugin.ts` | ~340 | Studio Workshop 主文件（manifest + canHandle + run + generateStudioOutput） |
| `studio-workshop.types.ts` | ~210 | 类型/接口（7个） + MODE_HINTS + 模式检测/解析辅助函数 |
| `studio-workshop.podcast.ts` | ~240 | 播客管线（复用共享 Prompt，plan 生成 / 文本组装 / 时间戳污染检测 / round cards / 叙述清洗） |
| `studio-workshop.renderers.ts` | ~180 | 渲染负载构建器（slides/infographic/table/audio/script/document） |
| `mindmap.plugin.ts` | 372 | 思维导图（含 tree↔markdown 转换） |
| `flashcards.plugin.ts` | 308 | 闪卡 |
| `quiz.plugin.ts` | 275 | 测验 |
| `class-check.plugin.ts` | 264 | 随堂检验（智能版，基于知识点结构；视频内触发，不在 catalog） |
| `cheatsheet.plugin.ts` | — | unit/exam 考试速查表；课堂、大纲、真题分源回锚 |
| `explainer.plugin.ts` | ~240 | 板书精讲（BoardScript 板书脚本，render mode `'board'`）；Prompt / 引用校验 / DSL 清洗拆为 explainer-prompts.ts / explainer-quotes.ts / board-script.ts |
| `fallback.plugin.ts` | 43 | 兜底 |
| `index.ts` | — | 插件注册（9 个插件） |

## 新增插件步骤

1. 在 `plugins/` 创建 `xxx.plugin.ts`，实现 `AppPlugin` 接口
2. 在 `plugins/index.ts` 注册
3. 在 `app-catalog.ts` 添加目录项
4. 在 `components/apps/windows/` 创建对应浮窗组件
