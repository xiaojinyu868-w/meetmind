# Agent Rules — MeetMind

> 你是接手 MeetMind 的 AI 开发者。读完这份文件再动手。
> 详细规则在 `skills/` 目录中，本文件只给你最核心的上下文。

---

## 0. Agent 阅读路径（最先读这里）

拿到任务后，按以下顺序阅读，效率最高：

```
第 1 步：本文档（AGENTS.md）→ 第 1-5 节（命令 + 产品 + Big Picture + Skills + 设计系统）
第 2 步：skills/making-changes/SKILL.md → 了解 Plan→Execute→Verify→Commit 流程
第 3 步：根据任务类型选择 ↓
```

### 按任务类型选择阅读路径

| 任务类型 | 阅读顺序 |
|---------|---------|
| **改 UI / 组件** | `src/components/DOMAIN.md` → 对应子目录 DOMAIN.md → 具体组件 |
| **改页面路由** | `src/app/DOMAIN.md` → 对应 page.tsx |
| **改 API 接口** | `src/app/api/DOMAIN.md` → 对应子目录 DOMAIN.md → route.ts |
| **改业务逻辑（service）** | `src/lib/services/DOMAIN.md` → 找到对应 service 文件 |
| **改状态管理** | `src/stores/DOMAIN.md` → 了解哪些状态已迁移到 store |
| **改类型定义** | `src/types/DOMAIN.md` → `src/types/index.ts` |
| **改配置** | `src/lib/config/DOMAIN.md` → `src/lib/config/app.config.ts` |
| **改工具函数** | `src/lib/utils/DOMAIN.md` → 对应 utils 文件 |
| **处理 bug** | `skills/debugging/SKILL.md` → 先诊断再动手 |
| **改 God File (page.tsx)** | `src/DOMAIN.md` → 理解数据流 → 找对应功能区 → `replace_in_file` 精确替换 |

### 铁律

- **每次改完必跑 `make check`**（tsc 类型检查）
- **只读 DOMAIN.md，不确定的再读源码**
- **不要发明新脚本，只用 Makefile 里的命令**
- **如果目录结构、关键文件、依赖边界发生变化，必须同步更新对应的 `DOMAIN.md` / `AGENTS.md`**
- **新增目录若包含 3 个以上源码文件，或承担独立职责，必须补一个 `DOMAIN.md`**

---

## 1. Golden Commands

**日常开发**
```bash
make dev          # 启动开发服务器
make check        # 类型检查（最常用，每次改完必跑）
make build        # 生产构建（限制单核+1GB内存，防OOM）
make deploy       # 构建 + PM2 重启
```

**代码质量**
```bash
make test         # 运行 Vitest 单元测试
make test-watch   # 单元测试 watch 模式
make lint         # ESLint 检查（--max-warnings 0）
make clean-logs   # 自动清理所有 console.log 残留
make stats        # 项目统计（超标文件、console.log 残留）
```

**数据库**
```bash
make db-push      # 同步 Prisma schema 到 SQLite
make db-studio    # 打开 Prisma Studio
```

**只用这些命令。不要发明新脚本。**

---

## 2. 产品是什么

MeetMind 是以学习者长期上下文为中心的 AI 学习产品。

**一句话**：用户像发微信一样把学习现场发给 MeetMind，先收下，后台慢慢理解，理解成熟后自然长出回声、复习、Tutor。

**当前聚焦**：课堂场景。一个大学生录了一节课 → MeetMind 帮他听懂了这节课 → 生成一张让他忍不住分享到班级群的回声卡。

### Taste（任何改动都必须对齐）

**顶层原则：视觉为智能让路。安静是底色，智能是主角，仪式感是点缀。**

| 关键词 | 含义 |
|--------|------|
| **安静** | 不通知、不弹窗、不催促。95% 的界面保持极简克制 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 每句话都能指回真实原件 |
| **第一印象** | 学生打开 MeetMind，第一反应应该是「这个 AI 真的懂我在学什么」——不是"好看"，不是"安静"，是**智能**。视觉为这个目标服务 |

### 仪式时刻白名单（允许破戒的 5 个场景）

日常 95% 的界面**仍然**遵守「平涂、克制」，但以下 5 个关键仪式时刻允许情绪化视觉（渐变/光晕/柔光）：

