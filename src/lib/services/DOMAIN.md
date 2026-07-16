# Services — 业务逻辑核心层

> 所有业务逻辑都在这里。API 路由是薄壳，调用这里的函数。

## 依赖规则

```
api/route.ts → services → lib/utils, lib/db, lib/config
```

- ✅ services 可以互相调用（但避免循环）
- ✅ services 可以调用 `lib/utils/`, `lib/db/`, `lib/config/`
- ❌ services 不能 import `components/`, `hooks/`, `stores/`
- ❌ services 不能 import `app/api/`（反向依赖）

## 服务分域索引

### 🎙️ ASR 转录

| 文件 | 行数 | 职责 |
|------|------|------|
| `qwen-asr-service.ts` | 709 | 通义千问 ASR（同步短音频 + 异步长音频） |
| `dashscope-asr-service.ts` | ~660 | Qwen/腾讯兼容的实时 ASR 客户端（FIFO 音频缓冲、连接 ID 命名空间、心跳保活、长录制重连） |
| `asr/ws-url.ts` | 13 | ASR WebSocket 候选地址构建（http→ws、https→wss、8443 fallback） |
| `transcript-enhancer.ts` | 473 | 转录文本增强（规则→词库→LLM 分层纠错） |
| `media-tooling.ts` | 244 | ffmpeg/ffprobe 调用、转码、公网 URL 解析 |

### 🔗 外部平台导入

| 文件 | 行数 | 职责 |
|------|------|------|
| `bilibili-import-service.ts` | 466 | B站视频：URL 解析→音频下载→字幕提取 |
| `xiaoyuzhou-import-service.ts` | 255 | 小宇宙播客：HTML 解析→m4a 下载 |
| `web-article-extract-service.ts` | ~550 | 通用网页文章提取（Firecrawl → deprecated OpenClaw fallback → Jina Reader → 直接 fetch），返回平台、作者与提取方式 |
| `jina-reader-service.ts` | 220 | Jina Reader API 封装 |

### 🤖 AI / LLM

| 文件 | 行数 | 职责 |
|------|------|------|
| `llm-service.ts` | ~750 | 统一 LLM 调用层（StepFun / DeepSeek / 通义千问 / 火山方舟 / 中转站），默认优先 `step-3.7-flash`（阶跃星辰）；`chatStream` 默认开 word-level smoothing（中文按字 / 英文按词 / 标点独立段，10ms 节流），所有走流式的对话框（/api/chat、/api/workspace/search、legacy /api/tutor）自动按词平滑刷出，可 `options.smooth: 'off'` 关闭 |
| `highlight-service.ts` | 675 | AI 精选片段（Smart/Fast 双模式） |
| `summary-service.ts` | 246 | 课堂摘要生成 |
| `lesson-digest-service.ts` | ~340 | 课堂结构化分段总结：segments + 图片锚点 → LLM 生成分段 digest + fallback 兜底；`normalizeLessonDigestOutput` 用前一段结束时间安全补齐模型遗漏的时间边界。桌面移动共享 |
| `tutor-service.ts` | 273 | AI 家教：引用匹配 + LLM 解释 |
| `learning-intent-service.ts` | ~190 | 深度学习意图确认：模型先利用已有上下文，只在学习路径确有歧义时生成 1-3 个动态单选/多选问题；用户作答后再次整理为最终计划，模型不可用时返回确定性计划 |
| `workshop-readiness-service.ts` | ~220 | 应用矩阵内容适配判断：先用证据阈值拦截过短材料，再由模型判断学习内容类型、可用应用与可选推荐；允许 `not_ready` / 无推荐，避免把闲聊或不可靠转录包装成课程 |
| `dify-service.ts` | 354 | Dify Agent 集成（提问引导 + 联网检索） |
| `teaching-suggestion.ts` | 256 | 教学改进建议生成 |
| `gemini-image-service.ts` | 361 | Gemini 图像生成（via undyingapi 代理） |
| `qwen-image-service.ts` | 146 | 通义千问图像生成 |
| `volc-podcast.ts` | 582 | 火山引擎播客 TTS（WebSocket 双向流式） |
| `web-search-service.ts` | 381 | 服务端联网搜索（Bing/SerpAPI/DuckDuckGo HTML + Instant Answer fallback）；`webSearchExact` 为今日情报返回真实结果，不要求用户安装插件 |
| `feed-retrieval-service.ts` | ~245 | 今日情报外部检索层：网页搜索 + Semantic Scholar 论文 + Open Library 图书；网页候选不足时复用 `DASHSCOPE_API_KEY` 调 Qwen Responses `web_search`，只返回带真实 URL 的候选 |

### 📦 Workspace 数据管线

