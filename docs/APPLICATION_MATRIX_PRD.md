# MeetMind 应用矩阵 PRD

> 版本：v1.1
>
> 日期：2026-05-31
>
> 状态：本期范围已确认，待进入实现阶段
>
> 适用分支：`milestone/m9`（应用矩阵分支）
>
> 历史：v1.0（2026-05-31 上午）→ v1.1（同日下午，校准上下文模型与应用清单）

---

## 0. 文档定位

本文档定义 **MeetMind 应用矩阵** 在当前迭代的产品范围、应用清单、交互形态与验收标准。

### 0.1 本期范围

- **课堂层应用矩阵打磨**（catalog 7 个应用）
- **上下文抽象（`ContextPack`）** —— 场景上下文 + 个人上下文-局部型的合并渲染
- 给主分支留干净的合并接口

### 0.2 本期不做（详见 §6）

- 单元层 / 考试层路由 —— 视为课堂层的自然延伸，本期不落地
- 新增应用（`concept-map` / `exam-coverage` 等）
- 全局个人上下文 / memory / 学习画像
- catalog 外的 4 个 plugin（`class-check` 等）
- 裂变 / 分享 / 账户系统（主分支负责，已通过 v3.0 SharedAgent 合入）

### 0.3 本期核心判断

> **专注课堂层。先做上下文。**
>
> 单元层是课堂层的自然延伸——把课堂层的应用矩阵 + 上下文抽象做对，单元层只需要"传多个 lesson 的 ContextPack"就成立，不需要新应用。

---

## 1. 产品心智

### 1.1 一句话定义

> **MeetMind 是你的私人导师。在合适的时间点，给你交付合适的价值。**

### 1.2 三层学习对象

产品向用户呈现三个并列的"学习容器"：

| 层 | 容器 | 主场景 | 本期落地 |
|---|---|---|---|
| **课堂层** | 一节课 | 课后即时复习 | ✅ 是 |
| **单元层** | 几节课组成 | 单元 / 章节复盘 | ❌ 推迟 |
| **考试层** | 几个单元 + 真题 + 大纲 | 备考冲刺 | ❌ 推迟 |

### 1.3 心智约束

- 三层是**并列的，不是嵌套的**
- 每一层都是"完整可用"的，不依赖另一层
- 单元/考试层是课堂层的**自然延伸**，应用复用、上下文加多

### 1.4 本期聚焦

- 仅课堂层入口（已存在）+ 课堂层应用矩阵
- 上下文抽象做对，单元/考试层届时只需"传多 lesson 的 ContextPack"

---

## 2. 上下文模型（核心）

### 2.1 场景上下文 vs 个人上下文

判断标准：**是否会被分发**。

| 类型 | 包含 | 是否分发 | 本期处理 |
|---|---|---|---|
| **场景上下文** | 一节课的转录 + anchors + 摘要 + 课程元信息 | ✅ 会被分发（小组讨论 / 主分支分享） | 做 `ContextPack` 抽象 |
| **个人上下文 — 局部型** | 用户在某节课的标记 / 困惑 | ❌ 不分发 | 用户自用时注入到 prompt，分发时剥离 |
| **个人上下文 — 全局型** | memory（大模型对这个人的了解，跨场景画像） | ❌ 不分发 | 本期不做 |

### 2.2 个人上下文-局部型：标记融入转录

#### 2.2.1 设计原则

- **数据层不污染**：标记仍以独立结构存（`session_id` + `targetMs` + `text` + `kind`），不动原始转录
- **Prompt 层渲染合并**：构造 ContextPack 时由纯函数 `renderTranscriptWithAnnotations()` 把标记内联到转录文本里喂给 LLM
- **跨应用免费受益**：所有课堂层应用通过同一个 ContextPack 消费，不需要每个应用单独写"困惑驱动"逻辑

#### 2.2.2 注入格式

转录段落和标记按时间合并渲染：

```
[t=14:32] 老师：边际成本就是再多生产一个单位的成本…
[t=14:32 ⟪困惑⟫]
[t=14:33] 老师：所以 MC = ΔTC / ΔQ…
```

强标记（带用户文字）：

```
[t=14:32 ⟪用户备注：这里和上节课讲的有什么区别？⟫]
```

#### 2.2.3 上限策略

- 单课**软上限 20 条**，超过时按时间临近度合并相邻标记
- 单元/考试层（推迟到未来期）届时再做一次去重合并

