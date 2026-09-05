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
| `/api/transcribe` | POST | 标准模式转录（2026-08 单遍化后：默认流程不走，保留作手动「重新精转」与文件导入/兜底转写） |
| `/api/transcribe-fast` | POST | 快速模式（DashScope 异步 API），同上；LLM 后校对（post-edit，DeepSeek V4 Flash）默认开启挂在此链路 |
| `/api/transcribe-turbo` | POST | Turbo 模式（DashScope WebSocket 实时流），同上 |
| `/api/transcribe/status` | GET | 异步转录任务状态查询 |
| `/api/transcript-enhance` | POST | LLM 转录文本纠错增强 |
| `/api/upload-audio` | POST | 音频文件上传到临时目录 |
| `/api/asr-config` | GET | ASR proxy 可用性、模型与采样率；禁止向浏览器返回 DashScope API Key |
| `/api/asr/oneshot` | POST | 非实时短音频 ASR（语音输入对话框） |
| `/api/board/tts` | POST | 板书精讲 narration TTS（DashScope SpeechSynthesizer SSE + 字级时间戳；默认 cosyvoice-v3-flash + longanhuan + 课堂教学指令，wav 容器消除 mp3 段间缝；服务端并发闸 1 路串行 + 1s/2s/4s/8s/16s 退避重试 6 次——cosyvoice 免费档 428 惩罚窗口实测 10s+，宁等 31s 也不把 null 抛给前端降级机器人音；≤500 字校验 + 两级缓存：进程内 LRU 64 条 + 磁盘缓存 `data/board-tts-cache/` 200 条 FIFO（v27——demo 重播与 dev 重启零重合成）；合成失败 503 由前端降级 speechSynthesis/timer） |
| `/api/board/hanzi/[char]` | GET | hanzi-writer 笔画数据自托管（读本地 hanzi-writer-data 依赖包，替代 jsDelivr CDN——实测每字 1~3s 是书写卡顿最大来源；单 CJK 字符校验 + 进程内缓存 + immutable；数据为 Arphic Public License，见包内 ARPHICPL.TXT） |
| `/api/board/grade-ink` | POST | 学生板演批改（Practice 闭环）：{ image: 叠网格笔迹图 dataURL ≤4.5MB, question, answer ≤2000 字 } → qwen3.7-plus 多模态 → { verdict, comment, marks }（cell 网格坐标，服务端清洗）；失败 502 前端静默降级 |
| `/api/board/photo-explain` | POST | 拍题开讲（Phase 1 AHA，2026-08）：{ image: 题目照片 dataURL ≤4.5MB } → 审题（photo-problem-service，Qwen3.7-Plus）→ 独立解题锚定（DeepSeek V4 Pro）→ BoardScript 生成（DeepSeek V4 Flash）→ { script, problem, models }；照片无题 422 `not_a_problem`、上游失败 502；全程 30-90s 前端分阶段文案覆盖 |
| `/api/board/teach-agent` | POST | agent 驱动板书课（v28，SSE）：{ topic ≤100字, material?, model? } → text/event-stream（meta/text delta/tool 进度/image 进度/done{title, script}/error）。一节课 = 一次 streamText 运行（默认 kimi/kimi-k3 经百炼兼容模式，`TEACH_AGENT_MODEL`/`TEACH_AGENT_BASE_URL` 可覆盖）：agent 文本流即讲稿、11 个原子板书工具即板书，轨迹 = AI SDK 原生 messages，walker（teach-agent/to-board-script.ts）装配成 BoardScript；messages 不转发前端 |
| `/api/asr/diarize` | POST | 说话人分离（Fun-ASR 非实时 + diarization_enabled）。2026-08 起不再自动触发，保留供手动「重新精转」 |
| `/api/asr/corrections` | GET/POST | ASR 纠错事件记录 / 热词列表 |
| `/api/asr/corrections/aggregate` | POST | 将纠错记录聚合为热词 |
| `/api/extract-terms` | POST | 从课程主题提取关键术语表（用于 ASR 纠错） |

