---
name: app-loading-optimization
overview: 优化访客模式进入体验：使用品牌图片 + 真实进度条替代固定时长动画，让加载时间由实际数据决定，大幅提升页面加载速度感知。
todos:
  - id: refactor-app-loading
    content: 重构 AppLoading 组件：使用品牌图片背景 + 底部真实进度条，移除固定时长动画逻辑
    status: completed
  - id: expose-loading-progress
    content: 修改 page.tsx：新增 loadingProgress 状态，在 initializeApp 各阶段更新进度值并传递给 AppLoading
    status: completed
    dependencies:
      - refactor-app-loading
  - id: optimize-guest-mode
    content: 优化登录页访客模式：移除"进入中"spinner，让用户直接看到 /app 的品牌加载页
    status: completed
    dependencies:
      - expose-loading-progress
---

## 用户需求

优化访客模式的加载体验，解决点击"访客模式体验"后长时间显示"进入中"的问题。

## 产品概述

将现有的固定时长开屏动画改造为基于品牌图片的真实进度加载页，让用户在等待时看到精美的品牌展示，同时进度条反映实际的数据加载状态。

## 核心功能

1. 使用品牌图片 `/videos/加载页.jpg` 作为加载页背景
2. 底部显示细长进度条，进度由实际初始化任务决定
3. 移除所有人为的固定延迟，数据就绪立即进入应用
4. 优化登录页到应用页的过渡体验

## 技术栈

- 前端框架：Next.js 14 + React 18 + TypeScript
- 样式方案：Tailwind CSS
- 现有组件：AppLoading.tsx（需要重构）

## 技术架构

### 系统架构

当前流程问题：

```
登录页点击访客模式 → 显示"进入中"spinner → router.push → 
AppLoading 固定动画(2700ms+) → appReady 后还要等动画完成 → 进入应用
```

优化后流程：

```
登录页点击访客模式 → router.push（无spinner）→ 
AppLoading 显示品牌图+真实进度条 → appReady 后立即淡出 → 进入应用
```

### 模块划分

1. **AppLoading 组件重构**

- 移除固定时长的 LOADING_STAGES 动画
- 新增 `progress` prop 接收外部传入的真实进度值
- 使用品牌图片作为背景
- 底部渲染进度条和状态文字

2. **page.tsx 初始化进度暴露**

- 新增 `loadingProgress` 状态（0-100）
- 在 `initializeApp` 各阶段更新进度值
- 将进度值传递给 AppLoading

### 数据流

```
initializeApp() 执行各阶段
        ↓
setLoadingProgress(30/50/80/100)
        ↓
AppLoading 接收 progress prop
        ↓
进度条实时更新
        ↓
progress=100 且 appReady=true → 触发 onComplete
```

## 实现细节

### 进度节点设计

根据 `initializeApp` 的实际执行阶段：

- 0%：组件挂载
- 30%：第一批并行操作开始（checkServices、getPreference等）
- 60%：第一批完成，开始处理状态
- 80%：复习模式下加载演示数据完成
- 100%：setAppReady(true)

### 核心目录结构

```
src/
├── components/
│   └── AppLoading.tsx        # [MODIFY] 重构为品牌图+真实进度条模式
│                             # - 新增 progress prop 接收外部进度
│                             # - 使用 /videos/加载页.jpg 作为全屏背景
│                             # - 底部渲染简洁进度条
│                             # - 移除固定时长动画逻辑
│                             # - progress=100 时立即触发 onComplete
└── app/
    └── (main)/
        └── app/
            └── page.tsx      # [MODIFY] 暴露初始化进度
                              # - 新增 loadingProgress 状态
                              # - initializeApp 各阶段调用 setLoadingProgress
                              # - 将 loadingProgress 传递给 AppLoading
```

### 关键接口定义

```typescript
// AppLoading 新 Props
interface AppLoadingProps {
  progress?: number;           // 外部传入的真实进度 0-100
  message?: string;            // 可选的状态文字
  onComplete?: () => void;     // 加载完成回调
}
```

## 实现注意事项

1. **性能考量**

- 品牌图片使用 Next.js Image 组件优化加载
- 进度条更新使用 CSS transition 而非 JS 动画，减少重绘
- 淡出动画控制在 300ms 内，不人为延迟

2. **兼容性保持**

- 保留 `!mounted` 时的基础加载状态（SSR hydration）
- 如果外部不传 progress，组件内部使用简单的 indeterminate 动画
- 保持 onComplete 回调机制不变

3. **用户体验**

- 进度条平滑过渡，使用 easeOut 缓动
- 100% 后快速淡出（200-300ms）
- 移动端和桌面端都使用相同的加载页