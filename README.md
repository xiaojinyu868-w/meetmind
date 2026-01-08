# MeetMind 课堂助手

帮助学生在课堂上标记困惑点，课后通过 AI 家教补懂知识。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入阿里云百炼 API Key

# 3. 启动开发服务器
npm run dev
```

访问 http://localhost:3001

## 项目结构

```
meet-mind/
├── src/
│   ├── app/                    # Next.js 页面和 API
│   │   ├── page.tsx            # 学生端首页
│   │   ├── parent/             # 家长端
│   │   ├── teacher/            # 教师端
│   │   └── api/                # API 路由
│   │       ├── chat/           # 通用对话
│   │       ├── tutor/          # AI 家教
│   │       ├── transcribe/     # 语音转录
│   │       ├── asr-config/     # ASR 配置
│   │       └── upload-audio/   # 音频上传
│   ├── components/             # React 组件
│   │   ├── Recorder.tsx        # 录音组件（核心）
│   │   ├── AITutor.tsx         # AI 家教
│   │   ├── TimelineView.tsx    # 时间轴
│   │   └── ActionList.tsx      # 行动清单
│   ├── lib/
│   │   ├── services/           # 业务逻辑
│   │   │   ├── llm-service.ts          # LLM 调用
│   │   │   ├── dashscope-asr-service.ts # 实时 ASR
│   │   │   ├── qwen-asr-service.ts     # 批处理 ASR
│   │   │   └── tutor-service.ts        # AI 家教
│   │   ├── longcut/            # 时间戳/引用算法
│   │   └── db.ts               # IndexedDB
│   └── types/                  # TypeScript 类型
├── server.js                   # WebSocket 代理服务器
├── docker-compose.yml          # Open Notebook 服务
├── .env.example                # 环境变量模板
└── package.json
```

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `DASHSCOPE_API_KEY` | ✅ | 阿里云百炼 API Key |
| `LLM_MODEL` | 否 | 默认 `qwen3-max` |
| `DASHSCOPE_ASR_WS_MODEL` | 否 | 默认 `qwen3-asr-flash-realtime` |
| `GOOGLE_API_KEY` | 否 | Google Gemini |
| `OPENAI_API_KEY` | 否 | OpenAI |

## 核心功能

### 录音与转录
- **流式模式**：实时语音识别，低延迟
- **批处理模式**：录音结束后转录，高精度

### AI 家教
- 引用老师原话解释困惑点
- 追问定位具体问题
- 生成学习行动清单

### 多角色视图
- **学生端** `/`：录音 + 复习
- **家长端** `/parent`：学习概览
- **教师端** `/teacher`：班级分析

## 技术架构

```
浏览器 ─── WebSocket ───> server.js ───> 百炼 ASR
   │                                        │
   └── HTTP ───> Next.js API ───> 百炼 LLM ─┘
```

- **框架**：Next.js 14 (App Router)
- **语言**：TypeScript
- **样式**：Tailwind CSS
- **AI**：阿里云百炼（通义千问 + ASR）
- **存储**：IndexedDB

## 开发命令

```bash
npm run dev      # 开发模式（含 WebSocket）
npm run build    # 构建
npm run start    # 生产模式
npm run lint     # 代码检查
```

## License

MIT
