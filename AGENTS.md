# Agent Rules — MeetMind

> 你是接手 MeetMind 的 AI 开发者。读完这份文件再动手。
> 详细规则在 `skills/` 目录中，本文件只给你最核心的上下文。

---

## 0. Agent 阅读路径（最先读这里）

拿到任务后，按以下顺序阅读，效率最高：

```
第 1 步：本文档（AGENTS.md）→ 第 1-5 节（命令 + 产品 + Big Picture + Skills + 设计系统）
第 2 步：skills/making-changes/SKILL.md → 了解 Plan→Execute→Verify→Commit 流程
第 3 步：根据任务类型选择 ↓
```

### 按任务类型选择阅读路径

| 任务类型 | 阅读顺序 |
|---------|---------|
| **改 UI / 组件** | `src/components/DOMAIN.md` → 对应子目录 DOMAIN.md → 具体组件 |
| **改任意 AI 对话面板（输入条 / 消息流 / 流式 / 文件上传 / 麦克风）** | `src/components/chat/DOMAIN.md` —— **ChatBase 底座（M11 起，M13 起 5 面板 100% 收口）**：薄底座 ChatBubble / ChatComposer / ChatMessageList / ChatRenderer / ChatThinkingStripBubble + ChatCodeBlock（Shiki 高亮）/ ChatImageLightbox / ChatMermaidBlock + 三个 hook（useChatComposer 草稿+IME / useChatFileUpload 拖拽+粘贴 / useAutoFollowScroll 智能跟随）+ `markers/`（collectMessageText / extractIntentSummary / extractIntentBio）。任何新对话面板都应基于这个底座做 adapter，不要重新写一套输入条/气泡。**已收口 5 面板**：IntentDialog(`goal`) / TutorAgentPanel(`review`,`in-class`) / ClassroomCompanionPanel(`in-class`) / SharedAgentChat(`shared`) / WordExplainer(`word`)。**铁律**：底座不引入业务逻辑（mode/prompt/endpoint），用 slot / capability 对象组合。 |
| **改课堂同桌 / Hero / 内联 app 卡** | `src/components/classroom/DOMAIN.md` → 对应组件（注意：M14.6 起 Skill chip 直接调 `/api/apps/execute`，不走 `<open_app:KEY/>` marker 链路） |
| **改复习态 Tutor / Skill chip / Tool card** | `src/components/tutor/DOMAIN.md` → 对应组件 |
| **改 Workshop 应用窗口** | `src/components/apps/windows/DOMAIN.md` → 对应窗口组件 |
| **改页面路由** | `src/app/DOMAIN.md` → 对应 page.tsx |
| **改 API 接口** | `src/app/api/DOMAIN.md` → 对应子目录 DOMAIN.md → route.ts |
| **改 Tutor 后端** | `src/app/api/tutor/DOMAIN.md`（M10：`/api/tutor/agent` 是所有对话入口的唯一后端，按 `mode: 'in-class' \| 'review' \| 'shared' \| 'goal' \| 'word'` 5 分支） |
| **改 prompt** | `src/lib/prompts/tutor-prompts.ts`（mode-driven `buildTutorSystemPrompt`） + `项目开发文档/提示词设计哲学.md` |
| **改「聊聊你想要的」/ 目标共建 / 教练对话** | `src/components/intent/DOMAIN.md` → `IntentDialogContainer` 是入口包装，主对话在 `IntentDialog`，提炼卡片在 `IntentSummaryCard`（bio）/ `IntentBioCard`。入口仅在设置页（M14.6 移除首登强制拦截）。后端 `/api/tutor/agent` mode='goal'，prompt 在 `tutor-prompts.ts` 的 `buildGoalSegment`（GOAL_HEADER + GOAL_PATH_A 首次会面 / GOAL_PATH_B 回访 + GOAL_COMMON）。文件解析 helper `src/lib/services/file-parse-service.ts`。|
| **改实时语音通话 UI / 抗噪抗打断** | `src/components/realtime/DOMAIN.md` → `RealtimeOrb`（v7 呼吸光晕，复用于复习态 + intent 通话）+ `IntentVoiceCallScreen` / `TutorRealtimeCallScreen`。后端 WebSocket 在 `server.js` 的 `/api/tutor-call`，VAD/降噪参数走环境变量（见 `.env.example` 实时语音同桌段）。|
| **改业务逻辑（service）** | `src/lib/services/DOMAIN.md` → 找到对应 service 文件 |
| **改 ASR 链路** | `src/lib/services/asr/`（text-utils / render-state-machine / post-edit / audio-constraints）+ `src/lib/services/dashscope-asr-service.ts`（DashScopeASRClient 实时 ASR 客户端）+ `server.js`（两个 WebSocket proxy：`/api/asr-stream` DashScope + `/api/asr-stream-speaker` 腾讯云说话人分离）+ `src/lib/services/asr/ws-url.ts`（URL 选择：speakerDiarization 切换路径）|
| **改说话人分离** | `src/lib/services/asr/diarization-service.ts`（课后 diarization + getSpeakerLabel / getSpeakerColorClass）+ `server.js` speaker proxy（腾讯云 `16k_zh_en_speaker` HMAC 签名 + 协议翻译）+ `src/components/Recorder.tsx`（并行连接无感切换引擎）+ `src/lib/utils/transcript-format.ts`（formatTranscriptWithSpeakers：fullTranscript 带 `[说话人N]` 标记，用于 in-class + review 两种 mode）|
| **改 AI-Native 插件** | `src/lib/ai-native/plugins/DOMAIN.md` → 对应 plugin |
| **改 SharedAgent / 分享 Agent / 裂变** | `roadmap/v3.0-virality-agent.md`（北极星）→ `src/app/api/share/DOMAIN.md` → `src/app/share/DOMAIN.md` → `src/app/me/shares/`（A 管理面）→ `src/components/share/DOMAIN.md` → `src/lib/services/share-agent-service.ts`。**v3.0 闭环 5 个支点**：(1) 创建 `OctoCrystalDispatcher` (2) 落地页 `SharedAgentLanding` + `ArtifactRender` 真渲染产物 (3) 分享态对话 `mode='shared'` (4) 领取 `claimSharedAgent` → `WorkspaceCapture(sourceType='shared-agent')` 在 B 工作台点击跳回 `/share/[token]` (5) 管理 `MyShareList` + `DELETE /api/share/[token]`（撤销不影响已领取副本）|
| **改文章 / 网页原文接入** | `src/app/api/article/`（无 DOMAIN.md）→ `src/lib/services/web-article-extract-service.ts` + `jina-reader-service.ts`；`.env.example` 配 `FIRECRAWL_API_KEY`（首选），`OPENCLAW_GATEWAY_URL` 已 **deprecated**（见 `openclaw/README.md`，与 MeetMind 解耦的 AI Agent Gateway，现仅 fallback） |
| **改微信公众号 / 微信端捕获** | `src/app/api/wechat/`（bind / callback / mp / capture/[token]，无 DOMAIN.md）→ 6 个 `src/lib/services/wechat-*-service.ts`（auth / inbox / media / mp / voice-utils / web-session）→ `src/components/WechatBindForm.tsx`；`.env.example` 配 `WECHAT_APP_ID/SECRET` + `WECHAT_MP_TOKEN` |
| **改跨设备同步** | `roadmap/v2.1-cross-browser-sync-gap.md`（**已确认架构缺口**：浏览器 A 录课，B 看到卡片但点开无转录/锚点/highlight。根因=服务端只存汇总文本不存分段 + 客户端拉回不回填 IndexedDB）→ `src/lib/services/backfill-captures-to-indexeddb.ts` + `upload-recording-audio.ts` + `src/hooks/useWorkspaceContextLoader.ts` |
| **改用户面文案** | `src/lib/ui/copy.ts`（**唯一真相源**——不要把字符串散落到组件里） |
| **改状态管理** | `src/stores/DOMAIN.md` → 了解哪些状态已迁移到 store |
| **改类型定义** | `src/types/DOMAIN.md` → `src/types/index.ts` |
| **改配置** | `src/lib/config/DOMAIN.md` → `src/lib/config/app.config.ts` |
| **改模型 / LLM provider / API key / 默认模型** | `src/lib/config/DOMAIN.md` → `src/lib/config/app.config.ts` → `src/lib/services/DOMAIN.md` → `src/lib/services/llm-service.ts` → `src/lib/utils/tutor-agent-provider.ts` → `src/app/api/tutor/DOMAIN.md` → `src/app/api/tutor/agent/route.ts` → `docs/TUTOR_AGENT.md` |
| **改设置项 / 用户偏好** | `src/app/DOMAIN.md` → 设置页 `page.tsx` → `src/lib/utils/DOMAIN.md`（偏好 key / 解析）→ 所有消费该偏好的 hooks / components |
| **改工具函数** | `src/lib/utils/DOMAIN.md` → 对应 utils 文件 |
| **处理 bug** | `skills/debugging/SKILL.md` → 先诊断再动手 |
| **改 God File (page.tsx)** | `src/app/DOMAIN.md` → 理解数据流 → 找对应功能区 → 精确替换 |

