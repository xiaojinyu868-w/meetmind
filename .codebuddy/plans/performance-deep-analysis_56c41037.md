---
name: performance-deep-analysis
overview: 深入分析并优化 MeetMind 首页和复习页面加载缓慢的问题，包括"加载中..."等待时间过长和"加载音频..."过慢两个核心问题。
todos:
  - id: explore-homepage
    content: 使用 [subagent:code-explorer] 深入分析首页组件结构和数据加载流程
    status: completed
  - id: explore-review-audio
    content: 使用 [subagent:code-explorer] 分析复习页面音频加载机制和相关代码
    status: completed
  - id: diagnose-homepage
    content: 诊断首页性能瓶颈并输出详细分析报告
    status: completed
    dependencies:
      - explore-homepage
  - id: diagnose-audio
    content: 诊断音频加载性能瓶颈并输出详细分析报告
    status: completed
    dependencies:
      - explore-review-audio
  - id: optimize-homepage
    content: 实施首页加载性能优化方案
    status: completed
    dependencies:
      - diagnose-homepage
  - id: optimize-audio
    content: 实施音频预加载和缓存优化方案
    status: completed
    dependencies:
      - diagnose-audio
  - id: verify-performance
    content: 验证优化效果并输出性能对比报告
    status: completed
    dependencies:
      - optimize-homepage
      - optimize-audio
---

## 产品概述

MeetMind 应用存在两个核心性能问题需要深入分析和优化：首页加载时显示"加载中..."等待时间过长，以及复习模式下"加载音频..."速度过慢。之前已进行过代码分割优化但问题仍然存在，需要从根本上诊断和解决这些性能瓶颈。

## 核心功能

- **首页加载性能分析**：诊断首页初始化过程中的性能瓶颈，包括数据获取、组件渲染、资源加载等环节
- **音频加载优化**：分析复习页面音频资源加载链路，识别网络请求、音频解码、缓存策略等方面的问题
- **性能监控与度量**：建立性能基准指标，量化优化前后的加载时间差异
- **优化方案实施**：针对诊断出的问题实施具体的优化措施，如懒加载、预加载、缓存策略等

## 技术栈

- 基于现有项目技术栈进行分析和优化
- 性能分析工具：Chrome DevTools Performance、Network、Lighthouse
- 代码分析：React Profiler、Bundle Analyzer

## 技术架构

### 性能问题诊断流程

```mermaid
flowchart TD
    A[性能问题诊断] --> B[首页加载分析]
    A --> C[音频加载分析]
    
    B --> B1[网络请求分析]
    B --> B2[JS执行时间分析]
    B --> B3[组件渲染分析]
    B --> B4[数据获取链路分析]
    
    C --> C1[音频资源请求分析]
    C --> C2[音频文件大小分析]
    C --> C3[预加载策略分析]
    C --> C4[缓存策略分析]
    
    B1 --> D[问题定位]
    B2 --> D
    B3 --> D
    B4 --> D
    C1 --> D
    C2 --> D
    C3 --> D
    C4 --> D
    
    D --> E[优化方案制定]
    E --> F[优化实施]
    F --> G[性能验证]
```

### 模块划分

- **诊断模块**：负责收集和分析性能数据，定位具体瓶颈
- **首页优化模块**：针对首页加载问题的具体优化实现
- **音频优化模块**：针对音频加载问题的具体优化实现
- **监控模块**：建立性能指标监控，验证优化效果

### 数据流分析重点

1. **首页加载链路**：应用启动 → 路由初始化 → 数据请求 → 组件渲染 → 首屏展示
2. **音频加载链路**：页面进入 → 音频URL获取 → 音频资源请求 → 音频解码 → 播放就绪

## 实施细节

### 核心目录结构（待分析）

```
project-root/
├── src/
│   ├── pages/
│   │   ├── Home/           # 首页相关组件
│   │   └── Review/         # 复习页面相关组件
│   ├── components/         # 公共组件
│   ├── services/           # API服务层
│   ├── hooks/              # 自定义hooks
│   └── utils/              # 工具函数
```

### 关键分析点

**首页性能分析**：

- 初始数据获取时序和并发策略
- 组件树深度和渲染开销
- 第三方依赖加载影响
- 状态管理初始化开销

**音频加载分析**：

- 音频文件大小和格式
- CDN/服务器响应时间
- 是否存在预加载机制
- 浏览器音频缓存策略

### 技术实施方案

1. **问题诊断**：深入代码审查，定位具体性能瓶颈
2. **数据获取优化**：优化API请求策略，减少阻塞式加载
3. **音频预加载**：实现智能预加载和渐进式加载
4. **缓存策略**：建立有效的数据和资源缓存机制
5. **渲染优化**：减少不必要的重渲染，优化关键渲染路径

### 性能指标目标

- 首页首屏加载时间：< 2秒
- 音频加载就绪时间：< 1秒
- 用户可交互时间（TTI）：显著降低

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：深入探索MeetMind项目代码库，分析首页和复习页面的实现逻辑、数据获取流程、组件结构和音频加载机制
- 预期结果：全面了解现有代码架构，定位具体的性能瓶颈代码位置和原因