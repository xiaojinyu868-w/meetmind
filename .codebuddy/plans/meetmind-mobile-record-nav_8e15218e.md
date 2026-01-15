---
name: meetmind-mobile-record-nav
overview: 修复移动端录音页面缺少顶部导航栏的问题，添加得到风格的顶部栏（Logo + Tab切换 + 菜单），让用户可以在录音和复习模式之间切换。
todos:
  - id: explore-codebase
    content: 使用[subagent:code-explorer]探索现有顶部导航组件实现和录音页面结构
    status: completed
  - id: analyze-header
    content: 分析复习模式MobileHeader组件的接口和样式实现
    status: completed
    dependencies:
      - explore-codebase
  - id: add-header-to-record
    content: 在录音页面移动端布局中引入MobileHeader组件
    status: completed
    dependencies:
      - analyze-header
  - id: configure-tab-switch
    content: 配置Tab切换逻辑，实现录音/复习模式路由跳转
    status: completed
    dependencies:
      - add-header-to-record
  - id: test-mobile-layout
    content: 测试移动端页面布局和导航功能
    status: completed
    dependencies:
      - configure-tab-switch
---

## 产品概述

修复MeetMind移动端录音页面缺少顶部导航栏的问题，为录音模式添加与复习模式一致的得到风格顶部导航栏，实现录音和复习两种模式之间的无缝切换。

## 核心功能

- 顶部导航栏：包含Logo、Tab切换按钮（录音/复习）、菜单按钮
- Tab切换：支持在录音模式和复习模式之间点击切换
- 视觉一致性：保持与现有复习模式顶部导航栏相同的设计风格
- 当前状态高亮：Tab切换时显示当前所在模式的激活状态

## 技术方案

### 现有项目分析

这是对现有项目的修复任务，需要在移动端录音页面添加已存在于复习模式的顶部导航组件。

### 修改范围

基于现有代码结构，主要修改录音模式的移动端布局文件，复用现有的顶部导航组件。

### 数据流

```mermaid
flowchart LR
    A[用户点击Tab] --> B[路由切换]
    B --> C{目标模式}
    C -->|录音| D[录音页面]
    C -->|复习| E[复习页面]
```

## 实现细节

### 核心目录结构

针对现有项目修改，仅展示需要修改的文件：

```
src/
├── components/
│   └── MobileHeader.tsx    # 复用：移动端顶部导航组件
└── pages/
    └── record/
        └── index.tsx       # 修改：录音页面添加顶部导航
```

### 关键代码结构

**顶部导航组件接口**：复用现有MobileHeader组件，传入当前激活的Tab状态

```typescript
interface MobileHeaderProps {
  activeTab: 'record' | 'review';
  onTabChange: (tab: 'record' | 'review') => void;
}
```

### 技术实现计划

1. 调研现有复习模式的MobileHeader组件实现
2. 在录音页面引入并配置MobileHeader组件
3. 确保Tab切换路由正确跳转
4. 测试移动端布局适配

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：探索现有项目结构，查找复习模式顶部导航组件的实现位置和代码结构
- 预期结果：定位MobileHeader组件文件路径，了解其props接口和使用方式