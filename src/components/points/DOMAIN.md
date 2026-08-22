# points/ — 积分系统前端（Phase 2）

> 余额可见、扣费拦截提示、ASR 录课前预检、设置页积分区块。
> 后端契约见 `AGENTS.md` 任务输入与 `src/hooks/usePointsSummary.ts` 头注；
> 未登录 guest 没有积分概念，所有积分 UI 静默隐藏。

## 文件索引

| 文件 | 职责 |
|------|------|
| `PointsChip.tsx` | App 头部安静的积分 chip（墨绿小点 + 等宽数字，无金币风；Pro/Max 会员带档位标）；点击展开小面板：余额、本月免费录课剩余分钟、「开通会员/升级/续费 + 充积分」直达按钮（唤起 PaywallDialog，一级页面可达）、近 5 笔流水、去设置的入口。挂载在 `Header.tsx`（仅登录态渲染） |
| `PointsSettingsSection.tsx` | 设置页「积分」区块：会员卡（档位 + 到期日 + 开通/升级/续费 CTA → 唤起 PaywallDialog 会员 Tab）、当前余额（+ 充积分入口）、免费录课分钟进度条（分母按档位取 `asrFreeMinutesPerMonth`）、最近流水（默认 3 条，其余收进「查看全部 N 条记录」展开器，上限 20——避免每次用 AI 都把设置页拉长）。挂载在 `src/app/(auth)/settings/page.tsx` |
| `PaywallDialog.tsx` | 高意向付费拦截页（v9 呼吸森林：光场 + 玻璃卡 + serif 标题）：「会员 \| 充积分」双 Tab——会员 Tab 展示 Pro/Max 两卡（权益按 plan 字段条件渲染，无空心权益），积分 Tab 3 档套餐；数据 GET /api/pay/packs（packs + membershipPlans）→ 微信 Native 扫码（POST /api/pay/recharge → code_url 转 QR）→ 轮询 `/api/pay/order/[outTradeNo]` 到账庆祝（会员档显示档位开通而非积分）。微信支付未配置时 CTA 置灰显示"即将开通"。挂载于 `app/page.tsx` 与 `settings/page.tsx`，由 `usePaywall` 唤起 |
| `points-format.ts` | 流水 reason 标签与时间格式化的共享纯函数（COPY 驱动） |

## 依赖方向

```
points/ → hooks/usePointsSummary（数据）+ lib/ui/copy（文案）
```

- 组件不含业务逻辑：402 识别与文案在 `src/hooks/points-guard.ts`，取数在 `src/hooks/usePointsSummary.ts`
- 扣费成功 / 402 拦截后由各 fetch 入口调 `notifyPointsChanged()`，chip 与设置页静默刷新

## 相关入口（不在本目录）

- 402 拦截接线：`src/hooks/useClassroomCompanion.ts`（Tutor 对话 + 内联应用）、`src/components/apps/hooks/useAppExecution.ts`、`src/components/apps/WorkshopYellowPage.tsx`——insufficient_points 时除安静文案外同步唤起 Paywall（guest 限额/月熔断不弹）
- ASR 预检：`src/hooks/useAsrQuotaPrecheck.ts`，由 `useRecordingLifecycle.handleRecordingStart` 在开新课时调用；服务端强制预检在 `server.js` ASR WS 连接时打内部 `/api/points/precheck-asr`，拒绝码 `ASR_QUOTA_EXCEEDED` / `GUEST_DAILY_ASR_CAP` 由 `resolvePendingAudioFailureStatus` 与 `useVoiceInput` 映射为安静文案，QUOTA_EXCEEDED 同时唤起 Paywall
- `src/lib/hooks/fetchUIMessageStream.ts`：Error 上附带 `status`/`body`，402 时才能拿到 balance/required