1. **录音中的呼吸球**：柔光渐变（粉→紫→蓝低饱和度）+ 高斯模糊光晕 + 呼吸动画。停止即消散。
2. **AI 正在"酿"的提示**：右栏或卡片边缘一道极淡的彩色气息流过，< 1.5s，不阻塞交互。
3. **Echo 卡片生成完成的瞬间**：一道柔光扫过卡片。
4. **录课结束的收尾动画**：屏幕中央极简收束动画，像合上一本笔记。
5. **Tab 切换 / AI 流式输出**：字符逐个浮现（stagger），让学生**看见** AI 在思考。

**除此以外，其他任何地方禁止**：`bg-gradient-*`、`shadow-*`、`ring-*` 装饰、非系统 Tailwind 色、emoji 作 UI 元素。

---

## 3. Big Picture Architecture

> 以下架构需要阅读多个文件才能理解全貌，是代码库的"根"。

### 3.1 DOMAIN.md 文档生态系统

整个代码库使用 **DOMAIN.md 模式**：每个重要目录都包含一个 `DOMAIN.md`，作为该域的索引、依赖规则和文件清单。这不是可选文档——它是架构的一部分。

- 阅读顺序：先读该目录的 `DOMAIN.md`，再读具体源码
- 新增目录若包含 3+ 源码文件或承担独立职责，**必须**补 `DOMAIN.md`
- 目录结构或依赖边界变化时，**必须**同步更新对应 `DOMAIN.md`

### 3.2 双存储架构

| 层级 | 技术 | 用途 | 说明 |
|------|------|------|------|
| 服务端 | Prisma 7.2 + SQLite | 用户数据、Workspace、Echo | `prisma/schema.prisma` |
| 客户端 | Dexie.js (IndexedDB) | 转录文本、本地缓存、离线状态 | `src/lib/db/` |

**关键决策**：IndexedDB 是客户端真实数据源，服务端 SQLite 是同步备份。组件直接从 IndexedDB 读取，API 成功后回写本地。

### 3.3 核心数据流：收 → 酿 → 应

```
用户输入（录音/链接/文件/文字）
  → context-reach 识别内容类型
  → page.tsx 路由到对应 handler
  → 调用 API route（薄壳，只转请求/响应）
  → services 处理业务逻辑
  → 返回结果 → IndexedDB 持久化 → UI 更新
  → 后台触发 Echo/复习/Tutor 生成（"酿"）
```

**"酿"是隐式的**：后台理解过程不体现在界面上，只在用户"伸手"时通过 AI 回答质量体现。

### 3.4 AI-Native 插件系统

`src/lib/ai-native/plugins/` 是 Workshop 应用（思维导图、闪卡、测验等）的运行时。每个插件实现统一的渲染契约：

- `studio-workshop.plugin.ts`：主控制器，管理窗口生命周期
- 插件通过 `renderers/` 输出特定 UI 组件
- 执行结果通过 `apps/DOMAIN.md` 中的 hooks 消费

### 3.5 God File 提取策略

`src/app/(main)/app/page.tsx` 是已知遗留债务（~2300 行），正在按**域**分阶段提取为 hooks + 子组件：

| 阶段 | 提取的 hooks | 减少行数 |
|------|-------------|---------|
| Phase 2 | `useSourceImport` | -603 |
| Phase 3 | `useCollectionComposer`, `useCollectionPulse` | -613 |
| Phase 4 | `useTutorLauncher`, `useRecordingLifecycle`, `useTranscriptHandlers`, `useAudioMessagePlayback` | -729 |
| Phase 5 | `useCollectionListActions`, `useWechatCaptureImport`, `useWorkspaceContextLoader`, `useSeekController`, `useAppStateRestore` | -581 |
| Phase 6 | `useSeekController` 消费, `usePendingRecordedAudio`, `useNoteActions`, `useActionItems`, `useExtractTerms`, `useSourceItemManagement` | -289 |

**agent 修改原则**：不要一次性拆分，只在当前任务中顺手提取≥50行的独立模块，立即 `tsc --noEmit` 验证。

### 3.6 Tutor API 双模式架构

`/api/tutor` 不是单一端点，而是两种完全不同的交互模式：

