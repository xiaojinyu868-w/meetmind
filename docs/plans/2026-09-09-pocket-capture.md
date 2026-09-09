# 口袋（Pocket）——把"收进来"这一层按最好的产品重做

> 2026-09-09。对标：Raycast / ChatGPT 桌面端（一键、任何应用里都能用）、Apple 快速备忘录
>（收下的东西带着"从哪来"，回到那个地方它还在）、Drafts（先收再整理，收件箱是一条流不是文件夹树）、
> CleanShot X（截图是框选一块，不是整屏）、Yoink / Dropover（任何能拖的东西都有地方可放）、
> Readwise（每条摘录带来源，并且会变成复习材料）。MeetMind 比它们多的一件事：**收进来的东西被同学读过**——
> 进今日情报、进问同学的书桌、进课后应用、进长期记忆。口袋不是仓库，是"你今天指过的东西，同学都看过了"。

## 一句话

**任何应用里选中，一个键，收下；拖进来，收下；截一块，收下。** 每一条自带来源（哪个应用、哪个窗口、哪个网址），
格式不丢（加粗 / 列表 / 代码块 / 公式 TeX），落进同一条收集流，同学立刻能读。

## 入口（桌面壳）

| 动作 | 行为 |
|---|---|
| 选中文字 → `⌘⇧M` | 模拟一次复制读系统剪贴板（文字 + HTML + 网址书签），**还原你原来的剪贴板**，POST `/api/workspace/clip` |
| 剪贴板里是图 → `⌘⇧M` | 收图（截图工具刚截的那张） |
| 没选中 → `⌘⇧M` | 进入**框选截图**：全屏冻结画面 + 十字光标，拖一块；Esc 取消，双击整屏 |
| 拖任何东西到桌宠 / 口袋窗 | 文字 / HTML / 网页图片（URL）/ 图片文件 / 网址 → 收 |
| `⌘⇧K` | 口袋窗：今天收的东西按来源成组的一条流 + 底部一行（记 / 问）；本身也是拖放与粘贴目标 |

每次收下：光标旁一张 1.6s 的小回执（不抢焦点）——图标 + 第一行 + 来源 + 「撤销」；桌宠吞一口。
失败：系统通知；未登录：打开主窗口；离线：文字进 `pending-clips.json`、图进 `pending-shots/`，启动补传。

## 来源（有根）

热键那一刻取：前台应用名、窗口标题、浏览器当前网址（macOS：Chrome / Edge / Arc / Brave / Safari 用 AppleScript 问；
Windows：PowerShell 取前台窗口标题）。服务端据此打 `platformLabel`（chatgpt.com → ChatGPT，claude.ai → Claude…）
和 `groupKey`（同一来源 30 分钟内的连续几条归一组）。

## 格式保真（服务端 `pocket-clip-service`）

HTML → Markdown（turndown + gfm 表格），三条专门规则：
- **KaTeX**：`<annotation encoding="application/x-tex">` 里的原始 TeX 抓回来写成 `$…$` / `$$…$$`——从 ChatGPT 划过来的推导是可再渲染的公式，不是乱码符号
- **代码块**：ChatGPT 的 `<pre>` 里先有一层工具条 div，默认规则抓不到；按 `pre code.language-x` 取语言写成围栏
- **去 UI 渣**：`button / svg / script / style / aria-hidden`，以及「复制代码 / Copy code」这类残留行

## 契约

- `POST /api/workspace/clip`：`{ text?, html?, source?: { app, windowTitle, url, pageTitle }, occurredAt?, clientId? }`
  → 写一条 `sourceType: 'desktop-clip'` 的 capture（`normalizedText` 是 Markdown，`metadata.pocket = { source, groupKey, format, hasMath }`，
  `metadata.provenance` 带 platformLabel），返回 `{ capture: { id, sourceKey, title, previewText } }`
- `GET /api/workspace/pocket?limit=`：最近收进口袋的条目（desktop-clip / desktop-screenshot / desktop-drop / manual-note）
- 撤销：已有的 `DELETE /api/workspace/captures`
- 图片：仍走 `upload-image` → `captures`（`desktop-screenshot` / `desktop-drop`）

## 分期

- **P1（本次）**：热键划取（文字 / HTML / 图）+ 框选截图 + 来源 + 回执与撤销 + 拖放文字 / 网页图 + 剪贴板还原 + 离线队列；
  服务端转换与两个接口；口袋窗改成"今天的流 + 记 / 问"。
- **P2**：收集流里按 groupKey 成组展示（「来自 ChatGPT 的这段对话 · 3 条」）；问同学书桌出现「你刚划的几条」；
  回到同一网址时口袋窗提示「这里你收过 2 条」。
- **P3**：浏览器扩展作为补充入口（选区 + 页面 HTML 更干净），复用同一 `/api/workspace/clip`。

## 验证边界（诚实说明）

服务器上没有 Electron 二进制与显示服务：桌面壳这次只做到 **纯逻辑单测（`make test-desktop`）+ 模块加载检查**；
框选覆盖层、回执窗、热键的真实体验需要在 Mac 上 `npm run desktop:dev` 跑一遍，再 `npm run desktop:dist:mac` 打包自用。
