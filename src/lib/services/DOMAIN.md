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
| `dashscope-asr-service.ts` | 460 | DashScope WebSocket 实时 ASR 客户端 |
| `transcript-enhancer.ts` | 473 | 转录文本增强（规则→词库→LLM 分层纠错） |
| `media-tooling.ts` | 244 | ffmpeg/ffprobe 调用、转码、公网 URL 解析 |

### 🔗 外部平台导入

| 文件 | 行数 | 职责 |
|------|------|------|
| `bilibili-import-service.ts` | 466 | B站视频：URL 解析→音频下载→字幕提取 |
| `xiaoyuzhou-import-service.ts` | 255 | 小宇宙播客：HTML 解析→m4a 下载 |
| `web-article-extract-service.ts` | 390 | 通用网页文章提取（Jina Reader + 直接 fetch） |
| `jina-reader-service.ts` | 220 | Jina Reader API 封装 |

### 🤖 AI / LLM

| 文件 | 行数 | 职责 |
|------|------|------|
| `llm-service.ts` | 514 | 统一 LLM 调用层（通义千问/火山方舟/中转站） |
| `highlight-service.ts` | 675 | AI 精选片段（Smart/Fast 双模式） |
| `summary-service.ts` | 246 | 课堂摘要生成 |
| `tutor-service.ts` | 273 | AI 家教：引用匹配 + LLM 解释 |
| `dify-service.ts` | 354 | Dify Agent 集成（提问引导 + 联网检索） |
| `teaching-suggestion.ts` | 256 | 教学改进建议生成 |
| `gemini-image-service.ts` | 361 | Gemini 图像生成（via undyingapi 代理） |
| `qwen-image-service.ts` | 146 | 通义千问图像生成 |
| `volc-podcast.ts` | 582 | 火山引擎播客 TTS（WebSocket 双向流式） |
| `web-search-service.ts` | 381 | 联网搜索（Bing/SerpAPI/DuckDuckGo） |

### 📦 Workspace 数据管线

| 文件 | 行数 | 职责 |
|------|------|------|
| `workspace-service.ts` | 237 | 工作空间基础管理（创建/查询） |
| `workspace-context-service.ts` | 838 | Capture 收集 + Ingest 处理 + 状态管理 |
| `workspace-context-types.ts` | 161 | 类型定义 + 纯工具函数 + 微信 helper |
| `workspace-echo-service.ts` | 1267 | 每日回响生成（AI 洞察/金句/推荐） |
| `workspace-search-service.ts` | 175 | 全局 AI 检索（流式带引用） |
| `commonstack-echo-service.ts` | 273 | Echo LLM 调用（System Prompt 在此） |

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
| `wechat-inbox-service.ts` | 195 | 消息智能路由（角色推断/echo/tutor） |
| `wechat-voice-utils.ts` | 58 | 语音工具（预览文本/路径规范化） |
| `wechat-web-session-service.ts` | 52 | Web 会话临时存储（内存 Map, 2min TTL） |

### 🏫 课堂 / 教学

| 文件 | 行数 | 职责 |
|------|------|------|
| `classroom-data-service.ts` | 1007 | 课堂数据共享（学生↔教师读写） |
| `parent-service.ts` | 398 | 家长端（困惑时刻 + AI 摘要） |
| `meetmind-service.ts` | 436 | 核心业务整合（Open Notebook + LongCut） |
| `note-service.ts` | 393 | 个人笔记 CRUD |
| `notebook-service.ts` | 314 | Open Notebook（向量搜索/嵌入/笔记管理） |
| `search-service.ts` | 153 | 知识库搜索（向量 + LongCut 降级） |
| `analytics-service.ts` | 626 | 用户行为统计（DAU/会话/事件） |

### 🔧 基础设施

| 文件 | 行数 | 职责 |
|------|------|------|
| `health-check.ts` | 86 | 浏览器 API 可用性检查 |
| `app-workspace-state.ts` | 38 | 持久化视图状态（24h TTL） |
| `anchor-service.ts` | 165 | 困惑锚点 IndexedDB CRUD |
| `conversation-service.ts` | 314 | 对话历史 CRUD |
| `memory-service.ts` | 157 | 课堂时间线本地持久化 |
| `memory-migration.ts` | 251 | localStorage→IndexedDB 迁移 |
| `longcut-service.ts` | 119 | LongCut API 调用层 |
| `longcut-utils.ts` | 160 | LongCut 本地算法封装 |
| `index.ts` | 13 | barrel 导出 |

## ⚠️ 超标文件（>500 行）

改动这些文件时必须格外小心，优先考虑能否拆分：

- `workspace-echo-service.ts` (1267) — Echo 数据管线
- `classroom-data-service.ts` (1007) — 课堂数据
- `auth-service.ts` (998) — 认证
- `workspace-context-service.ts` (947) — Capture 管线
- `qwen-asr-service.ts` (709) — ASR
- `highlight-service.ts` (675) — 精选片段
- `analytics-service.ts` (626) — 数据分析
- `volc-podcast.ts` (582) — 播客 TTS
- `rate-limit-service.ts` (550) — 速率限制
- `llm-service.ts` (514) — LLM 调用
