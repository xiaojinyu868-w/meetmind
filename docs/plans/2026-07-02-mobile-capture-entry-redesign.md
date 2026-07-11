# 手机端定位重设计：学习现场的上下文采集入口

> 日期：2026-07-02（初版）/ 2026-07-03（v3 最终版）
> 状态：**v3 定稿**——设计已验证（可交互 demo），进入实现阶段
> 关联：`design-demo/mobile-review-v2/full.html`（完整可交互 demo）
> 原则基座：AGENTS.md（v7 设计宪法 + Bitter Lesson + God File 治理）

---

## 1. 定位

**手机端不是电脑端的缩小版，而是学习现场的"上下文采集入口"**。

**分工**：手机负责采集（录音/拍照/速记）+ 阅读（lesson-digest），电脑负责整理（三栏工作台 + 应用矩阵深度编辑）。

**核心心智**：手机 = 阅读 + 底部对话。桌面 = 三栏工作台。两者不追求交互一致，追求数据一致。

---

## 2. 架构原则：共享层写一次，UI 壳各包一层

### 2.1 什么必须共享（只写一遍）

| 层级 | 共享内容 | 桌面移动都受益 |
|---|---|---|
| 数据层 | IndexedDB (Dexie) + 服务端 SQLite (Prisma) | 读写同一份 |
| API 层 | `/api/tutor/agent`、`/api/classroom/foresight`、`/api/classroom/lesson-digest`（新增） | mode 参数区分场景 |
| 业务逻辑层 | `useSourceImport`、`useClassroomCompanion`、`useClassroomForesight`、`useCollectionComposer` | 已共享 |
| 渲染组件层 | `TranscriptFlowView`、ChatBase 底座（`ChatBubble`/`ChatComposer`/`ChatMessageList`）、`AppRenderSurface` | 已共享 |
| 新增能力 | `lesson-digest-service.ts` + `LessonDigestCard`（纯展示组件） + `capturedAtMs` 透传 | 写一次，桌面移动各挂一层薄壳 |

### 2.2 什么必须分叉（薄壳，各几十行）

| 能力 | 桌面端 | 移动端 | 分叉原因 |
|---|---|---|---|
| 布局容器 | `DesktopVideoReviewLayout` 三栏 | 单流 + 底部 Sheet | 屏幕尺寸 |
| 播放器 | `WaveformPlayer`（波形交互） | `MiniPlayer`（进度条） | 手机不需要波形 |
| 同桌对话容器 | 右栏常驻 `TutorAgentPanel` | 底部可拖拽 Sheet（内含 ChatBase 底座） | 交互形态不同 |
| 应用打开方式 | 中栏 tab 内嵌 | 全屏 overlay（专注态） | 认知负荷 |

### 2.3 开发约束

**铁律：新功能的业务逻辑放在共享层，不要内联到桌面端独有的布局组件里。**

具体来说：
- `lesson-digest-service.ts` 是共享 service，不写进 `DesktopVideoReviewLayout`
- `DigestCard` 是纯展示组件（props in, JSX out），不包含布局假设
- `capturedAtMs` 透传加在 `useSourceImport`（共享 hook），不加在 `page.tsx` 的桌面/移动分支里
- 桌面端消费新能力时，在 `ReviewWorkspacePanel` 的 tab 里挂 `<DigestCard data={...} />`
- 移动端消费时，在 `page.tsx` 的移动 review 分支里挂同一个 `<DigestCard>`

---

## 3. 四态体验流

demo 验证的完整流程：`design-demo/mobile-review-v2/full.html`

```
采集台首页 →（录一节课）→ 录课中 →（结束）→ 整理中 → 复习态 →（练闪卡）→ 闪卡 →（完成）→ 复习态
```

### 3.1 待机态（采集台首页）

- 三个采集入口：录一节课（vermilion 白底主按钮）/ 拍一下 / 速记一句
- **Echo 卡片**：今日笔记概览（陈述句，不问用户；整卡可点击跳复习态）
- **收集流**：按"今天/昨天/更早"分组，录音/速记/照片/处理中混排
- **底部 composer 输入条**：随手发想法、贴链接
- 速记提交后 → 新卡片淡入到收集流顶部（带当前时间 + "刚记录"）

### 3.2 现场态（录课中）

