# `src/app/share/` — Domain

> v3.0 SharedAgent 公开落地页路由。
>
> 设计文档：`roadmap/v3.0-virality-agent.md`
> API：`src/app/api/share/`

## 目的

班里同学点开"Alice 分享给你的一节课"链接后落到这里。任何浏览器、不需要登录就能看；登录后可以「领取到我的工作台」并继续在自己的环境里跟同学聊。

这是产品的**裂变面**——95% 的访问者第一次接触 MeetMind 就是这个页面。访问体验决定 K 系数。

## 路由

```
/share/[token]
```

`token` 是 12 字符 URL-safe，由 `share-agent-service.ts#generateShareToken` 生成。

## 文件清单

| 文件 | 职责 |
|---|---|
| `[token]/page.tsx` | Next.js 路由壳，`force-dynamic` runtime |
| `[token]/SharedAgentLanding.tsx` | 落地页主体 UI（client component） |
| `[token]/SharedAgentChat.tsx` | 嵌入对话面板，走 `/api/tutor/agent` mode='shared' |

## 数据流

```
访问者打开 /share/[token]
  → SharedAgentLanding mount
  → fetch GET /api/share/[token]（带可选 Authorization）
  → 渲染分享者 / 课名 / 转录摘要 / artifact 预览
  → 若 conversationEnabled → 挂载 SharedAgentChat
       → useChat({ transport: DefaultChatTransport→/api/tutor/agent })
       → body: { mode: 'shared', shareToken, ... }
       → 服务端 buildTutorSystemPrompt('shared', context) 拼 prompt
       → 流式回答（不读访问者画像，不读原作者对话历史）
  → 用户点「领取到我的工作台」
       → 未登录：跳 /login?next=/share/[token]
       → 已登录：POST /api/share/[token]/claim → toast → 落地页保留
  → 用户点「也分享给别人」
       → navigator.share / clipboard.writeText
```

## Taste 约束

- **匿名可读 / 可对话**：登录不是入场券，是付费墙之前的功能
- **领取按钮粘底但不喧宾夺主**：sticky bottom-3 footer，圆角 + 阴影克制
- **Octo Buddy 始终在场**：mood='happy'（默认） / 'thinking'（流式中） / 'surprised'（404）
- **没有"X 个同学正在看"这类大字提示**：viewCount 只在底部一行极淡显示

## 与 god file 的关系

落地页**完全独立**于 `src/app/(main)/app/page.tsx`。这是有意为之——避免 SharedAgent 链路的复杂度被卷进 god file 的提取迁移。

未来如果我们要在分享链接打开后让访问者能用更完整的"工作台预览"（含真实 cheatsheet UI / mindmap interaction），可以引入 `AppRenderSurface` 复用既有应用矩阵；但要保证它在 shared 态是 **read-only render**，不会回写任何东西到原作者 workspace。

## 不在这里做

- **创建分享**：见 `src/components/share/ShareAgentCard.tsx` + 上层调用方
- **业务规则**：见 `src/lib/services/share-agent-service.ts`
- **API 契约演化**：见 `src/app/api/share/DOMAIN.md`
