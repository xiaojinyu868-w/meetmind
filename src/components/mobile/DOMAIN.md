# Mobile — 移动端专用组件

> 手机端 UI 组件，基于 Tailwind 响应式，在桌面端不渲染。

## 依赖规则

同 `components/` 顶层：可用 hooks/stores/types/lib/utils，不可直接 import services。

## 文件索引

| 文件 | 职责 |
|------|------|
| `index.ts` | barrel 导出 |
| `MobileLayout.tsx` | 移动端整体布局容器 |
| `MobileMenu.tsx` | 移动端菜单 |
| `MobileTabSwitch.tsx` | 底部 tab 切换 |
| `MobileTimeline.tsx` | 移动端收集流时间线 |
| `MobileAIFab.tsx` | 移动端 AI 浮动按钮 |
| `MiniPlayer.tsx` | 迷你音频播放器 |
| `MenuDrawer.tsx` | 侧边抽屉菜单 |
| `BottomPanel.tsx` | 底部面板 |
| `ConfusionCard.tsx` | 困惑点卡片 |
| `PodcastPlayer.tsx` | 播客播放器（导出 `ConfusionMarker` 类型） |
| `DedaoConfusionCard.tsx` | 得到风格困惑卡片 |
| `DedaoMenu.tsx` | 得到风格菜单（含游客/登录态统一设置入口） |
| `DedaoTimeline.tsx` | 得到风格时间线 |

## 注意

- `PodcastPlayer.tsx` 导出的 `ConfusionMarker` 类型被 `session-store` 引用
- Dedao 系列组件是得到 App 风格的替代 UI 方案
- `MobileCollectionSheet.tsx`、`MobileTopBar.tsx`、`MobileRecordTopBar.tsx`、`MobileAIChatHeader.tsx`、`MobileAIChatPanel.tsx` 是 page 拆分模板：适合承接移动端大块条件渲染 UI；其中 AI Chat 头部与面板现在同时承担"聊天页 → 语音同桌二级通话页"的动线切换，但不要把业务逻辑和数据获取塞回组件里
- `DedaoMenu.tsx` 现在承担移动端统一"设置"入口：游客和登录用户都能进 `settings`，个人资料不再单独挂在菜单里