#### 2.2.4 标记的语义粒度

- **弱标记**：用户单按"困惑"按钮，无文字 → `kind: 'confusion'`
- **强标记**：用户写了文字说明 → `kind: 'note'` + `text`
- **星标**：用户标记重点 → `kind: 'star'`

UX 上保留两种触达方式：单按 → 弱标记；长按 → 弹输入框 → 强标记。强标记价值远高于弱标记。

### 2.3 数据契约：`ContextPack`

```ts
export type ContextTier = 'class' | 'unit' | 'exam';

export interface LessonContext {
  sessionId: string;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summary?: string;
  keyDifficulties?: string[];
  title?: string;
  occurredAt?: number;
}

export interface PersonalAnnotation {
  sessionId: string;
  targetMs: number;
  kind: 'confusion' | 'note' | 'star';
  text?: string;        // 强标记带文字，弱标记可空
}

export interface ContextPack {
  tier: ContextTier;                              // 本期始终为 'class'
  lessons: LessonContext[];                       // 场景上下文（会分发）
  personalAnnotations?: PersonalAnnotation[];     // 个人上下文-局部型（不分发）
  exam?: {                                        // 考试层用，本期 undefined
    name?: string;
    targetDate?: number;
    pastPapers?: Array<{ title: string; content: string }>;
    syllabus?: string;
  };
}
```

### 2.4 分发剥离机制

主分支裂变能力（`v3.0 SharedAgent`）分发场景上下文给他人时：

- **不传 `personalAnnotations`** —— 个人上下文按定义不分发
- 渲染函数 `renderTranscriptWithAnnotations(pack)` 在 `personalAnnotations` 为空时退化为纯转录

```ts
// 主分支自用渲染
const promptText = renderTranscriptWithAnnotations({
  ...pack,
  personalAnnotations: userAnnotations,  // 标记融入
});

// 主分支分发渲染
const sharedText = renderTranscriptWithAnnotations({
  ...pack,
  personalAnnotations: undefined,        // 自动剥离
});
```

### 2.5 `WorkshopAppCatalogItem` 扩展字段

```ts
export interface WorkshopAppCatalogItem {
  // ... 现有字段
  supportedTiers: ContextTier[];   // 新增
  primaryTier: ContextTier;        // 新增
}
```

---

## 3. 信息架构（IA）

### 3.1 三层并列入口（心智，未来落地）

```
全局菜单层（侧边栏 / 学习中心）
  ┌─ 我的考试   →  考试层应用矩阵                  [推迟]
  ├─ 我的单元   →  单元层应用矩阵                  [推迟]
  └─ 我的课堂列表
        └─ 进入某节课 → 课堂复习页 → 课堂层应用矩阵 [本期]
```

### 3.2 本期范围内的入口

- 仅"课堂复习页 → 课堂层应用矩阵"
- 单元/考试层入口、装载交互、"加到单元/考试"轻入口 —— 全部推迟

---

## 4. 应用矩阵全景

### 4.1 矩阵边界（狭义）

**应用矩阵 = `WORKSHOP_APP_CATALOG` 中的 7 个应用**。

`catalog` 外的 plugin（`class-check` / `confusion-drill` / `knowledge-cards` / `review-plan`）是**非用户主动触发**的内嵌能力，归视频复习等场景管，**不归本期 PRD 管**。

### 4.2 应用 × 层 矩阵

| 应用 | class | unit | exam | 主舞台 | 本期变更 |
|---|:---:|:---:|:---:|---|---|
| 闪卡 `flashcards` | ✅ | future | future | 课堂 | prompt + 单卡视觉打磨 |
| 测验 `quiz` | ✅ | future | future | 课堂 | prompt + 题型多样化 + 即时诊断 |
| 思维导图 `mindmap` | ✅退化 | future | ❌ | 单元 *(future)* | 折叠态默认 + prompt 收敛 |
| 课堂播客 `audio-overview` | ✅ | ❌ | ❌ | 课堂 | 移出"批量生成"默认入口 |
| 信息图 `infographic` | ✅ | future | ❌ | 课堂 | **重做：砍 8 选 1，定为"一张图带走这节课"** |
| 速查表 `cheatsheet` | ✅ | future | future | 课堂 | **已完成（fix12），本期不动** |
| 学习报告 `study-report` | ✅ | ❌ | ❌ | 课堂 | **已完成，本期不动**（家长视角） |

