# API Routes — 服务端接口层

> API 路由是**薄壳**：解析请求 → 鉴权 → 调用 services → 返回响应。
> 业务逻辑必须放在 `lib/services/`，不要在 route.ts 里写复杂逻辑。

## 依赖规则

```
route.ts → lib/services/ + lib/utils/rate-limit
```

- ✅ 路由可以调用 `lib/services/`
- ✅ 路由可以调用 `lib/utils/rate-limit` 做速率限制
- ❌ 路由不能 import `components/`, `hooks/`, `stores/`（这些是客户端）
- ❌ 路由之间不能互相调用

## 路由总览

### 🎙️ 转录管线

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/transcribe` | POST | 标准模式转录 |
| `/api/transcribe-fast` | POST | 快速模式（DashScope 异步 API） |
| `/api/transcribe-turbo` | POST | Turbo 模式（DashScope WebSocket 实时流） |
| `/api/transcribe/status` | GET | 异步转录任务状态查询 |
| `/api/transcript-enhance` | POST | LLM 转录文本纠错增强 |
| `/api/upload-audio` | POST | 音频文件上传到临时目录 |
| `/api/asr-config` | GET | ASR proxy 可用性、模型与采样率；禁止向浏览器返回 DashScope API Key |
| `/api/asr/oneshot` | POST | 非实时短音频 ASR（语音输入对话框） |
| `/api/asr/diarize` | POST | 说话人分离（Fun-ASR 非实时 + diarization_enabled） |
| `/api/asr/corrections` | GET/POST | ASR 纠错事件记录 / 热词列表 |
| `/api/asr/corrections/aggregate` | POST | 将纠错记录聚合为热词 |
| `/api/extract-terms` | POST | 从课程主题提取关键术语表（用于 ASR 纠错） |

### 📥 内容导入

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/video/import` | POST | 视频导入（B站/YouTube/小宇宙/抖音/直链） |
| `/api/video/resolve` | GET | 旧前端视频 URL 解析兼容入口（只归一化 URL，不抓取远程媒体） |
| `/api/video/image` | GET | B 站封面图代理（避免浏览器直连 hdslb 403） |
| `/api/article/import` | POST | 图文导入（公众号/小红书/知乎等） |
| `/api/sources/ingest` | POST | 通用数据源接入（文档/文本/音频） |
| `/api/sources/ingest-image` | POST | 图片接入（OCR + 多模态 LLM） |

### 🤖 AI 能力

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/chat` | POST | AI 对话（多模型/流式/速率限制） |
| `/api/tutor` | POST | AI 家教（解释/追问/引导/联网检索） |
| `/api/tutor/agent` | POST | AI 同桌 agent-native 工具调用流 |
| `/api/tutor/intent` | POST | 深度学习开始前生成可编辑意图计划；游客也可按 Tutor 限流调用；只提出计划，不写长期记忆 |
| `/api/tutor/memory` | POST | 全局学习问答持久化后静默整理最多 2 条学习理解；访客与登录用户都可使用，route 内限流；支持替换近义旧理解，失败返回空结果且不影响最近学习现场 |
| `/api/classroom/foresight` | POST | 课堂预知气泡生成（qwen3.7-plus） |
| `/api/classroom/flow` | POST | 课中课堂脉络：模型根据带时间位置的实时转录，自主判断当前讲解、近期推进与值得课后回看的内容；前端只消费稳定 JSON 契约 |
| `/api/classroom/lesson-digest` | POST | 课堂结构化分段总结生成（飞书妙记形态，segments + 图片锚点 → 分段 digest） |
| `/api/translate/en-zh` | POST | 课堂英文片段翻译为中文 |
| `/api/translate/zh-en` | POST | 课堂中文片段翻译为英文 |
| `/api/generate-summary` | POST | 课堂摘要生成 |
| `/api/generate-topics` | POST | 精选片段生成（Smart/Fast） |
| `/api/feedback` | POST | 用户反馈 |
| `/api/feed` | POST | 今日情报：允许游客携本地 captures 匿名调用并按 IP 限流；跨课程请求可携 `learningContext.activeThread/memories/recentActivities`，无新收藏但有真实当前目标时也可生成；有 `DASHSCOPE_API_KEY` 时外部卡默认由百炼原生 turbo 搜索返回真实 URL 与简介，不依赖服务器访问 DuckDuckGo / Open Library；响应含 `contentUrl/contentKind/authors/publishedAt/perspective`，link-only 与解析失败内容不能作为原文观点证据 |

### 🧩 应用系统

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/apps/execute` | POST | 执行 AI-Native 应用插件；单课可传 legacy `input`，unit/exam 传 `contextPack`。服务端校验 tier、课数与 catalog 白名单；考试速查表必须有至少两节课，或 exam tier 的大纲/真题范围 |
| `/api/apps/plugins` | GET | 获取已注册插件列表 |
| `/api/apps/catalog` | GET | 获取应用目录 |
| `/api/apps/readiness` | POST | 结合真实原文、场景标题/来源、学习信号与 `contextTier` 判断当前层材料是否足以生成应用；ready 只返回该层 catalog 白名单，单课不含考试速查表。游客复习也会调用，已在 `public-routes.ts` 放行并由 route 自身限流 |
| `/api/apps/infographic/generate-image` | POST | Gemini 信息图生成 |

