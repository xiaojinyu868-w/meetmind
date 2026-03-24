# Stores — 全局客户端状态

> Zustand 状态管理。组件和 hooks 通过 selector 订阅。

## 依赖规则

```
components/hooks → stores → types
```

- ✅ stores 可以 import `types/`
- ❌ stores 不能 import `components/`, `hooks/`, `lib/services/`

## 文件索引

| 文件 | 行数 | 职责 | 核心 export |
|------|------|------|------------|
| `ui-store.ts` | 103 | 全局 UI 状态 | `useUIStore`, `useViewMode`, `useReviewTab`, `useMobileSubPage`, `useUIActions` |
| `player-store.ts` | 54 | 音频播放器状态 | `usePlayerStore`, `useIsPlaying`, `useCurrentTime`, `usePlayerActions` |
| `index.ts` | 30 | barrel 导出 | re-export 全部 |

## 使用约定

1. **始终用 selector** 订阅（`useUIStore(s => s.viewMode)`），不要 `useUIStore()` 全量订阅
2. 新增全局状态前先确认不能用 React state 或 URL params 解决
3. Store 不做异步操作（异步逻辑放在 hooks 或 services 中）