### 铁律

- **每次改完必跑 `make check`**（tsc 类型检查）
- **改 ASR / Tutor 前后必跑 `make eval-asr` / `make eval-tutor`**（数字波动 = 回归信号）
- **只读 DOMAIN.md，不确定的再读源码**
- **不要发明新脚本，只用 Makefile 里的命令**
- **代码和文档必须一起交付**：凡是改了配置、模型、路由契约、目录结构、关键文件、依赖边界、默认行为或用户可见流程，必须同步更新对应 `DOMAIN.md` / `AGENTS.md` / `docs/*` / `.env.example`
- **新增目录若包含 3 个以上源码文件，或承担独立职责，必须补一个 `DOMAIN.md`**
- **用户面字符串必须 `import { COPY } from '@/lib/ui/copy'`，禁用词：回声卡 / 酿 / 预知气泡 / 工坊 / 研判 / 引擎**

---

## 1. Golden Commands

**日常开发**
```bash
make dev          # 启动开发服务器（默认端口 3001，PORT 可覆盖）
make check        # 类型检查（最常用，每次改完必跑）
make build        # 生产构建（限单核 + 1GB 内存，防 OOM）
make deploy       # 构建 + PM2 重启
```

**代码质量**
```bash
make test         # 运行 Vitest 单元测试（src/）
make test-server  # server/ 下 ASR 工具函数单测
make test-all     # src/ + server/ + eval/ 全套
make test-watch   # 单元测试 watch 模式
make lint         # ESLint 检查（--max-warnings 0）
make smoke        # 端到端 smoke：路由/WS/auth/API 全通（需 dev server 在 3101）
make smoke-intent     # goal 模式 e2e（双路径：首次会面 + 回访）
make smoke-review     # review 模式 e2e（bio 注入 + 时间戳 + inline app）
make smoke-in-class   # in-class 模式 e2e（recentFocus + Skill chip + bio）
make smoke-shared     # shared 模式 e2e（隐私铁律）
make smoke-all       # 跑全部 4 个 mode 的 e2e smoke
make ttft            # 测首 token 延迟（4 mode × N=5）——改 prompt/smoothStream/provider 后必跑
make clean-logs      # 自动清理所有 console.log 残留
make clean-logs-dry  # 预览清理效果（不修改）
make stats        # 项目统计（超标文件、console.log 残留）
```

**Eval Harness（M1 底座，SWE-Bench 风格）**
```bash
make eval               # 完整套件（unit + ASR + Tutor）
make eval-unit          # grader 自身单测
make eval-asr           # ASR dry-run（基于 seed 数据集）
make eval-asr-real      # ASR 真实调用（需 DASHSCOPE_API_KEY + 公网 audio URL）
make eval-tutor         # Tutor dry-run
make eval-tutor-real    # Tutor 真实调用（优先 DEEPSEEK_API_KEY；也兼容 OPENAI_API_KEY / DASHSCOPE_API_KEY）
make eval-guard         # CI gate：baseline 在 tests/eval/baselines/
make eval-guard-update  # 接受当前数字为新 baseline（慎用）
make eval-ci            # CI 完整流程：unit + asr + tutor + guard
```

**数据库**
```bash
make db-push      # 同步 Prisma schema 到 SQLite
make db-studio    # 打开 Prisma Studio
```

**只用这些命令。不要发明新脚本。**

### 文档同步检查（没有单独命令，必须走人工清单）

每次代码变更后，在 `make check` 之前先做一次文档同步判断：

| 变更类型 | 必须同步 |
|---------|---------|
| 新增 / 删除 / 重命名文件、目录、关键职责 | 对应目录 `DOMAIN.md` + 必要时 `AGENTS.md` 架构速查 / 关键文件 |
| 新增 API 路由、请求体字段、响应契约、stream marker | `src/app/api/**/DOMAIN.md` + 相关 `docs/*` |
| 新增模型 provider、默认模型、API key、环境变量 | `src/lib/config/DOMAIN.md` + `.env.example` + `docs/TUTOR_AGENT.md` + `AGENTS.md` |
| 改 Tutor / ASR / AI-Native 主链路 | 对应 `DOMAIN.md` + `docs/TUTOR_AGENT.md` / `docs/ASR_PIPELINE.md` / `src/lib/ai-native/DOMAIN.md` |
| 改用户面文案或设置项 | `src/lib/ui/copy.ts` 或设置页说明 + 偏好 key 所在 `DOMAIN.md` |

判断方式不是运行新脚本，而是用 `git diff --name-only` 看本次改动，再按上表补齐文档。最终验证仍然只用 Makefile 命令：`make check`，必要时加 `make eval-*` / `make test`。

---

## 2. 产品是什么

MeetMind 是以学习者长期上下文为中心的 AI 学习产品。

**一句话**：用户像发微信一样把学习现场发给 MeetMind，先收下，后台慢慢理解，理解成熟后自然长出**同桌、回声、复习、Tutor**。

**当前聚焦**：课堂场景。一个大学生录了一节课 → MeetMind 当场作为 AI **同桌**陪他听 → 课后基于用户真实意图帮他解释、定位、复述、验证或生成闪卡 / 测验 / 速查表 / 思维导图 / 学习报告 → 生成一张让他忍不住分享到班级群的回声卡。

**当前里程碑**：M11（ChatBase 底座 + v3.0 SharedAgent 裂变）→ M12（ChatBase 升级 Shiki/Mermaid/lightbox + 退役 `AITutor.tsx` 死代码 + 文章原文展示）→ M13（5 面板 100% 收口 + 新增 `mode='word'` + 麦克风 push-to-record + TTFT p95 -32%）→ M14 / M14.5（课堂同桌 AI-native 重做：动态 chip 取代 inline app 药丸；`qwen3.7-plus` 多模态默认）。详见 `roadmap/v3.0-virality-agent.md`、`CHANGELOG.md` 和 `项目开发文档/提示词设计哲学.md`。

> ⚠️ 文档覆盖度提示：`CHANGELOG.md` 停在 M11.5，**M12/M13/M14/M14.5 见 commit history**；`docs/UPGRADE_PLAN.md` 仅覆盖 M1-M4（M5+ 未补）。任何与 v3.0 哲学（"场景上下文可分享、个人上下文默认私有、Agent 是分享单元"）冲突的旧设计以 `roadmap/v3.0-virality-agent.md` 为准。

### 上下文模型与两条产品主线

**好的输出 = 个人上下文 + 场景上下文 + 好的模型智能。**

