---
name: response-time-optimization
overview: 优化 MeetMind 项目的响应时间，包括按钮点击反馈速度、页面跳转速度和引导弹窗加载速度，通过预加载、懒加载、代码分割和 React 性能优化等技术手段提升用户体验。
todos:
  - id: add-page-prefetch
    content: 使用 [skill:vercel-react-best-practices] 在 Header.tsx 和 login/page.tsx 添加关键页面预加载
    status: completed
  - id: optimize-onboarding-loading
    content: 优化 useOnboarding.ts 实现乐观 UI，移除 isLoading 阻塞，添加 isHydrated 状态
    status: completed
  - id: test-performance
    content: 使用 [skill:webapp-testing] 测试优化效果，验证页面跳转和引导加载速度
    status: completed
    dependencies:
      - add-page-prefetch
      - optimize-onboarding-loading
---

## 产品概述

针对 MeetMind 智能学习平台的反馈时间优化，解决用户感知的 3 个核心延迟问题：按钮点击响应、页面跳转等待、引导弹窗加载。

## 核心功能

### 1. 按钮点击响应速度优化

- 优化 loading 状态的即时反馈，确保用户点击后立即看到视觉变化
- 使用 `useTransition` 实现非阻塞的状态更新
- 添加骨架屏和微动画提升感知速度

### 2. 页面跳转/路由切换速度优化

- 使用 Next.js Link 组件的 `prefetch` 预加载目标页面
- 实现智能预加载策略（鼠标悬停时预加载）
- 优化 Header 角色切换的跳转逻辑

### 3. 引导弹窗加载速度优化

- 实现乐观 UI 模式，不等待 IndexedDB 加载完成即显示界面
- 优化 `useOnboarding` 的初始化逻辑，使用默认状态立即渲染
- 将引导状态加载改为后台异步更新，不阻塞用户交互

## 技术栈

- 框架：Next.js 14+ App Router
- 样式：Tailwind CSS
- 状态管理：React Hooks + IndexedDB 持久化
- 类型：TypeScript

## 实现方案

### 1. 按钮响应优化

**问题分析**

- 当前 `router.push()` 是异步操作，用户点击后需要等待 JavaScript 路由计算和页面代码加载
- 虽然已有 loading 状态，但实际页面渲染可能延迟

**优化策略**

```typescript
// 使用 useTransition 包裹路由跳转，保持 UI 响应性
const [isPending, startTransition] = useTransition();

const handleNavigation = (href: string) => {
  setIsLoading(true); // 立即显示 loading
  startTransition(() => {
    router.push(href);
  });
};
```

### 2. 页面预加载优化

**问题分析**

- 当前项目的路由跳转使用 `router.push()`，没有利用 Next.js 的预加载机制
- Header 角色切换是高频操作，每次都需要等待目标页面加载

**优化策略 - Header.tsx**

```typescript
// 添加 Link 组件预加载关键页面
import Link from 'next/link';

// 使用隐藏的 Link 实现 prefetch
<Link href="/" prefetch={true} className="hidden" />
<Link href="/parent" prefetch={true} className="hidden" />
<Link href="/teacher" prefetch={true} className="hidden" />

// 或在 useEffect 中手动预加载
useEffect(() => {
  router.prefetch('/');
  router.prefetch('/parent');
  router.prefetch('/teacher');
}, [router]);
```

**优化策略 - login/page.tsx**

```typescript
// 预加载访客模式目标页面
useEffect(() => {
  router.prefetch('/app');
}, [router]);
```

### 3. 引导加载优化

**问题分析**

- `useOnboarding` 需要从 IndexedDB 异步加载状态
- `isLoading` 为 true 期间（3-4秒），引导组件无法显示
- 用户必须等待加载完成才能看到引导或开始使用

**优化策略 - 乐观 UI**

```typescript
// useOnboarding.ts 优化
export function useOnboarding(options: UseOnboardingOptions = {}) {
  // 使用默认状态立即渲染，不等待 IndexedDB
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(false); // 改为 false，不阻塞渲染
  const [isHydrated, setIsHydrated] = useState(false); // 新增：标记是否已从 DB 加载

  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await getPreference<OnboardingState>(ONBOARDING_STATE_KEY, DEFAULT_STATE);
        if (saved) {
          setState(saved);
          stateRef.current = saved;
        }
      } catch (err) {
        console.error('Failed to load onboarding state:', err);
      } finally {
        setIsHydrated(true);
      }
    };
    loadState();
  }, []);

  // 返回 isHydrated 而非 isLoading，让调用方决定是否等待
  return { isLoading: false, isHydrated, ... };
};
```

**调用方优化 - app/page.tsx**

```typescript
// 不再等待 isLoading，直接渲染
// 引导状态会在 hydrate 后自动更新
const { isHydrated, shouldShowFlow, ... } = useOnboarding({ isMobile });

// 如果需要确保状态准确，可以等待 isHydrated
// 但不阻塞主要 UI 渲染
```

## 实现注意事项

### 性能考量

- `router.prefetch()` 会预加载页面的 JavaScript 代码，但不会执行数据获取
- 对于角色切换这种高频操作，预加载能显著减少感知延迟
- IndexedDB 读取通常在 10-100ms 内完成，3-4秒的延迟可能有其他原因

### 兼容性

- `useTransition` 是 React 18+ 特性，项目已支持
- `router.prefetch()` 是 Next.js App Router 的标准 API

### 代码风格

- 保持现有的 Tailwind CSS 类名风格
- 使用项目已有的 loading spinner 组件样式

## 目录结构

```
src/
├── app/
│   └── (auth)/
│       └── login/
│           └── page.tsx              # [MODIFY] 添加 /app 页面预加载
├── components/
│   └── Header.tsx                    # [MODIFY] 添加角色页面预加载
└── hooks/
    └── useOnboarding.ts              # [MODIFY] 实现乐观 UI，移除加载阻塞
```

## Agent Extensions

### Skill

- **vercel-react-best-practices**
- 用途：确保 React/Next.js 性能优化符合 Vercel 最佳实践
- 预期结果：预加载策略正确实现，useTransition 使用规范，页面跳转流畅

- **webapp-testing**
- 用途：测试优化后的反馈时间效果
- 预期结果：验证页面跳转预加载生效，引导弹窗立即显示，按钮响应即时