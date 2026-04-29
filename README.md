# MeetMind

> **你随手种下的，会安静地长成你意想不到的东西。**

一个以学习者长期上下文为中心的 AI 学习产品。用户像发微信一样把学习现场的一切发给 MeetMind，MeetMind 先收下，后台慢慢理解，理解成熟后自然长出回声、复习、Tutor。

> 仓库现在同时承载原 MeetMind 学习产品和新的 Agent Native Infra 项目。开始开发前先看 [`REPO_MAP.md`](./REPO_MAP.md) 区分两条产品线和共享底座。

---

## 产品哲学

**先收，再懂，再教。**

用户不需要分类、不需要选功能、不需要先做决策。

### 当前聚焦：课堂场景

先打透「一节课」这个场景，再自然扩展到全场景。

一个大学生录了一节课 → MeetMind 帮他听懂了这节课 → 生成一张让他忍不住分享到班级群的回声卡。

增长单元不是「一个用户」，是「一个班级」。

### Taste

| 关键词 | 含义 |
|--------|------|
| **安静** | 不通知、不弹窗、不催促 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 没有「生成」按钮，像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 每句话都能指回真实原件 |

详见 [`docs/ECHO_PRODUCT_DEFINITION.md`](./docs/ECHO_PRODUCT_DEFINITION.md)

---

## 快速开始

```bash
git clone git@github.com:xiaojinyu868-w/meetmind.git
cd meetmind
npm install
cp .env.example .env   # 编辑 .env，填入 API Key

npm run dev             # 开发模式
```

### 环境变量

```bash
# 必需
DATABASE_URL="file:./prisma/meetmind.db"
DASHSCOPE_API_KEY=sk-your-api-key

# 微信服务号
WECHAT_APP_ID=your-app-id
WECHAT_APP_SECRET=your-app-secret
WECHAT_MP_TOKEN=your-mp-token

# Echo 模型
COMMONSTACK_ECHO_MODEL=gemini-3-flash

# 功能开关
NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER=true
NEXT_PUBLIC_ENABLE_WECHAT_LOGIN=true

# 公网
PUBLIC_DOMAIN=capture.meetmind.online
PUBLIC_PROTOCOL=https
```

### 生产部署

```bash
# 构建（低内存服务器）
NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1024" npm run build

# PM2 启动
pm2 start ecosystem.config.js

# 或手动启动
NODE_ENV=production PORT=3002 node server.js
```

| 项目 | 值 |
|------|-----|
| 域名 | `https://capture.meetmind.online` |
| 端口 | 3002 |
| 反向代理 | Nginx |
| 进程管理 | PM2 |

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 14 (App Router) |
| 语言 | TypeScript 5.3 |
| 样式 | Tailwind CSS 3.4 |
| 数据库 | Prisma 7.2 + SQLite |
| 客户端存储 | Dexie (IndexedDB) |
| AI 模型 | 阿里云百炼（通义千问）、CommonStack（Gemini） |
| 音频处理 | wavesurfer.js、fluent-ffmpeg |
| ASR | DashScope qwen3-asr-flash / qwen3-asr-flash-filetrans |

---

## 项目结构

```
meetmind/
├── server.js                 # 自定义服务器
├── prisma/                   # 数据库 schema
├── src/
│   ├── app/
│   │   ├── (main)/app/       # 收集主页面（产品核心，~9700 行）
│   │   ├── api/
│   │   │   ├── video/import/ # 视频/播客导入管线
│   │   │   ├── article/import/ # 图文导入管线
│   │   │   ├── transcribe*/  # ASR 转录
│   │   │   ├── tutor/        # AI Tutor
│   │   │   ├── workspace/    # 工作区 API
│   │   │   └── wechat/       # 微信服务号
│   │   └── wechat/           # 微信 H5 页面
│   ├── components/           # React 组件
│   │   ├── EchoCard.tsx      # 回声卡（应用内）
│   │   ├── EchoShareCard.tsx # 回声分享图（Canvas）
│   │   ├── AITutor.tsx       # AI 助教
│   │   └── Recorder.tsx      # 原声录制
│   └── lib/
│       ├── services/         # 服务层
│       │   ├── commonstack-echo-service.ts  # Echo LLM 调用
│       │   ├── workspace-echo-service.ts    # Echo 工作区逻辑
│       │   ├── xiaoyuzhou-import-service.ts  # 小宇宙播客
│       │   └── web-article-extract-service.ts # 网页文章提取
│       └── context-reach/    # 内容识别与路由
├── docs/                     # 产品文档
└── tests/                    # E2E 测试
```

---

## 当前已成立的能力

### 收集（Capture）
- 微信式聊天收集流
- 原声录制 → 后台 ASR → 去复习
- 统一上传（图片、文档、PDF、PPT、音频、视频、链接）
- 视频链接导入（B站、YouTube、小宇宙播客）
- 图文链接导入（小红书、微信公众号）
- 长音频智能 ASR（>10min 自动切换 DashScope 异步模式，支持 12 小时）
- 微信服务号轻收集入口

### 回声（Echo）
- 课堂回声：三层骨架（echo + highlights + takeaway）
- 回声卡：应用内轻卡片，系统设计语言
- 分享图：Canvas 绘制，书籍封面排版
- CommonStack + Gemini 3 Flash 生成
- 课堂回声卡可分享（增长引擎）

### AI 能力
- AI Tutor：基于收集上下文的私教对话
- 流式输出 + 思考过程可视化
- 应用矩阵：思维导图、闪卡、测验、信息图、课堂播客

### 设计系统
- Notion 式秩序白皮书：零渐变、零阴影、纯平涂
- 五色系统：canvas / card / ink / ink-secondary / divider
- 四功能色块：sand / mint / dustyblue / rose

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [`REPO_MAP.md`](./REPO_MAP.md) | 仓库边界地图：原 MeetMind / Agent Native Infra / 共享底座 |
| [`specs/agent-native-infra-spine.md`](./specs/agent-native-infra-spine.md) | 新项目顶层总纲：Agent Native Infra |
| [`docs/ECHO_PRODUCT_DEFINITION.md`](./docs/ECHO_PRODUCT_DEFINITION.md) | Echo 产品定义（taste、三层价值、增长引擎） |
| [`docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md`](./docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md) | Capture V1 产品定义、收集原则、验收清单 |
| [`docs/competition-tech-article-draft.md`](./docs/competition-tech-article-draft.md) | 竞赛技术文章草稿 |

---

## 许可证

MIT License
