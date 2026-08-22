# /api/compat — 清小搭 OpenAI 兼容适配层

> 把 MeetMind 的「上场前」试讲听众 agent 暴露为 OpenAI 兼容 HTTP 服务，供清华
> 清小搭智能体广场网关调用。baseUrl = `https://<域名>/api/compat/v1`。
> 文本 + 语音（input_audio 转写注入）对话链路；鉴权为平台约定的静态 Bearer 凭证，
> 不走产品自有登录态。

## 端点

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/compat/v1/models` | GET | 连通性 / 凭证校验；返回固定模型列表（`shangchangqian`），不触达真实 LLM |
| `/api/compat/v1/chat/completions` | POST | 对话入口；`stream === true`（严格 JSON 布尔）走手动 SSE（role 帧 → 增量帧 → 带 usage 的 stop 帧 → `[DONE]`），否则返回 OpenAI 非流式 JSON；`max_tokens` 映射 `maxOutputTokens`，`model` 忽略 |
| `/api/compat/v1/files/[name]` | GET | 讲稿产物托管（docx 附件 + 在线上场包页），**免 Bearer**，见「讲稿产物」节 |

## 鉴权

- `Authorization: Bearer <XIAODA_API_KEY>`，两端点共用 `v1/auth.ts` 的 `checkXiaodaAuth`
- env 未配置 → 503 `service_disabled`；凭证缺失/不匹配 → 401

## 请求处理约定

- 入参 `system` 消息一律丢弃，persona 固定为 `src/lib/prompts/rehearsal-prompts.ts`
  的 `REHEARSAL_SYSTEM_PROMPT`（「上场前」：尖锐但善意的试讲听众，v2 起含讲稿适配
  与追问预测清单能力，v3 起讲稿输出带【讲稿开始】/【讲稿结束】解析锚点，
  版本 `2026-08-rehearsal-v3`）
- `content` 为多模态 part 数组时拼接 `type: 'text'`；`input_audio` 走下方音频链路；
  `image_url` / `file` 等 part 跳过不报错；`tool` 角色降级为 `user`（纯文本链路无 tool 协议）
- 空消息体 / 无有效消息（text 与 audio 都没有）→ 400

## 音频链路（input_audio → 转写注入）

平台只给 OSS 公网签名 URL（无 base64），签名有时效，**收到请求当次处理，不缓存**。
实现收口在 `v1/audio-transcribe.ts`，消息预处理（text 拼接 + 转写注入）收口在
`v1/chat/completions/message-preprocess.ts` 的 `normalizeMessages`
（同一条消息 text + audio 共存时两者都保留，text 在前、转写块在后）：

1. **预检拉取**：仅 http/https；headers-only GET（读响应头即 cancel body），30s 超时；
   `Content-Length` > 25MB 直接拒绝（缺失时放行，OSS 正常都会带）
2. **转写**：复用现有批量转写链路 `src/lib/services/qwen-asr-tasks.ts` 的
   `submitAsyncTask` + `waitForTask`（DashScope filetrans，`language='auto'`）——
   把 OSS URL 直接交给 DashScope 拉取，本侧不落地音频、不依赖 `ASR_PUBLIC_HOST` 回源、
   不需要 ffmpeg 分片（filetrans 原生支持 mp3 与分钟级音频）。轮询预算 60s，
   给 LLM 推理留余量（网关总超时 120s）
3. **注入**：成功 → 该条 user 消息尾部追加 `[语音试讲转写]\n<转写文本>`；
   失败 / 空结果 → 追加 `[语音转写失败，已忽略]`，记 warn 日志，**不 500、不打断主流程**，
   由 persona 告诉用户"这段音频我没拿到，请重发或换成文字讲"
4. 一条消息多个 audio part 串行处理

**env**：复用现有 `DASHSCOPE_API_KEY` / `DASHSCOPE_ASR_FILE_MODEL`，无新增变量；
key 缺失时音频降级为失败说明，纯文本对话不受影响。

**流式转写进度帧（delta.reasoning）**：含 `input_audio` 的 `stream:true` 请求走
`v1/chat/completions/audio-progress-stream.ts`——转写推迟到 SSE 流内执行，先返回
HTTP 头，转写各阶段立刻下发 reasoning 进度帧（平台 L1 思考过程，前端渲染为
"思考中"动画），帧序：`正在接收语音…`（预检拉取）→ `正在转写语音…`（转写轮询）→
`听完了，正在分析…`（转写成功，能拿到音频时长时带"约 N 秒"）→ role 帧 → content 帧
→ stop 帧 → `[DONE]`。reasoning 帧 chunk 结构与 content 帧一致，仅 `delta` 字段为
`{reasoning}`。文案是进度提示不是思维链：面向用户、不暴露转写服务 / URL 等细节。
reasoning 帧发出后 HTTP 头已送，此后**任何错误**（无有效消息、streamText 初始化失败、
首增量前上游抛错、中途断流）一律走"带 `error` 的 stop 帧 + `[DONE]`"流内兜底，
不再回 HTTP 500（清小搭 §5.6）；仅 provider key 缺失（流尚未打开）仍回 500
`config_error`。

**取舍说明**：非流式路径（`stream !== true`）转写仍在请求阶段阻塞执行——JSON 响应
无法呈现 reasoning 进度，阻塞期间（最长约 60s）用户无输出是可接受取舍，平台走网关
总超时兜底。无音频的流式请求保持"首增量探测失败 → HTTP 500"原逻辑不变。

**取舍说明**：没有复用 `/api/transcribe-fast` 的服务端管线（ffmpeg 分片 + 公网回源
temp-audio），因为它依赖 `ASR_PUBLIC_HOST` 且面向长音频精转；清小搭场景是分钟级
公网 URL，filetrans 直交 URL 是最小路径。`qwen-asr-tasks.ts` 是纯服务端 TS，未做任何改动。

## 讲稿产物（marker → docx 附件 + 在线上场包页）

persona v3 约定：模型输出讲稿时必须用 `【讲稿开始】` / `【讲稿结束】` 包裹完整正文
（参考 goal mode `---我想要的---` 先例，是后端解析锚点；正文照常展示给用户）。
实现收口在 `v1/rehearsal-artifacts.ts` + `v1/docx-writer.ts`：

1. **解析**：流式路径在 stop 帧前已累计全量文本（route.ts 与 audio-progress-stream.ts
   的增量循环顺手累计），非流式同理；取第一对完整标记之间的文本。只有开始没有结束
   （标记不完整）→ 视为无标记；多对标记 → 只取第一对。**无标记 → 无产物，行为与
   未接入产物前完全一致**；产物生成失败也只记 warn 不打断主流程。
2. **docx**：不新增 npm 依赖，`docx-writer.ts` 手写最小 store-only ZIP（local file
   header + central directory + CRC32，stored 不压缩），条目 `[Content_Types].xml` /
   `_rels/.rels` / `word/document.xml`；讲稿按行转 `<w:p><w:r><w:t xml:space="preserve">`
   段落，XML 转义 `&<>"`，首段为「试讲讲稿 · 生成于 <时间>」。