### 👤 认证

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/auth/register` | POST | 注册 |
| `/api/auth/login` | POST | 密码登录 |
| `/api/auth/login-with-code` | POST | 验证码登录 |
| `/api/auth/logout` | POST | 登出 |
| `/api/auth/me` | GET | 获取当前用户 |
| `/api/auth/refresh` | POST | 刷新 JWT |
| `/api/auth/password` | PUT | 修改密码 |
| `/api/auth/password/set` | POST | 设置密码 |
| `/api/auth/reset-password` | POST | 重置密码 |
| `/api/auth/send-code` | POST | 发送验证码 |
| `/api/auth/wechat` | GET | 微信 OAuth URL |
| `/api/auth/wechat/callback` | GET | 微信 OAuth 回调 |
| `/api/auth/learner-profile` | GET/PATCH | 读取或保存学习者画像；除可纠正的学习理解与轻量学习连续性外，只保存用户对课堂自动归组的改名/确认/暂停偏好，真实课堂 session 不复制进画像 |

### 📦 Workspace

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/workspace/current` | GET | 获取当前工作空间 |
| `/api/workspace/local-migration` | POST | 把本地 IndexedDB 学习历史迁移到当前账号的 Workspace |
| `/api/workspace/captures` | POST/PATCH/DELETE | capture 写入、更新与归档删除；写入时 canonicalize URL，同工作区相同原文自动合并，并持久化 `metadata.provenance` |
| `/api/workspace/captures/stats` | GET | captures 统计 |
| `/api/workspace/search` | POST | 全局 AI 检索（SSE 流式） |
| `/api/workspace/echoes/daily-refresh` | POST | 每日回响刷新 |

### 💬 微信

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/wechat/mp` | GET/POST | 公众号消息接收 + 自动回复 |
| `/api/wechat/bind` | POST | 微信绑定发起 |
| `/api/wechat/bind/callback` | GET | 微信绑定回调 |
| `/api/wechat/capture/[token]` | GET | 读取微信 capture、绑定状态与后台正文解析状态 |

### 📊 分析

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/analytics` | POST | 行为数据上报 |
| `/api/analytics/stats` | GET | 统计数据查询 |

### 🩺 运行维护

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/health` | GET | 非缓存健康检查；同时验证进程存活与 SQLite 可查询，健康返回 200，降级返回 503 |

## ⚠️ 超标文件

- `video/import/route.ts` (1209) — 已拆分 3 个模块（types/segment/download），仍偏大
- `tutor/route.ts` (708) — ✅ 已拆分 4 个模块，从 1763 行降至 708 行
- `transcribe-turbo/route.ts` (636) — WebSocket 转录
- `sources/ingest/route.ts` (553) — 通用接入

## video/import/ 子模块

此目录已拆分为 4 个文件：

| 文件 | 行数 | 职责 |
|------|------|------|
| `route.ts` | 1209 | POST handler + stage 执行器 + ASR 调用 |
| `video-import-types.ts` | 318 | 类型 + 常量 + 纯工具函数 |
| `video-import-segment.ts` | 369 | 文本标准化 + segment 处理管线 |
| `video-import-download.ts` | 282 | yt-dlp + 直链下载 |

## tutor/ 子模块

此目录已拆分为 5 个文件：

| 文件 | 行数 | 职责 |
|------|------|------|
| `route.ts` | 708 | POST handler + 响应解析 + 时间戳修正 |
| `tutor-types.ts` | 54 | 缓存类型/常量/操作 + SupportReference |
| `tutor-citations.ts` | 238 | 引用/资料处理工具函数（14 个） |
| `tutor-prompts.ts` | 144 | 5 个 System Prompt 常量 |
| `tutor-guidance.ts` | 396 | 引导问题生成（LLM + 规则回退） |