### 4.3 catalog 外能力（仅说明，不归本期管）

| Plugin | 触发方式 | 关系 |
|---|---|---|
| `class-check` | 视频复习时按 checkpoint 自动触发 | 是 `study-report` 的数据源 |
| `confusion-drill` | 内嵌触发 | 困惑点专项训练 |
| `knowledge-cards` | 内嵌触发 | 知识卡片 |
| `review-plan` | 内嵌触发 | 复习编排 |

它们的产品形态、入口、迭代节奏由各自所在场景负责，本期 PRD 不约束。

---

## 5. 课堂层应用规格

### 5.1 通用约束

- **上下文输入**：`ContextPack`，`tier='class'`，`lessons.length=1`
- **个人上下文注入**：用户自用渲染时 `personalAnnotations` 注入；分发渲染时为空
- **产物原则**：**第一次生成就让用户觉得好**，不依赖记忆 / 历史
- **产物结构干净**：不带个人化痕迹，为后续主分支分享场景留空间

### 5.2 闪卡 `flashcards`（打磨）

**用户场景**：上完课立刻自测，确认"我真听懂了吗"。

**产物形态**：
- 数量：5-8 张
- 题目类型：主动回忆题（情境化、应用化），不出"什么是 XX？"这种烂题
- 单卡可独立成图分享（视觉到位，主分支裂变可复用）
- 翻面动画 + 掌握度三档（会 / 模糊 / 不会）—— **当场反馈，不持久化**

**本期打磨重点**：
- prompt 优化：保证 5-8 张真的覆盖本课关键
- 单卡视觉打磨：保证截图分享美观
- 标记融入：当用户在某段标记困惑时，闪卡 prompt 通过转录里的 `⟪困惑⟫` 标记自然倾斜出题

**不做**：
- 掌握度持久化 / 错题回流（无记忆层）

**验收**：
- 用户第一次生成就觉得"这 6 张卡真的覆盖了这节课的关键"
- 翻面交互流畅，不卡顿

### 5.3 测验 `quiz`（打磨）

> **重要区分**：本应用是 catalog 内的**用户主动触发的事后测验**。
> **不是**视频复习场景内嵌的随堂检验（`class-check` plugin），后者不归本期 PRD 管。

**用户场景**：检验对本节课的理解程度。

**产物形态**：
- 题量：5-10 题
- 题型多样化：单选 + 填空 + 判断 + 简答（带 AI 评分）
- 每题强制带 `[t=MM:SS]` 证据回链
- 答完即时诊断（一次性，不持久化）

**本期打磨重点**：
- prompt 优化 + 题型多样化
- 证据回链点击跳回录音的体验闭合
- 答题完成后增加"你在哪些点还不稳"的当场反馈
- 标记融入：困惑点优先出题

**不做**：
- 错题本沉淀 / 跨次答题数据累积

**验收**：
- 题目不流于表面，能真正考住用户
- 证据回链点了真的能跳回原录音对应位置

### 5.4 思维导图 `mindmap`（退化形态）

**用户场景**：扫一眼这节课的结构。

**产物形态**：
- 折叠态默认，节省决策成本
- 节点 = 概念，边 = 老师讲解逻辑
- 节点点击弹证据回链小窗

**本期打磨重点**：
- 课堂层视觉权重降低（在 YellowPage 卡片排序中靠后）
- prompt 收敛：单课层只展示主干 3-5 个分支，不要试图穷尽所有概念
- 标记融入：用户标过困惑的节点视觉标红

**未来（推迟）**：
- 单元层是 mindmap 的真正主舞台 —— 跨课节点合并、揭示连接

**验收**：
- 折叠态打开后用户能在 5 秒内扫完
- 不和闪卡 / 速查表信息冗余

### 5.5 课堂播客 `audio-overview`（降级）

**用户场景**：通勤 / 吃饭时回顾本节课的精华。

**产物形态**：
- 双人对话，**严格控制 10-15 分钟**
- 章节定位 + 回放复盘

**本期变更**：
- **移出"先做一版都做"批量生成入口** —— 单独留"想听的时候点一下"入口
- 在 YellowPage 卡片中视觉次级化处理

**不做**：
- 单元层的"本周播客摘要"（30 分钟长音频没人听）

**验收**：
- 默认不被批量生成
- 用户主动点击时，体验顺畅
- 时长不超过 15 分钟

