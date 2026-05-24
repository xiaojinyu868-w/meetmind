# Apps — 应用系统组件

> Workshop 应用的入口、浮窗、证据标签和执行 hook。

## 依赖规则

同 `components/` 顶层。`hooks/useAppExecution.ts` 是应用执行的核心 hook。

## 目录结构

```
apps/
├── WorkshopYellowPage.tsx   # 应用黄页导航（897 行）
├── hooks/
│   └── useAppExecution.ts   # 应用执行 hook（SSE 流/超时/状态管理）
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
- `WorkshopYellowPage.tsx` + CSS module 是应用矩阵首屏基线：用户文案说“学习应用 / 先做一版”，避免能力接口、输出形态、异常、模型等内部词；视觉默认 `canvas/card/ink/divider`，不使用持续渐变和阴影。

## 已有测试

- `mindmap-layout.test.ts` — 布局引擎纯函数测试（19 tests）