- **主画面 = 实时生长的结构化笔记卡片**（不是原始转录，不是 MindMap）
  - AI 把 ASR 原文重新组织成干净摘要，过滤错字和口头禅
  - 课中课后同形态：课中看到的卡片课后自然变成 digest 的一部分
  - 关键段有 pine 竖条 + ★ 标记
  - 拍照后板书缩略图内嵌到对应时间段卡片
  - "待整理"卡片（虚线框）诚实提示"这段老师还在讲，课后整理笔记时会补上"
- **状态条**：录音计时 + 波形 + 翻译开关（"译"小按钮）+ 停止键
  - 记一下计数器在笔记标题旁，不在状态条挤
- **LIVE 薄条**：默认隐藏，翻译开启时显示英文原文 + 下方斜体中文翻译
- **拍一下悬浮键**（左下，vermilion）：badge 累积拍照数
- **问同学悬浮键**（右下，带 pulse + 预测 chip badge）：打开后 badge 清零 + pulse 停止
  - 展开后：预测 chip（`useClassroomForesight`）+ 稳定 chip（刚才那段/我没跟上/记一下）+ ChatBase 底座对话
- **底部 Sheet 展开时**：拍一下按钮 + LIVE 条自动上移到 Sheet 上方，始终可见

### 3.3 过渡态（整理中）

- Octo 呼吸 + 轨道粒子 + **进度条**（0→100%）+ "约 X 分钟" ETA
- 轮播状态文案：读转录 → 插图片 → 生成分段笔记
- 笔记卡片渐入预览
- 完成后出现"笔记整理好了，去看看 →"
- "先去做别的 →" 可回首页（Echo 卡片会引导回来）

### 3.4 沉淀态（复习）

- **主视图 = lesson-digest 结构化总结**（飞书妙记形态）
  - 按时间自然分段，每段：小标题 + 摘要 + 可选图片内联 + `[MM:SS]` 时间戳
  - 关键段有 pine 竖条 + ★
  - 图片里的信息被模型读进总结文字，不是"总结"和"图片"两条并行
  - 没有 `capturedAtMs` 的图片放"课后补充"区
- **"原文"折叠按钮**：每个 section 可展开原始转录片段（带时间范围 + 斜体引文），用于核对 AI 摘要
- **困惑点 = digest 属性，不是独立系统**
  - 长按段落触发标记（朱批左边线出现）+ 自动打开底部 Sheet 预填"这段我没跟上"
  - 不需要独立困惑点列表 tab、不需要 AnchorDetailPanel、不需要困惑笔记编辑
  - 桌面端的困惑点 tab 降级为转录流里的高亮标记，不再作为一等公民独立管理
- **底部可拖拽 Sheet**（同桌对话）
  - 收起态：薄条（同桌最新消息预览 + "问一下"按钮）
  - 半展：对话 + 输入（上半仍看 digest）
  - 全展：完整对话
  - 共享 `mode='review'` 会话，桌面移动看到同一条历史
- **mini-player**：滚动 digest 超过 60px 时自动收起成 3px 细线，滚回顶部恢复
- **AI 建议区**（底部）：Octo 陈述句引导（不问用户）+ 闪卡/速查表入口
- **应用全屏打开**（闪卡等）：专注态，练完关掉回 digest。不追求边看边练（伪需求）

### 3.5 闪卡完成态

- 练完最后一张 → Octo excited + "练完了" + "明天可以再来一遍"
- 返回复习态

### 3.6 空状态

- 首次打开：Octo + "录第一节课试试" + 单个录音按钮
- 没有 Echo 卡片、没有收集流、没有"最近"标签

---

## 4. 组件映射

| 部件 | 共享层（写一次） | 桌面壳 | 移动壳 |
|---|---|---|---|
| lesson-digest 生成 | `lesson-digest-service.ts` + `/api/classroom/lesson-digest/route.ts` | — | — |
| digest 渲染 | `LessonDigestCard`（纯展示） | 挂在 `ReviewWorkspacePanel` tab | 挂在移动 review 主视图 |
| AI 对话 | ChatBase 底座 | `TutorAgentPanel` 包一层 | 底部 Sheet 包一层 |
| 录课笔记 | `useClassroomCompanion` + `useClassroomForesight` | `ClassroomRecordingView` | 同左（`ClassroomLayout` 已处理响应式） |
| 拍照 + 时间锚点 | `handleImportFiles` 加 `{ sessionId, capturedAtMs }` 参数 | 桌面端也能用 | 移动端悬浮按钮触发 |
| 闪卡 | `AppRenderSurface` + `FlashcardsWindow` | 中栏 tab 内嵌 | 全屏 overlay |
| 困惑点 | `anchors` 数据（IndexedDB） | 转录高亮标记 | digest 长按标记 |
| Echo | `workspaceEchoes` 数据 | 收集页右侧面板 | 首页 Echo 卡片 |