### 5.6 信息图 `infographic`（重做）

**用户场景**：一张图带走这节课，可截图发朋友圈 / 班群。

**本期变更（重做）**：
- **砍掉 8 选 1 预设**（不再让用户选信息图 / 流程图 / 时间线 / ……）
- 定一个固定产物 **"一张图带走这节课"**：
  - 上：课程名 + 老师 + 日期
  - 中：3 个核心概念 + 老师金句
  - 下：一句话总结 + MeetMind 品牌
- 一键出图，**结构干净、零个人化痕迹**——主分支裂变直接复用

**不做**：
- 用户自定义版式
- 8 种场景预设

**验收**：
- 一键出图无需用户做选择
- 出图视觉到位，单图可独立分享

### 5.7 速查表 `cheatsheet`（已完成）

**心智**：**开卷考 / 允许带一张 A4 / quiz 时**当场带的那张纸。

**当前状态**：fix12 已完成，包含：
- 横向 A4 默认（3 列高密度）
- 6 区语义色编码（定义 / 公式 / 流程 / 对照 / 易错 / 范例）
- 单条删除（屏幕 hover 显出，打印不渲染）
- 区块折叠
- 字号档位（紧凑 / 标准 / 舒适，CSS 变量驱动）
- 密度估算（约占一页 N%，超过 100% 提示）
- emphasis=strong 的 ★ 标记 + 极淡区块色
- 公式块强化（等宽 14px + 双侧实色边）
- 打印 `-webkit-print-color-adjust: exact`
- 复制为 Markdown

**本期处置**：**不再调整**。PRD 仅保留心智与现状描述。

### 5.8 学习报告 `study-report`（已完成）

**用户场景**：**家长视角** —— 家长拿到孩子的一节网课录音，想快速理解课堂讲了什么、孩子有没有遇到困惑。

**产物形态**（已实现）：
- letterToParent：给家长的一段自然文字（3-5 句，像微信聊天）
- topics：课堂知识点结构（名称 / 难度 / 一句话说讲了什么）
- confusionAnalysis：困惑点分析（仅当有数据时）
- chatTopics：家长可以和孩子聊的具体话题
- nextSteps：建议下一步

**核心原则**：有数据才说话，不凭空编造。不给评分（没有 1-5 分、没有百分比、没有"掌握度"）。

**数据依赖**：**依赖随堂检验数据，由视频复习场景提供**（见 §4.3 catalog 外能力 `class-check`）。无随堂检验数据时退化为基于转录的"听课内容报告"。

**本期处置**：**不再调整**。PRD 仅保留心智与现状描述。

---

## 6. 不在本期范围

| 不做 | 理由 / 处置 |
|---|---|
| 单元层路由 / 考试层路由 | 课堂层的自然延伸；课堂层做对后单元/考试层只需多传 lesson 即可 |
| `concept-map` / `exam-coverage` 等新应用 | 单元/考试层独有应用，等单元/考试层路由上线后再看是否真的需要 |
| 全局个人上下文 / memory / 学习画像 | 用户在第 1-3 次使用感知不到，价值延迟。等记忆 / 画像期统一做 |
| 闪卡掌握度持久化 / 错题本沉淀 | 同上 |
| 事件流数据沉淀 / event log | 无下游使用方时不种数据，避免锁死 schema |
| catalog 外的 4 个 plugin | 由各自所在场景负责（视频复习等） |
| 跨层产物的"自动合并"算法 | 让 LLM 看原料现场组装，不预设合并规则 |
| 8 选 1 信息图预设 | 已砍 |
| 课堂层学习报告下架 | **撤销 v1.0 误判**，学习报告保留 |
| 裂变 / 分享 / 账户系统 | 主分支负责，已通过 v3.0 SharedAgent 合入 |

---

## 7. 验收标准

### 7.1 产品级验收

每个保留的应用必须满足：

- ✅ **第一次生成就让用户觉得好** —— 不依赖"用了多次"才显现价值
- ✅ 不出现"什么是 XX？"这种烂题 / 烂卡 / 烂内容
- ✅ 产物结构干净，不带个人化痕迹（为分享留空间）

### 7.2 接口级验收

