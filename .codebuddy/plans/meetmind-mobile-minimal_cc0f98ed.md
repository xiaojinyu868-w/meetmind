---
name: meetmind-mobile-minimal
overview: 优化移动端为得到风格极简界面：播放器压缩为单行（播放按钮+时间+进度条+困惑点标记），采用金色暖调配色，移除重复Header，最大化时间轴内容区域。
design:
  architecture:
    framework: react
  styleKeywords:
    - 极简主义
    - 知识感
    - 金色暖调
    - 得到风格
    - 内容优先
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 18px
      weight: 600
    subheading:
      size: 15px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#D4A574"
      - "#C49A6C"
      - "#8B7355"
    background:
      - "#FBF9F7"
      - "#FFFFFF"
      - "#F5F0EB"
    text:
      - "#3D3D3D"
      - "#666666"
      - "#999999"
    functional:
      - "#E8D4BC"
      - "#D4A574"
      - "#52C41A"
      - "#FF4D4F"
todos:
  - id: explore-codebase
    content: 使用[subagent:code-explorer]探索现有移动端播放器组件和页面布局结构
    status: completed
  - id: create-theme
    content: 创建得到风格金色暖调配色主题变量
    status: completed
    dependencies:
      - explore-codebase
  - id: create-mini-player
    content: 开发单行极简播放器组件（含进度条和困惑点标记）
    status: completed
    dependencies:
      - create-theme
  - id: create-tab-switch
    content: 实现App风格的录音/复习Tab切换组件
    status: completed
    dependencies:
      - create-theme
  - id: optimize-layout
    content: 重构移动端页面布局，移除重复Header并最大化内容区域
    status: completed
    dependencies:
      - create-mini-player
      - create-tab-switch
  - id: integrate-components
    content: 整合所有组件并进行移动端适配测试
    status: completed
    dependencies:
      - optimize-layout
---

## 产品概述

对MeetMind移动端界面进行极简风格优化，参考得到App的知识感设计语言，采用金色暖调配色方案。核心目标是最大化内容展示空间，将播放器压缩为单行设计，移除冗余元素。

## 核心功能

- **极简播放器**：单行设计，包含播放/暂停按钮、当前时间/总时长、进度条及困惑点标记，占用最小垂直空间
- **得到风格配色**：采用金色暖调主色，营造知识感和品质感的视觉体验
- **优化页面布局**：移除重复Header，最大化时间轴和内容区域的展示空间
- **App风格切换**：录音/复习Tab切换采用更贴近原生移动App的交互设计

## 技术栈

- 前端框架：React + TypeScript（复用现有项目技术栈）
- 样式方案：Tailwind CSS
- 组件库：基于现有组件进行优化

## 技术架构

### 系统架构

基于现有MeetMind项目架构进行局部优化，不引入新的架构模式。主要涉及移动端组件的样式重构和布局调整。

### 模块划分

- **播放器模块**：重构为单行极简设计，整合播放控制、时间显示、进度条和困惑点标记
- **导航模块**：优化Tab切换组件，实现App风格的录音/复习切换
- **布局模块**：移除重复Header，重新规划页面垂直空间分配

### 数据流

用户交互 -> 播放器状态更新 -> UI响应渲染（保持现有数据流，仅优化展示层）

## 实现细节

### 核心目录结构

仅展示需要修改或新增的文件：

```
src/
├── components/
│   ├── MiniPlayer.tsx          # 新增：单行极简播放器组件
│   └── MobileTabSwitch.tsx     # 新增：App风格Tab切换组件
├── app/
│   └── record/
│       └── [id]/
│           └── page.tsx        # 修改：移动端布局优化
└── styles/
    └── globals.css             # 修改：添加得到风格配色变量
```

### 关键代码结构

**MiniPlayer组件接口**：单行播放器的核心属性定义，包含播放状态、时间信息、进度控制和困惑点数据。

```typescript
interface MiniPlayerProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  confusionPoints: number[];  // 困惑点时间戳数组
  onPlayPause: () => void;
  onSeek: (time: number) => void;
}
```

**配色系统常量**：得到风格金色暖调配色方案定义。

```typescript
const DEDAO_THEME = {
  primary: '#D4A574',      // 金色主色
  secondary: '#8B7355',    // 深棕辅助色
  background: '#FBF9F7',   // 暖白背景
  text: '#3D3D3D',         // 深灰文字
  accent: '#E8D4BC',       // 浅金强调色
};
```

### 技术实现要点

1. **播放器压缩**：使用flex布局实现单行排列，进度条采用自定义样式支持困惑点标记叠加显示
2. **配色迁移**：通过CSS变量和Tailwind自定义配置实现金色暖调主题
3. **空间优化**：移除重复Header后，使用calc()动态计算内容区域高度
4. **Tab切换**：实现底部固定式Tab栏，带滑动指示器动画效果

## 设计风格

参考得到App的知识感极简设计，采用金色暖调配色营造温暖、专业、有品质的阅读/学习氛围。整体风格简洁克制，突出内容本身。

## 页面设计

### 录音详情页（移动端优化）

**顶部区域**

- 移除重复Header，仅保留必要的返回按钮和标题
- 标题采用单行显示，溢出时省略处理
- 高度压缩至44px

**Tab切换区**

- 底部固定式设计，录音/复习两个Tab
- 选中态使用金色下划线指示器，带滑动动画
- 采用圆角胶囊按钮风格，符合移动端操作习惯

**极简播放器（单行设计）**

- 固定在Tab切换下方，高度48px
- 左侧：播放/暂停圆形按钮（32px）
- 中间：进度条区域（flex-1），进度条上叠加显示困惑点标记（金色圆点）
- 右侧：时间显示（当前/总时长），采用等宽数字字体
- 背景使用浅金色，与内容区形成视觉层次

**时间轴内容区**

- 占据剩余全部空间，支持滚动
- 时间戳采用金色小标签样式
- 内容卡片使用暖白背景、轻微圆角和细微阴影
- 困惑点高亮使用浅金色背景标记

## 代码探索

### SubAgent

- **code-explorer**
- 用途：探索现有移动端播放器组件结构、样式定义和布局实现
- 预期结果：获取当前播放器组件代码、样式文件位置及页面布局结构，为重构提供基础