- **个人上下文**：目标、阶段、长期困惑、掌握情况、学习节奏、收藏、行为与反馈；跨天跨课积累，默认私有。
- **场景上下文**：一节课、一篇文章、一道题或一次讨论的原件、转录、资料、进度与当前意图；有明确边界，可在用户主动分享时生成快照。
- **模型智能**：基于两类上下文判断此刻应解释、定位、复述、连接、检验还是保持克制。当前表达与当前场景优先；个人画像只是背景，不能变成覆盖用户意图的硬规则。

产品有两条互相回流的主线：

1. **收集线**：“先随手发给 MeetMind”，接住文字、语音、图片、链接、收藏、想法与反馈，主要沉淀长期个人上下文。
2. **课堂线**：“帮我真正理解这一节课”，以一节课为最小完整理解单元，保留完整学习现场并形成场景上下文。

课堂内容的组织层级是：`原件 / 片段 → 一节课 → 课程单元或章节（多节相关课）→ 一门学期课程（多个单元）→ 长期个人学习上下文`。收集内容可以补进课堂；课堂中的困惑、练习结果和关注点也必须回写个人上下文。不要把两条线做成两个数据孤岛。

### Taste（任何改动都必须对齐）

**顶层原则：视觉为智能让路。安静是底色，智能是主角，仪式感是点缀。智能 = 用户意图理解 + 模型能力；遵循 The Bitter Lesson，产品层提供上下文、工具和渲染契约，不用硬规则替模型判断意图。**

| 关键词 | 含义 |
|--------|------|
| **安静** | 不通知、不弹窗、不催促。95% 的界面保持极简克制 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 回答基于真实原件；课后复习中的课堂引用可以跳回 `[MM:SS]` 转录，课中不提供回跳，避免打断正在进行的课堂 |
| **第一印象** | 学生打开 MeetMind，第一反应应该是「这个 AI 真的懂我在学什么」——不是"好看"，不是"安静"，是**智能**。视觉为这个目标服务 |

**桌面上下文动作原则**：搜索笔记、历史收集、笔记总结这类“伸手拿资料”的动作，不用居中小弹窗打断主界面；优先使用右侧上下文 sidecar / 抽屉，让主学习现场仍然在背景里，像打开一页旁注而不是跳出一个 demo 弹框。

**同桌出现原则**：同桌不是无上下文聊天机器人。空课堂 / 未听课时不占右栏、不显示 Octo Buddy、不提供“问同学”入口；只有真实录课或示例课处于听课态时才自动出现。否则它只能拒答，会伤害“这个 AI 真的懂我在学什么”的第一印象。

**首屏录音来源原则**：电脑内录是核心能力，不是帮助文档里的隐藏功能。课堂零存量首屏必须让“麦克风 / 电脑声音 / 两路都录”作为轻量选择直接可见；不要只给一个“开始录课”按钮让用户猜。

**试听课原则**：试听课必须真的能听，不能只是静态转录演示。进入示例课 recording 视图时必须挂载 `/demo-audio.mp3`，用真实音频播放时间驱动转录渐进露出；中间课堂脉络也必须随音频推进，不能长期停在空态。若浏览器拦截自动播放，必须提供显式“播放声音”入口。英文试听课默认 EN→中，但用户手动切换后要尊重用户选择。音频自然结束后必须留在试听课堂现场，由 Octo Buddy 轻提醒用户点“结束这节课”，再进入既有课后复习页 / 应用矩阵；不要在课中页面承载完整课后学习，也不能回到“原声已保留”的失败卡片。

**课中中间画布原则**：中间区域是模型自主理解的「课堂脉络」，只回答“现在讲什么、刚才如何推进、什么值得课后回来”。前端只约束稳定渲染契约，不用关键词树或固定节点数量替模型判断课堂结构。思维导图属于课后应用矩阵，不得重新作为课中主画布。

**课中轻引导原则**：同桌右栏可以引导，但必须像旁边同学轻轻递话，不像功能导览。优先用 Octo Buddy 像素章鱼 + 2-3 个自然问题 chip（点了就发送），避免大面积“我能做什么”的说明卡。Octo Buddy 是 IP，不是静态 icon；内嵌在右栏时也要有呼吸 / 听课 / 开心等轻动画。

**课后复习三栏原则**：视频和音频课后复习都必须是“左边有根，中间练习，右边有人陪”。左栏保留原始课堂证据（视频/音频播放器、时间轴、转录锚点），且视频复习默认应给左栏最大权重，保证视频真的可看；中栏承载完整学习工作区（应用矩阵、闪卡、测验、思维导图等）；右栏只做同桌解释与复盘。三栏之间两条边界都可拖拽；左证据栏不自动折叠，学习区和同桌被挤到阈值后折叠成窄 rail，可点击恢复。复习态 `<open_app:KEY/>` 不能把完整应用塞进聊天气泡，必须打开中间学习工作区；测验/闪卡等应用交互动态要先写入课后学习黑板，再由同桌作为上下文读取，避免中间应用和右侧聊天直接耦合。黑板是轻结构自然语言便签，只写学习现场事实，不写“如果/应该/优先/提醒/建议”等面向模型的指令，把判断权留给模型。

### 仪式时刻白名单（允许在系统外释放灵魂的 6 个场景）

日常 95% 的界面**仍然**遵守「克制 + 双签名色 + 米白纸感」，但以下 6 个仪式时刻允许情绪化视觉：

1. **录音中的呼吸球**：仪式色板（rose/lilac/sky 三色低饱和度）+ 高斯模糊光晕 + 呼吸动画。停止即消散。
2. **AI 正在"酿"的提示**：`thinking-strip` 极淡墨绿/朱批气息流横扫，&lt; 2s，不阻塞交互。
3. **Echo / 应用卡生成完成的瞬间**：墨绿 check + 一道柔光扫过卡片，< 1.6s。
4. **录课结束的收尾动画**：屏幕中央极简收束，像合上一本笔记。
5. **Tab 切换 / AI 流式输出**：字符逐个浮现（`stream` + `typing-caret`），让学生**看见** AI 在思考。
6. **分享落地页 `/share/[token]`（v3.0 唯一允许整页放飞的页面）**：
   - 大气场墨绿/朱批 radial gradient 背景 + Octo `original.png` 大图 + `hero-float` 动画
   - Instrument Serif italic 装饰标题
   - 这一页的目标是被陌生人在班级群点开——它的视觉权重要承担起裂变的任务

**除此以外，常规页面允许**：极淡墨绿 1px ring（`surface-ai`）、`shadow-soft/card/float` 极克制投影、双签名色作引用资产 / 状态点 / mark 高亮。

**始终禁止**：饱和色撞脸 ChatGPT 紫 / Stripe 蓝 / 多邻国绿、emoji 作 UI 元素、用渐变填充按钮、用阴影替代结构。

### 用户面文案（M9 zero-prompt 原则）

- 唯一真相源：`src/lib/ui/copy.ts`，所有出现在 UI 的字符串必须 `import { COPY }` 引用
- 角色名："**同学**"（不是 tutor / 助教 / 客服）
- 禁用词：回声卡 / 酿 / 预知气泡 / 工坊 / 研判 / 引擎 / 引导（这些是开发者黑话）
- 首选词：笔记总结 / 整理 / 预感 / 应用 / 同学
- **零提问产品**：机器应该 act，不该 ask；UX 决策埋进静默后端行为，仅按需 hover 浮现

---

## 3. Big Picture Architecture

> 以下架构需要阅读多个文件才能理解全貌，是代码库的"根"。

### 3.1 DOMAIN.md 文档生态系统

整个代码库使用 **DOMAIN.md 模式**：每个重要目录都包含一个 `DOMAIN.md`，作为该域的索引、依赖规则和文件清单。这不是可选文档——它是架构的一部分。

