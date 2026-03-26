# Page Routes — 页面路由层

> 页面路由是 Next.js App Router 的 UI 入口，职责：获取数据 → 渲染组件。
> 业务逻辑、数据获取、状态管理都应该在 `components/`、`hooks/`、`lib/` 里完成。

## 依赖规则

```
page.tsx → components/ + hooks/ + stores/ + lib/
page.tsx ❌ 不能调用 api routes（通过 fetch 调用可以）
```

## 目录结构

```
src/app/
├── (auth)/                    # 认证页面组
│   ├── login/page.tsx         # 登录（726行）
│   ├── forgot-password/       # 忘记密码（348行）
│   ├── profile/page.tsx       # 个人资料（288行）
│   └── profile/password/      # 修改密码（268行）
│
├── (main)/                    # 主应用页面组
│   ├── app/page.tsx           # ⚠️ God File（8294行）— 核心状态机
│   ├── app/matrix/[appKey]/  # AI 应用矩阵（381行）
│   └── loading.tsx            # 加载态
│
├── parent/page.tsx            # 家长端（350行）
├── teacher/page.tsx           # 教师端（8行，仅重定向）
├── feedback/page.tsx          # 反馈页（216行）
├── help/page.tsx             # 帮助页（244行）
├── all-notes/page.tsx         # 笔记聚合（441行）
├── page.tsx                   # 根页面重定向
└── wechat/
    ├── capture/[token]/       # 微信 capture 接收（153行）
    └── open/[token]/          # 微信 Open 跳转
```

## 关键文件说明

### `src/app/(main)/app/page.tsx` — God File

这是整个项目最核心的文件，包含：

| 内容 | 行数区间 | 说明 |
|------|---------|------|
| 状态定义 | ~1-200 | 76+ useState + 多个 ref |
| Store 订阅 | ~200-350 | useUIActions / useSessionStore 等 |
| 核心函数 | ~350-1200 | restoreReviewSession / openReviewFromCollection 等 |
| 数据处理 | ~1200-2200 | ingestTranscriptSegments / handleRecordingStop 等 |
| 事件处理 | ~2200-3000 | 各种 UI 事件回调 |
| 渲染逻辑 | ~3000-8086 | JSX 组件树 + 条件渲染 |

**最近拆分**：
- `MobileCollectionSheet.tsx`（296行）— 移动端收集浮层
- `SharedWorkspacePanel.tsx`（140行）— shared workspace 分支渲染

**修改策略**：任何改动前，先用 `replace_in_file`，一次只改一个精确区块（10-30行），改完立刻 `make check`。

### `src/app/(main)/app/matrix/[appKey]/page.tsx` — AI 应用矩阵

根据 `appKey` 参数渲染不同 AI 原生应用的空白画布（工作室/播客等）。

## (auth)/ 页面组

| 文件 | 行数 | 职责 |
|------|------|------|
| `login/page.tsx` | 726 | 登录（支持验证码登录 + 微信登录） |
| `forgot-password/page.tsx` | 348 | 忘记密码流程 |
| `profile/page.tsx` | 288 | 个人资料编辑 |
| `profile/password/page.tsx` | 268 | 修改密码 |

## 其他页面

| 文件 | 行数 | 职责 |
|------|------|------|
| `parent/page.tsx` | 350 | 家长端：孩子学习报告视图 |
| `teacher/page.tsx` | 8 | 教师端：仅做 OAuth 鉴权后重定向 |
| `feedback/page.tsx` | 216 | 用户反馈表单 |
| `help/page.tsx` | 244 | 帮助文档页面 |
| `all-notes/page.tsx` | 441 | 跨 session 的笔记聚合页 |
| `wechat/capture/[token]/page.tsx` | 153 | 接收微信推送的 capture 数据 |

## 最近的 God File 偿还

- `page.tsx`：`8294 → 8086`，已抽离 `MobileCollectionSheet.tsx`（移动端收集浮层）与 `SharedWorkspacePanel.tsx`（shared workspace 渲染）
- 下一批适合继续提取的候选：review 左侧工作区面板、移动端顶部条、collection context 选择条