### 📥 内容导入

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/video/import` | POST | 视频导入（B站/YouTube/小宇宙/抖音/直链）；成功转写后按分钟接入积分结算（与录课共享 600 分钟/月免费额度，reason=`asr:import`，详见 api/points/DOMAIN.md）；长音频整文件 filetrans 阈值按模型族分派（qwen-audio 新族 12h，旧族 28min）；`temp-audio/video_import_*` 成品音频是用户收集的内容本体，不随 6h 临时清理删除（复习页播放依赖），平台原始音频地址存 metadata `originAudioUrl` 兜底 |
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
| `/api/memory/events` | POST | 学习记忆事件入口（P0 事件化，详见 `memory/DOMAIN.md`）：Bearer 登录限定；落 `LearningEvent` 后服务端异步蒸馏合并回画像，立即返回 `{ ok, eventId }`；幂等键撞 unique 静默返回已有 |
| `/api/classroom/foresight` | POST | 课堂预知气泡生成（qwen3.7-plus） |
| `/api/classroom/flow` | POST | 课中课堂脉络：请求体用 `newSegments` 只提交上次成功更新后新增的实时转录，并携 `priorFlow` 工作记忆；模型返回 upsert/remove 增量，服务端合并成稳定渲染 JSON；生成失败返回 5xx，让客户端保留未消费游标重试 |
| `/api/classroom/lesson-digest` | POST | 课堂结构化分段总结生成（飞书妙记形态，segments + 图片锚点 → 分段 digest） |
| `/api/classroom/understanding` | POST | 课后理解（一次 LLM 调用）：标题（用户锁保护）+ 课堂摘要 + 精选片段一次落齐。2026-08 单遍化后由 realtime 定稿（停录即发布）直接触发，不再等课后 batch |
| `/api/translate/en-zh` | POST | 课堂英文片段翻译为中文 |
| `/api/translate/zh-en` | POST | 课堂中文片段翻译为英文 |
| `/api/generate-summary` | POST | 课堂摘要生成 |
| `/api/titles/lock` | POST | 用户手动改名加锁：写标题 + metadata.titleSource='user'，自动标题系统不再覆盖 |
| `/api/titles/backfill` | POST | 存量零信息标题（录音 HH:MM / 屏幕截图）静默回填，单次最多 10 条 |
| `/api/generate-topics` | POST | 精选片段生成（Smart/Fast） |
| `/api/feedback` | POST | 用户反馈 |
| `/api/feed` | POST | 今日情报：允许游客携本地 captures 匿名调用并按 IP 限流；跨课程请求可携 `learningContext.activeThread/memories/recentActivities`，无新收藏但有真实当前目标时也可生成；有 `DASHSCOPE_API_KEY` 时外部卡默认由百炼原生 turbo 搜索返回真实 URL 与简介，不依赖服务器访问 DuckDuckGo / Open Library；响应含 `contentUrl/contentKind/authors/publishedAt/perspective`，link-only 与解析失败内容不能作为原文观点证据 |

### 🌐 清小搭兼容层（OpenAI 兼容，详见 `compat/DOMAIN.md`）

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/compat/v1/models` | GET | 清小搭网关连通性/凭证校验（静态 Bearer `XIAODA_API_KEY`），返回固定模型列表 |
| `/api/compat/v1/chat/completions` | POST | 「上场前」试讲听众 agent 的 OpenAI 兼容对话入口；SSE 流式 + 非流式 JSON；入参 system 丢弃、persona 固定为 rehearsal-prompts；复用 Tutor provider 解析 |

### 🧩 应用系统

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/apps/execute` | POST | 执行 AI-Native 应用插件；单课可传 legacy `input`，unit/exam 传 `contextPack`。服务端校验 tier、课数与 catalog 白名单；考试速查表必须有至少两节课，或 exam tier 的大纲/真题范围 |
| `/api/apps/plugins` | GET | 获取已注册插件列表 |
| `/api/apps/catalog` | GET | 获取应用目录 |
| `/api/apps/readiness` | POST | 结合真实原文、场景标题/来源、学习信号与 `contextTier` 给出应用推荐；模型判断只影响推荐与提示语气，`allowedAppKeys` 始终是该层 catalog 白名单（单课不含考试速查表），只有空内容 / 极短碎片（<2 段或 <80 字或 <20 秒）才返回 `not_ready`。游客复习也会调用，已在 `public-routes.ts` 放行并由 route 自身限流 |
| `/api/apps/infographic/generate-image` | POST | Gemini 信息图生成 |
| `/api/podcast/audio/[file]` | GET | 读取运行时生成的播客 mp3（public/uploads/podcast/；next start 下运行时新文件走静态 404，故同信息图一样走动态路由） |

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
| `/api/auth/wechat` | GET | 微信内置浏览器 OAuth URL |
| `/api/auth/wechat/callback` | GET/POST | 微信 OAuth 回调与一次性 Web session 交换 |
| `/api/auth/wechat/qr` | POST/GET | 创建公众号带参二维码并轮询登录/绑定结果；挑战由 HttpOnly 浏览器 Cookie 绑定，5 分钟过期；POST 按网络身份 + 浏览器双限流并复用有效挑战；桌面端（Electron）可用 `clientNonce` 代替 Cookie（POST 传入、GET 轮询原样带回） |
| `/api/auth/learner-profile` | GET/PATCH | 读取或保存学习者画像；除可纠正的学习理解与轻量学习连续性外，只保存用户对课堂自动归组的改名/确认/暂停偏好，真实课堂 session 不复制进画像 |

### 📦 Workspace

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/workspace/current` | GET | 获取当前工作空间 |
| `/api/workspace/local-migration` | POST | 把本地 IndexedDB 学习历史迁移到当前账号的 Workspace |
| `/api/workspace/captures` | POST/PATCH/DELETE | capture 写入、更新与归档删除；写入时 canonicalize URL，同工作区相同原文自动合并，并持久化 `metadata.provenance` |
| `/api/workspace/captures/stats` | GET | captures 统计 |
| `/api/workspace/captures/[captureId]/evidence` | GET | 按 capture 懒加载完整课堂证据（转录分段 + artifacts） |
| `/api/workspace/captures/[captureId]/artifacts` | POST | 追加证据 artifact（kind 自由字符串，如 `keyframe`/`screenshot`），按 (captureId, kind, artifactKey) 幂等 upsert；桌面壳与录课关键帧的写入入口 |
| `/api/workspace/upload-audio` | POST | 录音原声持久化（Bearer，按 userId/sessionId 幂等覆盖，异步生成波形 peaks） |
| `/api/workspace/audio/[user]/[file]` | GET | 流式返回持久化音频（支持 Range；运行时上传文件必须走动态路由） |
| `/api/workspace/upload-image` | POST | 截图/关键帧原图持久化（Bearer，≤20MB，png/jpg/webp/gif/bmp），返回 mediaUrl 供 capture 或 artifact 引用 |
| `/api/workspace/images/[user]/[file]` | GET | 返回持久化图片（与 audio 路由同构，不可猜路径防枚举） |
| `/api/workspace/search` | POST | 全局 AI 检索（SSE 流式） |
| `/api/workspace/echoes/daily-refresh` | POST | 每日回响刷新 |