- 阅读顺序：先读该目录的 `DOMAIN.md`，再读具体源码
- 新增目录若包含 3+ 源码文件或承担独立职责，**必须**补 `DOMAIN.md`
- 目录结构或依赖边界变化时，**必须**同步更新对应 `DOMAIN.md`

### 3.2 双存储架构

| 层级 | 技术 | 用途 | 说明 |
|------|------|------|------|
| 服务端 | Prisma 7.2 + SQLite | 用户数据、Workspace、Echo、AsrCorrection / AsrHotword | `prisma/schema.prisma` |
| 客户端 | Dexie.js (IndexedDB) | 转录文本、本地缓存、离线状态 | `src/lib/db/` |

**关键决策**：IndexedDB 是客户端真实数据源，服务端 SQLite 是同步备份。组件直接从 IndexedDB 读取，API 成功后回写本地。

### 3.3 核心数据流：收 → 酿 → 应

```
用户输入（录音/链接/文件/文字）
  → context-reach 识别内容类型
  → page.tsx 路由到对应 handler
  → 调用 API route（薄壳，只转请求/响应）
  → services 处理业务逻辑
  → 返回结果 → IndexedDB 持久化 → UI 更新
  → 后台触发 Echo / 复习 / Tutor 生成（"酿"）
```

**"酿"是隐式的**：后台理解过程不体现在界面上，只在用户"伸手"时通过 AI 回答质量体现。

### 3.4 AI-Native 插件系统

`src/lib/ai-native/plugins/` 是 Workshop 应用的运行时（7 个 plugin，`studio-workshop` 含 3 个子模块 podcast/renderers/types）。每个插件实现统一的 `AppPlugin` 契约：

- `manifest.id` + `canHandle(context)` + `run(context, tools)`
- 输出 `AppExecutionResult { cards, trace, render }`，前端统一交给 `AppRenderSurface` 渲染；WorkshopWindow、独立应用页、InlineAppCard 不得各写一套 UI
- 主要 plugin：cheatsheet / flashcards / quiz / mindmap / class-check（视频内随堂检验，不在 catalog）/ studio-workshop（播客 + 信息图）/ fallback
- catalog：`src/lib/ai-native/app-catalog.ts` 是 UI 端的应用矩阵（6 类 ready 应用：flashcards / quiz / mindmap / cheatsheet / infographic / audio-overview）

### 3.5 课堂同桌 → 应用矩阵的链路（M14.6 重做）

M14.6 起，结构化产物**不再走** LLM 输出 `<open_app:KEY/>` marker 的链路（已从 prompt 与代码移除），改为前端 SkillChip 直接打开应用矩阵：

```
用户点 SkillChip（如"速查表"）或手敲 "整一张速查表"
  → 前端直接调 /api/apps/execute（appKey → pluginId）
  → AppRenderSurface 渲染完整 AppExecutionResult
  → 对话流里纯文字回答，应用产物在中间学习工作区 / 应用矩阵呈现
```

- LLM 对话保持**纯文字**：`agent/route.ts` 的 `tools = {}`，不挂 native tools，不注入 marker 合约。
- 应用矩阵 6 类 ready 应用（`WORKSHOP_APP_CATALOG` in `app-catalog.ts`）：`flashcards / quiz / mindmap / cheatsheet / audio-overview / infographic`。M16 起目录按学习动作组织，只突出一个基于显式课堂信号的“现在最适合”；首次生成留在矩阵后台完成，结果页不暴露模型选择，分享入口在至少完成一个产物后出现。
- **遗留死代码（M14.6 前的 marker 链路，待清理）**：`<open_app:KEY/>` marker、`extractOpenAppMarker`、`capOpenAppContract` / `TutorInlineAppKey` 类型、`InlineAppCard` 的 marker 拦截逻辑。（`tutor-tools.ts` 及 4 个无入口 plugin `study-report` / `knowledge-cards` / `confusion-drill` / `review-plan` 已在 M14.6+ 清理删除。）

### 3.6 God File 提取策略

`src/app/(main)/app/page.tsx` 是已知遗留债务（行数见 `make stats`），正在按**域**分阶段提取为 hooks + 子组件：

| 阶段 | 提取的 hooks | 减少行数 |
|------|-------------|---------|
| Phase 2 | `useSourceImport` | -603 |
| Phase 3 | `useCollectionComposer`, `useCollectionPulse` | -613 |
| Phase 4 | `useTutorLauncher`, `useRecordingLifecycle`, `useTranscriptHandlers`, `useAudioMessagePlayback` | -729 |
| Phase 5 | `useCollectionListActions`, `useWechatCaptureImport`, `useWorkspaceContextLoader`, `useSeekController`, `useAppStateRestore` | -581 |
| Phase 6 | `useSeekController` 消费, `usePendingRecordedAudio`, `useNoteActions`, `useActionItems`, `useExtractTerms`, `useSourceItemManagement` | -289 |

**agent 修改原则**：不要一次性拆分，只在当前任务中顺手提取≥50 行的独立模块，立即 `make check` 验证。

### 3.7 Tutor 后端（M10 mode-driven 收口）

历史上分散到三个入口（课堂同桌 / 录音复习 / 视频复习）的 prompt + 后端，已收口为**单一 endpoint**：

| 入口 | 调用方 | 关键参数 |
|------|--------|---------|
| 课堂同桌 | `useClassroomCompanion` | `mode: 'in-class'`, `recentFocus` (最近 30s) |
| 录音/视频复习 | `TutorAgentPanel` / `SafeAITutor` | `mode: 'review'`, `fullTranscript`, `currentTimestampSec`（秒，不是毫秒）, `learnerProfile`（个人画像 + 当前课程近期对话痕迹）, options.thinkingGuide |
| **分享态对话** (v3.0) | `SharedAgentChat` (落地页 `/share/[token]`) | `mode: 'shared'`, `shareToken`，服务端从 `SharedAgent.snapshotJson` 加载上下文；不读取访问者画像，禁用 native tools，禁用 inline app marker |
| 目标共建 / onboarding | `IntentDialog` | `mode: 'goal'`, `learnerProfile`（bio 双 marker：headline + goals）；禁用 inline app marker；首次会面 vs 回访双路径 |
| 选词解释浮窗 (M13) | `WordExplainer` | `mode: 'word'`, `selectionText` + `nearbyContext` + `fullTranscriptTail`；禁用 inline app marker；浮窗形态 |

```
POST /api/tutor/agent
  body: { mode, context: {...}, options: {...}, transcript, messages, sessionId, subject, model? }
  → resolveTutorAgentProviderConfig(env, { modelId }) 选择 StepFun / DeepSeek / DashScope / OpenAI-compatible provider
    （env 驱动 pickAvailableModelId：TUTOR_MODEL/LLM_MODEL → recommended → 首个可用；有 StepFun key 默认 `step-3.7-flash`，否则有 DeepSeek key 默认 `DeepSeek-V4-Flash`，否则 `qwen3.7-plus`）
  → buildTutorSystemPrompt(mode, context, options) 拼 system
  → streamText({ model, tools: {},
                 // M14.6：所有 mode 纯对话，不挂 native tools，不注入 <open_app:KEY/> marker 合约。
                 // 结构化产物由前端 SkillChip 直接打开应用矩阵（见 §3.5）。
                 // Qwen thinking 模型通过 fetch hook 注入 enable_thinking=false 抑制推理，降 TTFT。
                 stopWhen: stepCountIs(3),
                 experimental_transform: smoothStream({
                   chunking: /[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]|\S+\s+/,  // 中文 1 字 1 切、英文 1 词 1 切
                   delayInMs: 12,
                 }),
                 onStepFinish: track('tutor.step') })
  → toUIMessageStreamResponse()  // AI SDK v6 帧
```