| 文件 | 行数 | 职责 |
|------|------|------|
| `workspace-service.ts` | 237 | 工作空间基础管理（创建/查询） |
| `workspace-account-service.ts` | ~170 | 账号统一：默认工作区补齐 + 微信旧数据归属修复 + 本地历史迁移 |
| `workspace-context-service.ts` | 838 | Capture 收集 + Ingest 处理 + 状态管理 |
| `workspace-context-types.ts` | 161 | 类型定义 + 纯工具函数 + 微信 helper |
| `backfill-captures-to-indexeddb.ts` | ~390 | 跨设备下行恢复：按 sessionId 将服务端课堂转录、说话人、困惑点、摘要、精选片段与个人笔记逐类补回 IndexedDB；不覆盖本机已有编辑，失败项可重试 |
| `upload-recording-audio.ts` | ~90 | 登录态录音后台持久化：把本地 Blob 上传为跨设备 mediaUrl，并回写 IndexedDB / Workspace capture |
| `workspace-audio-sync-service.ts` | ~70 | 服务端按 userId + sessionId 把已上传原声绑定回正确 Workspace capture，不依赖前端保留 sourceKey |
| `retry-pending-recording-uploads.ts` | ~90 | 进入课堂时静默补传仍只有本地 Blob 的已完成录音；每次顺序处理少量，成功去重、失败保留后续重试 |
| `workspace-echo-service.ts` | ~1300 | 每日回响生成（AI 洞察/金句/推荐）；CommonStack 新 schema 不返回 title，需从 takeaway / echo 生成标题后再进质量门 |
| `workspace-search-service.ts` | 175 | 全局 AI 检索（流式带引用） |
| `commonstack-echo-service.ts` | 273 | Echo LLM 调用（System Prompt 在此） |
| `feed-service.ts` | ~700 | 今日情报编排与排序：内部线索来自收藏、已确认目标和活跃学习线，没有新 capture 也可由真实目标启动；外部检索计划覆盖深入、相邻与不同视角，模型只在真实网页/论文/书籍候选中筛选，禁止编造外链 |
| `feed-preference-service.ts` | ~120 | 今日情报长期偏好：从账号 Feedback 读取有用/不相关记录，并与当前设备即时反馈合并；同一内容以设备最新判断优先 |

### 👤 用户 / 认证

| 文件 | 行数 | 职责 |
|------|------|------|
| `auth-service.ts` | 998 | 注册/登录/JWT/刷新令牌/权限验证 |
| `quota-service.ts` | 343 | API 配额管理（按角色/类型/窗口限制） |
| `rate-limit-service.ts` | 550 | 速率限制（Redis 滑动窗口） |
| `verification-code-service.ts` | 203 | 验证码生成/验证（6位, 5分钟过期） |
| `email-service.ts` | 289 | SMTP 邮件发送 |
| `sms-service.ts` | 175 | 腾讯云短信 |

### 💬 微信

| 文件 | 行数 | 职责 |
|------|------|------|
| `wechat-auth-service.ts` | 413 | 微信 OAuth 2.0 登录 |
| `wechat-mp-service.ts` | 252 | 公众号消息解析（XML/签名验证） |
| `wechat-media-service.ts` | 222 | 媒体下载（图片/语音/视频 + 转码） |
| `wechat-inbox-service.ts` | 195 | 消息智能路由（角色推断/echo/tutor）；微信正文解析状态通过 `received/processing/ready/failed` 同步进 provenance |
| `wechat-voice-utils.ts` | 58 | 语音工具（预览文本/路径规范化） |
| `wechat-web-session-service.ts` | 52 | Web 会话临时存储（内存 Map, 2min TTL） |

### 🏫 课堂 / 教学

| 文件 | 行数 | 职责 |
|------|------|------|
| `classroom-data-service.ts` | 1007 | 课堂数据共享（学生↔教师读写） |
| `classroom-flow-service.ts` | ~215 | 课中课堂脉络生成：让默认可用模型基于实时转录自主判断当前讲解、近期推进与课后保留点；只约束渲染 JSON，不用关键词树替模型决定课堂结构 |
| `meetmind-service.ts` | 436 | 核心业务整合（Open Notebook + LongCut） |
| `note-service.ts` | 393 | 个人笔记 CRUD |
| `notebook-service.ts` | 314 | Open Notebook（向量搜索/嵌入/笔记管理） |
| `search-service.ts` | 153 | 知识库搜索（向量 + LongCut 降级） |
| `analytics-service.ts` | 626 | 用户行为统计（DAU/会话/事件） |

### 🔧 基础设施

| 文件 | 行数 | 职责 |
|------|------|------|
| `health-check.ts` | 86 | 浏览器 API 可用性检查 |
| `app-workspace-state.ts` | 38 | 持久化视图状态（24h TTL），含 `PersistedVideoWorkspaceTab`（chat/confusion/transcript/apps） |
| `anchor-service.ts` | 165 | 困惑锚点 IndexedDB CRUD |
| `conversation-service.ts` | 314 | 对话历史 CRUD |
| `memory-service.ts` | 157 | 课堂时间线本地持久化 |
| `memory-migration.ts` | 251 | localStorage→IndexedDB 迁移 |
| `longcut-service.ts` | 119 | LongCut API 调用层 |
| `longcut-utils.ts` | 160 | LongCut 本地算法封装 |
| `file-parse-service.ts` | 220 | M11：把 File（pdf/docx/ppt/图片/音频/视频/纯文本）解析成纯文本，给「聊聊你想要的」/全局对话注入 supportMaterials 用。内部按 MIME/后缀分流到 `/api/sources/ingest` / `/api/sources/ingest-image` / `/api/transcribe`。**不写 IndexedDB / 不动 collection** —— 是 `useSourceImport` 的轻量 helper 表亲。 |
| `index.ts` | 13 | barrel 导出 |

## ⚠️ 超标文件（>500 行）

改动这些文件时必须格外小心，优先考虑能否拆分：

- `workspace-echo-service.ts` (1303) — Echo 数据管线
- `classroom-data-service.ts` (1007) — 课堂数据
- `auth-service.ts` (998) — 认证
- `workspace-context-service.ts` (947) — Capture 管线
- `qwen-asr-service.ts` (709) — ASR
- `highlight-service.ts` (675) — 精选片段
- `analytics-service.ts` (626) — 数据分析
- `volc-podcast.ts` (582) — 播客 TTS
- `rate-limit-service.ts` (550) — 速率限制
- `llm-service.ts` (603) — LLM 调用（DeepSeek / DashScope / Ark / Relay）
