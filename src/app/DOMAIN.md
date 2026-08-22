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
│   ├── login/page.tsx         # 登录（邮箱或管理员用户名密码 / 邮箱验证码 + 微信内 OAuth + 桌面公众号扫码）
│   ├── forgot-password/       # 忘记密码（347行）
│   ├── settings/page.tsx      # 统一设置装配层（展示组件在 components/settings/，含桌面锚点导航）
│   ├── profile/page.tsx       # 兼容入口，现重定向到 settings
│   └── profile/password/      # 修改密码（267行）
│
├── (main)/                    # 主应用页面组
│   ├── app/page.tsx           # ⚠️ God File（2302行）— 核心状态机
│   ├── app/matrix/[appKey]/  # AI 应用矩阵（384行）
│   └── loading.tsx            # 加载态
│
├── feedback/page.tsx          # 反馈页（215行）
├── teach/page.tsx             # v32 AI 家教 demo：左备课本画布 + 右 Agent 对话栏 + 课程历史（组件在 components/teach/，mock 事件流收口 teach-client.ts）
├── companion/page.tsx         # 桌面端小窗（随手记/随口问/壳内快捷动作；Electron quick-panel 加载，浏览器也可用）
├── admin/ai-control/page.tsx  # 管理员 AI 控制中心（上下文 / prompt / 模型 / 版本）
├── help/page.tsx             # 帮助页（317行）
├── all-notes/page.tsx         # 笔记聚合（440行）
├── technology/page.tsx        # 面向投资人 / 研究者 / 合作伙伴的技术说明
├── page.tsx                   # 消费级产品 Landing Page
└── wechat/
    ├── capture/[token]/       # 微信 capture 接收（152行）
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
| 事件处理 + 渲染 | ~2200-2302 | 各种 UI 事件回调 + JSX 组件树 |

**修改策略**：任何改动前，先用 `replace_in_file`，一次只改一个精确区块（10-30行），改完立刻 `make check`。

全局 `showAISearch` 状态名为历史兼容名，当前实际动态挂载的是 `GlobalAskPanel`：桌面与移动共用同一全屏 Ask MeetMind，不再挂旧单轮 `AISearchPanel`。

主工作台静态挂载 `Recorder`，保证首次点击仍处于真实用户手势链路并立即建立实时 ASR；`WaveformPlayer` 继续按需加载。`autoStartSignal` 只保留为异常挂载时的兜底，不再作为正常首录路径。分享海报、收集编辑器、长按操作菜单等覆盖层同样只在用户打开时加载。

`/app?claimedCapture=[captureId]` 是 SharedAgent 领取后的回流契约：页面切到收集流，等待对应 WorkspaceCapture 回填后滚动到卡片并短暂显示 AI 在场微光，随后清掉参数，避免刷新时重复播放落点反馈。

### `src/app/(main)/app/matrix/[appKey]/page.tsx` — 学习应用独立页

根据 `appKey` 参数渲染不同学习应用的独立画布；六类应用统一复用 `AppWindowShell`，返回矩阵时保留游客身份等入口状态。可分享成果在标题栏直接创建分享链接。`cheatsheet` 深链不会用当前单课直接生成，而会转入 `/app?workspace=context&intent=cheatsheet` 的课程 / 多课范围选择。用户可见文案避免深链、会话数据、转录内容等内部词。

`/app?workspace=context&intent=cheatsheet` 是考试速查表的显性入口契约：打开全局面板中的「我的上下文」，定位到课堂上下文顶部的考试速查表课程选择；关闭后清理参数，保证入口可以再次打开。

## (auth)/ 页面组

| 文件 | 行数 | 职责 |
|------|------|------|
| `login/page.tsx` | ~640 | 登录：密码模式接受邮箱或管理员用户名，验证码模式保持邮箱格式校验；微信内 OAuth；桌面端原地公众号扫码并自动进入目标页 |
| `forgot-password/page.tsx` | 347 | 忘记密码流程 |
| `settings/page.tsx` | ~430 | 统一设置页装配层：游客/登录态共用；展示拆到 `components/settings/`（行原子 / SettingsNav 桌面锚点导航 / AccountSection / AboutYouSection），文案收口 COPY.settings |
| `profile/page.tsx` | — | 兼容重定向到 `settings#account` |
| `profile/password/page.tsx` | 267 | 修改密码 |

## 其他页面

| 文件 | 行数 | 职责 |
|------|------|------|
| `page.tsx` | — | 消费级主域 `/` 默认交付：渲染 `LandingPage`（React 落地页，两主线叙事）并携带分享 metadata / OG；middleware 不再重写根路径（仅 `tech.*` / `technology.*` 子域重写到 `/technology`）。`/app?guest=1&entry=demo` 继续作为真实试听入口；`public/landing-concept-v1.html` 仅作设计参考存档 |
| `technology/page.tsx` | — | 独立专业技术介绍；既可由 `/technology` 访问，也可把 `tech.*` / `technology.*` 子域名指向同一部署后从根路径进入 |
| `feedback/page.tsx` | 215 | 用户反馈表单 |
| `help/page.tsx` | 317 | 帮助文档页面 |
| `all-notes/page.tsx` | 440 | 跨 session 的笔记聚合页 |
| `admin/ai-control/page.tsx` | — | 管理员专属 AI 控制中心；复杂编辑与版本管理留在独立页面，产品现场仅提供带本次真实上下文的轻入口 |
| `wechat/capture/[token]/page.tsx` | 152 | 接收微信推送的 capture 数据 |

## 最近的 God File 偿还

- `page.tsx`：`8294 → 2302`，已按 Phase 2-6 持续提取为 hooks + 子组件，包括 `MobileCollectionSheet.tsx`、`SharedWorkspacePanel.tsx`、`ReviewWorkspacePanel.tsx`、`ReviewTutorPanel.tsx`、`MobileTopBar.tsx`、`CollectionSelectionBar.tsx`、`CollectionComposerContextPreview.tsx`、`MobileAIChatHeader.tsx`、`CollectionComposerBar.tsx`、`MobileRecordTopBar.tsx`、`MobileAIChatPanel.tsx` 等
- 下一批适合继续提取的候选：移动端 highlights / summary / notes / apps / tasks 共用子页面框架、review 区发射给 Tutor 的启动态组装逻辑、移动端主时间线与困惑卡之间的事件桥接
