# Apps — 应用系统组件

> Workshop 应用的入口、浮窗、证据标签和执行 hook。

## 依赖规则

同 `components/` 顶层。`hooks/useAppExecution.ts` 是应用执行的核心 hook。

## 目录结构

```
apps/
├── WorkshopYellowPage.tsx   # 分层学习动作矩阵（class / unit / exam 白名单 + 一个有依据的首选 / 显性跨课速查表入口 / 后台生成 / 任务 dock）
├── ClassroomFlowArtifact.tsx # 录课时已生成的课堂脉络入口与课后时间线工作区；复用持久化结果并支持时间戳回跳原话
├── WorkshopAppCard.tsx      # 学习动作导向的应用卡：首选完整卡 + 其他能力紧凑卡；状态与单一主操作；渲染 `data-app={app.key}`，module.css 按应用给 icon cover 分配克制签名色（cheatsheet=sand/quiz=vermilion/mindmap=pine-fog/audio=vermilion-mist/infographic=pine-mist）
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
- `WorkshopYellowPage.tsx` + CSS module 是应用矩阵首屏基线：从录课进入且已经形成课堂脉络时，先展示“录课时已经整理好”的成品入口，打开后按完整时间线复习并可回跳原话，不要求用户再次生成。随后再让用户选择“检验理解 / 记住核心 / 看清结构”等学习动作。目录必须先按 `contextTier` 过滤：单课只直接生成五项真实成立的课后动作，考试速查表的**能力入口仍需显性可见**，但点击必须进入课程 / 多节课堂范围选择，不能为了能力数量把跨课产物退化成单课生成。首选项显示适用场景、时间投入、产物和可核对的推荐依据；其余能力在宽工作区两列呈现，三栏复习页的中间容器 ≤600px 时按真实容器宽度回到单列并直接露出动作文字。`/api/apps/readiness` 只做两件事：客观下限（空内容 / 极短碎片，<2 段或 <80 字或 <20 秒）禁止生成，以及给出“现在最适合”的推荐；模型的 ready / limited / 内容分类判断**只改变推荐与提示语气，永不裁剪 allowedAppKeys**——是否生成是用户的决定，材料撑不住的能力由插件在执行时诚实返回 `CONTENT_NOT_READY` 空态，而不是在门口禁用。模型主动返回 `recommendedAppKey=null` 时前端也不得强行补一个“现在最适合”。官方试听课只开放 class 层五项直接生成能力。任务 dock 只在生成进行中或失败时出现。分享是已完成成果的就地动作：显示在成果卡和结果页，不再单独放在矩阵底部。
- `useAppExecution` 按 session + app 缓存成品；普通重做失败时可保留旧成品，但服务端返回 `CONTENT_NOT_READY` 代表当前范围本身不成立，必须同时清掉旧结果与缓存，禁止出现“没做好”却仍可分享旧成品的矛盾状态。

## 已有测试

- `mindmap-layout.test.ts` — 布局引擎纯函数测试（19 tests）
