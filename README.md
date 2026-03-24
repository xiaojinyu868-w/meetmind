# MeetMind

> **基于教育专属记忆大模型的 AI 原生专属导师。**
>
> 从微信文件传输助手的 AI 版本入手，解决传统收集没有反馈、难以沉淀的两大痛点，让用户无感收集碎片学习材料，并自然长出依托材料、课堂音视频原文的专属私教与复习应用矩阵。

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7.2-2D3748?logo=prisma)](https://www.prisma.io/)

---

## 产品哲学

**先收，再懂，再教。**

用户不需要分类、不需要选功能、不需要先做决策。只是像发微信一样，把学习现场的一切发给 MeetMind。

MeetMind 先收下原件，后台慢慢理解，理解成熟后自然长出复习、Tutor、回声、跨材料连接。

### 产品不是什么

- 不是录音转写工具
- 不是 AI 教育工具外壳
- 不是功能工作台
- 不是前台满是 AI 解释和提示的产品

### 产品是什么

**一个以个人学习上下文为核心的产品。**

核心不是"回答问题"，而是先把学习现场收进来，保留原件，在后台慢慢理解，再自然长出价值。

---

## 当前阶段：Capture First

如果用户没有自然地把学习现场收进来，后面所有智能都没有基础。

当前阶段的全部重心：**把收集做成一个真正成立的产品。**

### Capture V1 = 微信式的学习上下文聊天流

- 左侧：原声录制
- 输入框：文本输入 / 语音听写
- `+`：统一文件入口（图片、文档、音频、视频、链接）
- 所有内容先像消息一样进入收集流
- 后台再异步转录、OCR、解析、发酵
- 媒体消息成熟后，自然长出 `去复习`

### 收集的原则

1. **原件优先** — 原声保留原始音频，图片先看原图，文档先开原件，解析结果不默认占主消息
2. **先收后理解** — 所有输入先进流、再后台处理、不阻塞下一次输入
3. **不让系统抢戏** — 尽量避免"文件已加入""系统正在解析"这类话术
4. **兼容旧复习能力** — 音频/视频转写成功后自然长出时间轴、课堂问答、复习模式

### 微信服务号的角色

| 入口 | 定位 |
|------|------|
| **微信服务号** | 最自然的轻收集入口——文字、语音、图片、链接 |
| **H5 / Web** | 深交互入口——看原件、补材料、复习、Tutor、回声 |

---

## 长期北极星

**一个以学习者长期上下文为中心的学习产品 / 学习基础设施。**

最终要做到两件事：

1. AI 真正"听过这节课、看过这些材料、接触过这些原件"
2. AI 真正"越来越懂这个人如何学习、在乎什么、卡在哪里"

长期完整形态自然长出：

| 模块 | 职责 |
|------|------|
| **Capture** | 无感收集 — 把学习现场收进来 |
| **Review** | 复习 — 时间轴、课堂问答、去复习 |
| **Tutor** | 深交互 — 依托原件的专属私教 |
| **Echo** | 轻回声 — 发酵、每日回看、回来理由 |
| **应用矩阵** | 衍生应用 — 思维导图、闪卡、播客、信息图等 |

### 核心差异化：上下文工程

创业公司真正的机会是垂类的经验和垂类的上下文工程。

MeetMind 不靠通用模型能力取胜，靠的是：

- 用户长期积累的学习上下文（原件、转写、笔记、困惑点、提问历史）
- 基于这些上下文的个性化理解和教学
- 上下文越厚，AI 越懂这个人 — 这是时间复利

---

## 快速开始

### 环境要求

- Node.js >= 18.0
- npm >= 9.0
- 阿里云百炼 API Key（[获取地址](https://bailian.console.aliyun.com/)）

### 安装与启动

```bash
# 克隆仓库
git clone git@github.com:xiaojinyu868-w/meetmind.git
cd meetmind

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，至少填入 DASHSCOPE_API_KEY

# 开发模式
npm run dev

# 生产构建（低内存服务器）
NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1024" npm run build

# 生产运行
NODE_ENV=production PORT=3002 node server.js
```

### 环境变量

```bash
# ===== 必需 =====
DATABASE_URL="file:./prisma/meetmind.db"
DASHSCOPE_API_KEY=sk-your-api-key

# ===== 微信服务号（收集入口）=====
WECHAT_APP_ID=your-app-id
WECHAT_APP_SECRET=your-app-secret
WECHAT_MP_TOKEN=your-mp-token
WECHAT_MP_PUBLIC_BASE_URL=https://your-domain.com

# ===== 功能开关 =====
NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER=true
NEXT_PUBLIC_ENABLE_WECHAT_LOGIN=true

# ===== 可选：LLM 配置 =====
LLM_MODEL=qwen3.5-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# ===== 可选：构建优化 =====
NEXT_BUILD_CPUS=1                    # 限制构建并发（低内存服务器）
NEXT_IGNORE_BUILD_LINT=1             # 构建时跳过 lint
NEXT_IGNORE_TYPE_ERRORS=1            # 构建时跳过类型检查
```

### 可用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（含自定义服务器） |
| `npm run build` | 生产构建 |
| `npm run start` | 生产运行 |
| `npm run lint` | ESLint 检查 |

---

## 技术架构

### 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | Next.js 14 (App Router) |
| **语言** | TypeScript 5.3 |
| **样式** | Tailwind CSS 3.4 |
| **数据库** | Prisma 7.2 + SQLite |
| **客户端存储** | Dexie (IndexedDB) |
| **AI** | 阿里云百炼（通义千问） |
| **音频** | wavesurfer.js、fluent-ffmpeg |
| **实时通信** | SSE 流式输出 |

### 项目结构

```
meetmind/
├── server.js                        # 自定义服务器
├── prisma/                          # 数据库
│   └── schema.prisma
│
├── src/
│   ├── app/
│   │   ├── (main)/app/              # 收集主页面（产品核心）
│   │   ├── api/
│   │   │   ├── sources/ingest/      # 统一内容接入
│   │   │   ├── tutor/               # AI Tutor
│   │   │   ├── chat/                # AI 对话
│   │   │   ├── transcribe/          # 离线转录
│   │   │   ├── transcribe-turbo/    # 快速转录
│   │   │   ├── wechat/              # 微信服务号
│   │   │   ├── workspace/           # 工作区
│   │   │   └── apps/                # 应用矩阵
│   │   └── wechat/                  # 微信 H5 页面
│   │
│   ├── components/                  # React 组件（113 个）
│   │   ├── Recorder.tsx             # 原声录制
│   │   ├── AITutor.tsx              # AI 助教
│   │   ├── SafeAITutor.tsx          # 带错误边界的安全包装
│   │   ├── TutorErrorBoundary.tsx   # Tutor 局部错误边界
│   │   ├── IntentBubbleExplorer.tsx # 轻量意图胶囊
│   │   ├── WorkspaceCaptureList.tsx  # 全部收集
│   │   └── ...
│   │
│   ├── hooks/                       # 自定义 Hooks（23 个）
│   │   ├── useVoiceInput.ts         # 语音听写
│   │   └── ...
│   │
│   └── lib/
│       ├── services/                # 服务层（48 个）
│       │   ├── rate-limit-service.ts
│       │   ├── workspace-service.ts
│       │   ├── wechat-mp-service.ts
│       │   ├── wechat-inbox-service.ts
│       │   └── ...
│       ├── capture/                 # 收集上下文
│       ├── hooks/                   # 通用 Hooks
│       │   ├── useAuth.tsx
│       │   └── useSSEStream.ts
│       └── ai-native/              # 应用矩阵插件底座
│
├── docs/                            # 交接文档
│   ├── SERVER_AGENT_HANDOFF_CAPTURE_V1.md
│   └── AGENT_HANDOFF_TUTOR_UX_WECHAT_FLOW.md
│
└── tests/                           # E2E 测试
```

---

## 当前已成立的能力

### 收集主线

- [x] 微信式聊天收集流（手机端主路径）
- [x] 左原声 / 框内听写 / `+` 统一上传 / 发送
- [x] 原声录制：停止后先发原始音频消息，再后台转写
- [x] 听写：浏览器原生优先，不可用时退化为整段录音转文字
- [x] 统一上传：图片、文档、PDF、PPT、音频、视频、链接
- [x] 原件优先：图片看原图，文档开原件，解析不占主消息
- [x] 全部收集 / 历史收集 作为内容入口

### AI 能力

- [x] AI Tutor：基于收集内容的专属私教对话
- [x] Tutor 局部错误边界（面板崩溃不影响整页）
- [x] Tutor 限流保护 + 友好错误文案
- [x] 轻量意图胶囊（首屏不过度打扰）
- [x] 流式输出 + 思考过程可视化
- [x] 应用矩阵：思维导图、闪卡、测验、信息图、课堂播客

### 微信入口

- [x] 微信服务号消息接入
- [x] 微信发来的内容进入收集流
- [x] 微信回流动线（服务号 → H5 → 收集主线）

### 复习（旧能力兼容）

- [x] 课堂时间轴 / 时间戳
- [x] 音频/视频转写后自然长出"去复习"
- [x] 课堂问答
- [x] 复习模式

---

## 当前阶段不做什么

- 前台大 AI 洞察展示
- 复杂画像展示
- 多角色切换（学生/家长/教师）
- 新的一级页面堆叠
- 为了"像 AI 产品"而增加前台打扰

### 判断标准

任何改动都先问这 5 句：

1. 这个改动是不是让用户更容易收集？
2. 是不是更原件优先？
3. 是不是更少打扰？
4. 是不是更像"发消息"而不是"用功能"？
5. 是不是更容易自然长出复习和 Tutor？

---

## 交接文档

如果你是接手开发的 agent 或开发者，请优先阅读：

| 文档 | 内容 |
|------|------|
| [`docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md`](./docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md) | 产品完整定义、收集层实现状态、验收清单、工作守则 |
| [`docs/AGENT_HANDOFF_TUTOR_UX_WECHAT_FLOW.md`](./docs/AGENT_HANDOFF_TUTOR_UX_WECHAT_FLOW.md) | Tutor UX 修复、微信回流动线、部署状态、行号速查 |

---

## 部署

当前生产环境：

| 项目 | 值 |
|------|-----|
| 域名 | `https://capture.meetmind.online` |
| 端口 | 3002 |
| 反向代理 | Nginx |

```bash
# 低内存构建
NEXT_BUILD_CPUS=1 NEXT_IGNORE_BUILD_LINT=1 NEXT_IGNORE_TYPE_ERRORS=1 \
  NODE_OPTIONS="--max-old-space-size=1024" npm run build

# 启动
nohup env NODE_ENV=production PORT=3002 node server.js > runtime-3002.log 2>&1 &

# 验证
curl -I http://127.0.0.1:3002/app
curl -I https://capture.meetmind.online/app
```

---

## 许可证

MIT License