| 模式 | 协议 | 用途 | 关键差异 |
|------|------|------|---------|
| **文本家教** | SSE 流 | 深度答疑、引用资料 | 支持 `[MM:SS]` 时间戳渲染契约和 `[资料N]` 引用标记 |
| **语音同桌** | WebSocket (qwen-omni realtime) | 实时语音对话 | 无文本渲染契约，通过 `useOmniRealtimeCall.ts` 管理音频上下行 |

两者共享 `tutor-prompts.ts` 中的基础 persona，但 system prompt 分离（文本用 `TUTOR_SYSTEM_PROMPT`，实时用 `REALTIME_TEACHER_STYLE_PROMPT`）。

---

## 4. Skills（详细规则在这里）

| Skill | 路径 | 何时读 |
|-------|------|--------|
| **架构执行** | `skills/architecture-enforcement/SKILL.md` | 创建/修改文件时 |
| **变更流程** | `skills/making-changes/SKILL.md` | 每次写代码时 |
| **代码审查** | `skills/code-review/SKILL.md` | 完成变更后自审 |
| **系统化调试** | `skills/debugging/SKILL.md` | 遇到 bug 时 |

**工作流**：Plan → Execute → Verify → Commit（详见 `skills/making-changes/SKILL.md`）

---

## 5. 设计系统（快速参考）

**铁律：95% 平涂极简；5 个仪式时刻允许灵魂迸发（详见第 2 节 Taste 白名单）。**

| Token | 色值 | 用途 |
|-------|------|------|
| `canvas` | `#F7F7F5` | 全局背景 |
| `card` | `#FFFFFF` | 卡片 |
| `ink` | `#232322` | 正文 |
| `ink-secondary` | `#787774` | 次要文字 |
| `ink-muted` | `#A3A39E` | 时间、标注 |
| `divider` | `#E9E9E7` | 分隔线 |

**仪式时刻调色板（仅限白名单场景使用）**：
- `ceremony-rose` `#FCE7F3`、`ceremony-lilac` `#E9D5FF`、`ceremony-sky` `#DBEAFE`
- 仅用于呼吸球 / 气息流 / 收尾动画 / 卡片扫光。不得用于常规按钮、卡片、背景。

**日常禁止**：`bg-gradient-*`、`shadow-*`、`ring-*` 装饰、非系统 Tailwind 色、emoji 作 UI 元素。
**仪式时刻允许**：上述元素仅限白名单中的 5 个场景出现，且必须使用 `ceremony-*` 色板。

---

## 6. Architecture Guardrails

> 来自 `skills/architecture-enforcement/SKILL.md`，每次变更前检查。

### 文件大小硬限制

| 类型 | 上限 | 当前超标文件（遗留债务） |
|------|------|------------------------|
| 页面/组件 | 500 行 | `page.tsx`(~2300), `AITutor.tsx`(~2357), `Recorder.tsx`(~1781) |
| API 路由 | 500 行 | `video/import/route.ts`(1212), `tutor/route.ts`(886) |
| 服务文件 | 500 行 | `workspace-echo-service.ts`(1297), `classroom-data-service.ts`(1009) |
| 工具/类型 | 300 行 | — |

**规则**：新文件不得超过上限；修改若导致超标，必须先拆分。

### 依赖方向（单向，不可反向）

```
app/api → lib/services → lib/utils/, lib/db/, lib/config/
app/pages → components → hooks → stores → types
```

**禁止**：
- `services/` 不得 import `components/`
- `components/` 不得直接 import `services/`（通过 hooks 或 props）
- `utils/` 不得 import `services/` 或 `components/`
- API 路由不得包含业务逻辑（必须委托给 services）

---

## 7. 架构速查

