# /api/pay — 积分充值（微信 Native 扫码支付）

> 订单编排与到账逻辑在 `src/lib/services/recharge-order-service.ts`；
> 微信支付 APIv3 封装（下单/验签/解密）在 `src/lib/services/wechat-pay-service.ts`；
> 充值包面额唯一数值真相源在 `src/lib/config/pricing.ts`（RECHARGE_PACKS）。
> env 六项（WECHAT_PAY_MCHID/APPID/APIV3_KEY/SERIAL_NO/PRIVATE_KEY/PLATFORM_CERT_PEM）
> 缺任意一项 → 充值入口 503 pay_unavailable；回调地址 WECHAT_PAY_NOTIFY_URL 缺省取
> WECHAT_MP_PUBLIC_BASE_URL + /api/wechat/pay-notify。

## 路由

| 路由 | 方法 | 鉴权 | 职责 |
|------|------|------|------|
| `/api/pay/packs` | GET | 公开（public-routes 白名单） | 返回 `{ packs: RechargePack[], membershipPlans: MembershipPlan[] }`（积分包 + Pro/Max 会员档）；PaywallDialog 客户端拉取（避免 pricing.ts 的 pino 依赖进浏览器 bundle） |
| `/api/pay/recharge` | POST | Bearer（限流 wechatQr 档） | body `{ packKey }`（积分包或 `pro-monthly`/`max-monthly` 会员档）→ 落 pending 订单（金额/积分快照，+30min 过期）→ 微信 Native 下单。200 `{ outTradeNo, codeUrl, amountFen, points, membership? }`（会员档 points=0 带 `{ tier, days }`）；packKey 非法 400 `invalid_pack`；微信支付未配置/下单失败 503 `pay_unavailable`（订单置 failed 留痕） |
| `/api/pay/order/[outTradeNo]` | GET | Bearer（限流 wechatQrPoll 档） | 订单状态轮询，仅限本人 → `{ status, points, amountFen, packKey }`（status: pending\|paid\|expired\|failed）；他人/不存在 404；超期 pending 惰性置 expired。**pending/expired 时先 `syncOrderFromWeChat` 主动向微信查单兑账**（回调丢失/延迟的第二通道；微信确认 SUCCESS 且金额/mchid 匹配即到账，绕过本地过期——已付的钱必须能兑回），查单失败静默降级为本地状态 |
| `/api/wechat/pay-notify` | POST | 平台证书验签（public-routes 白名单，无 Bearer） | raw body → APIv3 验签 → AES-256-GCM 解密 → 校验 out_trade_no/mchid/amount.total 与本地快照一致 → `markOrderPaidAndGrant` 单事务到账（**本地已过期订单微信确认 SUCCESS 仍到账**——expired 只约束二维码有效期，只拒 failed 终态）→ best-effort 客服消息通知。成功 `{ code: 'SUCCESS' }`；验签失败 401；订单不存在 404 / 不可支付或金额不符 400 / 内部错误 500（微信按策略重推） |

## 到账链路

```
微信服务器回调 /api/wechat/pay-notify
  → verifyNotifySignature（平台证书 PEM 由 env 注入，不实现证书自动下载，到期手动轮换）
  → decryptNotifyResource（APIv3 key AES-256-GCM）
  → markOrderPaidAndGrant（单事务：订单 pending/expired 且金额一致
     （本地 expired 只约束二维码有效期，微信确认 SUCCESS 必须兑账）
     → 置 paid → PointTransaction kind='earn' reason/refType='recharge'
       幂等键 recharge:{outTradeNo} → PointAccount balance/totalEarned 增加）
  → 重复回调：订单已 paid 或 P2002 → duplicate 幂等成功，不重复加分
    （P2002 兜底回查订单拿 userId，会员档无流水也能发到账通知）
  → 金额不一致：拒绝并 log.error（防伪造）
```

到账后 `notifyRechargePaidBestEffort` 按 userId 查 AuthProvider(provider='wechat') 的 openId
推客服消息；48h 窗口外（45015）/未绑定/推送失败都静默跳过，不阻塞回执。

## 充值包（pricing.ts RECHARGE_PACKS）

| packKey | amountFen | points |
|---------|-----------|--------|
| starter | 990 | 400 |
| standard | 2990 | 1400 |
| scholar | 6990 | 4000 |

## 会员档（pricing.ts MEMBERSHIP_PLANS，共用 RechargeOrder 链路）

| packKey | tier | amountFen | days | 免费分钟/月 | 月发放积分 | 权益 |
|---------|------|-----------|------|------------|-----------|------|
| pro-monthly | pro | 3900 | 31 | 2000 | 800 | deep 模式解锁 |
| max-monthly | max | 7900 | 31 | 6000 | 2000 | deep 解锁 + 应用 8 折 + 优先模型 |

会员档到账分发：`markOrderPaidAndGrant` 按 packKey 查 MEMBERSHIP_PLANS，命中则
updateMany 原子占位（pending→paid，并发重推安全）+ `grantMembershipInTx` upsert
Membership（续期从 max(now, expiresAt) 叠加天数，换档=档位覆盖+时长叠加），
不加积分余额、不写积分流水。到期读时判断回落免费档，无定时任务。
