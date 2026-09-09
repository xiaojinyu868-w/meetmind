import { sharedContextCopy } from '@/lib/ui/shared-context-copy';
# 共享 Context 管理

`SharedContextPanel.tsx`：登录用户的学习画像入口。首屏自动展示当前空间中有来源的模型理解；下方为紧凑学习轨迹和任务试读。补充自述、空间切换和授权放入次级展开区。只依赖 hook、公共类型和 COPY，接口调用集中在 `hooks/useSharedContext.ts`，SDK 不依赖 UI。

`ContextPortrait.tsx` 展示真实 recall 结果和来源按钮；不将计数或虚构掌握度作为画像。空数据、整理中、服务降级分别显示。此视图是任务检索结果，不承诺覆盖所有经历或已解决矛盾。`ContextEvidenceDialog.tsx` 用原生 modal dialog 展开完整证据，提供键盘焦点隔离、Escape 关闭和返回原触发点。轨迹不直接输出长 JSON，原文在弹层保留。

补充更新仍是 user.note 自述，不能保证覆盖旧推断；明确不再适用的来源可暂停。整理完成后通过刷新更新画像。分页轨迹只含已加载记录，不显示虚假的总数。文案由 `src/lib/ui/shared-context-copy.ts` 定义，经 sharedContextCopy 统一导出。

初版独立 `/context` 页面，便于与旧「我的上下文」区分验证；没有静默迁移旧画像。未配置 Hindsight 时明确显示服务未就绪和原始观察。忘记要求用户确认一次；应用凭证只保留当前组件内存，换用户/退出即清空。

来源按钮按 ID 拉取完整原文，支持不在当前分页内的证据；暂停/忘记会清空已展示的检索和原文。cleanupPending 有独立状态说明，避免把停止参考等同于上游已彻底移除。

沿用 paper/card/pine/ink/divider 设计 token，中文文案集中于 `sharedContextCopy`。

画像按所引用来源的最近时间排序，首屏显示三条，其余可展开（仅展示折叠，不删除检索结果）。Hindsight 正文中的 When/Involving 尾注移入完整表述折叠区，原始文字保留。排序不代表已解决新旧理解冲突，也不把检索卡片当成永久标签。