3. **上场包 HTML**：同内容生成自包含页面（inline CSS 无外部资源），顶部场景信息
   占位（场合/听众/时长），大字号高行距适配"走廊里看手机"，含 `@media print` 规则。
4. **托管**：落盘 `data/xiaoda-files/`（运行时 mkdirSync recursive；文件名
   `crypto.randomBytes(16)` hex + 扩展名，不可猜），每次写入顺手删除 mtime 超过
   24h 的旧文件（懒清理）。`GET /api/compat/v1/files/[name]` 提供下载/查看，
   name 严格校验 `^[a-f0-9]{32}\.(docx|html)$` 防路径穿越；docx 带
   `Content-Disposition: attachment; filename*=UTF-8''<编码后的中文文件名>`。
   绝对 URL 从请求 `x-forwarded-proto` / `x-forwarded-host` / `host` 推导，不写死域名。
5. **挂载**：流式在 stop 帧**之前**追加一帧 content
   （`\n\n📄 讲稿附件已生成，也可在线查看：{htmlUrl}`），stop 帧顶层挂
   `x_soda: { attachments: [{ fileUrl, fileName: "试讲讲稿.docx", fileType: "word",
   mimeType, fileSize, expiresAt: +24h ISO }] }`；非流式把提示行追加到 content、
   响应顶层挂同名结构。

**免鉴权取舍**：files 路由**不要求 Bearer**——清小搭前端渲染附件卡片与用户点开
链接都是直接 GET，不带凭证；访问控制靠 32 位 hex 不可猜文件名 + 24h TTL，与仓库
`/api/workspace/audio/*` 档位2 同策略。代价是链接在 TTL 内可被任何持有者打开，
讲稿内容敏感度低（用户自己的试讲稿），可接受。

## 每日成本闸

适配层对公网开放（单 Bearer），`v1/daily-cap.ts` 做进程内用量兜底：Map key 为 UTC
日期字符串，chat 请求数与音频转写次数分桶计数，跨天换桶并懒清理旧桶。闸值 env
可调：`XIAODA_DAILY_CHAT_CAP`（默认 500）、`XIAODA_DAILY_AUDIO_CAP`（默认 100）。
计数时机：chat 在鉴权通过后、业务执行前 +1；含 input_audio 的请求在业务执行前做
音频闸预检（不计数），音频计数只在确实进入转写时 +1（`transcribeInputAudio` 入口，
预检失败/缺 key 的降级也计）。超闸返回 429
`{error:{type:"daily_cap_exceeded",message:"今日体验名额已用完，明天再来"}}`。
**多实例部署时必须换共享存储**（如 Redis）——PM2 单进程内存计数即可，多实例各自
计数会导致闸值失真。

## 模型链路

完全复用 Tutor 的 provider 解析：`resolveTutorAgentProviderFallbacks(process.env, {})`
取第一个有 key 的 provider → `createTutorAgentChatModel(provider, { thinking: false })`
→ `streamText`（AI SDK v6）。无可用 key → 500 `config_error`；未产出内容前上游抛错
→ 500 `upstream_error`；流式中途抛错 → 带 `error` 的 stop 帧 + `[DONE]`（含音频的
流式请求例外：reasoning 进度帧已发出，错误一律流内兜底，见上方音频链路）。
日志统一 `createLogger('xiaoda-compat')`；音频下载大小、音频时长、转写耗时走 debug。
