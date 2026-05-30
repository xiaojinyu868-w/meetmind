# 手机端 God File 抽离方案

> 版本：v1.0
>
> 日期：2026-05-31
>
> 状态：方案待执行（task #28 占位）

---

## 0. 背景

调查（`docs/MOBILE_INVESTIGATION.md` §5.1）：
`src/app/(main)/app/page.tsx` 总长约 2300 行，其中 **L1717-L2200 ≈ 480 行**是手机端独有的业务逻辑（`isMobile ? <MobileUI> : <DesktopUI>` 分支体）。
若把上下游引用一起算，手机端逻辑约 **900 行**散落在主页面。

后果：
- 手机端任意修改都要在 God file 里穿过桌面态判断 + state 回调地狱
- 每个手机端工程师都要先理解全文 2300 行才能改一行
- 改一处可能误伤桌面端，反之亦然
- 难以单元测试

目标：把手机端逻辑抽到 `src/components/mobile/` 下的独立 shell，让 page.tsx 只做"在桌面/手机间二选一"。

---

## 1. 抽离方案（4 阶段）

### 阶段 A：纯 UI 容器（低风险，高价值）

抽出仅依赖 props 的容器组件，**不动 state 管理**：

| 新文件 | 职责 | 抽离的 page.tsx 行数 |
|---|---|---|
| `src/components/mobile/MobileSubPages.tsx` | 顶层 mobileSubPage 路由器：根据 `mobileSubPage` 分发到 `'apps'` / `'tasks'` / `'ai-chat'` / `'ai-call'` 子页面 | ~120 |
| `src/components/mobile/MobileAppsSubPage.tsx` | apps 子页面（顶部 sticky 头部 + SharedWorkspacePanel('apps')） | ~30 |
| `src/components/mobile/MobileTasksSubPage.tsx` | tasks 子页面（顶部 sticky 头部 + ActionList） | ~30 |
| `src/components/mobile/MobileClassroomView.tsx` | viewMode='classroom' 下的整个手机端 layout（包括 ClassroomView 的 mobile 版） | ~100 |
| `src/components/mobile/MobileRecordView.tsx` | viewMode='record' 下的 collection 流（DedaoTimeline + MiniPlayer + Composer） | ~100 |
| `src/components/mobile/MobileReviewView.tsx` | viewMode='review' 下的时间线 / MiniPlayer / 应用入口 | ~120 |

每个组件接受**只读 props + 回调**。state 仍在 page.tsx 持有。

风险：低。可灰度（通过 feature flag 切换新旧实现）。

### 阶段 B：state 收敛（中等风险）

把手机端独有的 state 收到 `src/stores/mobile-shell-store.ts`：

```ts
interface MobileShellStore {
  mobileSubPage: 'apps' | 'tasks' | 'ai-chat' | 'ai-call' | null;
  mobileCollectionSheet: 'open' | 'closed';
  showMobileMenu: boolean;
  showMobileRecorder: boolean;
  showConversationHistory: boolean;
  // ...
  actions: {
    setMobileSubPage(...): void;
    openCollectionSheet(): void;
    // ...
  };
}
```

把 page.tsx 里 `mobileSubPage` 等 useState 替换为该 store 的订阅。

风险：中等。涉及 state 的迁移，可能有 race condition。

### 阶段 C：业务逻辑回调收敛（中等风险）

把手机端独有的回调函数（如 `onStartRecording` for mobile, `handleMobileSubPageBack`, `handleMobileAILaunch`）收到 `src/hooks/useMobileShell.ts`：

```ts
export function useMobileShell(deps: ShellDependencies) {
  const { state, actions } = useMobileShellStore();
  const onStartRecording = useCallback(() => { ... }, [...]);
  const onMobileSubPageBack = useCallback(() => { ... }, [...]);
  // ...
  return { state, actions, callbacks: { onStartRecording, ... } };
}
```

风险：中等。需要小心保留闭包语义。

### 阶段 D：page.tsx 简化（验收）

最终 page.tsx 里手机端入口只剩：

```tsx
{isMobile && (
  <MobileShell
    sessionId={sessionId}
    segments={segments}
    // ...其余必要 props
  />
)}
```

总减少 page.tsx 约 **800 行**，God file 缩到 ~1500 行。

---

## 2. 不在抽离范围内（永远留在 page.tsx 或共用 store）

- session / segments / anchors 等**桌面端也消费**的核心数据
- 鉴权、路由相关
- 全局 store（useUIStore 等）

---

## 3. 单元测试承诺

每个新抽出的组件 / hook 必须带测试：
- `MobileSubPages.test.tsx`：路由分发覆盖率 100%
- `mobile-shell-store.test.ts`：actions 行为
- `useMobileShell.test.ts`：闭包正确性 + 状态迁移

---

## 4. 灰度策略

```ts
const useNewMobileShell = featureFlag('mobile.shell.v2', { userId });

return useNewMobileShell
  ? <MobileShellV2 ... />
  : <LegacyMobileBranchInPage ... />;
```

新旧两套并存 1-2 周，监控 Sentry 错误率，无回归后删除旧分支。

---

## 5. 不在本期范围（后续迭代）

- MobileShell 内部进一步切分（比如 ClassroomView / RecordView / ReviewView 的状态机改造）
- 把 ClassCheckOverlay、ClassCheckToast 等条件渲染收进各自的容器组件
- 实时同桌（RealtimeTutorPanel）的手机端定制
- 手机端独有的快捷手势（双指缩放转写、长按词汇查询）

---

## 6. 执行顺序建议

1. **阶段 A** —— 1-2 个 PR，每 PR 抽 1-2 个容器组件（低风险，可立即看到 page.tsx 行数下降）
2. **阶段 B** —— 1 个 PR（store 抽离）
3. **阶段 C** —— 2 个 PR（hook 抽离 + 回调迁移）
4. **阶段 D** —— 验收 PR（page.tsx diff -800 行）

每个阶段独立可合并、可灰度、可回滚。