### 💬 微信

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/wechat/mp` | GET/POST | 公众号验签、消息接收与自动回复；优先截获二维码 `subscribe/SCAN` 事件更新认证挑战，不写入收集流；绑定用户的纯文字消息分流给微信 Agent（`wechat-agent-service.ts`），异步客服消息回复，不占 5 秒回执；视频/播客链接的元数据补全 + 自动转写 + 完成客服推送在 `wechat-video-enrich-service.ts`（B站/小宇宙；小宇宙按 episode 去重，绑定用户结算 ASR 分钟） |
| `/api/wechat/bind` | POST | Capture 邮箱/密码兼容绑定；必须用服务端 `linkToken` 派生 openId，不接受客户端指定微信身份 |
| `/api/wechat/bind/callback` | GET/POST | 微信内 Capture OAuth 授权与回调：authorize 必须验证真实 linkToken、双限流并创建数据库一次性 state；POST 交换一次性 Web session |
| `/api/wechat/capture/[token]` | GET | 读取微信 capture、绑定状态与后台正文解析状态 |
| `/api/wechat/pay-notify` | POST | 微信支付结果回调（白名单无 Bearer，APIv3 平台证书验签）：验签 → AES-256-GCM 解密 → 校验单号/商户号/金额快照 → `markOrderPaidAndGrant` 单事务到账（幂等；本地已过期订单微信确认 SUCCESS 仍到账）→ best-effort 客服消息通知；详见 `src/app/api/pay/DOMAIN.md` |

### 💳 支付（积分充值）

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/pay/recharge` | POST | 创建充值订单 + 微信 Native 下单，返回 `{ outTradeNo, codeUrl, amountFen, points }` |
| `/api/pay/order/[outTradeNo]` | GET | 订单状态轮询（仅本人），返回 `{ status, points, amountFen, packKey }` |

契约细节见 `src/app/api/pay/DOMAIN.md`。

### 📊 分析

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/analytics` | POST | 行为数据上报 |
| `/api/analytics/stats` | GET | 统计数据查询 |

### 🪙 积分（Phase 2：真扣费，详见 `points/DOMAIN.md`）

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/points/summary` | GET | 积分账户总览（Bearer；懒建 + 欢迎 500 / 月度 800 发放；含最近 20 条流水；**惰性对账**：顺带兑掉该用户最近 2h 内回调丢失的卡单） |
| `/api/points/asr-quota` | GET | ASR 录课免费额度查询（Bearer；每月 600 分钟免费，超出 2 积分/分钟） |
| `/api/points/settle-asr` | POST | ASR 分钟结算（内部接口，`x-internal-secret` 鉴权；server.js WS 关闭时回调） |
| `/api/admin/points/adjust` | POST | 管理端调账（鉴权同 `/api/analytics/stats`；kind='adjust' 留痕，不允许负余额） |

### 🛠️ 管理员 AI 控制

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/admin/ai-control` | GET/POST | 仅管理员可用；读取 Tutor 六模式、学习意图确认、长期学习理解整理，以及应用矩阵全部六类应用的上下文输入、运行选项、模型路由与提示词版本，并执行 prompt 预览、线上/候选真实结果对比、保存草稿、发布与回滚。对比复用各链路真实的 system/user input 与 provider/输出格式合同：导图走 Markdown 文本，其余应用走各自结构化 JSON；播客试跑到脚本与章节计划为止，不触发收费 TTS。不持久化对话，并复用 Tutor 限流。管理员指令只能追加，不能覆盖隐私、引用、场景、用户证据、学习层级和应用证据合同。 |
| `/api/admin/costs` | GET | 仅管理员可用（鉴权同 `/api/analytics/stats`）；积分影子计量成本视图：`?days=1-90`（默认 7），返回窗口内合计、feature（PointTransaction.reason）× modelId 聚合与每日趋势（请求数 / tokens / costMilliYuan），内存聚合不引 raw SQL |

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
