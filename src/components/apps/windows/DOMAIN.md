# Workshop Windows — 应用窗口组件

> AI 原生应用的窗口化展示系统，包含思维导图、信息图、回响卡等可视化窗口。

## 目录结构

```
src/components/apps/windows/
├── WorkshopWindowManager.tsx    # 窗口管理器（多窗口协调）
├── AppRenderSurface.tsx         # 统一应用渲染面（浮窗 / 对话内联 / 独立页共用）
├── MindmapWindow.tsx            # 思维导图窗口（692行，已拆分）
├── MindmapWindowLayout.ts      # 思维导图布局引擎（168行）
├── InfographicWindow.tsx       # 信息图窗口（699行，已拆分）
├── InfographicWindowData.ts    # 信息图数据处理（305行）
├── StudyReportWindow.tsx       # 学习报告入口（插件报告 / 随堂检验报告分发）
├── StudyReportDocument.tsx     # 插件学习报告文档排版（疏朗阅读版）
├── study-report-document-model.ts # 学习报告内容归一化纯 helper（有测试）
├── AppWindowShell.tsx          # 独立应用页外壳
├── app-window-shell-tone.ts    # 独立应用页色调策略（闪卡使用低亮度沉浸背景，避免白底眩光）
├── FlashcardsWindow.tsx        # 闪卡训练窗口（低亮度沉浸练习背景，demo 静态结果显示试听成果分享入口）
├── flashcards-share-actions.ts # 闪卡试听成果外传文案/文件名 helper
├── EvidenceLabel.tsx           # 证据标签组件
└── index.ts                    # barrel 导出
```

## 已拆分的窗口

### MindmapWindow（思维导图）

- 主文件：`MindmapWindow.tsx` — 渲染逻辑（导图 / 大纲双视图）
- 布局引擎：`mindmap-layout.ts` — 树布局算法、v7 色板、位置计算

**设计原则（第一性原理：用户打开就该一眼读懂整张图）**：
- v7 米白纸感（`PALETTE.bg` 近白），不是深色画布；落在复习工作区里不突兀。
- 节点 = **文字坐在一道墨线上**（朱批/松墨手感），不是七彩填色方块。
- **按一级主干分配颜色**：每条主干 + 整棵子树共享一种双签名色（pine / vermilion 家族交替，见 `BRANCH_HUES` / `getBranchHue`），一眼看出"我在哪条主干"——这是可读性的真正来源，而不是按 depth 彩虹。
- **默认整图展开 + 自适应**（`buildFullExpandedSet` + `fitToView`，带 `MIN_READABLE_SCALE` 可读下限），无需任何交互即可阅读。
- **全屏沉浸阅读**：右上角 / 控制条「全屏」把导图 portal 到 `document.body` 全屏层（Esc 退出），给一块真正看得清的大画布。
- 滚轮缩放**以光标为锚**（光标下内容不动），拖拽平移；这是"顺手"的关键。

布局引擎纯函数（可单元测试，见 `mindmap-layout.test.ts`）：
- `getBranchHue()` / `branchIndexOf()` — 按一级主干取色
- `getHueByDepth()` — 旧的按深度取色（保留供测试 / 大纲兜底）
- `measureText()` / `getFontSize()` — 文本宽度 / 字号
- `buildLayoutTree()` / `subtreeHeight()` / `assignPositions()` / `flattenLayout()` / `boundingBox()` — 树布局

### QuizWindow（课堂测验）

- 客观题（single / judge）= 选项卡片即时判分；主观题（short / fill）= 看参考答案 + 一次轻量自评标记，统一进 `isAnswerCorrect` 计分。
- **铁律**：选项质量在生成端把关——`quiz.plugin.ts` 绝不再造 "该片段主要讨论了X / 跳过了话题 / 未做实质分析" 这类模板干扰项；凑不出有内容的干扰项就出成简答题（`resolveTypeAndOptions`）。

### InfographicWindow（信息图）

- 主文件：`InfographicWindow.tsx`（699行）— 渲染逻辑
- 数据文件：`InfographicWindowData.ts`（305行）— 场景预设/风格预设/数据转换

## AppRenderSurface

统一承接 `AppExecutionResult` → 具体应用 UI 的分发。`WorkshopWindowManager`、应用矩阵独立页、课堂/复习对话内联应用都必须复用这里，避免同一个 app 维护两套 UI。

## 排版约定

- 应用窗口默认使用 `canvas/card/ink/divider` 平涂体系；闪卡这类长时间主动回忆页面允许使用低亮度沉浸背景以降低白底眩光，但不要把这种深色舞台扩散到普通文档 / 报告类应用。
- 报告类应用优先复用 `StudyReportDocument` 的疏朗文档排版：大标题、长正文 1.75+ 行高、主内容和建议区分栏。
- 用户可见应用名称必须避开 `COPY.bannedWords`；`app-catalog.test.ts` 也会额外守住目录里的 `AI / 生图 / 智能生成` 等技术词。
- 独立应用页和 `AppWindowShell` 不展示内部 sessionId；动作文案使用“再做一版 / 已做好 / 没做好”。

## WorkshopWindowManager

负责多窗口的：
- 打开/关闭/层叠管理
- 窗口间通信
- 拖拽位置持久化（localStorage）

## 证据标签（EvidenceLabel）

将转录片段锚定到 AI 生成内容上，支持：
- 点击跳转到对应时间点
- 引用文本高亮
- 多标签折叠展开
