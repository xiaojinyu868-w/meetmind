---
name: meetmind-ux-optimization
overview: 针对 MeetMind 项目进行全面的 UX 优化，包括：按钮点击反馈、引导流程加载优化、移动端上传功能修复、以及移除重置引导按钮。
todos:
  - id: fix-guest-loading
    content: 修复登录页访客模式按钮，添加 isGuestLoading 状态和 loading spinner 显示
    status: completed
  - id: fix-role-switch
    content: 优化 Header.tsx 角色切换组件，添加页面跳转加载状态和过渡动画
    status: completed
  - id: fix-onboarding-flow
    content: 修改 useOnboarding.ts 和 OnboardingGuide.tsx，将所有引导步骤改为非交互式，统一使用下一步按钮
    status: completed
  - id: fix-mobile-upload
    content: 修复 AudioUploader.tsx 移动端上传问题，优化 file input 兼容性和交互反馈
    status: completed
  - id: remove-reset-button
    content: 移除 app/page.tsx 中的重置引导调试按钮
    status: completed
  - id: test-all-fixes
    content: 使用 [skill:webapp-testing] 测试所有修复功能，验证按钮 loading、引导流程、移动端上传
    status: completed
    dependencies:
      - fix-guest-loading
      - fix-role-switch
      - fix-onboarding-flow
      - fix-mobile-upload
      - remove-reset-button
---

## 产品概述

针对 MeetMind 智能学习平台的用户体验优化，解决用户反馈的 4 个核心问题：按钮点击无反馈、引导加载延迟、移动端上传问题和重置引导按钮移除。

## 核心功能

### 1. 按钮点击加载反馈优化

- 访客模式体验按钮：点击后显示加载状态，添加 loading spinner
- 学生/老师/家长端入口切换：添加页面跳转过渡动画和加载指示
- 所有需要等待的按钮添加统一的 loading 状态样式

### 2. 引导弹窗交互优化

- 优化引导加载逻辑，减少 isLoading 阻塞时间
- 将交互式步骤的"点击试试"改为明确的"下一步"按钮
- 所有引导步骤统一使用按钮进入下一步，提升操作明确性

### 3. 移动端音频上传修复

- 修复移动端文件选择后无法触发上传的问题
- 优化 file input 的移动端兼容性（capture 属性、accept 类型）
- 添加移动端专用的上传按钮样式和交互反馈

### 4. 重置引导按钮移除

- 移除 app/page.tsx 中的重置引导调试按钮

## 技术栈

- 框架：Next.js 14+ App Router
- 样式：Tailwind CSS
- 状态管理：React Hooks + IndexedDB
- 类型：TypeScript

## 实现方案

### 1. 按钮点击加载反馈

**登录页访客模式按钮 (login/page.tsx)**

- 新增 `isGuestLoading` 状态，点击时设为 true
- 在 `handleGuestMode` 中先设置 loading 状态，再执行 `router.push('/app')`
- 按钮显示 spinner 和"进入中..."文字

**角色切换 RoleTab (Header.tsx)**

- 将 `Link` 组件改为可控的按钮+程序化导航
- 使用 `useTransition` 或自定义 loading 状态
- 点击时显示加载指示器，完成后跳转

### 2. 引导交互优化

**useOnboarding.ts 优化**

- 将所有步骤的 `interactive` 默认改为 `false`
- 用户通过点击"下一步"按钮进入下一步，而非点击目标元素

**OnboardingGuide.tsx 优化**

- 移除"点击试试"提示，统一使用"下一步"按钮
- 保留点灯效果（spotlight），但不要求用户必须点击高亮区域
- 简化交互逻辑，降低用户认知负担

### 3. 移动端上传修复

**AudioUploader.tsx 修复**

- 优化 file input 的 accept 属性，添加更多移动端音频格式
- 添加 `capture` 属性处理，移动端优先使用
- 确保 `handleInputChange` 在移动端文件选择器关闭后正确触发
- 添加移动端专用的点击区域和提示文案

**关键修复点**

```typescript
// 移动端兼容性增强
accept="audio/*,audio/mp3,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/m4a,.mp3,.wav,.webm,.ogg,.m4a"
```

### 4. 移除重置引导按钮

**app/page.tsx**

- 删除第 2145-2160 行的重置引导按钮代码块

## 实现注意事项

### 性能考量

- 加载状态使用 React state，避免不必要的重渲染
- 使用 `useTransition` 处理页面跳转，保持 UI 响应性
- 引导状态从 IndexedDB 加载使用 Suspense 边界，不阻塞首屏

### 兼容性

- 移动端 file input 需要测试 iOS Safari 和 Android Chrome
- 使用 `audio/*` 通配符确保最大兼容性
- 添加 touch 事件处理，提升移动端点击响应

### 代码风格

- 遵循现有项目的 Tailwind CSS 类名风格
- 使用项目已有的颜色变量（rose-500、coral 等）
- Loading spinner 样式与项目现有的 animate-spin 保持一致

## 目录结构

```
src/
├── app/
│   └── (auth)/
│       └── login/
│           └── page.tsx              # [MODIFY] 添加访客模式 loading 状态
├── app/
│   └── (main)/
│       └── app/
│           └── page.tsx              # [MODIFY] 移除重置引导按钮
├── components/
│   ├── Header.tsx                    # [MODIFY] 添加角色切换加载状态
│   ├── AudioUploader.tsx             # [MODIFY] 修复移动端上传兼容性
│   └── OnboardingGuide.tsx           # [MODIFY] 统一使用下一步按钮
└── hooks/
    └── useOnboarding.ts              # [MODIFY] 引导步骤 interactive 默认改为 false
```

## Agent Extensions

### Skill

- **vercel-react-best-practices**
- 用途：确保 React 组件性能优化符合 Vercel 最佳实践
- 预期结果：loading 状态管理高效，避免不必要的重渲染，页面跳转流畅

- **webapp-testing**
- 用途：测试移动端上传功能和按钮交互反馈
- 预期结果：验证移动端文件选择、上传功能正常工作，按钮 loading 状态正确显示