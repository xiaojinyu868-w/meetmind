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

|  | ~740 | 今日情报编排与排序：内部线索来自收藏、已确认目标和活跃学习线，没有新 capture 也可由真实目标启动；外部检索计划覆盖深入、相邻与不同视角。百炼原生搜索已完成相关性选择时，只做多方向去重，不再重复调用排序模型；direct 候选仍由模型在真实 URL 中筛选。明确点过“不相关”的同一材料会被排除 |
|------|------|------|
| `qwen-asr-service.ts` | 709 | 通义千问 ASR（同步短音频 + 异步长音频） |
| `dashscope-asr-service.ts` | ~700 | Qwen 实时 ASR 客户端（2026-08 腾讯 speaker 兼容层已移除；首次连接与重连均保留 FIFO PCM、连接 ID 命名空间、心跳保活）；浏览器只连自有 proxy、不接触 DashScope Key；realtime 单遍即定稿，仅 realtime 零产出时由 Recorder 兜底批量转写并按 session 隔离回填；断连缓冲按字节预算（`reconnectAudioBufferMs`，默认 120s≈3.84MB），缓冲溢出丢帧通过 `onAudioDropped` 累计上报（含代理侧 `audio-dropped` 事件），Recorder 常驻提示——单遍化后丢帧=内容永久缺失，绝不静默；WS URL 携带 `?token=<JWT>`（localStorage `meetmind_access_token`，guest 不带）供积分 Phase 2 连接关闭结算归属用户 |
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
| `llm-service.ts` | ~750 | 统一 LLM 调用层（StepFun / DeepSeek / 通义千问 / 火山方舟 / 中转站），默认优先 `step-3.7-flash`（阶跃星辰）；`chatStream` 默认开 word-level smoothing（中文按字 / 英文按词 / 标点独立段，10ms 节流），所有走流式的对话框（/api/chat、/api/workspace/search、legacy /api/tutor）自动按词平滑刷出，可 `options.smooth: 'off'` 关闭；`chat()` 内部统一接 `point-meter` 影子计量（feature/userId 由调用链 meter context 归属，调用方零侵入） |
| `highlight-service.ts` | 675 | AI 精选片段（Smart/Fast 双模式） |
| `summary-service.ts` | 246 | 课堂摘要生成 |
| `lesson-digest-service.ts` | ~340 | 课堂结构化分段总结：segments + 图片锚点 → LLM 生成分段 digest + fallback 兜底；`normalizeLessonDigestOutput` 用前一段结束时间安全补齐模型遗漏的时间边界。桌面移动共享 |
| `tutor-service.ts` | 273 | AI 家教：引用匹配 + LLM 解释 |
| `learning-intent-service.ts` | ~220 | 深度学习意图确认：当前表达定义目标边界，历史上下文不能静默收窄宽泛愿望；只在学习路径确有歧义时生成 1-3 个动态单选/多选问题，用户作答后再次整理为最终计划，模型不可用时返回确定性计划 |
| `learning-memory-distillation-service.ts` | ~170 | 全局学习问答持久化后的独立学习理解整理：不依赖用户手动选择模式，只从本轮真实表达/作答提炼最多 2 条，支持替换近义旧理解；拒绝愿望、建议、人格与敏感推断，证据不足返回空数组，不读取或改写客观学习现场 |
| `ai-control-service.ts` | ~750 | 管理员 AI 控制台：Tutor 六模式 + 意图确认 + 学习理解整理 + 应用矩阵六类应用的链路目录、上下文样例、prompt 最终拼接预览、线上与候选配置真实结果对比、追加指令 / 模型覆盖、草稿发布与版本回退；按链路保留 JSON 或 Markdown 真实调用参数，硬产品合同始终位于实验指令之后；运行时读取失败自动回落代码基线 |
| `workshop-readiness-service.ts` | ~220 | 应用矩阵内容适配判断：先用客观证据阈值拦截空内容和过短材料，再由模型判断内容类型与可选推荐；证据充足后模型不得撤销当前层能力，避免误判让长课堂整页不可用。官方试听课直接采用策划过的 ready 评估 |
| `dify-service.ts` | 354 | Dify Agent 集成（提问引导 + 联网检索） |
| `teaching-suggestion.ts` | 256 | 教学改进建议生成 |
| `gemini-image-service.ts` | 365 | Gemini 图像生成（via undyingapi 代理）；`buildImagePrompt` 是两个 provider 共用的提示词真相源 |
| `dashscope-image-service.ts` | ~180 | DashScope 图像生成（阿里云百炼）：默认 `qwen-image-3.0-pro`（multimodal-generation 同步接口，邀测中），AccessDenied 自动降级 `qwen-image-plus`（image-synthesis 异步任务）；信息图默认 provider，`IMAGE_PROVIDER=gemini` 可退回 Gemini |
| `qwen-image-service.ts` | 146 | 通义千问图像生成 |
| `qwen-ocr-service.ts` | ~160 | Qwen-OCR（qwen-vl-ocr）图片文字提取：DashScope multimodal-generation 同步接口 + 自定义 prompt（Markdown + LaTeX + 图表还原）；图片摄入主链路，认证复用 DASHSCOPE_API_KEY |
| `volc-podcast.ts` | 582 | 火山引擎播客 TTS（WebSocket 双向流式） |
| `board-tts-service.ts` | ~300 | 板书精讲 narration TTS：DashScope SSE 流式（SpeechSynthesizer + word_timestamp_enabled），复用 DASHSCOPE_API_KEY；默认 **cosyvoice-v3-flash + longanhuan + 课堂教学指令**（2026-08 试听选型，样本在 public/demo/tts-samples/；时间戳兼容性实测：v2/v3 全系列可用，qwen-audio-3.0-tts-flash 无、plus 加 instruction 后丢失），**wav 容器**（mp3 编码器首尾 padding 会在段间拼出可闻缝）；**并发闸 1 路串行 + 1s/2s/4s 退避重试 3 次**（2026-08-18 实测：cosyvoice 免费档 QPS 极低，预取突发吃 428 惩罚性限流，机器人音降级的主因）；`alignTimingsToInput` 把引擎归一化坐标系（剥空格/数字 TN 展开/合并词）映射回输入文本下标（剥空白坐标系 + 数字段均分），`charIndexAtMs` 播放时刻→字下标插值；未配置/失败返回 null 走 fallback |
| `ink-grading-service.ts` | ~170 | 学生板演批改（Practice 闭环，对齐 AmIWrite practice）：板面笔迹图（客户端叠 6×4 网格）→ qwen3.7-plus 多模态（llm-service chat，`DASHSCOPE_VL_MODEL` 可覆盖）→ 严格 JSON；`parseInkGradeResponse` 纯函数清洗（verdict 白名单 / comment ≤60 字 / cell 越界丢弃 / marks ≤4 / **corrections 仅 partial/wrong 保留、逐行 ≤20 字、≤3 行**，不可解析 → unknown 空结果）；空间定位用网格 cell 引用（AmIWrite grid referencing 思路，粗粒度换可靠性），cell→坐标换算在客户端 `blackboard/ink-grading.ts`；**corrections = 老师示范（interpretive feedback：写错步骤的正确写法上板，Desmos 设计哲学）** |
| `photo-problem-service.ts` | ~130 | 拍题开讲·审题：图片 → Qwen3.7-Plus 多模态（`BOARD_PHOTO_VL_MODEL` > `DASHSCOPE_VL_MODEL` > qwen3.7-plus）→ { subject, statement(LaTeX), figureDesc?, studentAttempt? }；`parsePhotoProblemResponse` 纯函数清洗（isProblem=false/statement 空 → null，字段截断） |
| `photo-lecture-service.ts` | ~180 | 拍题开讲·生成管线。**one-shot 默认（2026-08 链路收敛）**：单次多模态调用（`BOARD_PHOTO_ONESHOT_MODEL` 默认 qwen3.7-plus）看照片 + 解题 + 写脚本 + 节奏标注一次完成（审题独立存在只是旧生成模型没有眼睛；解题锚定/导演标注是弱模型时代分工）；`BOARD_PHOTO_MODE=staged` 切回三段式（审题 → V4 Pro 解题锚定 → V4 Flash 生成 → 导演 pass）；`explainPhotoProblem` 编排，无题/产出不可用 → null |
| `board-director-service.ts` | ~200 | 导演 pass（节奏标注，docs/BOARD_TUTOR_ARCHITECTURE.md 导演层）：BoardScript sanitize 后按页并行调 LLM（`BOARD_DIRECTOR_MODEL` 默认 kimi-k3，Moonshot provider），产出全量 cue（字位锚点）+ 段后 breathMs；`parseDirectorResponse` 纯函数校验（下标/字位越界丢弃、action 去重、breath clamp 2500），单页失败/超时保留原节奏——增强项不是正确性项 |
| `teach-agent/` | ~640 | agent 驱动板书课（v28，"课 = agent 工具调用轨迹"，详见子域 DOMAIN.md）：tools.ts 11 个原子板书工具 + BoardEnv 环境反馈；to-board-script.ts 把 AI SDK 原生 messages 装配成 BoardScript；teach-agent-service.ts streamText loop + SSE 事件流 + dashscope 生图回填；system prompt 在 `skills/board-teaching.md`（磁盘技能，可独立迭代） |
| `web-search-service.ts` | 381 | 服务端通用联网搜索（Bing/SerpAPI/DuckDuckGo HTML + Instant Answer fallback）；`webSearchExact` 仅在 `FEED_SEARCH_MODE=direct` 时为今日情报提供真实结果 |
| `feed-retrieval-service.ts` | ~330 | 今日情报外部检索层：`auto` 在配置 `DASHSCOPE_API_KEY` 时优先调用国内可达的百炼原生 `qwen-plus` turbo 搜索，一次流式请求返回真实来源与简介，最多并行 3 个发现方向；结果已按搜索相关性排序，不再二次调用 LLM。无 DashScope 或显式 `direct` 时才使用网页搜索 + Semantic Scholar + Open Library |

