---
name: page-speed-optimization
overview: 优化 MeetMind 学生端页面加载速度和运行时性能，通过代码分割、懒加载、资源优化和渲染优化等手段提升用户体验。
todos:
  - id: analyze-current-performance
    content: 使用 Lighthouse 和 Web Vitals 分析当前性能瓶颈
    status: pending
  - id: implement-code-splitting
    content: 将 page.tsx 中的组件改为动态导入（dynamic import），按路由和视图为单位分割代码
    status: pending
  - id: optimize-demo-data-loading
    content: 优化演示数据加载策略，使用更细粒度的代码分割和预加载
    status: pending
  - id: add-resource-prefetching
    content: 为关键资源添加预加载（prefetch）和预连接（preconnect）
    status: pending
  - id: optimize-images-assets
    content: 优化图片和静态资源，使用 Next.js Image 组件和适当格式
    status: pending
  - id: reduce-javascript-bundle
    content: 分析和减少 JavaScript bundle 大小，移除未使用的依赖
    status: pending
  - id: implement-virtual-scrolling
    content: 为长列表（转录片段、困惑点）实现虚拟滚动
    status: pending
  - id: optimize-render-performance
    content: 使用 React.memo、useMemo、useCallback 优化渲染性能
    status: pending
  - id: test-and-measure
    content: 使用 webapp-testing skill 测试优化效果，对比前后性能指标
    status: pending
    dependencies:
      - implement-code-splitting
      - optimize-demo-data-loading
      - add-resource-prefetching
---

## 性能优化目标

### 当前问题分析

1. **首屏加载慢**：page.tsx 2154 行，静态导入 20+ 个组件，初始 bundle 大
2. **代码未分割**：所有组件静态导入，没有使用 dynamic import
3. **演示数据**：虽然延迟加载，但加载时机可以优化
4. **资源加载**：没有预加载关键资源

### 优化目标

| 指标 | 当前 | 目标 |
|------|------|------|
| First Contentful Paint (FCP) | - | < 1.5s |
| Largest Contentful Paint (LCP) | - | < 2.5s |
| Time to Interactive (TTI) | - | < 3.5s |
| JavaScript Bundle Size | - | 减少 30%+ |

## 优化策略

### 1. 代码分割（Code Splitting）

**问题**：page.tsx 静态导入所有组件，初始加载大量不需要的代码

**方案**：
```typescript
// 当前：静态导入所有组件
import { Recorder } from '@/components/Recorder';
import { TimelineView } from '@/components/TimelineView';
import { AITutor } from '@/components/AITutor';
// ... 20+ 个组件

// 优化：按视图动态导入
const Recorder = dynamic(() => import('@/components/Recorder'), {
  loading: () => <AppLoading />
});

const TimelineView = dynamic(() => import('@/components/TimelineView'));
const AITutor = dynamic(() => import('@/components/AITutor'));
```

**分割策略**：
- 录音模式组件（Recorder）- 首屏需要
- 复习模式组件（TimelineView, AITutor 等）- 延迟加载
- 移动端组件 - 按设备类型条件加载
- 演示数据 - 保持延迟加载

### 2. 资源预加载

**关键资源预加载**：
```typescript
// next.config.js
const nextConfig = {
  async headers() {
    return [
      // 预连接到外部服务
      {
        source: '/:path*',
        headers: [
          {
            key: 'Link',
            value: '<https://dashscope.aliyuncs.com>; rel=preconnect',
          },
        ],
      },
    ];
  },
};
```

### 3. 图片和静态资源优化

**当前问题**：可能没有使用 Next.js Image 组件

**优化**：
- 使用 `next/image` 替代 `<img>`
- 使用 WebP 格式
- 添加适当的 sizes 和 priority 属性

### 4. 渲染优化

**React 优化**：
- 使用 `React.memo` 包装纯展示组件
- 使用 `useMemo` 缓存计算结果
- 使用 `useCallback` 稳定回调函数引用

**长列表虚拟滚动**：
- 转录片段列表
- 困惑点列表
- 精选片段列表

### 5. Bundle 分析

**分析工具**：
```bash
# 分析 bundle 大小
npm run analyze
```

**优化方向**：
- 移除未使用的依赖
- 按需引入大型库（如 lodash → lodash-es）
- 使用 tree-shaking 友好的导入方式

## 实现计划

### Phase 1: 分析和基础优化
1. 运行 Lighthouse 获取基线数据
2. 添加 @next/bundle-analyzer
3. 分析当前 bundle 组成

### Phase 2: 代码分割
1. 将复习模式组件改为动态导入
2. 将移动端组件改为条件动态导入
3. 优化演示数据加载策略

### Phase 3: 资源优化
1. 添加关键资源预加载
2. 优化图片加载
3. 优化字体加载（如有）

### Phase 4: 渲染优化
1. 实现虚拟滚动
2. 添加 React.memo 优化
3. 优化 useEffect 依赖

### Phase 5: 测试验证
1. 对比优化前后 Lighthouse 分数
2. 使用 webapp-testing 进行真实场景测试
3. 监控 Core Web Vitals

## 预期效果

- 首屏加载时间减少 40-50%
- JavaScript bundle 大小减少 30%+
- 页面交互响应更快
- 移动端体验明显改善

## 风险评估

| 风险 | 缓解措施 |
|------|----------|
| 动态导入导致闪烁 | 添加合适的 loading 状态 |
| 代码分割增加复杂度 | 保持清晰的组件结构 |
| 预加载浪费带宽 | 只预加载关键资源 |
