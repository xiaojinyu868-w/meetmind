# Data Hooks — 数据获取 hooks

> 封装 SWR/API 调用的数据 hooks，供组件层使用。

## 依赖规则

```
components → hooks/data → lib/services + stores + types
```

- ✅ data hooks 可以调用 `lib/services/`、`stores/`、`types/`
- ❌ 不可 import `components/`

## 文件索引

| 文件 | 职责 |
|------|------|
| `index.ts` | barrel 导出 |
| `useSession.ts` | 课堂会话数据（创建/加载/恢复） |
| `useSummary.ts` | 摘要生成与 IndexedDB 缓存 — classSummary 仍被 AITutor / WorkshopYellowPage 消费 |
| `useTopics.ts` | 精选片段生成 — ⚠️ UI 面板已移除，page.tsx 中的调用方可清理 |
| `useTranscript.ts` | 转录数据管理 |
| `useTutor.ts` | AI Tutor 数据交互 |
