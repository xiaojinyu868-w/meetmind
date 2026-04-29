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
│   ├── login/page.tsx         # 登录（725行）
│   ├── forgot-password/       # 忘记密码（347行）
│   ├── settings/page.tsx      # 统一设置（含资料 / 模型 / 导入偏好）
│   ├── profile/page.tsx       # 兼容入口，现重定向到 settings
│   └── profile/password/      # 修改密码（267行）
│
├── (meetmind-learning)/       # 原 MeetMind 学习产品页面组（route group，不影响 URL）
│   ├── app/page.tsx           # ⚠️ God File（2302行）— URL /app
│   ├── app/matrix/[appKey]/   # AI 应用矩阵 — URL /app/matrix/[appKey]
│   ├── all-notes/page.tsx     # URL /all-notes
│   ├── wechat/                # URL /wechat/*
│   └── loading.tsx
│
├── (agent-native-infra)/      # 新 Agent Native Infra 页面组（route group，不影响 URL）
│   ├── consult/               # URL /consult/*
│   ├── console/DOMAIN.md      # URL /console/*
│   ├── teacher/               # URL /teacher/*
│   ├── learn/                 # URL /learn/*
│   └── invite/                # URL /invite
│
├── (shared)/                  # 跨产品线共享页面组（route group）
│   ├── feedback/page.tsx      # URL /feedback
│   └── help/page.tsx          # URL /help
│
├── page.tsx                   # 根页面重定向
└── api/                       # API route groups，见 api/DOMAIN.md
```

## 产品线边界

| Track | 页面入口 | 说明 |
|------|----------|------|
| 原 MeetMind 学习产品 | `(meetmind-learning)/app`, `(meetmind-learning)/wechat`, `(meetmind-learning)/all-notes` | 个人学习、收集、课堂、复习、Tutor |
| Agent Native Infra | `(agent-native-infra)/consult`, `console`, `teacher`, `learn`, `invite` | 机构数字员工、学生咨询、老师工作台、机构控制台 |
| 共享页面 | `(auth)`, `(shared)/feedback`, `(shared)/help` | 登录、帮助、反馈 |

页面路由可以复用共享 UI 和 hooks，但不要让原学习页面依赖 Agent Native Infra 的业务模块。

## 关键文件说明

### `src/app/(meetmind-learning)/app/page.tsx` — God File

这是整个项目最核心的文件，包含：

| 内容 | 行数区间 | 说明 |
|------|---------|------|
| 状态定义 | ~1-200 | 76+ useState + 多个 ref |
| Store 订阅 | ~200-350 | useUIActions / useSessionStore 等 |
| 核心函数 | ~350-1200 | restoreReviewSession / openReviewFromCollection 等 |
| 数据处理 | ~1200-2200 | ingestTranscriptSegments / handleRecordingStop 等 |
| 事件处理 + 渲染 | ~2200-2302 | 各种 UI 事件回调 + JSX 组件树 |

**修改策略**：任何改动前，先用 `replace_in_file`，一次只改一个精确区块（10-30行），改完立刻 `make check`。

### `src/app/(meetmind-learning)/app/matrix/[appKey]/page.tsx` — AI 应用矩阵

根据 `appKey` 参数渲染不同 AI 原生应用的空白画布（工作室/播客等）。

## (auth)/ 页面组

| 文件 | 行数 | 职责 |
|------|------|------|
| `login/page.tsx` | 725 | 登录（支持验证码登录 + 微信登录） |
| `forgot-password/page.tsx` | 347 | 忘记密码流程 |
| `settings/page.tsx` | — | 统一设置页：游客/登录态共用，包含默认模型、导入偏好与个人资料 |
| `profile/page.tsx` | — | 兼容重定向到 `settings#account` |
| `profile/password/page.tsx` | 267 | 修改密码 |

## 其他页面

| 文件 | 行数 | 职责 |
|------|------|------|
| `(shared)/feedback/page.tsx` | 215 | 用户反馈表单 |
| `(shared)/help/page.tsx` | 317 | 帮助文档页面 |
| `(meetmind-learning)/all-notes/page.tsx` | 440 | 跨 session 的笔记聚合页 |
| `(agent-native-infra)/consult/page.tsx` | — | 新 agent demo 入口 |
| `(agent-native-infra)/console/agent-assets/page.tsx` | 414 | 机构 Agent 资产只读控制台，聚合 service action atoms / org skills / arena 状态 / runtime evidence |
| `(agent-native-infra)/teacher/page.tsx` | — | 老师端 checkpoint / sources 入口 |
| `(agent-native-infra)/learn/*` | — | Education Service OS 学生练习入口 |
| `(meetmind-learning)/wechat/capture/[token]/page.tsx` | 152 | 接收微信推送的 capture 数据 |

## 最近的 God File 偿还

- `page.tsx`：`8294 → 2302`，已按 Phase 2-6 持续提取为 hooks + 子组件，包括 `MobileCollectionSheet.tsx`、`SharedWorkspacePanel.tsx`、`ReviewWorkspacePanel.tsx`、`ReviewTutorPanel.tsx`、`MobileTopBar.tsx`、`CollectionSelectionBar.tsx`、`CollectionComposerContextPreview.tsx`、`MobileAIChatHeader.tsx`、`CollectionComposerBar.tsx`、`MobileRecordTopBar.tsx`、`MobileAIChatPanel.tsx` 等
- 下一批适合继续提取的候选：移动端 highlights / summary / notes / apps / tasks 共用子页面框架、review 区发射给 Tutor 的启动态组装逻辑、移动端主时间线与困惑卡之间的事件桥接
