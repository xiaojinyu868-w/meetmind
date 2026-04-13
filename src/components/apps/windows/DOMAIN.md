# Workshop Windows — 应用窗口组件

> AI 原生应用的窗口化展示系统，包含思维导图、信息图、回响卡等可视化窗口。

## 目录结构

```
src/components/apps/windows/
├── WorkshopWindowManager.tsx    # 窗口管理器（多窗口协调）
├── MindmapWindow.tsx            # 思维导图窗口（692行，已拆分）
├── MindmapWindowLayout.ts      # 思维导图布局引擎（168行）
├── InfographicWindow.tsx       # 信息图窗口（699行，已拆分）
├── InfographicWindowData.ts    # 信息图数据处理（305行）
├── StudyReportWindow.tsx       # 听课报告窗口（家长视角专注度+掌握度报告）
├── EvidenceLabel.tsx           # 证据标签组件
└── index.ts                    # barrel 导出
```

## 已拆分的窗口

### MindmapWindow（思维导图）

- 主文件：`MindmapWindow.tsx`（692行）— 渲染逻辑
- 布局引擎：`MindmapWindowLayout.ts`（168行）— 树布局算法、主题色板、位置计算

布局引擎包含纯函数（可单元测试）：
- `getHueByDepth()` — 根据深度返回主题色
- `measureText()` — 文本宽度测量
- `getFontSize()` — 字体大小计算
- `buildLayoutTree()` — 构建树结构
- `subtreeHeight()` — 子树高度
- `assignPositions()` — 坐标分配
- `flattenLayout()` — 打平为渲染数组
- `boundingBox()` — 包围盒计算

### InfographicWindow（信息图）

- 主文件：`InfographicWindow.tsx`（699行）— 渲染逻辑
- 数据文件：`InfographicWindowData.ts`（305行）— 场景预设/风格预设/数据转换

## WorkshopWindowManager

负责多窗口的：
- 打开/关闭/层叠管理
- 窗口间通信
- 拖拽位置持久化（localStorage）

## 证据标签（EvidenceLabel）

将转录片段锚定到 AI 生成内容上，支持：
- 点击跳转到对应时间点
- 引用文本高亮
- 多标签折叠展开
