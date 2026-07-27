# AI-Native Plugins — 应用插件

> Workshop 应用的 LLM 执行插件，每个插件对应一种应用类型。
> M14.6+ 收口为 7 个插件：4 个 catalog 结构化应用 + class-check（视频内随堂检验）+ studio-workshop（播客/信息图）+ fallback。讲给同桌听（teach-back）加入后 catalog 结构化应用为 5 个、插件共 8 个。

## 文件索引

| 文件 | 职责 |
|------|------|
| `quiz.plugin.ts` | 测验插件（LLM 生成选择题/判断题；题目必须重新匹配真实原文，匹配失败则降级为基于证据的简答题） |
| `class-check.plugin.ts` | 随堂检验插件（基于知识点结构的智能随堂检验，视频内触发，不在 catalog） |
| `studio-workshop.plugin.ts` | Studio Workshop 主文件（~340 行），子模块如下 |
| `studio-workshop.types.ts` | 类型/模式检测/解析辅助（~210 行，有测试） |
| `studio-workshop.podcast.ts` | 播客管线（~290 行） |
| `studio-workshop.renderers.ts` | 渲染负载构建器（~180 行） |
| `flashcards.plugin.ts` | 闪卡（模型题面 / 答案必须重新落回真实原文；无语义支持则用证据片段生成安全兜底卡） |
| `flashcards.plugin.test.ts` | 闪卡证据回锚测试：语义匹配优先、秒/毫秒归一、禁止按卡片序号轮转原文 |
| `mindmap.plugin.ts` | 思维导图（节点 prompt 要求“地图标签”式短语而非解释句；无原文支持的叶子节点会被剔除，保留节点回写证据时间） |
| `cheatsheet.plugin.ts` | 跨课 / 考试速查表：课堂、大纲、真题三类证据分别回锚；无支持条目直接丢弃，`strong` 只由明确强调或真题证据保留；正文保留有依据的 GFM / LaTeX / 紧凑 Mermaid（flowchart / pie / xychart-beta；小表格只用于对比，图中数值必须直接来自证据），不得为装饰滥用富文本；模型判断材料无学习价值或全部条目无法落回证据时返回 `CONTENT_NOT_READY`，禁止逐句包装原文制造假成品 |
| `teach-back.plugin.ts` | 讲给同桌听（费曼检验）：从课堂证据选 3-5 个「应该能亲口讲出来」的目标点，`anchorText` 经 `resolveGroundedEvidence` 重新锚定，锚不住 `evidence=null` 不伪造时间戳；转录过短或选点为空抛 `CONTENT_NOT_READY`。讲述后的四象限核对不在此插件，走 `/api/apps/teach-back/evaluate`（`teach-back-eval-service.ts`：coverage × confidence 由 LLM 判断，quadrant 由服务端映射推导，不信 LLM 自报） |
| `teach-back.plugin.test.ts` | 选点正规化测试：锚定 / 锚不住不伪造 / 去重截断 |
| `fallback.plugin.ts` | 兜底 |
| `index.ts` | 插件注册（8 个插件） |

应用的可评测 Prompt 基线统一放在上级 `../app-prompts.ts`（teach-back 的三段 prompt——选点 / 安静学生 instructions / 四象限核对——单独在 `../teach-back-prompts.ts`，因 app-prompts.ts 已达行数上限；该文件同时被前端 TeachBackWindow import，只放纯字符串函数）；应用矩阵全部七类应用均已接入管理员运行时控制，真实插件执行、产品现场透镜、控制中心预览和线上/候选试跑共用同一份 System/User Prompt。导图是单课轻结构 Markdown；速查表要求跨课 / 考试证据与可打印 JSON；信息图只保留一个中心命题并限制手机阅读负担；播客把可朗读语料与章节时间证据分离，避免把时间读进音频或让模型猜章节。管理员只可追加指令和选择模型，证据回锚、层级边界、输出格式、视觉 / 音频价值合同不可覆盖。

运行时治理必须由服务端 `/api/apps/execute` 读取后写入 `AppExecutionContext.runtimeControl`；插件自身不得静态 import Prisma-backed `ai-control-service`。插件模块可能被客户端窗口复用类型或纯函数，破坏该边界会把 `better-sqlite3` 打进浏览器构建。

## 已清理（M14.6+）

以下 plugin 已删除——它们只能通过 `tutor-tools.ts` 的 tool-calling 触发，但 M14.6 起 `agent/route.ts` 纯对话 `tools = {}`，这三个变成无入口死代码：

- `study-report.plugin.ts` — 学习报告（面向家长，产品定位错位 + 非视频场景死入口）
- `knowledge-cards.plugin.ts` — 知识卡片
- `confusion-drill.plugin.ts` — 困惑点训练
- `review-plan.plugin.ts` — 复习计划

`nextSuggestedPlugins` 字段（`AppExecutionResult` 上的"建议下一个 plugin"）也已删除——只有赋值没有消费方，是死字段。

## 已有测试

- `studio-workshop.types.test.ts` — 44 tests，覆盖模式检测/时间戳/数组/对话解析
- `flashcards.plugin.test.ts` — 覆盖模型时间戳不可信时，题面/答案仍能回到真正支持它的课堂片段
- `quiz.plugin.test.ts` / `cheatsheet.plugin.test.ts` / `mindmap.plugin.test.ts` — 覆盖错误时间戳、幻觉条目、虚假重点、跨课课内时间与大纲证据的降级 / 剔除
- `teach-back.plugin.test.ts` — 选点正规化：anchorText 锚定、锚不住不伪造时间戳、去重与上限
