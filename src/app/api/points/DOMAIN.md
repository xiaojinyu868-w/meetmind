# /api/points — 积分系统（Phase 2：真扣费）

> 账户与结算逻辑全部在 `src/lib/services/point-account-service.ts`；
> 价目数值唯一真相源在 `src/lib/config/pricing.ts`（POINTS_CONFIG / getTutorModePrice / getAppExecPrice）。
> 影子计量（Phase 1，`point-meter.ts`）继续只记真实成本（costMilliYuan），真扣费流水 costMilliYuan=0 防双算。

## 路由

| 路由 | 方法 | 鉴权 | 职责 |
|------|------|------|------|
| `/api/points/summary` | GET | Bearer | 账户总览：`{ balance, totalEarned, totalSpent, asrFreeMinutesRemaining, asrFreeMinutesPerMonth, asrPricePerMinute, monthCostMilliYuan, monthCostCapMilliYuan, membership: { tier, expiresAt }, recentTransactions[≤20] }`。首次访问懒建账户并发放欢迎积分 +200（一次性）与当月活跃（按月+档位幂等：free 150 / pro 800 / max 2000） |
| `/api/points/asr-quota` | GET | Bearer | ASR 录课免费额度：`{ asrFreeMinutesRemaining, balance, asrPricePerMinute }`；录课前预检用，同样落实懒建与发放 |
  - 分钟结算同样覆盖播客/视频导入：`/api/video/import` 成功转写后按转写时长调用 `settleAsrMinutes`（reason=`asr:import`，connectionId=`video-import:{baseName}`），与录课共享同一免费额度池；结算失败只 warn 不阻塞导入 |
| `/api/points/settle-asr` | POST | `x-internal-secret`（env `INTERNAL_API_SECRET`） | 内部接口：server.js 的 `/api/asr-stream` WS 代理在连接关闭时按连接时长回调。分钟向上取整 → 先吃当月免费额度（按会员档位 300/2000/6000 分钟）→ 超出按 3 积分/分钟扣。token（WS URL `?token=` 的 JWT）有效则按用户结算；匿名只记影子流水不扣分。env 未配置时 503（server.js 同步跳过） |

## 扣费契约（全站统一）

- 扣费拦截一律 `HTTP 402`，body `{ "error": "insufficient_points" | "monthly_cost_cap" | "membership_required", "balance": number, "required": number, "requiredTier"?: string }`
- 语义：预检（余额 ≥ 价格 + 月成本 < 50000 毫元熔断）→ 执行 → 成功后 `spendPoints` 原子结算（余额校验 + 扣减 + 写流水含 balanceAfter，幂等键防重）
- guest（无 Bearer）不介入积分，维持现有 rate-limit 行为
- 扣费点不在本目录：`/api/tutor/agent`（review / global deep 5 积分/轮；deep 档另有会员闸门：免费档 402 `membership_required`，Max 档 quick 路由主模型）、`/api/apps/execute`（按 appKey 5-20 积分/次，Max 档 8 折）
- 充值入口（earn 侧）在 `/api/pay/recharge` + `/api/wechat/pay-notify`（refType='recharge'，幂等键 `recharge:{outTradeNo}`），详见 `src/app/api/pay/DOMAIN.md`
- 管理端调账：`POST /api/admin/points/adjust`（admin 鉴权同 `/api/analytics/stats`），`{ userId, delta, reason }` → kind='adjust' 留痕，不允许调成负余额

## ASR 分钟结算链路

```
前端 dashscope-asr-service（WS URL 带 ?token=<JWT>，guest 不带）
  → server.js /api/asr-stream 代理（连接关闭且有真实音频流过才结算）
  → POST 127.0.0.1:<PORT>/api/points/settle-asr（x-internal-secret）
  → settleAsrMinutes（幂等键 asr:{userId}:{connectionId}，免费额度内 delta=0 只记 quantity）
```

免费额度量纲在 `PointTransaction.quantity`（分钟数）；当月剩余 = 档位额度（free 300 / pro 2000 / max 6000，见 pricing.ts MEMBERSHIP_PLANS）− Σquantity(refType='asr')。
付费分钟余额不足时按可用余额截断（音频已转完无法撤回，warn 留痕），不扣成负数。
