---
name: login-page-redesign
overview: 重新设计登录页面：修复视频全屏覆盖问题、移除左侧遮挡元素、参考 WereUs 风格重新设计登录卡片（Logo 放卡片上方）
design:
  architecture:
    framework: react
  styleKeywords:
    - Glassmorphism
    - Rose Pink
    - Soft Rounded
    - Video Background
    - Modern Minimal
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 700
    subheading:
      size: 16px
      weight: 600
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#F43F5E"
      - "#E11D48"
      - "#FB7185"
    background:
      - "#FFF1F2"
      - "#FFFFFF"
      - "#000000"
    text:
      - "#1F2937"
      - "#6B7280"
      - "#FFFFFF"
    functional:
      - "#22C55E"
      - "#EF4444"
      - "#F59E0B"
todos:
  - id: fix-video-fullscreen
    content: 修复视频全屏覆盖：使用 transform 居中定位 + min-width/min-height 消除黑边
    status: completed
  - id: remove-left-section
    content: 移除左侧 Logo 遮挡区域：删除 hidden lg:flex 展示区块
    status: completed
  - id: redesign-card-layout
    content: 重构登录卡片布局：Logo 移至卡片上方居中，统一所有屏幕尺寸显示
    status: completed
    dependencies:
      - remove-left-section
  - id: optimize-card-style
    content: 优化卡片玻璃态样式：增强半透明效果、优化圆角和阴影
    status: completed
    dependencies:
      - redesign-card-layout
  - id: polish-form-elements
    content: 美化表单元素：优化输入框、按钮的配色和交互效果
    status: completed
    dependencies:
      - optimize-card-style
  - id: test-responsive
    content: 测试响应式适配：验证移动端和桌面端显示效果
    status: completed
    dependencies:
      - polish-form-elements
---

## 产品概述

重新设计 MeetMind 登录页面，参考 WereUs 风格，打造沉浸式视频背景登录体验。

## 核心功能

- **视频全屏背景**：视频完全覆盖浏览器窗口，消除上下黑边，提供沉浸式视觉体验
- **简洁布局**：移除左侧遮挡元素，保持视频背景的完整展示
- **重新设计登录卡片**：
- Logo（MeetMind 文字+图标）放置于登录卡片上方居中
- 采用半透明粉色调卡片设计，大圆角边框
- 输入框、按钮设计简洁柔和
- **保持原有登录功能**：邮箱/手机号切换、记住密码、访客模式、微信登录、注册链接、协议提示等

## 技术栈

- 前端框架：Next.js 14 + React 18 + TypeScript
- 样式方案：Tailwind CSS
- UI 组件：Radix UI（已有）+ 自定义样式
- 状态管理：React Hooks

## 技术方案

### 系统架构

本次修改仅涉及登录页面 UI 层，不涉及架构变更。

### 模块划分

- **视频背景模块**：优化视频全屏显示，解决黑边问题
- **登录卡片模块**：重构卡片布局，将 Logo 移至卡片上方

### 数据流

用户交互保持不变：表单输入 -> useAuth Hook -> API 调用 -> 路由跳转

## 实现细节

### 核心目录结构

仅修改登录页面文件：

```
src/
└── app/
    └── (auth)/
        └── login/
            └── page.tsx    # 重新设计登录页面 UI
```

### 关键代码结构

**视频背景优化**：使用 CSS 确保视频完全覆盖视口，添加 min-width 和 min-height 属性强制全屏。

```
// 视频背景全屏覆盖方案
<video
  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 min-w-full min-h-full w-auto h-auto object-cover"
/>
```

**登录卡片布局重构**：Logo 移至卡片上方，卡片采用玻璃态设计。

```
// 登录卡片结构
<div className="flex flex-col items-center">
  {/* Logo 在卡片外部上方 */}
  <div className="mb-6 flex items-center gap-3">
    <LogoIcon />
    <span>MeetMind</span>
  </div>
  {/* 半透明登录卡片 */}
  <div className="bg-rose-50/90 backdrop-blur-md rounded-3xl">
    {/* 表单内容 */}
  </div>
</div>
```

### 技术实现计划

1. **视频全屏问题**

- 问题：视频 object-cover 可能因视频比例与屏幕不匹配产生黑边
- 方案：使用 transform + min-width/min-height 确保视频始终大于视口并居中裁剪
- 步骤：修改 video 元素样式类

2. **移除左侧遮挡元素**

- 问题：左侧有 Logo 区块遮挡视频
- 方案：删除整个左侧展示区域 div
- 步骤：移除 `hidden lg:flex flex-1` 区块

3. **Logo 位置调整**

- 问题：Logo 当前仅在移动端卡片内显示
- 方案：将 Logo 移至卡片外部上方，所有屏幕尺寸统一显示
- 步骤：重构卡片容器结构

4. **卡片样式优化**

- 问题：需要更符合 WereUs 风格的设计
- 方案：增强玻璃态效果，优化配色和圆角

### 集成点

- 保持现有 useAuth Hook 接口不变
- 保持现有路由逻辑不变
- 保持现有表单验证逻辑不变

## 设计风格

采用 WereUs 参考风格，打造现代玻璃态（Glassmorphism）登录体验。

## 整体风格

- 视频全屏铺满作为动态背景
- 右侧浮动半透明登录卡片
- 粉色调玻璃态设计，柔和圆润
- 简洁现代，视觉焦点清晰

## 页面设计

### 登录页面

#### 区块1：视频背景层

- 全屏视频背景，完全覆盖浏览器窗口
- 视频居中裁剪显示，无黑边
- 右侧添加轻微渐变遮罩，提升卡片可读性

#### 区块2：Logo 区域

- 位于登录卡片正上方居中
- 包含图标（M 字母方形图标，渐变配色）和 MeetMind 文字
- 白色文字带阴影，与视频背景形成对比
- 添加微妙动画效果

#### 区块3：登录卡片

- 半透明粉色背景（rose-50/90）配合模糊效果
- 大圆角设计（rounded-3xl，24px）
- 柔和阴影增加层次感
- 宽度约 420px，居中或右侧定位

#### 区块4：表单区域

- 邮箱/手机号切换标签，玫瑰色高亮
- 输入框白底圆角，粉色边框聚焦效果
- 记住密码复选框、忘记密码链接水平排列
- 渐变色登录按钮，带悬停效果
- 白底边框访客模式按钮

#### 区块5：辅助功能区

- 注册提示链接
- 微信登录按钮（绿色）
- 用户协议和隐私政策链接