# MeetMind 课堂助手

> **首个"家校同频"智能助教系统** —— 为每个家庭配备一位真正"听过课"的专属 AI 家教
> 
> MVP 1.0 - 把课堂"变成可回放、可定位、可追溯的时间轴记忆"

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![阿里云百炼](https://img.shields.io/badge/阿里云百炼-通义千问-orange)](https://bailian.console.aliyun.com/)

---

## 📋 目录

- [产品愿景](#-产品愿景)
- [核心痛点](#-核心痛点)
- [快速开始](#-快速开始)
- [技术架构](#-技术架构)
- [三端视图](#-三端视图)
- [已完成功能](#-已完成功能)
- [关键差异化](#-关键差异化)
- [开发文档](#-开发文档)
- [贡献指南](#-贡献指南)

---

## 🎯 产品愿景

**MeetMind（原点教育）** 是首个"家校同频"智能助教系统。我们的核心理念是：

> **把家教最稀缺、最值钱的能力规模化复制出来：听过课、懂老师讲法、能把错误转成下一步行动。**

### 一句话定位

通过全天候记录课堂内容并个性化辅导，填补学校与家庭教育间的信息断层。让课后辅导第一次真正拥有"课堂上下文"，从而具备替代家教的可能性。

### 目标用户

| 用户群体 | 核心需求 |
|----------|----------|
| **学生** | 课堂没听懂的地方能快速补懂，不再盲目刷题 |
| **家长** | 知道孩子课堂学了什么、卡在哪里，有据可依地辅导 |
| **教师** | 获得课堂理解反馈，减轻重复解释负担 |

---

## 🔥 核心痛点

我们把痛点抽象成三个层级的"断层"：

### 断层一：信息断层（家长最愿意付费的源头）

> 家长的核心困难不是"不会做题"，而是拿不到课堂当天的真实信息：老师讲解顺序、强调点、作业意图、易错提示。

**场景**：晚上 9 点，孩子说"听懂了"，但一做题就卡住。家长翻着教材，明明题目自己会做，却越讲越心虚——她不知道老师今天用的是什么方法。

### 断层二：方法断层（最隐蔽、最耗费学习效率）

> 同一知识点，在学校、补习班、家长的讲法可能完全不同。孩子的脑子被迫装下多套互相打架的体系。

**场景**：学校强调"从定义出发"，补习班强调"模板化套路"。孩子渐渐学会切换不同思维，但真正理解越来越少。

### 断层三：反馈断层（冲刺期最致命的瓶颈）

> 冲刺期最稀缺的不是努力，而是即时、可解释、能转成下一步行动的高质量反馈。

**场景**：考试临近，孩子每天刷题到深夜，错题本越来越厚：错的总是那几类。缺反馈就会陷入题海的时间黑洞。

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0
- npm >= 9.0
- 阿里云百炼 API Key（[获取地址](https://bailian.console.aliyun.com/)）

### 安装步骤

```bash
# 1. 克隆仓库
git clone <repository-url>
cd meetmind

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 4. 启动开发服务器（含 WebSocket 代理）
npm run dev

# 或者仅启动 Next.js（不含 WebSocket 实时转录）
npm run dev:next
```

### 访问应用

| 端口 | 地址 | 说明 |
|------|------|------|
| 3001 | http://localhost:3001 | 学生端（录音/复习） |
| 3001 | http://localhost:3001/parent | 家长端（日报/陪学脚本） |
| 3001 | http://localhost:3001/teacher | 教师端（困惑热点/教学反思） |

### 可用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（含 WebSocket ASR 代理） |
| `npm run dev:next` | 仅启动 Next.js（端口 3001） |
| `npm run build` | 生产构建 |
| `npm run start` | 生产运行 |
| `npm run lint` | ESLint 代码检查 |

### 环境变量配置

```bash
# ===== 阿里云百炼 API（必需）=====
DASHSCOPE_API_KEY=sk-your-api-key-here

# LLM 模型配置
LLM_MODEL=qwen3-max
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 实时语音识别模型配置
DASHSCOPE_ASR_WS_MODEL=qwen3-asr-flash-realtime
DASHSCOPE_ASR_WS_SR=16000

# 离线语音转录配置（云服务器部署时需要配置公网访问）
PUBLIC_HOST=your-server-ip:3001
PUBLIC_PROTOCOL=http

# ===== 可选：其他 LLM 提供商 =====
# GOOGLE_API_KEY=your-google-api-key
# OPENAI_API_KEY=your-openai-api-key

# ===== 可选：认证配置 =====
# JWT_SECRET=your-jwt-secret-change-in-production
# JWT_EXPIRES_IN=7200
# JWT_REFRESH_EXPIRES_IN=604800

# ===== 可选：外部服务 =====
# NEXT_PUBLIC_NOTEBOOK_API=http://localhost:5055
# ENABLE_NOTEBOOK=true
```

---

## 🏗️ 技术架构

### 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| **框架** | Next.js (App Router) | ^14.2.0 |
| **语言** | TypeScript | ^5.3.0 |
| **样式** | Tailwind CSS | ^3.4.0 |
| **状态管理** | Zustand | ^4.5.0 |
| **本地存储** | Dexie (IndexedDB) | ^4.2.1 |
| **AI SDK** | Vercel AI SDK | ^6.0.11 |
| **音频处理** | wavesurfer.js | ^7.12.1 |
| **音频转换** | fluent-ffmpeg | ^2.1.3 |
| **可视化** | @nivo/heatmap | ^0.99.0 |
| **网络** | ws, axios, swr | latest |

### 项目结构

```
meetmind/
├── server.js                    # 自定义服务器 (WebSocket ASR 代理 + Next.js)
├── package.json                 # 项目依赖
├── .env.example                 # 环境变量示例
│
├── src/
│   ├── app/                     # Next.js App Router 页面
│   │   ├── page.tsx             # 学生端首页 (录音/复习)
│   │   ├── parent/page.tsx      # 家长端
│   │   ├── teacher/page.tsx     # 教师端
│   │   └── api/                 # API 路由
│   │
│   ├── components/              # React 组件
│   │   ├── ui/                  # 基础 UI 组件 (shadcn/ui)
│   │   ├── mobile/              # 移动端组件
│   │   ├── teacher/             # 教师端组件
│   │   └── business/            # 业务组件
│   │
│   ├── hooks/                   # 自定义 Hooks
│   │   ├── useAnchors.ts        # 困惑点管理
│   │   ├── useAudio.ts          # 音频播放控制
│   │   ├── useRecording.ts      # 录音状态管理
│   │   └── useTranscript.ts     # 转录数据管理
│   │
│   ├── lib/
│   │   ├── config/              # 统一配置管理
│   │   │   └── app.config.ts    # 应用配置 (LLM/Auth/ASR/Feature/UI)
│   │   ├── services/            # 服务层
│   │   │   ├── llm-service.ts   # LLM 调用封装
│   │   │   ├── tutor-service.ts # AI 家教服务
│   │   │   ├── highlight-service.ts # 精选片段生成
│   │   │   └── ...              # 其他服务
│   │   ├── utils/               # 工具函数
│   │   │   ├── time-utils.ts    # 时间处理
│   │   │   ├── json-utils.ts    # JSON 解析
│   │   │   └── transcript-utils.ts # 转录文本处理
│   │   └── db.ts                # IndexedDB 数据库 (Dexie)
│   │
│   ├── types/                   # TypeScript 类型定义
│   │   ├── index.ts             # 核心业务类型
│   │   └── user.ts              # 用户/认证类型
│   │
│   └── fixtures/                # 演示数据
│       └── demo-data.ts         # 统一演示数据源
│
└── 项目开发文档/                 # 开发文档
    ├── 项目结构.md
    ├── 技术架构.md
    ├── API接口文档.md
    ├── 开发路线图.md
    └── 家长端升级规划v2.0.md
```

---

## 📱 三端视图

### 学生端 (`/`)

```
┌─────────────────────────────────────────────────────────────┐
│  录音模式                          复习模式                  │
│  ┌─────────────────────┐          ┌─────────────────────┐  │
│  │ 🎙️ 实时录音          │          │ 📊 时间轴浏览        │  │
│  │ 📝 语音转录          │          │ 🔴 困惑点回顾        │  │
│  │ 🔴 困惑点标记        │          │ 🤖 AI 家教对话       │  │
│  │ 📊 音量可视化        │          │ 💬 自由问答          │  │
│  └─────────────────────┘          └─────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🎵 波形播放器 | ⚙️ 模型选择 | ✅ 行动清单            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 家长端 (`/parent`)

| 功能 | 描述 |
|------|------|
| 今日概览 | 课程数量、困惑点统计、待解决/已解决 |
| 困惑点列表 | 按科目分类、显示老师原话、跳转 AI 解释 |
| 陪学脚本 | AI 生成的个性化陪学指南（约 X 分钟） |
| 任务清单 | 逐个击破困惑点、标记完成状态 |
| 进度环 | 可视化完成率、鼓励语 |

### 教师端 (`/teacher`)

| 功能 | 描述 |
|------|------|
| **课程信息卡片** | 学科、教师、时长、学生数统计 |
| **困惑热点 TOP3** | 金银铜排名、热度可视化、困惑人数、可能原因 |
| **学生列表展开** | 点击卡片查看具体困惑学生名单 |
| **AI 课后反思** | 一键生成、流式输出、支持复制和重新生成 |
| **反思报告结构** | 课堂总结 → 教学亮点 → 问题分析 → 改进建议 |

---

## ✅ 已完成功能

| 模块 | 状态 | 说明 |
|------|:----:|------|
| 录音转录 | ✅ | 实时流式 + 离线异步双模式（阿里云 ASR） |
| 困惑标记 | ✅ | 一键标记、时间戳关联、5秒可撤销 |
| 课堂时间轴 | ✅ | 自动分段、锚点关联、主题提取 |
| AI 家教对话 | ✅ | 选择题精准定位困惑、可点击时间戳跳转 |
| 波形播放器 | ✅ | 音频波形可视化、锚点跳转 |
| 学生端 | ✅ | 录音模式 + 复习模式完整流程 |
| 家长端 | ✅ | 今日概览、困惑列表、陪学脚本 |
| 教师端 | ✅ | 困惑热点 TOP3、AI 流式生成课后反思、数据同步 |
| 多模型支持 | ✅ | 通义千问/Gemini/OpenAI 可切换 |
| 配置管理 | ✅ | 统一配置中心，支持环境变量覆盖 |
| 类型安全 | ✅ | 完整 TypeScript 类型定义，DB/应用层类型分离 |

### 最新更新

#### v1.8 - 登录页优化 & 新用户引导系统

| 功能 | 描述 |
|------|------|
| **登录页 UI 优化** | 登录卡片增加毛玻璃透明效果，更现代的视觉体验 |
| **产品标语更新** | "AI智能学习助手 - 你的专属AI同桌" |
| **未设置密码处理** | 用户未设置密码时自动切换到验证码登录，并显示友好提示 |
| **手机号登录暂停** | 手机号登录标记为"即将开放"，避免用户尝试不可用功能 |
| **新用户引导系统** | 首次访问时显示欢迎弹窗和 3 步引导教程，帮助用户快速上手 |
| **渐进式引导** | 支持聚光灯高亮、气泡提示、步骤指示器，引导状态持久化 |

#### v1.7 - 离线转录架构升级

| 功能 | 描述 |
|------|------|
| **阿里云异步 ASR** | 替换 OpenAI Whisper，使用 `qwen3-asr-flash-filetrans` 异步模式 |
| **长音频支持** | 支持整节课（40-90分钟）音频完整转录，保留完整上下文 |
| **公网 URL 机制** | 音频保存到 `public/temp-audio/`，通过公网 URL 供阿里云访问 |
| **自动清理** | 临时音频文件 2 小时后自动清理 |

#### v1.6 - 代码重构与架构优化

| 功能 | 描述 |
|------|------|
| **配置集中化** | 新增 `app.config.ts` 统一管理 LLM/Auth/ASR/Feature/UI/Dev 配置，敏感信息移至环境变量 |
| **工具函数模块化** | 消除 4 处重复的 `formatTimestamp`，拆分为 `time-utils`、`json-utils`、`transcript-utils` 三个独立模块 |
| **类型系统优化** | 区分 DB 层类型（`DBAnchor`、`DBTranscriptSegment`，id 为 number）和应用层类型（id 为 string），添加 `dbToTranscriptSegment` 转换函数 |
| **Hooks 提取** | 从 page.tsx 抽离 4 个业务 Hooks：`useAnchors`（困惑点管理）、`useAudio`（音频控制）、`useRecording`（录音状态）、`useTranscript`（转录数据） |
| **服务层规范化** | 6 个服务文件统一风格，使用统一工具函数，补齐 `updateAnchorStatus` 等缺失方法 |
| **页面精简** | 移除硬编码学科名称，改用 `UIConfig.defaultSubject`；Header 数据使用配置驱动 |

#### v1.5 - 移动端体验优化

| 功能 | 描述 |
|------|------|
| **移动端 AI 对话优化** | AI 助教页面添加 MiniPlayer 进度条，点击时间戳可同步查看播放进度 |
| **紧凑布局重构** | 移动端头部采用垂直紧凑布局，隐藏联网搜索和 token 显示等冗余信息 |
| **ModelSelector 改进** | 新增 `compact` 属性支持紧凑模式，移动端显示更简洁 |

#### v1.4 - WebSocket 代理架构升级

| 功能 | 描述 |
|------|------|
| **统一 Upgrade 分发** | 自定义 ASR 代理与 Next.js HMR 共享同一 HTTP 服务器，通过路径分流避免冲突 |

#### v1.3 - 学生端-教师端数据同步

| 功能 | 描述 |
|------|------|
| **统一演示数据源** | 学生端和教师端使用相同的 `demo-data.ts` 数据源，确保显示一致 |
| **数据流打通** | 教师端可正确读取学生端的转录内容和困惑点标记 |

---

## 🎯 关键差异化

### 必须坚持的原则

| 原则 | 说明 |
|------|------|
| **证据链输出** | AI 的每一句解释都必须引用课堂原生片段（分钟级） |
| **最小必要采集** | MVP 只做纯语音，逐步加入关键帧，始终遵循合规 |
| **Less structure, more intelligence** | 不用重知识图谱，用时间轴 + RAG + LLM |
| **合作姿态进入校园** | 教师减负，不是监控；学校得到反馈，不是负担 |

### 与竞品的差异

| 维度 | 竞品 | MeetMind |
|------|------|----------|
| 数据来源 | 题库/通用内容 | 课堂原生数据 |
| 解释依据 | AI 自由发挥 | 必须引用老师原话 |
| 家长参与 | 看成绩/看作业 | 知道"老师怎么讲的" |
| 教师负担 | 需要录入/操作 | 一键启动、无感采集 |

---

## 📚 开发文档

详细的技术文档已拆分到 `项目开发文档/` 目录：

| 文档 | 说明 |
|------|------|
| [项目结构.md](./项目开发文档/项目结构.md) | 目录结构和文件说明 |
| [技术架构.md](./项目开发文档/技术架构.md) | 技术栈、系统架构、数据流、WebSocket 架构 |
| [API接口文档.md](./项目开发文档/API接口文档.md) | API 路由和核心组件说明 |
| [开发路线图.md](./项目开发文档/开发路线图.md) | MVP 阶段规划和 TODO LIST |
| [家长端升级规划v2.0.md](./项目开发文档/家长端升级规划v2.0.md) | 基于用户研究的家长端详细升级计划 |

---

## 🤝 贡献指南

### 开发流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 提交 Pull Request

### 代码规范

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 组件使用函数式写法 + Hooks
- 服务层使用单例模式
- 配置项统一放置在 `app.config.ts`

### 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试
chore: 构建/工具
```

---

## 📄 许可证

MIT License

---

## 📞 联系我们

如有问题或建议，欢迎提交 Issue 或 Pull Request。
