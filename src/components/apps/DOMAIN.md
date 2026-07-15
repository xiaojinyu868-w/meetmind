# Apps — 应用系统组件

> Workshop 应用的入口、浮窗、证据标签和执行 hook。

## 依赖规则

同 `components/` 顶层。`hooks/useAppExecution.ts` 是应用执行的核心 hook。

## 目录结构

```
apps/
├── WorkshopYellowPage.tsx   # 学习动作矩阵编排（推荐 / 后台生成 / 任务 dock / 分享后置）
├── WorkshopAppCard.tsx      # 学习动作导向的应用卡：适用场景 / 时间投入 / 状态 / 单一主操作
├── workshop-recommendation.ts # 显式标记 / 已知难点的低风险推荐兜底；无可靠信号时允许不推荐
├── hooks/
│   ├── useAppExecution.ts   # 应用执行 hook（SSE 流/超时/状态管理）
│   └── useWorkshopReadiness.ts # 调用内容适配判断，控制可用应用 / 推荐 / 不生成状态
├── evidence/
│   ├── EvidenceChip.tsx      # 证据标签芯片
│   └── EvidencePopoverCard.tsx # 证据弹窗卡片
└── windows/
    ├── WorkshopWindowManager.tsx # 浮窗管理器 + ErrorBoundary
    ├── AppRenderSurface.tsx      # 统一应用渲染面（Workshop / 对话内联共用）
    ├── InfographicWindow.tsx     # 信息图浮窗
    ├── infographic-window-data.ts # 信息图类型/预设/工具函数
    ├── MindmapWindow.tsx         # 思维导图浮窗
    ├── mindmap-layout.ts         # 思维导图布局引擎（纯函数，有测试）
    ├── QuizWindow.tsx            # 测验浮窗
    ├── FlashcardsWindow.tsx      # 闪卡浮窗
    ├── PodcastWindow.tsx         # 播客浮窗
    └── AppWindowShell.tsx        # 浮窗外壳
```

## 渲染约束

- `AppRenderSurface.tsx` 是 `AppExecutionResult` 到应用 UI 的唯一分发层。
- Workshop 浮窗、应用矩阵独立页、对话内联应用都应复用它；不要在 `classroom/` 或 `tutor/` 里为同一个 app 重写一套 UI。
- `WorkshopYellowPage.tsx` + CSS module 是应用矩阵首屏基线：用户选择“带走重点 / 检验理解 / 记住核心”等学习动作；每卡说明适用场景、时间投入和产物。首屏只有在 `/api/apps/readiness` 返回有证据的推荐时才突出一个应用；判断必须同时带真实原文、材料标题与来源类型，避免把听力练习等对话型学习材料误判为闲聊。材料过短、非学习内容或转录不可靠时不展示应用矩阵，也不允许硬生成，并清理该 session 已有的派生缓存（不碰原录音），避免旧幻觉在内容变化后复现。分享只在完成至少一个可分享且当前内容允许的产物后出现。首次生成留在矩阵后台完成；视觉默认 `canvas/card/ink/divider`，不使用渐变和装饰性阴影。

## 已有测试

- `mindmap-layout.test.ts` — 布局引擎纯函数测试（19 tests）