- ✅ `ContextTier` / `ContextPack` / `LessonContext` / `PersonalAnnotation` 类型在 `src/lib/ai-native/types.ts` 中导出
- ✅ 所有应用通过同一个 `ContextPack` 入参
- ✅ catalog 中所有应用都标注了 `supportedTiers` 和 `primaryTier`
- ✅ `WorkshopYellowPage` 通过 `pack.tier` 过滤渲染（本期所有 catalog 应用 `supportedTiers` 至少包含 `'class'`）

### 7.3 上下文级验收

- ✅ `renderTranscriptWithAnnotations(pack)` 是纯函数，有单元测试
- ✅ 当 `personalAnnotations` 为 `undefined` 时，输出与不带标记的纯转录一致（分发剥离正确）
- ✅ 当 `personalAnnotations` 长度超过 20 时，按时间临近度合并（有单元测试）
- ✅ 标记格式（`⟪困惑⟫` / `⟪用户备注：xxx⟫`）能被正则识别和剥离

### 7.4 应用级验收

- ✅ 闪卡：5-8 张，无烂题，单卡可截图分享
- ✅ 测验：5-10 题，题型≥3 种，证据回链可跳转
- ✅ 思维导图：折叠态默认，5 秒可扫完
- ✅ 课堂播客：移出批量入口，时长 ≤15 分钟
- ✅ 信息图：一键出图，固定版式
- ✅ 速查表：保持 fix12 现状
- ✅ 学习报告：保持现有家长视角形态

---

## 8. 落地拆条（PR 级别）

每个 PR 独立可合并、可灰度、不阻塞主分支。

| # | PR | 主要内容 | 风险 |
|---|---|---|---|
| PR-1 | 上下文抽象 | `ContextPack` / `LessonContext` / `PersonalAnnotation` 类型；catalog 加 `supportedTiers` / `primaryTier`；`buildPackFromSingleSession()` adapter；现有调用点过渡 | 极低（纯结构化，无行为变化） |
| PR-2 | 标记融入转录渲染 | `renderTranscriptWithAnnotations(pack)` 纯函数 + 单元测试；上限策略；分发剥离 | 低 |
| PR-3 | YellowPage 按 tier 过滤 | `WorkshopYellowPage` 接受 `contextPack`，按 tier filter；保持卡片样式 / dock / 缓存逻辑不动 | 低 |
| PR-4 | 闪卡打磨 | prompt 优化 + 单卡视觉 + 标记融入消费 | 中（需 eval） |
| PR-5 | 测验打磨 | prompt + 题型多样化 + 即时诊断 + 证据回链体验闭合 + 标记融入 | 中（需 eval） |
| PR-6 | 思维导图收敛 | 折叠态默认 + prompt 收敛 + 标记融入（节点标红） | 低 |
| PR-7 | 课堂播客降级 | 移出批量生成入口 + 时长上限 + 卡片视觉次级化 | 低 |
| PR-8 | 信息图重做 | 砍 8 选 1，定固定产物 | 中（产品形态变化） |

**建议提交顺序**：

1. PR-1 → PR-2（先把上下文抽象做对，所有后续应用基于它）
2. PR-3（接入 YellowPage，验证抽象工作）
3. PR-4 → PR-5 → PR-6（课堂层 prompt 打磨）
4. PR-7 → PR-8（课堂层产物形态调整）

---

## 9. 与主分支的合并约定

主分支（`v3.0 SharedAgent`）已合入本分支。后续主分支的裂变能力接入应用矩阵时：

### 9.1 主分支只通过 `ContextPack` 接入

```tsx
// 主分支的分享场景需要复用应用矩阵时，只构造 ContextPack
const pack: ContextPack = buildPackFromSharedAgent(sharedAgent);
// 不传 personalAnnotations —— 个人上下文不分发
<WorkshopYellowPage contextPack={pack} ... />
```

主分支**不应该直接调用 plugin**、**不应该直接拼 prompt**、**不应该直接读 catalog**。

### 9.2 分发剥离自动化

- 主分支构造 ContextPack 时**不传 `personalAnnotations`**
- `renderTranscriptWithAnnotations()` 自动退化为纯转录
- 个人上下文 100% 不会泄露到分享场景

### 9.3 本分支不动的边界

- `useAppExecution.ts`（执行逻辑）
- `AppRenderSurface.tsx`（渲染分发）
- `/api/apps/execute`（后端）
- 任何 plugin 的 renderer

### 9.4 本分支会动的范围