**渲染契约（前端硬合同，不能删）**：
1. `[MM:SS]` / `[MM:SS-MM:SS]` — **仅 `review` 模式**可点击跳回转录（解析在 `timestamp-parsing.ts`）；`in-class / shared / goal / word` 即使传 `returnTimestamps: true` 也必须忽略
2. `[资料N]` — 引用 support material 时复用编号，禁止编造
3. 思维引导：`---思维演示---` / `---正式回答---` / `【步骤名】` / `💡` / `🌟` 分段标记

> M14.6 已移除原第 4 条 `<open_app:KEY/>` marker 契约——结构化产物不再由 LLM 输出 marker，改由前端 SkillChip 直接打开（见 §3.5）。

旧 `/api/tutor` (legacy SSE 路径) 仍存在并被 `SafeAITutor` 在 flag off 时降级使用；移动端文字 AI / 历史详情也应走 `SafeAITutor → TutorAgentPanel`。`useOmniRealtimeCall` 走独立 WebSocket（qwen-omni realtime），不打这个 endpoint；移动端语音同桌由 `RealtimeTutorPanel → TutorRealtimeCallScreen` 承接，语音最终转写必须写入 `conversationService` 的 `global-chat` 并把 conversationId 接回文字 agent。

### 3.8 ASR 飞书妙记级工艺（M2 + M5 + M8）

ASR 链路（`src/lib/services/asr/`）：

- **三段式渲染**：`TranscriptRenderMachine` interim(灰斜体) / stable(黑) / final(commit)
- **长音频**：DashScope 异步 file-trans，分片 600s + 2s overlap + LCS 缝合（`stitchSegmentsWithOverlap` / `findOverlapLength`）
- **稳定性**：`reconnecting-websocket` + `p-retry` Full Jitter 退避，audioQueue 跨重连保留
- **Contextual biasing**：`buildASRContextHint` 注入 6 字段（courseTitle / courseSubject / participants / previousLessonTopics / lessonVocabulary / userHotwords）
- **后校对**：`postEditSegments` 用 qwen3.7-plus 只打低置信片段（feature flag `ASR_POST_EDIT_ENABLED`，默认关）
- **状态兜底**：`audioSessions.transcriptionStatus` 区分 pending/completed/failed；转写失败或超时后课堂卡片显示“原声已保留”，不能永久停在“整理中”
- **静默校对 + 热词聚合**：`AsrCorrection` 表存用户编辑，`onRecordingStop` 触发 `/api/asr/corrections/aggregate` 生成下节课的 `userHotwords`
- **AEC/NS/AGC**：`buildAudioConstraints` 是 getUserMedia 的唯一真相源，env 可覆盖
- **说话人分离**（M14.6+）：双引擎可选——DashScope `qwen3-asr-flash-realtime`（高精度，无说话人分离）+ 腾讯云 `16k_zh_en_speaker`（实时声纹聚类，支持 10 人）。`server.js` 两个独立 WebSocket proxy（`/api/asr-stream` + `/api/asr-stream-speaker`），speaker proxy 做 HMAC-SHA1 签名 + 协议翻译（腾讯云格式→DashScope 兼容格式）。`DashScopeASRClient` 通过 `speakerDiarization` 选项切换 WS URL。`Recorder.tsx` 录音中无感切换（并行连接→ready 后交接 asrClientRef→异步关旧 client）。课后 diarization（`diarization-service.ts`）在已有 speakerId 时跳过（避免两套引擎编号混用）。`transcript-format.ts` 的 `formatTranscriptWithSpeakers` 把 speakerId 转成 `[说话人N]` 标记注入 fullTranscript，用于 in-class + review 两种 mode 的 AI 上下文。

### 3.9 跨设备同步现状与缺口（v2.1 待修）

详见 `roadmap/v2.1-cross-browser-sync-gap.md`（2026-04-25 确认的架构缺口）。

- **现象**：浏览器 A 录课，浏览器 B 登录后看到卡片但点开无转录/锚点/highlight
- **根因**：(1) 服务端 `WorkspaceCapture` 只存 `normalizedText`（8000 字截断），分段 transcripts/anchors/summaries/highlights 无 SQLite 表；(2) 客户端 `useWorkspaceContextLoader` 拉回只 push sourceItem，不回填 IndexedDB
- **已落点**：`backfill-captures-to-indexeddb.ts` + `upload-recording-audio.ts`（音频上云 T2）+ `useWorkspaceContextLoader`；缺服务端分段表 + 下行回写
- **修复方向**（roadmap 选项 A）：新增 `WorkspaceTranscriptSegment` / `WorkspaceAnchor` / `WorkspaceClassSummary` / `WorkspaceHighlight` 表 + 客户端拉回时 `db.transcripts.bulkPut` 等

### 3.10 内容接入扩展（M12 文章 + 微信端 + OpenClaw）

| 来源 | API | Service | 备注 |
|------|-----|---------|------|
| 文章 / 网页 | `/api/article/import` | `web-article-extract-service.ts` + `jina-reader-service.ts` | `.env.example` 配 `FIRECRAWL_API_KEY`（首选） |
| 微信公众号 | `/api/wechat/*`（bind / callback / mp / capture/[token]） | 6 个 `wechat-*-service.ts`（auth / inbox / media / mp / voice-utils / web-session） | `WECHAT_APP_ID/SECRET` + `WECHAT_MP_TOKEN` |
| OpenClaw Gateway | — | `openclaw/`（仓库根目录，与 MeetMind 解耦） | **deprecated**：Firecrawl 替代微信公众号反爬，OpenClaw 仅 fallback |

### 3.11 今日情报：个人上下文 × 外部真实信息

`/api/feed mode='cross-course'` 不是摘要生成器。它先从收藏、笔记、目标与反馈中形成“看见自己”的内部线索，再生成包含 `deepen / adjacent / counterpoint` 的检索计划。`feed-retrieval-service.ts` 分别从普通网页、Semantic Scholar 论文目录与 Open Library 图书目录取回真实候选；普通网页结果不足且已配置 `DASHSCOPE_API_KEY` 时，可用 `qwen3.7-plus` Responses API 的 `web_search` 补充。模型只允许在真实候选中排序和解释，不能生成外链。

外部卡必须携带 `contentUrl`、`contentKind`、来源，并尽可能保留作者和出版时间。推荐组合优先包含至少一条论文或书籍，以及一条与当前问题相关的不同视角；检索失败时宁可少推，不得回退成虚构资料或通用搜索页。

---

## 4. Skills（详细规则在这里）

| Skill | 路径 | 何时读 |
|-------|------|--------|
| **架构执行** | `skills/architecture-enforcement/SKILL.md` | 创建/修改文件时 |
| **变更流程** | `skills/making-changes/SKILL.md` | 每次写代码时 |
| **代码审查** | `skills/code-review/SKILL.md` | 完成变更后自审 |
| **系统化调试** | `skills/debugging/SKILL.md` | 遇到 bug 时 |

**工作流**：Plan → Execute → Document → Verify → Review → Commit（详见 `skills/making-changes/SKILL.md`）。其中 Document 不是可选项：只要代码改变了事实来源、公共契约、默认行为或运维方式，就必须同步文档后再验证。

---

## 5. 设计系统 v7（快速参考）

> 完整设计宪法 + 可视化 showcase 在 `design-demo/v7/`（9 篇 showcase HTML：foundations / AI 视觉 / 组件 / 应用矩阵 / 课中 / 复习 / 分享落地 / 移动端 / 暗色 + `tokens.css` + `index.html` 导航页）。

**核心理念：图书馆台灯 + 朱批红笔。** "色 = 架构"——墨松绿是 AI 沉淀（场景上下文），朱批红是学生此刻（个人上下文 / 引用 / 标注）。

### 双签名色（Tailwind class · CSS var）