---

## 5. 后端 / 数据影响

- **`capturedAtMs` 透传**：`SourceIngestItem` 加 `capturedAtMs?: number`；`handleImportFiles` 加第三可选参数 `{ sessionId?, capturedAtMs? }`。这是桌面移动共享的基础设施。
- **lesson-digest**：新 service + 新 route。输入 = segments + 带 `capturedAtMs` 的图片；输出 = 分段总结 `{ heading, text, imageId?, startMs, endMs }`。参照 `cheatsheet.plugin.ts` 的 LLM + JSON parse + citation 模式。不实现为 `AppPlugin`（会破坏"7类 ready 应用"不变量）。
- **困惑点降级**：不删除 `anchors` 数据和 API，但 UI 层不再作为独立 tab/列表。桌面端 `AnchorDetailPanel` 可保留为只读详情，不再做 CRUD。
- **翻译开关**：纯 UI 层移动端化，复用已有 `cycleTranslationMode` 逻辑，不碰后端。

---

## 6. 迁移路径（增量，每步 make check）

1. **`capturedAtMs` 类型透传**（基础层，无 UI，风险最低）
   - `page-types.ts`：`SourceIngestItem.capturedAtMs?: number`
   - `useSourceImport.ts`：`handleImportFiles` 加可选参数，图片分支透传到 `updateSourceItem` + `persistCaptureToWorkspace.metadata`
   - `useCollectionComposer.ts`：同步类型签名
2. **`lesson-digest` 后端**
   - `lesson-digest-service.ts`：参照 `cheatsheet.plugin.ts` 的 LLM + JSON + citation
   - `/api/classroom/lesson-digest/route.ts`
   - 可独立测试
3. **`LessonDigestCard` 渲染组件**
   - 纯展示组件，props in JSX out
   - 挂在桌面 `ReviewWorkspacePanel` + 移动 review 分支
4. **移动端 UI 落地**
   - 替换 `DedaoTimeline` + `DedaoConfusionCard` 为 digest + 底部 Sheet
   - 移动端 AI 对话改用 ChatBase 底座（替换 `MobileAIChatPanel`）
   - 录课中笔记卡片（复用 `ClassroomRecordingView` 移动端区域）
5. **文档同步**
   - `src/components/mobile/DOMAIN.md` + `src/components/classroom/DOMAIN.md` + `AGENTS.md` 路由表

---

## 7. 明确不做

- 连拍多图自动归一个采集事件
- 单段落多图混排
- "问一下"与"翻译"合并成统一助手条
- PWA 安装态 / 独立 manifest
- 手机端深度编辑（逐句改转写、词汇提取等）
- 不抽离 `MOBILE_REFACTOR_PLAN` 阶段 A 容器（与 God File 治理铁律冲突）
- 不新建"问一下"平行轻量面板（与已存在的移动端"问同学"全屏 Sheet 功能重叠）
- 不删 `MobileTabSwitch` / 不改 `viewMode` 三态语义
- **边看转录边练闪卡**（伪需求，认知上不可能同时做两件事）
- **困惑点独立系统**（AnchorDetailPanel / 困惑点列表 tab / 困惑笔记编辑）——降级为 digest 属性
- **随堂自测入口 / 高光片段**（脑补的需求，不做）
- **手机端实时语音通话**（工程量大，v2 再做）

---

## 8. 验收标准

- 待机态首屏三个按钮的点击热区、响应时间符合"轻入口"（≤1 次点击）
- 课中条不出现任何 tab/菜单/说明卡，悬浮按钮不遮挡录音状态条
- 拍照追加后，采集记录能在电脑端同一 workspace 里看到（验证双存储架构没被破坏）
- 复习降级后，`make smoke-review` 仍需通过
- "问一下"展开必须能看到 `ClassroomChipRow` 动态预测 chip（不是空白输入框）
- 现场态拍的照片必须带 `capturedAtMs`，沉淀态补拍的照片该字段必须为空
- 结构化总结里命中锚点的图片必须出现在对应段落内
- 移动端"问同学"浮动按钮必须始终可见可点，从 chip 发的消息在 `TutorAgentPanel` 里能看到
- 新功能业务逻辑在共享层，桌面移动共用；UI 壳各包一层薄壳
- `make check` 通过，无类型回归