### 📦 Workspace 数据管线

| 文件 | 行数 | 职责 |
|------|------|------|
| `workspace-service.ts` | 237 | 工作空间基础管理（创建/查询） |
| `workspace-account-service.ts` | ~170 | 账号统一：默认工作区补齐 + 微信旧数据归属修复 + 本地历史迁移 |
| `workspace-context-service.ts` | 838 | Capture 收集 + Ingest 处理 + 状态管理 |
| `workspace-context-types.ts` | 161 | 类型定义 + 纯工具函数 + 微信 helper |
| `backfill-captures-to-indexeddb.ts` | ~440 | 跨设备下行恢复：按 sessionId 将服务端课堂转录、说话人、困惑点、摘要、精选片段与个人笔记逐类补回 IndexedDB；不覆盖本机已有编辑，失败项可重试。`evidenceAvailable` 的 capture 绝不用列表截断的 normalizedText 造「单段兜底」（真实分段由 evidence 懒拉）；本地 ≤1 段的降级数据在拿到真实多段时自愈替换 |
| `workspace-evidence-service.ts` | ~340 | 课堂证据服务端正规化：转录分段落表，低频产物按 kind 存储；capture 列表仅返回轻量索引但保留板书 `capturedAtMs` 等课堂定位字段，兼容旧 metadata bundle。**单调递增护栏**：显式分段只许同等/更完整覆盖，normalizedText 兜底单段只许补空表——客户端 500 段快照/摘要片段回刷不会毁掉服务端全量证据 |
| `workspace-evidence-client.ts` | ~120 | 用户首次在新设备打开课堂时懒拉完整证据，合并并发请求并复用 backfill 管线写回 IndexedDB |
| `upload-recording-audio.ts` | ~90 | 登录态录音后台持久化：把本地 Blob 上传为跨设备 mediaUrl，并回写 IndexedDB / Workspace capture |
| `workspace-audio-sync-service.ts` | ~70 | 服务端按 userId + sessionId 把已上传原声绑定回正确 Workspace capture，不依赖前端保留 sourceKey |
| `retry-pending-recording-uploads.ts` | ~90 | 进入课堂时静默补传仍只有本地 Blob 的已完成录音；每次顺序处理少量，成功去重、失败保留后续重试 |
| `workspace-echo-service.ts` | ~1300 | 每日回响生成（AI 洞察/金句/推荐）；CommonStack 新 schema 不返回 title，需从 takeaway / echo 生成标题后再进质量门 |
| `workspace-search-service.ts` | 175 | 全局 AI 检索（流式带引用） |
| `commonstack-echo-service.ts` | 273 | Echo LLM 调用（System Prompt 在此） |
| `feed-service.ts` | ~740 | 今日情报编排与排序：内部线索来自收藏、已确认目标和活跃学习线，没有新 capture 也可由真实目标启动；外部检索计划覆盖深入、相邻与不同视角。百炼原生搜索已完成相关性选择时，只做多方向去重，不再重复调用排序模型；direct 候选仍由模型在真实 URL 中筛选。明确点过“不相关”的同一材料会被排除 |
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
| `wechat-auth-service.ts` | ~330 | 微信内置浏览器 OAuth 2.0；身份注册/绑定委托给 `wechat-identity-service` |
| `wechat-identity-service.ts` | ~90 | openId 统一身份语义：真实 owner 登录、首次账号创建、登录态绑定与收集流归属同步 |
| `wechat-identity-claim-service.ts` | ~150 | Prisma 事务内创建 User + AuthProvider；唯一键竞争后只返回真实 openId owner，首次登录仅签发一次会话 |
| `wechat-oauth-state-service.ts` | ~40 | Capture 微信内 OAuth 的数据库一次性 state；原子消费，支持多实例并防登录 CSRF/重放 |
| `wechat-qr-auth-service.ts` | ~270 | 公众号带参二维码挑战状态机、扫码事件提取、有效挑战复用、官方临时二维码请求 |
| `wechat-qr-auth-repository.ts` | ~150 | Prisma 挑战仓库；CAS 约束 pending→scanned→processing→终态，按 24 小时清理过期记录 |
| `wechat-qr-auth-runtime.ts` | ~35 | 装配挑战仓库、公众号 access token 与统一身份服务 |
| `wechat-qr-auth-client.ts` | ~75 | 浏览器创建/轮询二维码挑战的同源客户端 |
| `wechat-mp-service.ts` | ~260 | 公众号消息解析（XML/签名验证）；小宇宙链接的即时回执区别于泛视频链接（COPY.wechatPodcast.receipt） |
| `wechat-agent-service.ts` | ~240 | 微信 Agent 对话：分流判定（绑定用户纯文字）、画像/近期收集/历史注入、LLM 回复、客服消息推送（长文按句号切多条；`pushWechatCustomerText` 导出给导入完成通知复用）；每日 30 轮成本护栏；会话落 `WechatAgentMessage` 表 |
| `wechat-video-enrich-service.ts` | ~440 | 微信视频/播客链接后台 enrichment：meta 补全（B站/小宇宙）→ 触发 `/api/video/import` 转写 → 回写 workspaceCapture（全量分段不截断、全文 20 万字符上限、正式标题「播客名 - 单集名」、metadata 存 `originAudioUrl` 平台原始音频兜底）；provenance 平台标签按 provider/sourceMode 映射；小宇宙按 episode 去重（已转写过直接推原收集链接）；绑定用户转写完成/失败客服推送 + `settleAsrMinutes` 结算（幂等键 `video-import:wechat:{linkToken}`） |
| `wechat-media-service.ts` | 222 | 公众号 access token 缓存 + 媒体下载（图片/语音/视频 + 转码） |
| `wechat-inbox-service.ts` | 195 | 消息智能路由（角色推断/echo/tutor）；微信正文解析状态通过 `received/processing/ready/failed` 同步进 provenance |
| `wechat-voice-utils.ts` | 58 | 语音工具（预览文本/路径规范化） |
| `wechat-web-session-service.ts` | 52 | OAuth Web 会话临时存储（内存 Map, 2min TTL） |
| `wechat-pay-service.ts` | ~250 | 微信支付 APIv3 封装：Native 下单（商户私钥 RSA-SHA256 签名）、**主动查单 `queryNativeOrder`（回调冗余，按 out-trade-no 查 trade_state）**、回调验签（平台证书 PEM 或微信支付公钥 PEM 由 env 注入，公钥模式见 .env.example；不实现证书自动下载）、回调资源 AES-256-GCM 解密；env 六项不齐 `isWechatPayConfigured` 为 false |
| `recharge-order-service.ts` | ~380 | 充值订单编排（积分包 + 会员档共用 RechargeOrder）：createRechargeOrder（快照 + 30min 过期，会员档 points=0 带 membership 信息，下单失败置 failed 抛 PayUnavailableError）、markOrderPaidAndGrant（单事务到账按 packKey 分发：积分包加余额写流水 / 会员档 updateMany 原子占位 + upsert Membership 续期叠加；**pending/expired 都放行——expired 只约束二维码有效期，微信确认 SUCCESS 即兑账**，只拒 failed 终态；幂等键 `recharge:{outTradeNo}`，金额快照不符拒绝防伪造；P2002 兜底回查订单拿 userId 保证通知不丢）、getOrderForUser（仅本人 + 惰性过期）、notifyRechargePaidBestEffort（积分/会员两种文案，48h 窗口外静默） |