- `app-catalog.ts`（加 `supportedTiers` / `primaryTier`）
- `types.ts`（加 `ContextTier` / `ContextPack` / `LessonContext` / `PersonalAnnotation`）
- `WorkshopYellowPage.tsx`（接受 `contextPack`，按 tier 过滤）
- 各 plugin 的 prompt 文件（接入 `renderTranscriptWithAnnotations`）
- 信息图 plugin（重做形态，砍 8 选 1）
- 课堂播客的批量入口归属

---

## 附录 A：未来方向（不在本期）

### A.1 单元层

- 路由：`/app/unit/[id]`
- 装载交互：从课堂复习页右上角"加到单元"轻入口
- 应用矩阵：**复用课堂层 6 个应用**，传入多 lesson 的 ContextPack
- 不需要新增应用

### A.2 考试层

- 路由：`/app/exam/[id]`
- 装载交互：从单元页右上角"加到考试"轻入口
- 真题 / 大纲上传
- 应用矩阵：复用现有应用，传入多 lesson + `pack.exam`
- 候选模板：考研 / 四六级 / 雅思 / 托福（仅作为命名建议）

### A.3 候选新应用（视未来需要）

| 候选 | 层 | 说明 |
|---|---|---|
| `concept-map` 跨课概念图谱 | 单元 | 揭示跨课概念连接、出现频次 |
| `exam-coverage` 考点覆盖表 | 考试 | 大纲 × 课堂覆盖度 × 真题分布 |

不预先承诺做。等单元/考试层落地、看到真实使用数据后决定。

### A.4 全局个人上下文 / memory

- 跨场景画像：大模型对这个人的了解
- 学习记忆：闪卡掌握度持久化、错题回流
- 学习画像：你最近在学什么、薄弱在哪
- **统一在"记忆期"做**，本期所有应用不依赖它

---

## 附录 B：应用全景（含 catalog 外能力）

```
应用矩阵（catalog，狭义）           ← 本期 PRD 范围
├─ flashcards    闪卡
├─ quiz          测验（事后版）
├─ mindmap       思维导图
├─ audio-overview 课堂播客
├─ infographic   信息图
├─ cheatsheet    速查表（已完成）
└─ study-report  学习报告（已完成，家长视角）

catalog 外能力（内嵌触发）          ← 本期 PRD 不管
├─ class-check        随堂检验（视频复习内嵌，study-report 数据源）
├─ confusion-drill    困惑点专项训练
├─ knowledge-cards    知识卡片
├─ review-plan        复习编排
└─ fallback           兜底
```

---

## 附录 C：产品决策日志

| 决策 | 结论 | 决策日期 |
|---|---|---|
| 三层心智（课堂 / 单元 / 考试） | 采纳 | 2026-05-30 |
| 三层入口并列，不嵌套 | 采纳 | 2026-05-30 |
| 应用按 tier 归属，prompt 分层 | 采纳 | 2026-05-30 |
| 思维导图：课堂退化、单元主舞台 | 采纳 | 2026-05-30 |
| 信息图：砍 8 选 1，固定"一张图带走这节课" | 采纳 | 2026-05-30 |
| 闪卡 / 测验：本期不做记忆 / 错题沉淀 | 采纳 | 2026-05-31 |
| 学习记忆 / 画像 / 全局个人上下文：留给后续期 | 采纳 | 2026-05-31 |
| 单元 / 考试创建入口：复习页右上角"加到"轻入口 | 采纳 → **推迟到单元/考试层落地期** | 2026-05-31 |
| 本分支不碰裂变 / 分享，留 ContextPack 合并接口 | 采纳 | 2026-05-30 |
| 速查表心智 = 开卷考 / 带 A4 / quiz 时（已完成，本期不动） | 采纳 | 2026-05-31 |
| 学习报告：单课内、家长视角、依赖随堂检验数据；**已完成，本期不动** | 采纳 | 2026-05-31 |
| 标记 / 困惑 = 个人上下文-局部型，融入转录注入 prompt，分发时剥离 | 采纳 | 2026-05-31 |
| 应用矩阵边界 = 狭义（catalog 7 个），catalog 外不归本期管 | 采纳 | 2026-05-31 |
| 单元 / 考试层路由 + 新应用 (concept-map / exam-coverage)：本期推迟 | 采纳 | 2026-05-31 |
| 本期专注课堂层 + 上下文抽象 | 采纳 | 2026-05-31 |

---

*文档版本：v1.1*
*创建日期：2026-05-31*
*确认状态：本期范围已确认，待进入实现阶段*
