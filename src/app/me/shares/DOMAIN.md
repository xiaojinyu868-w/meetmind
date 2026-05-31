# `src/app/me/shares/` — Domain

> v3.0 SharedAgent 的 **A 管理面**：让我看自己分享出去的所有内容、数据、撤销权。
>
> 设计文档：`roadmap/v3.0-virality-agent.md`
> API：`GET /api/share/me` + `DELETE /api/share/[token]`
> 入口：`ShareAgentCard` 创建成功后底部"管理我的分享"小字链接

## 目的

闭环的最后一公里：A 把分享递出去之后，要能：

1. **看到反馈**：每条分享被打开了几次 / 几个人聊过 / 几个人领走了——这是判断「这条分享值不值得发的依据」
2. **撤销后悔权**：不想要的分享一键关掉。已经领过的同学手里那份不变（snapshot 是当时刻一份）
3. **快速复用**：复制链接 / 看落地页快捷入口

没有这一层，A 把链接发出去就「失联了」——这违反 v3.0 战略文档的"撤销 / 隐私心安"原则。

## 文件清单

| 文件 | 职责 |
|---|---|
| `page.tsx` | Next.js 路由壳，渲染 `<MyShareList />` |
| `MyShareList.tsx` | 客户端列表：拉 `/api/share/me` → 渲染卡片 → 撤销 / 复制 / 跳落地页 |

## UI 元素

- 头部：Octo Buddy（happy）+「我递出去的分享」+ 副标题"谁打开了 · 谁聊过 · 谁领走了"
- 列表项：状态徽章（已发布 / 已撤销）+ 产物类型 + 标题 + 三个数字（viewCount / chatCount / claimCount）+ 三个动作（看落地页 / 复制链接 / 撤销）
- 撤销时弹 `window.confirm`，让 A 确认副本不会被影响
- 已撤销项 opacity 60%，不再展示动作

## 隐私铁律提示（页脚）

页面底部固定显示一句：
> 分享只带这节课的内容和你挑的产物，不会带你的私人对话或答题数据。
> 撤销后已经领过的同学手里那份不变（snapshot 是当时刻一份）。

这是给 A 的"心安声明"。撤销前看到这句话，心理负担会小很多。

## 不在这里做

- **创建分享的入口**：在 `OctoCrystalDispatcher`（应用矩阵）+ `useShareAgentCreator`
- **业务逻辑**：在 `src/lib/services/share-agent-service.ts`
- **落地页 UI**：在 `src/app/share/[token]/`