### 🏫 课堂 / 教学

| 文件 | 行数 | 职责 |
|------|------|------|
| `keyframe/` | ~300 | 录课「屏幕观察」关键帧检测：64 位 DCT pHash（带死区防纯色同值簇失稳）+ 稳定期结算检测器 + 浏览器抓帧（详见 `keyframe/DOMAIN.md`，架构定位见 `roadmap/v4.0-everywhere-capture.md`） |
| `lesson-title-service.ts` | ~260 | 课堂标题服务端：`主题 · 课程 · M-D` 契约 + 零信息词质量门（宁缺毋滥）+ titleSource 用户锁 + 存量回填 |
| `lesson-title-client.ts` | ~100 | 课堂标题客户端触发层：课后静默重命名 / 用户改名加锁 / 进入应用静默回填 / `requestLessonUnderstanding` 课后理解触发（2026-08 起 realtime 停录即触发，不再等课后 batch 定稿） |
| `lesson-understanding-service.ts` | ~180 | 课后理解：一次 LLM 调用输出 topic+overview+takeaways+highlights（解析校验可单测），标题/摘要/精选三个产物一次落齐 |
| `classroom-data-service.ts` | 1007 | 课堂数据共享（学生↔教师读写） |
| `classroom-flow-service.ts` | ~290 | 课中课堂脉络增量生成：模型只消费新增转录并返回 now / recent / keep 的 upsert-remove delta，服务端与 priorFlow 确定性合并；较早推进会作为课后复习材料保留，发给模型的工作记忆只带近期窗口，避免长课输入持续膨胀；内部 enum / 英文标识会被丢弃 |
| `meetmind-service.ts` | 436 | 核心业务整合（Open Notebook + LongCut） |
| `note-service.ts` | 393 | 个人笔记 CRUD |
| `notebook-service.ts` | 314 | Open Notebook（向量搜索/嵌入/笔记管理） |
| `search-service.ts` | 153 | 知识库搜索（向量 + LongCut 降级） |
| `analytics-service.ts` | 626 | 用户行为统计（DAU/会话/事件） |
| `point-meter.ts` | ~140 | 积分影子计量（Phase 1 只计量不扣费）：`recordLLMUsage` 按 `config/pricing.ts` 折算毫元成本写 `PointTransaction`（delta=0 不动余额），幂等键冲突跳过，写库失败只 warn；`runWithMeterContext`（AsyncLocalStorage）让路由/Service 入口包一层即可给底层 `llm-service.chat()` 零侵入归属 feature/userId；`meterUserIdFromRequest` 推导 guest_<ip> 归属 |
| `point-account-service.ts` | ~500 | 积分真扣费账户服务（Phase 2）：`getOrCreateWithGrants` 懒建 + 欢迎/月度幂等发放（月度面额按会员档位，幂等键 `grant:monthly:{userId}:{tier}:{YYYY-MM}`，月中升档按新档全额再发）；`checkCanSpend` 预检（月成本熔断优先于余额校验，402 契约统一来源）；`spendPoints` 事务内原子结算（余额校验 + 扣减 + 写流水含 balanceAfter，幂等键防重，costMilliYuan=0 防与影子流水双算）；`settleAsrMinutes` ASR 分钟结算（先吃当月免费额度——按档位 300/2000/6000 分钟，量纲记 `PointTransaction.quantity`，超出按积分/分钟价目，余额不足截断）；`adjustPoints` 管理端调账（不允许负余额）；`getSummary` `/api/points/summary` 契约视图（含 membership 与 asrFreeMinutesPerMonth；**先跑惰性对账**：扫该用户最近 2h 内 pending/expired 且无微信交易号的卡单，逐笔 `syncOrderFromWeChat` 兑账，补"回调丢失"的洞，best-effort 不阻塞 summary） |
| `membership-service.ts` | ~110 | 订阅会员唯一读写口：`getActiveMembership`（无记录/过期/未知档位 → free，读时判断无需定时任务）；`grantMembershipInTx`（支付到账事务内 upsert，续期从 max(now, expiresAt) 叠加天数）；`grantMembershipAdmin` 人工发放。档位数值只从 pricing.ts MEMBERSHIP_PLANS 取 |

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