| 角色 | 名称 | 色值 | Tailwind | CSS Var | 语义 |
|------|------|------|----------|---------|------|
| **主签名** | 墨松绿 Pine | `#2D4F3E` | `pine` / `pine-mist` / `pine-fog` | `--mm-pine` | AI / 沉淀 / 长期上下文 |
| **次签名** | 朱批红 Vermilion | `#B5483C` | `vermilion` / `vermilion-mist` / `vermilion-fog` | `--mm-vermilion` | 此刻 / 引用 / 学生标注 |

### 中性色

| Token | 色值 | Tailwind | 用途 |
|-------|------|----------|------|
| `paper` | `#FAF7F2` | `bg-paper` | 主底色 · 米白纸感（v7 升级 · 暖于 v6 燕麦灰） |
| `paper-warm` | `#F2EDE3` | `bg-paper-warm` | hover / 次表面 |
| `card` | `#FFFFFF` | `bg-card` | 主卡片 |
| `ink` | `#1C1B19` | `text-ink` | 主文字 / 主按钮 |
| `ink-secondary` | `#5C5A55` | `text-ink-secondary` | 次文字 |
| `ink-muted` | `#8E8B82` | `text-ink-muted` | 弱文字 / 标注 |
| `divider` | `#E8E2D5` | `border-divider` | 边线（偏暖纸感） |

### 字体三件套（已在 `app/layout.tsx` 通过 next/font 加载）

| 字体 | Tailwind | 用途 |
|------|---------|------|
| **Inter** | `font-sans`（默认） | 正文 · 'palt' 紧排让中英混排立刻 +30% 高级感 |
| **Instrument Serif** | `font-serif` 或 `.font-serif-italic` | 仪式字 · 标题里偶尔的 italic em |
| **JetBrains Mono** | `font-mono` 或 `.font-mono-cite` | 引用资产化 · `[MM:SS]` / `[资料 N]` 专用 |

### 投影系统（v7：必须存在但克制）

| Tailwind | 强度 | 用途 |
|---------|------|------|
| `shadow-soft` | 0/4/16 · 0.04 | 日常卡片 |
| `shadow-card` | 0/8/28 · 0.06 | 主卡片（首选） |
| `shadow-float` | 0/16/48 · 0.08 | 悬浮元素 |
| `shadow-modal` | 0/32/80 · 0.12 | 模态 |
| `shadow-ai-glow` / `shadow-glow` | 1px pine ring + 8/28 pine | **AI 在场专属** |

### v7 工具类（globals.css 直接可用）

```html
<!-- 引用资产化 -->
<span class="cite-ts mono">[20:01]</span>     <!-- 朱批时间戳 -->
<span class="cite-src mono">[资料 3]</span>   <!-- 墨绿资料 -->

<!-- AI 在场卡片 -->
<div class="surface-ai">…</div>                <!-- 1px pine ring + 缓慢光带 -->

<!-- 高亮笔 -->
<mark class="mark-pine">不让中间路由器被淹</mark>
<mark class="mark-vermilion">不让接收方被噎着</mark>

<!-- 流式输出 -->
<p class="stream"><span style="animation-delay:.04s">字</span>…<span class="typing-caret"></span></p>

<!-- 思考气息流 / 录音呼吸点 / Octo 光环 -->
<div class="thinking-strip">Octo 正在对照你前面问过的内容…</div>
<span class="rec-dot"></span>
<div class="octo-aura"><img … /></div>

<!-- 骨架屏 -->
<div class="skel h-3 w-2/3"></div>
```

### v7 原生组件（`@/components/ui`）

| 组件 | 文件 | 用途 |
|------|------|------|
| `Button` (variant: `pine` / `vermilion` / `ghost` / `naked` / `link` / `danger`) | `button.tsx` | 升级版按钮，size 加 `xl` |
| `Card` (variant: `default` / `soft` / `elevated` / `ai`, hoverable) | `card.tsx` | 4 档投影 + AI 在场态 |
| `Badge` (variant: `pine` / `vermilion` / `sand` / `mute`, dot) | `badge.tsx` | 双签名色胶囊，dot 状态点 |
| `Skeleton` + `Skeleton.Paragraph` + `Skeleton.AppCard` | `skeleton.tsx` | shimmer 横扫，不再 pulse 明灭 |
| `Cite` (kind: `ts` / `src`) | `cite.tsx` | **引用资产化**——MeetMind"有根"DNA |
| `OctoAvatar` (mood: 8 态, size, statusDot) | `octo-avatar.tsx` | 头像 wrapper，呼吸光环 + 状态点 |
| `ThinkingStrip` / `TypingDots` / `BrewingStrip` | `thinking-strip.tsx` | 三档等待形态：轻 / 中 / 重（"酿"） |
| `StreamText` | `stream-text.tsx` | 流式输出包装器，stagger 浮现 + caret |
| `AppTopBar` | `app-topbar.tsx` | 应用顶部栏 |
| `EmptyState` | `empty-state.tsx` | 空态占位 |
| `SectionHeader` | `section-header.tsx` | 区块标题 |
| `CourseHero` | `course-hero.tsx` | 课程 Hero 区 |
| `SkillChip` | `skill-chip.tsx` | M14.6 动态能力 chip（取代 inline app 药丸，点击直接打开应用矩阵） |
| `Composer` | `composer.tsx` | 对话输入条 |
| `RecordingHero` | `recording-hero.tsx` | 录音 Hero 区 |
### 暗色模式 first-class

通过 `data-theme="dark"` 切换。底色 `#14110D`（深棕墨黑，温度比纯黑高），墨绿变浅松绿 `#6B9080`，朱批变暖橘红 `#E07A5F`——给凌晨学习的学生眼睛准备的版本。所有 token 自动重映射，组件无需任何改动。

### v6 → v7 兼容映射

旧 class 全部保留并自动映射到 v7 token：`bg-canvas` → 新米白、`text-ink` → 新墨黑、`bg-mint` / `bg-skyblue` 等都映射到 pine 体系，`bg-coral` 映射到 vermilion 体系。**新代码请直接用 v7 class（pine / vermilion / paper / surface-ai / cite-ts / cite-src）**，不要再用 v6 别名。


---

## 6. Architecture Guardrails

> 来自 `skills/architecture-enforcement/SKILL.md`，每次变更前检查。

### 文件大小硬限制

| 类型 | 上限 |
|------|------|
| 页面/组件 | 500 行 |
| Hook | 500 行 |
| API 路由 | 500 行 |
| 服务文件 | 500 行 |
| Prompt/工具/类型 | 300 行 |

> 实时超标文件清单（按行数降序）见 `make stats`，不在此静态列出——行数每次 commit 后都会变，写死只会过时误导 agent。

**规则**：新文件不得超过上限；修改若导致超标，必须先拆分。

### 依赖方向（单向，不可反向）

```
app/api → lib/services → lib/utils/, lib/db/, lib/config/
app/pages → components → hooks → stores → types
                       └→ lib/ui/copy（用户面文案唯一源）
```

**禁止**：
- `services/` 不得 import `components/`
- `components/` 不得直接 import `services/`（通过 hooks 或 props）
- `utils/` 不得 import `services/` 或 `components/`
- API 路由不得包含业务逻辑（必须委托给 services）
- 用户面字符串散落在组件里（必须走 `@/lib/ui/copy`）

---

## 7. 架构速查

