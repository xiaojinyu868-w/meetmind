# Apps — 应用系统组件

> Workshop 应用的入口、浮窗、证据标签和执行 hook。

## 依赖规则

同 `components/` 顶层。`hooks/useAppExecution.ts` 是应用执行的核心 hook。

## 目录结构

```
apps/
├── WorkshopYellowPage.tsx   # 分层学习动作矩阵（class / unit / exam 白名单 + 一个有依据的首选 / 后台生成 / 任务 dock / 分享后置）
├── WorkshopAppCard.tsx      # 学习动作导向的应用卡：首选完整卡 + 其他能力紧凑卡；状态与单一主操作
├── workshop-recommendation.ts # 显式标记 / 已知难点的低风险推荐兜底；无可靠信号时允许不推荐
├── hooks/
│   ├── useAppExecution.ts   # 应用执行 hook（SSE 流/超时/状态管理）
│   └── useWorkshopReadiness.ts # 调用内容适配判断；客观证据控制空内容底线，模型只控制推荐
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
- `WorkshopYellowPage.tsx` + CSS module 是应用矩阵首屏基线：用户选择“检验理解 / 记住核心 / 看清结构”等学习动作。目录必须先按 `contextTier` 过滤：单课只展示五项真实成立的课后动作，考试速查表仅在 unit / exam 层出现；不能为了能力数量把跨课产物塞回单课。首选项显示适用场景、时间投入、产物和可核对的推荐依据；其余能力在宽工作区两列呈现，三栏复习页的中间容器 ≤600px 时按真实容器宽度回到单列并直接露出动作文字。`/api/apps/readiness` 的模型结果只改变当前层能力的首屏优先级：客观证据已经达到稳定生成阈值时，模型不得通过 `not_ready` / `allowedAppKeys` 剥夺用户行动能力；模型主动返回 `recommendedAppKey=null` 时前端也不得强行补一个“现在最适合”。只有空内容、极短碎片或客观证据不足时才禁止生成。官方试听课只开放 class 层五项能力。任务 dock 只在生成进行中或失败时出现。分享只在完成至少一个可分享且当前内容允许的产物后出现。
- 应用任务每 1.5 秒从缓存同步，但只有生成结果或任务状态真的变化时才更新 React state；无变化轮询不能让整个三栏学习区持续重渲染。

## 已有测试

- `mindmap-layout.test.ts` — 布局引擎纯函数测试（19 tests）