```
src/
├── DOMAIN.md              # ← 源码总览，从这里开始
├── app/
│   ├── DOMAIN.md         # 页面路由索引
│   └── api/
│       ├── DOMAIN.md     # 45 个 API 路由总览
│       ├── auth/DOMAIN.md        # 认证接口组
│       ├── workspace/DOMAIN.md    # Workspace 接口组
│       ├── sources/DOMAIN.md      # 内容接入接口组
│       ├── apps/DOMAIN.md         # AI 应用接口组
│       ├── tutor/DOMAIN.md        # AI 家教
│       └── video/import/DOMAIN.md # 视频导入管线
├── components/
│   ├── DOMAIN.md         # ~137 个 UI 组件索引
│   ├── ui/DOMAIN.md      # 原子 UI 组件库
│   ├── apps/windows/DOMAIN.md  # Workshop 窗口组件
│   ├── tutor/DOMAIN.md   # AI 家教子模块
│   ├── recorder/DOMAIN.md
│   ├── mobile/DOMAIN.md
│   ├── layout/DOMAIN.md
│   ├── classroom/DOMAIN.md
│   └── business/DOMAIN.md
├── hooks/DOMAIN.md       # hooks 索引（含 Omni realtime 通话 + sourceImport）
├── stores/DOMAIN.md      # Zustand 状态（7 stores，~89 状态已迁移）
├── types/DOMAIN.md       # 共享类型
└── lib/
    ├── DOMAIN.md         # 库代码总览
    ├── services/DOMAIN.md # 51 个业务服务（按域分组）
    ├── utils/DOMAIN.md   # 工具函数
    ├── utils/page/DOMAIN.md # page-utils 拆分模块
    ├── db/DOMAIN.md      # IndexedDB Schema + CRUD
    ├── ai-native/DOMAIN.md # 应用插件系统
    ├── ai-native/plugins/DOMAIN.md # Workshop 插件
    ├── longcut/DOMAIN.md # 转录算法
    ├── capture/DOMAIN.md # 收集逻辑
    ├── context-reach/DOMAIN.md # 输入分流
    ├── config/DOMAIN.md  # 配置中心
    └── logger.ts         # 统一日志（不要用 console.log）
```

**读取顺序**：修改某个目录前，先读该目录的 `DOMAIN.md` 了解文件清单和依赖规则。

---

## 8. 关键文件

| 文件 | 行数 | 注意 |
|------|------|------|
| `src/app/(main)/app/page.tsx` | ~2300 | God File（按域分 6 阶段提取为 hooks + 子组件，详见 §3.5），用 `replace_in_file` 精确替换，改前先读 `src/app/DOMAIN.md` |
| `src/components/AITutor.tsx` | ~2357 | AI 家教，已拆分语音同桌相关子模块到 `tutor/` |
| `src/components/Recorder.tsx` | ~1781 | 录音组件，已拆分 3 个子模块到 `recorder/`（含 `recorder-audio-source.ts` 支持 mic/system/mixed 三档音源） |
| `src/app/api/video/import/route.ts` | 1212 | 多平台导入管线，已拆分 3 个子模块 |
| `src/app/api/tutor/route.ts` | 886 | AI 私教路由，已拆分 4 个子模块（文本 SSE + 语音 realtime 双模式，详见 §3.6） |
| `src/hooks/useOmniRealtimeCall.ts` | 793 | Qwen Omni realtime 语音通话 hook，承接麦克风上行、语音下行与接通状态 |
| `src/lib/utils/page-utils.ts` | 10 | Barrel re-export，实际实现在 `page/` 子目录（5 个模块，共 1123 行） |
| `src/lib/ai-native/plugins/studio-workshop.plugin.ts` | ~425 | Studio Workshop 主文件，子模块：types/podcast/renderers |
| `src/lib/services/commonstack-echo-service.ts` | ~273 | Echo LLM 调用，System Prompt 在此 |
| `src/lib/services/workspace-echo-service.ts` | 1297 | Echo 数据管线 |
| `src/components/EchoCard.tsx` | ~209 | 回声卡，必须遵守设计系统 |

---

## 9. 技术栈

- Next.js 14 (App Router) + TypeScript 5.3
- Tailwind CSS 3.4（token 在 `tailwind.config.js`，CSS 变量在 `globals.css`）
- Prisma 7.2 + SQLite
- Dexie (IndexedDB) 客户端存储
- PM2 进程管理

---

## 10. 文档索引

| 文档 | 状态 | 说明 |
|------|------|------|
| `README.md` | ✅ | 产品哲学、环境变量、部署方式、微信接入 |
| `docs/ECHO_PRODUCT_DEFINITION.md` | ✅ | Echo 产品定义 source of truth |
| `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` | ⚠️ | 产品定义准确，技术细节可能过时 |
| `项目开发文档/提示词设计哲学.md` | ✅ | Less Structure, More Intelligence |
| `skills/*.md` | ✅ | Agent 工作规范（架构/变更/审查/调试） |