```
src/
├── DOMAIN.md              # ← 源码总览，从这里开始
├── app/
│   ├── DOMAIN.md         # 页面路由索引
│   ├── share/DOMAIN.md   # v3.0 SharedAgent 公开落地页（/share/[token]）
│   └── api/
│       ├── DOMAIN.md     # 68 个 API 路由总览
│       ├── auth/DOMAIN.md        # 认证接口组
│       ├── workspace/DOMAIN.md    # Workspace 接口组
│       ├── sources/DOMAIN.md      # 内容接入接口组
│       ├── apps/DOMAIN.md         # AI 应用接口组（execute / catalog / plugins / infographic）
│       ├── tutor/DOMAIN.md        # AI 同桌 + agent loop 子路由（M10 主入口；mode='shared' 走 SharedAgent）
│       ├── share/DOMAIN.md        # v3.0 SharedAgent 创建 / 公开读 / 领取 / 埋点
│       └── video/import/DOMAIN.md # 视频导入管线
         # 其余无 DOMAIN.md 的子目录：article / asr / asr-config / chat / class-check / classroom /
         # extract-terms / feedback / generate-summary / generate-topics / llm / transcribe /
         # transcribe-fast / transcribe-turbo / transcript-enhance / translate / upload-audio / wechat
├── components/
│   ├── DOMAIN.md         # ~220 个 UI 组件索引（实际数见 `make stats`）
│   ├── ui/DOMAIN.md      # 原子 UI 组件库
│   ├── apps/DOMAIN.md
│   ├── apps/windows/DOMAIN.md  # Workshop 窗口（cheatsheet / flashcards / quiz / mindmap / studyreport / podcast / infographic）
│   ├── chat/DOMAIN.md    # ChatBase 底座（M11 起 5 面板 100% 收口：ChatBubble/Composer/MessageList/Renderer + Shiki/Mermaid/lightbox）
│   ├── classroom/DOMAIN.md # M9 课堂同桌完整模块（Hero / Layout / CompanionPanel / InlineAppCard ...）
│   ├── intent/DOMAIN.md  # 「聊聊你想要的」目标共建（IntentDialogContainer / IntentDialog / IntentSummaryCard / IntentBioCard）
│   ├── realtime/DOMAIN.md # 实时语音通话 UI（RealtimeOrb + IntentVoiceCallScreen / TutorRealtimeCallScreen）
│   ├── tutor/DOMAIN.md   # 复习态 Tutor + Skill chip + Tool card + Realtime call screen
│   ├── share/DOMAIN.md   # v3.0 SharedAgent 创建器 + Canvas 长图
│   ├── recorder/DOMAIN.md
│   ├── mobile/DOMAIN.md
│   ├── layout/DOMAIN.md
│   ├── ConversationHistory/DOMAIN.md
│   └── business/DOMAIN.md
├── hooks/DOMAIN.md       # ~55 hooks（含 useOmniRealtimeCall / useClassroomCompanion / useEnToZhTranslation / useLiveConcepts；实际数见 `make stats`）
├── hooks/data/DOMAIN.md
├── stores/DOMAIN.md      # Zustand 状态（8 stores，状态已迁移）
├── types/DOMAIN.md       # 共享类型
├── fixtures/             # demo-app-outputs.ts（Hero 试听 demo 用）
└── lib/
    ├── DOMAIN.md         # 库代码总览
    ├── services/DOMAIN.md # ~80 业务服务（按域分组；实际数见 `make stats`）
    ├── services/asr/DOMAIN.md # ASR 纯逻辑层（text-utils / render-state-machine / post-edit / audio-constraints / ws-url）
    ├── services/classroom/ # recent-focus（30s 窗口，给课堂同桌做代词消歧）
    ├── services/translation/ # 翻译相关服务（按域分组）
    ├── prompts/          # tutor-prompts.ts（M10 mode-driven，5 mode）
    ├── tutor/            # classroom-agent-request（课堂同桌瘦身请求体）+ realtime-conversation-bridge（语音同桌转写去重）
    ├── ui/               # copy.ts（用户面文案单一真相源）
    ├── hooks/DOMAIN.md   # 服务端/通用 hooks（fetchUIMessageStream / useSSEStream / useAuth）
    ├── utils/DOMAIN.md   # 工具函数
    ├── utils/page/DOMAIN.md # page-utils 拆分模块
    ├── db/DOMAIN.md      # IndexedDB Schema + CRUD
    ├── ai-native/DOMAIN.md # 应用插件系统
    ├── ai-native/plugins/DOMAIN.md # 11 个 Workshop 插件（studio-workshop 含 3 子模块）
    ├── longcut/DOMAIN.md # 转录算法
    ├── capture/DOMAIN.md # 收集逻辑
    ├── context-reach/DOMAIN.md # 输入分流
    ├── config/DOMAIN.md  # 配置中心
    ├── swr/DOMAIN.md     # SWR fetcher 封装
    └── logger.ts         # pino + Sentry breadcrumbs（不要用 console.log）
```

**读取顺序**：修改某个目录前，先读该目录的 `DOMAIN.md` 了解文件清单和依赖规则。

---

## 8. 关键文件

> 行数每次 commit 都会变，不在此静态列出——查实时行数与超标清单跑 `make stats`。下表只保留不易变的架构注意点。

| 文件 | 注意 |
|------|------|
| `src/app/(main)/app/page.tsx` | God File（按域分 6 阶段提取为 hooks + 子组件，详见 §3.6），改前先读 `src/app/DOMAIN.md` |
| `src/components/SafeAITutor.tsx` | Tutor 入口分发：默认 `TutorAgentPanel`；负责把复习页/移动端/视频复习的启动问题、当前时间（秒）、选中资料、个人画像和应用学习动态适配到 agent context（M12 退役 `AITutor.tsx` 后精简） |
| `src/components/Recorder.tsx` | 录音组件（已拆 3 子模块到 `recorder/`，含 mic/system/mixed 三档音源） |
| `src/components/classroom/ClassroomCompanionPanel.tsx` | 课堂右栏同桌面板（header / 气泡 / 流式 / thinking / 输入栏）；M11 起基于 ChatBase 底座；课中 / 课后 starter 用会动的 Octo Buddy 像素章鱼 + 轻问题 chip 引导 |
| `src/components/classroom/InlineAppCard.tsx` | 内联 app 承载卡（保存完整 AppExecutionResult，复用 AppRenderSurface / 应用矩阵 UI） |
| `src/components/classroom/ClassroomLeftPanel.tsx` | 课堂左侧（list / recording 切换 + ActiveLessonPill + StickyStartBar） |
| `src/hooks/useClassroomCompanion.ts` | 课堂同桌 hook：显式关闭并防御性清理 `[MM:SS]`，课中不提供时间回跳；M14.6 起 `<open_app:KEY/>` marker 合约已移除，结构化产物走前端 SkillChip 直接打开 |
| `src/hooks/useOmniRealtimeCall.ts` | Qwen Omni realtime 语音通话 hook（语音同桌入口，独立 WebSocket，不走 /api/tutor） |
| `src/app/api/tutor/agent/route.ts` | **M10 主入口**：mode-driven 单一 endpoint，AI SDK v6 streamText。M14.6 起所有 mode 纯对话（`tools = {}`），结构化产物由前端 SkillChip 直接打开；provider fallback StepFun→DeepSeek→Qwen；Qwen 注入 `enable_thinking=false` 抑制推理。详见 `src/app/api/tutor/DOMAIN.md` |
| `src/app/api/tutor/route.ts` | Legacy SSE 路径（flag off 时仍可用，不要在它上面加新功能） |
| `src/lib/prompts/tutor-prompts.ts` | `buildTutorSystemPrompt(mode, context, options)` ── 5 mode 唯一 prompt 源（M11.4 goal 双路径 + M13 word mode）；M14.6 已移除 `<open_app:KEY/>` marker 合约 |
| `src/lib/tutor/classroom-agent-request.ts` | 课堂同桌打 `/api/tutor/agent` 的请求体构建（带 recentFocus + fullTranscript，fullTranscript 通过 `formatTranscriptWithSpeakers` 注入 `[说话人N]` 标记） |
| `src/lib/services/llm-service.ts` | 统一 LLM 调用层（StepFun / DeepSeek / DashScope / Ark / Relay）；模型注册表在 `app.config.ts`，env 驱动 `pickAvailableModelId`，Qwen recommended=`qwen3.7-plus`（M13 改名，原 `Qwen3.6-Plus-A` 已废弃） |
| `src/lib/utils/tutor-agent-provider.ts` | Tutor Agent provider 解析 + fallback：按请求模型/env 选 StepFun、DeepSeek、DashScope 或 OpenAI，强制 Chat Completions；`resolveTutorAgentProviderFallbacks` 在 primary 可重试失败时切 StepFun→DeepSeek→Qwen |
| `src/lib/utils/ai-model-preference.ts` | 设置页模型偏好的 key 与 `auto` 解析契约 |
| `src/lib/ui/copy.ts` | 用户面文案唯一真相源（COPY 对象 + bannedWords 校验） |
| `src/lib/ai-native/app-catalog.ts` | Workshop 应用矩阵（6 类 ready），`WORKSHOP_APP_CATALOG` + `WorkshopAppKey`；每项含 learningAction / bestFor / timeLabel |
| `src/app/api/video/import/route.ts` | 多平台导入管线（已拆 3 子模块） |
| `src/lib/services/commonstack-echo-service.ts` | Echo LLM 调用，System Prompt 在此 |
| `src/lib/services/workspace-echo-service.ts` | Echo 数据管线；CommonStack 新 schema 不返回 title，需从 takeaway / echo 生成标题后再进质量门 |
| `src/lib/services/asr/audio-constraints.ts` | getUserMedia constraints 唯一真相源（AEC/NS/AGC），env 可覆盖 |
| `src/lib/services/asr/post-edit.ts` | 低置信片段 LLM 校对（feature-flag `ASR_POST_EDIT_ENABLED`） |
| `src/lib/services/classroom/recent-focus.ts` | 课堂同桌的最近 30s 窗口提取（纯 TS，可单测） |
| `src/components/classroom/ClassroomLayout.tsx` | 课堂分栏；同桌只在真实录课 / 示例课听课态可见，空课堂隐藏右栏、Octo Buddy 和移动端问同学入口 |
| `src/components/classroom/ClassroomHero.tsx` | 课堂零存量 Hero；居中首屏避免右侧空洞，录音来源 rail 直接露出麦克风 / 电脑声音 / 两路都录，示例课只是低门槛预览 |
| `src/components/classroom/ClassroomRecordingView.tsx` | 课中视图；桌面呈现实时原话 + 课堂脉络，移动端可切换“脉络 / 原话”；试听课播放 `/demo-audio.mp3`，结束后只显示总结卡和“结束这节课”入口 |
| `src/components/classroom/ClassroomFlowCanvas.tsx` | 课中中间主画布；突出当前讲解，以低权重时间线呈现近期推进，并留下真正值得课后回来的内容 |
| `src/hooks/useClassroomFlow.ts` + `src/lib/services/classroom-flow-service.ts` | 课堂脉络主链路；模型基于带时间位置的实时转录自主更新可修正工作状态，前端失败时保留上一轮有用理解 |
| `src/components/classroom/demo-classroom-flow.ts` | 试听课课堂脉络；随真实音频秒数推进，避免中间画布长期空态 |
| `src/components/classroom/OctoBuddy.tsx` | Octo Buddy 像素 IP；Sprite 自带呼吸 / 听课 / 开心动画，悬浮球和右栏内嵌都复用它 |
| `src/components/DesktopVideoReviewLayout.tsx` | 桌面端课后复习三栏布局：左=视频/音频证据 + 时间轴，中=学习工作区，右=同桌解释与复盘；视频默认放大证据栏，并持有课后学习黑板 |
| `src/components/ReviewThreePaneLayout.tsx` | 课后复习可拖拽三栏容器；两条边界都可拖拽，学习区 / 同桌可折叠成 rail，左证据栏不自动折叠 |
| `src/components/ReviewLearningWorkspace.tsx` | 课后中间学习工作区；承载完整 AppRenderSurface，闪卡切低亮度练习背景，并把测验/闪卡动态写入课后学习黑板 |
| `src/components/review-learning-blackboard.ts` | 课后学习黑板；轻结构自然语言便签，只记录学习现场事实，不写模型指令，解耦中间应用与右侧同桌 |
| `src/components/AISearchPanel.tsx` | 搜索笔记面板；桌面端必须以右侧上下文 sidecar 呈现，移动端全屏 |
| `src/components/mobile/MobileCollectionSheet.tsx` | 收集菜单 / 历史收集 / 笔记总结；桌面端历史与笔记总结走右侧上下文抽屉，移动端保留 sheet |
| `src/components/EchoCard.tsx` | 回声卡，必须遵守设计系统 |

---

## 9. 技术栈

- Next.js 14 (App Router) + 自定义 `server.js`（注入 ASR WebSocket 代理）+ TypeScript 5.3
- Tailwind CSS 3.4（token 在 `tailwind.config.js`，CSS 变量在 `globals.css`）
- Prisma 7.2 + SQLite
- Dexie (IndexedDB) 客户端存储
- Zustand 状态管理（7 stores）
- Vercel AI SDK v6（`ai@^6` + `@ai-sdk/openai@^3` + `@ai-sdk/react@^3`）
- Sentry (`@sentry/nextjs@^10`) + pino (`^10`) + `p-retry` + `reconnecting-websocket`
- Promptfoo + Vitest（src + server + eval 三套 config）
- PM2 进程管理
- **M12/M14.5 渲染与内容接入**：Shiki（代码高亮，`ChatCodeBlock`）/ Mermaid（图，`ChatMermaidBlock`）/ KaTeX + remark-math（数学公式）/ react-markdown + remark-gfm / mammoth（.docx）/ unpdf（PDF）/ youtubei.js（YouTube 导入）/ sharp（图像处理）
- **基础设施工具**：SWR（数据请求，`lib/swr/`）/ ioredis（Redis，rate-limit / cache）/ nodemailer（邮件验证码）/ sonner（Toast）/ wavesurfer.js（音频波形）

---

## 10. 文档索引

| 文档 | 状态 | 说明 |
|------|------|------|
| `README.md` | ✅ | 产品哲学、技术栈、项目结构、能力清单、文档索引 |
| `docs/UPGRADE_PLAN.md` | ⚠️ | M1-M4 路线图 + 业界最佳实践决策表（M5+ 未补，AGENTS.md §3 摘要代替） |
| `CHANGELOG.md` | ⚠️ | 停在 M11.5；M12/M13/M14/M14.5 见 commit history |
| `docs/OBSERVABILITY.md` | ✅ | 可观测底座（pino + Sentry + track 埋点） |
| `docs/ASR_PIPELINE.md` | ✅ | ASR 飞书妙记级工艺总图 |
| `docs/TUTOR_AGENT.md` | ✅ | Tutor agent loop（Vercel AI SDK v6） |
| `docs/ECHO_PRODUCT_DEFINITION.md` | ✅ | Echo 产品定义 source of truth |
| `docs/APPLICATION_MATRIX_PRD.md` | ✅ | 应用矩阵产品定义 |
| `docs/MODEL_REGISTRY_REFACTOR.md` | ✅ | 模型注册表重构记录 |
| `docs/MOBILE_REFACTOR_PLAN.md` | ✅ | 移动端重构计划 |
| `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` | ⚠️ | 产品定义准确，技术细节可能过时 |
| `tests/eval/README.md` | ✅ | Eval harness 设计原则 + 数据集 + grader |
| `项目开发文档/提示词设计哲学.md` | ✅ | Less Structure, More Intelligence |
| `roadmap/v3.0-virality-agent.md` | ✅ | v3.0 北极星（场景上下文可分享、Agent 是裂变载体） |
| `roadmap/v2.1-cross-browser-sync-gap.md` | ✅ | 跨设备同步架构缺口（已确认，待修） |
| `roadmap/多模态Agent技术架构路线2026-2030.md` | ✅ | 长期技术路线 |
| `skills/*/SKILL.md` | ✅ | Agent 工作规范（架构执行 / 变更流程 / 代码审查 / 系统化调试） |
