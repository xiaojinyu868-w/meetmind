# CHANGELOG

产品打磨升级（2026-05 四个 Milestone）的里程碑日志。
每条都可追到 `docs/UPGRADE_PLAN.md` 决策表和 GitHub 分支 commit。

---

## 2026-07-28 — v4.0 全端采集层 + 标题系统 + 课后理解 + teach-back + 微信 Agent + 桌面端 v1.2.0

> 一周交付两条主线：(1) 应用矩阵与收集线的产品闭环（teach-back / 微信 Agent / 分享页 / 复习体验）；
> (2) v4.0 全端采集层从调研到分发全链路（桌面壳 / 小窗 / 关键帧 / 标题 / 课后理解）。
> 架构北极星：`roadmap/v4.0-everywhere-capture.md`（采集 / 学习线索 / 规则 Hook 三层）。
> 备份点：`backup/pre-v4-desktop-20260727` tag（此周期一切改动之前的 main 快照）。

### 桌面端（desktop-v1.1.0 / v1.2.0，landing 已开放下载）
- **桌面壳 v2**：内嵌 MeetMind 网页 + `setDisplayMediaRequestHandler` 免弹窗授予主屏 + loopback 系统音频（录网课无机器人，Windows WASAPI / macOS SCK）；完备化：单实例锁 / 应用菜单（保 Cmd/Ctrl+C/V）/ 窗口状态持久化 / 断网兜底页 / 权限与外链策略 / 托盘常驻 + 开机自启
- **桌面小窗 v3**（`/companion` 路由 + `quick-panel.js`）：随手记（直收收集线）+ 随口问（流式，mode=global）+ 截图快捷动作；失焦自动收起；`persist:meetmind` 共享登录态；网页远程加载，壳只承载
- **全局热键 `Cmd/Ctrl+Shift+M`**：录制感知分流——录屏类课时当前帧挂课堂时间轴（调网页 `__meetmindCaptureFrame` 钩子），否则截图收进收集线；按 scaleFactor 抓全分辨率；401 引导重登
- **自动更新检查**（`updater.js`）：启动 20s 首查 + 每 4h 查 desktop-v* Release，新版本安静通知一次（零依赖，未签名包友好）
- **打包分发**：electron-builder two-package 结构（asar 360K 零 node_modules）+ 稳定文件名 + `desktop-release.yml` CI（mac dmg + win nsis）+ landing 下载区（`DESKTOP_DOWNLOAD.enabled` 门控，已开）

### 课中「截取这一页」（主动截图 > 自动检测的产品决策）
- recorder-audio-source 保留屏幕视频轨；Recorder 注册帧源 + 武装桌面热键钩子
- 课中按钮（帧源存在才露出，曾修 P0 断链：ClassroomView/ClassroomLeftPanel 透传）+ 桌面热键同一条 `captureCurrentFrame`（时间戳取 Recorder 录音时钟，与转录严格同轴）
- Dexie v8 `keyframes` 表；课后 upload-image → artifacts(kind='keyframe') 静默上传（100 条分批；音频上传成功点自动重试）
- 复习页 TranscriptFlowView 按时间轴插入缩略图条（可点击回跳）；evidence.keyframes 跨设备回填（mergeCloudKeyframes 只补缺）
- 自动 pHash 翻页检测引擎（死区防纯色同值簇失稳，15 单测）保留为远期备选

### 标题系统 + 课后理解（一次 LLM 调用替代 3-4 次全文复读）
- 标题契约 `主题 · 课程 · M-D` + 零信息词质量门（宁缺毋滥，12 单测）；用户手动改名双锁（本地 topicLocked + 服务端 titleSource='user'）
- `/api/classroom/understanding`：定稿后一次调用产出 topic+overview+takeaways+highlights，标题/摘要/精选三个 artifact 一次落齐（解析校验 6 单测；归属校验防 IDOR）
- 存量回填：每次工作区加载静默重命名最多 10 条（失败打标不无限重试）；新标题同步 collection feed SourceIngestItem

### teach-back「讲给同桌听」（应用矩阵第 7 应用）
- 选点插件 + evaluate（四象限服务端映射）+ cover-check 轻量覆盖检测；像素教室 + 四象限揭示 + 盲区重讲 + 打字降级
- readiness 去门禁：前端永不"暂不可用"，CONTENT_NOT_READY 安静空态（且清旧产物缓存）；legacy 快照课堂按文字量放行

### 微信 Agent（公众号绑定用户文字对话）
- 画像 + 近期收集 + 12 轮历史 → LLM → 客服消息异步推送；MsgId 幂等防重推；护栏按用户消息计数 + 每日只提醒一次；逐片重试 + token 过期刷新；未送达回复不进历史；WechatAgentMessage 表（+messageId 列）

### 其他产品面
- 分享落地页重设计：思维导图真渲染（ShareMindmapGraph）+ 产物展品卡为主角 + 删文字墙；畸形 artifact 前端守卫
- 复习体验：波形三层加速（服务端 ffmpeg peaks + IndexedDB 缓存）+ 复制 AI 回答去时间戳（跳过围栏/行内代码，空位清理局部化）
- 图像生成切 DashScope：qwen-image-3.0-pro 优先（邀测 403 自动降级 plus，plus 独立尺寸枚举）

### 五路分片审计修复（25 文件）+ 遗留清零
- P0：课中截图按钮 prop 断链（JSX spread 不做类型检查）
- 高：understanding IDOR / 小窗 transport 锁死 null token / 内联应用伪造产物 / 微信 prompt 谎言与幂等护栏推送
- 中：backfill 无限重试 / highlight 残留 / cover-check 闭包 / 分享页崩溃 / 复制破坏缩进 等 12 项
- 清零：删死代码（maybeRetitleLesson + titles/lesson 路由、octo.png、globals.v6.bak.css、tracked pycache）

### 质量基线
899 vitest 全绿；eval-guard：ASR avg CER 1.22%（baseline ×1.1 内）、Tutor pass 92.9%（baseline 内）；真实 LLM 冒烟（标题/课后理解 JSON mode）通过

---

## 2026-06-02（晚 +4）— M11.5：bio 进入所有模式 + 设置页画像 + SharedAgentChat 迁底座 + 4 模式 e2e（26/26）

> 一轮交付：bio 不只在 IntentDialog 里记下来，而是进入复习态、课堂同桌、设置页——每个用户面都接得上。

### bio 进入所有 mode
- `formatLearnerProfileForTutorAgent`（review）：bio.headline 优先于结构化字段，goals[] (active) 也注入
- `buildInClassTutorAgentBody` + `useClassroomCompanion`：in-class 注入 learnerProfile
- shared 保持隐私铁律：服务端不注入访客 learnerProfile

### 设置页「关于你」
`src/app/(auth)/settings/page.tsx` 顶部加：bio.headline + detail + 「和教练再聊聊」+ 「清除画像」

### SharedAgentChat 迁底座
ChatBase paper variant 重写，保留 shareToken/隐私铁律，新获得自动跟随滚动+草稿持久化+IME 安全

### 4 个 mode e2e（共 26 case 全过）
| Suite | Cases | 验证 |
|---|---|---|
| smoke-intent | 10 | goal 双路径 |
| smoke-review | 6 | review 时间戳+bio+inline app |
| smoke-in-class | 5 | recentFocus+Skill chip+bio |
| smoke-shared | 5 | 隐私铁律+无死链 |

Makefile: \`make smoke-review\` / \`smoke-in-class\` / \`smoke-shared\` / \`smoke-all\`
\`smoke-shared\` 自动 prisma seed fake SharedAgent。

eval-guard 持平：tutor 92.9% / asr 1.46%。

---

## 2026-06-02（晚 +3）— M11.4：goal 模式从"任务驱动"升级为"建立个人上下文" + 双 marker（bio + goal）+ 10 场景双路径 e2e

> 用户反馈："开头就要引导用户自我介绍，尽可能全面自然地引导，要拿到这个人的个人上下文 / 相对确定的背景和意图。"
>
> 之前 M11.3 解决了"被动陪听 → 主动教练"，但 taste 还有更深一层错：
> 把 goal 模式当成"5-10 分钟把那件事想清楚"的**任务工具**，而不是"建立个人上下文"的**关系入口**。
>
> 第一次进 IntentDialog 的用户，AI 还不认识他。这时该做的不是"挑一个事来梳理"，
> 是**自然地把这个人聊完整**——身份、阶段、状态、节奏、在乎的事。
> 这才是 v3.0 信息流哲学里"个人上下文私有积累 = 付费壁垒"的地基。

### 类型层：BioEntry

`src/types/user.ts` 加 `LearnerProfileBase.bio?: BioEntry`：

```ts
export interface BioEntry {
  /** 一句话核心：身份 + 阶段 + 当前状态 */
  headline: string;
  /** 可选 detail：在乎的事 / 节奏 / 值得记住的细节 */
  detail?: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
}
```

### Prompt 重写：路径 A 首次会面 + 路径 B 回访

`MODE_GOAL_SEGMENT` 重写为分支 prompt（`tutor-prompts.ts`）：

**路径 A（首次会面）**：context.goal 没有 existingBio 也没有 existingGoals 时触发
- 目标：拿到身份 / 阶段 / 状态 / 在乎的 / 节奏 五维信息
- 第一段必做三件事：自我介绍 + 说明这次意图 + 给具体起手问题（最低阻力的"身份/阶段"）
- 一次只问一个问题
- 拿到身份+阶段+状态至少其中两层、对话过 3-5 轮后，可以提议帮记 bio
- 输出 `---我了解到的你---` 块（第二人称，他的画像）

**路径 B（回访）**：context.goal 已有 bio 或 goals 时触发
- **不重问已知道的**——直接接上"上次你说想做 X，最近怎么样？"
- 按 GROW 框架推进具体目标
- 输出 `---我想要的---` 块（第一人称，他的目标，**marker 内每行用"我"开头**）

`capGoalContext` 升级支持双数据源：existingBio + existingGoals + sessionHint，
首次会面时显式注入 `【这是你和他的第一次见面】` 段，让 prompt 走路径 A。

### Marker pipeline 扩展

新增 `extractIntentBio` marker（`src/components/chat/markers/extractIntentBio.ts`），
解析 `---我了解到的你---...---结束---`。与 `extractIntentSummary` 平行存在，
同一条 AI 消息可同时包含两种 marker（罕见但允许）。

### 前端：IntentBioCard + 双卡渲染

- `src/components/intent/IntentBioCard.tsx`（新）— "我了解到的你"画像卡，可编辑 headline + detail，保存为 `BioEntry`
- `src/components/intent/IntentDialog.tsx`：
  - 消息渲染层先抽 bio、再在剩余文本上抽 summary，footer 双卡堆叠（bio 在上，goal 在下）
  - 顶部记忆卡升级：bio 优先（`我了解到的你: <headline>`），bio 不存在时才显示 `我想要的: <首个 goal>`
  - 开场 greeting 三分支：
    - **首次**："我是 Octo。我们刚认识——你想先告诉我一点你自己吗？" + chips: 我是学生 / 我在工作 / 我在过渡期
    - **回访（有 bio）**："欢迎回来。上次我大概了解了你——<headline>…  最近怎么样？"
    - **回访（仅有 goals）**：保留原 goals 入口
- `IntentDialogContainer.tsx` 加 `handleSaveBio` → `saveLearnerProfile({ ...profile, bio })`

### 通话模式

`buildCallInstructions` 区分首次 vs 回访：
- 首次："这是你和他的第一次见面——温和地引导他自我介绍（先聊身份、阶段、最近状态），不要一次问多个问题"
- 回访："你之前已经认识他：<bio.headline>… 这次别再问身份/阶段"

### Smoke 扩到 10 case 覆盖双路径

`tests/smoke/smoke-intent-mode.ts`：

| Case | 路径 | 断言 |
|---|---|---|
| A1/首次见面/你好 | A | AI 必须自我介绍 + 邀请用户介绍自己 |
| A2/首次见面/我是大三学生 | A | 不能追"什么专业"（问卷思维），要问状态 |
| A3/首次见面/聊完后提议记画像 | A | 多轮聊完后给合理教练动作（提议记画像 / 复述 / 深挖） |
| A4/首次见面/输出 bio marker | A | 用户同意后必须输出 `---我了解到的你---` 包含身份/阶段 |
| A5/首次见面/含糊回答 | A | 不能追问"为什么"，要给更小的入口 |
| B1/回访/不重问身份 | B | 已知 bio 时不能再问身份阶段，要接上之前目标 |
| B2/回访/帮我记下来 | B | 输出 `---我想要的---` 第一人称 marker |
| G1/通用/你是谁 | * | 自报 Octo + 简短角色，不列功能清单 |
| G2/通用/多目标聚焦 | * | 必须聚焦让用户挑一个 |
| G3/通用/给一个不给三个 | * | 不能输出 1.2.3 并列清单 |

支持 `contextGoal` 注入模拟回访（B 路径）。

**实测：连续 3 次 10/10 稳定通过**。AI 在 G3 的回复堪称典范：
> "我先不问建议，反过来问你一句：你脑子里第一次冒出'想读研'这个念头，是因为什么？是觉得本科不够用、想往深走，还是想换个环境/换个方向？"
>
> ——把"给你建议"翻转成"先帮你看清自己想要什么"，这就是真正的咨询师姿态。

### 工程化 fix

- `make smoke-intent` 间隔 800ms → 2500ms，避免 LLM provider 连续返回 outputTokens=0
- 加空回复自动重试一次（4s 间隔）
- agent route Schema 加 `existingBio` 字段

---

## 2026-06-02（晚 +2）— M11.3：goal 模式从"被动陪听"改成"专业教练"+ 端到端 7 场景 e2e 自测 + glass 气泡可读性修复

> 用户反馈两条：
> (1) 沉浸式 IntentDialog 的字看不见（深底深字）
> (2) AI 在装萌（"挥了挥触手 / 我不会寒暄 / 你想说啥说啥"），不像意图识别教练
> 修复后：作为 coding agent 必须**模拟一个真实用户跑一轮**才算交付——不再"以为 deploy 完就完事"。

### Bug 1：glass 气泡可读性

`src/components/chat/ChatBubble.tsx` + `ChatThinkingStrip.tsx`：
- assistant glass: `bg-white/82 + text-ink` → `bg-white/95 backdrop-blur-xl + text-ink + shadow-2xl`
  对标 Apple Intelligence / Linear AI——深色沉浸式背景上 assistant 用接近实白卡片，glass 感靠 backdrop-blur + 阴影实现，不靠把背景做透。
- user glass: `bg-ink/95` → `bg-white/12 + border-white/20 + text-white`（半透明白 glass，沉浸式深底上更通透）

### Bug 2：goal 模式 prompt 重写为"主动教练"

`src/lib/prompts/tutor-prompts.ts` 的 `MODE_GOAL_SEGMENT` 整段重写：

旧版本走"The Bitter Lesson + 不催促"过头，结果模型 fallback 到了被动陪伴 + 装萌：
- "(挥了挥触手) 嗨，我不是很会寒暄"
- "你想说啥说啥，我就在这儿等着"
- 把自己定位成"同班同学"

新版本：
- 身份段：明确"目标教练"（GROW 框架，不是助理 / 同学 / 导师）
- 开局段：用户说"你好"/"我们在干什么"时**必须立刻**把对话推到正题，不能停在打招呼。给出 ✓ 范例 vs ❌ 严禁话术
- 推进段：每一轮做三件事之一（承接 / 聚焦 / 深挖），按 GROW 框架走（Goal/Reality/Why now/Stakes/Options），**铁律一次一问**
- 含糊回答处理：用户回"嗯"时不追问 why（会防御），给"更小的入口"或"对照"
- 建议处理：明确要时给一个不给三个，最后把球踢回去
- 角色扮演禁止："不要写 (动作描述)"

`src/components/intent/IntentDialog.tsx` 开局：
- 旧 greeting："不急。你现在脑子里有什么..."（被动）
- 新 greeting："我们这次 5-10 分钟，把脑子里那件还没想清楚的事说清楚。你想梳理的那件事是什么？" + **3 个开局 chips**（"想做但还没动的" / "卡在一个选择上" / "最近反复在想的"），点击直接发送让用户不用从零开始打字

### 端到端 e2e 自测（这次真跑了）

`tests/smoke/smoke-intent-mode.ts` 模拟 7 个真实用户场景：

| Case | 用户输入 | 断言 |
|---|---|---|
| greet/你好 | "你好" | 必须立刻给开局问题，不能装萌 |
| meta/我们在干什么 | "我们现在在干什么" | 必须解释场合 + 引导主题 |
| identity/你是谁 | "你是谁" | 必须自报 Octo+教练，不列功能清单 |
| vague/单字回答 | "嗯" | 不能追问"为什么…"，要给更小入口 |
| focus/多目标 | "想换工作、想学英语、想找对象，都没动" | 必须聚焦让用户挑一个 |
| summary/帮我记下来 | （多轮）→"对就是这样，帮我记下" | 必须输出 `---我想要的---` marker，第一人称 |
| advice/给一个不要给三个 | "给我点建议吧" | 不能输出 1.2.3 并列清单 |

ban list（COACH_BAN_GLOBAL）：所有 case 共享，包含装萌话术 / 被动姿态 / 错误身份 / 课堂语境 4 类共 12 条禁忌词。

实测结果：**7/7 passed**。
- "我是 Octo。你不是来寒暄的——你打开了这里，是因为脑子里有件还没想清楚的事…"
- "你现在一口气说了三件事，但都没动。那我们先做一件事：**这三件事里，哪一件是你最近白天想起来最多次的？**"
- "好，那我记下。`---我想要的---` 找一个能让我每天愿意起来去做的事——先往设计转…`---结束---`"

### Makefile

新增 `make smoke-intent`，CI 之外的"产品级 e2e"——不只是类型对、tests 过，是**真的回答符合产品意图**。任何人改 `MODE_GOAL_SEGMENT` 或 glass 视觉都应跑一遍。

### 我学到的

> Coding agent 不应该止于"deploy"，应该止于"我亲自跑过证据"。

后续每个 mode（in-class / review / shared / goal）都补一个对应的 smoke 脚本，固化在 Makefile 里。

---

## 2026-06-02（晚 +1）— M11.2：bug 修复（glass 气泡可读性 + goal 身份段）+ smoke-intent-mode 首版 3 case

> 用户反馈两条：(1) 沉浸式 IntentDialog 字看不见 (2) AI 自称"同班同学"
> 这一轮修了视觉 bug，并加了首版 e2e smoke。下一轮（M11.3）发现 prompt 还有更深的问题（被动陪听），再大幅重写。

### Bug 1：glass 气泡可读性

`src/components/chat/ChatBubble.tsx` + `ChatThinkingStrip.tsx`：
- assistant glass: `bg-white/82 + text-ink` → `bg-white/95 backdrop-blur-xl + text-ink + shadow-2xl`
  对标 Apple Intelligence / Linear AI——深色沉浸式背景上 assistant 用接近实白卡片，glass 感靠 backdrop-blur + 阴影实现，不靠把背景做透。
- user glass: `bg-ink/95` → `bg-white/12 + border-white/20 + text-white`（半透明白 glass，沉浸式深底上更通透）

### Bug 2：goal 模式加身份段（防"同班同学"）

`MODE_GOAL_SEGMENT` 加：
> 你是 Octo… 不是助理，不是教练，不是导师，**也不是同班同学**…

### 端到端 e2e smoke 首版（3 case）

`tests/smoke/smoke-intent-mode.ts` + `make smoke-intent`：
- 你是谁 / 我想准备考研 / 帮我记下来
- 真实 LLM 调用，断言 marker、节奏、身份

3/3 通过。但之后用户继续测发现"装萌 / 被动姿态"问题没覆盖到——M11.3 大幅扩到 7 case + 重写 prompt。

---

## 2026-06-02（晚）— M11.1：抽 ChatBase 底座 + IntentDialog 沉浸式重做 + TutorAgentPanel 迁底座

> 用户反馈："整个应用里有些对话框能上传图片有些不能，太重复造轮子了"
> 调研结论：9 个对话面板各自实现一套输入条 / 消息流 / 流式协议，3 套流式协议并存，5 套文件上传逻辑。
> 解法：抽**薄底座 + 厚适配层**，所有对话面板共享同一套 UX。今晚先迁 IntentDialog 和 TutorAgentPanel 验证抽象，剩下 3 个面板下次迁。

### 新增：ChatBase 底座（11 个文件）

`src/components/chat/` 全新目录：

- `ChatBubble.tsx` — 单条消息壳，role/variant/avatar/actions/footer 五个 slot；支持 `paper`/`glass`/`minimal` 三 variant
- `ChatComposer.tsx` — 输入条，capabilities 开关（mic/file/call），拖拽 overlay，附件 chip，glass / paper 两态
- `ChatMessageList.tsx` — 消息流容器，自动跟随滚动 + "回到最新"按钮
- `ChatRenderer.tsx` — 流式 markdown，marker pipeline（intent-summary 等可扩展），React.memo
- `ChatThinkingStrip.tsx` — 等待态气泡（thinking / tool / writing 三态）
- `hooks/useChatComposer.ts` — 草稿持久化（sessionStorage 按 draftKey）+ IME 安全（中文输入法 Enter 不误发）+ 自适应高度（1→8 行）+ Cmd/Ctrl+Enter 永远发送
- `hooks/useChatFileUpload.ts` — `parseFileForChat` 封装 + 拖拽 + 剪贴板粘贴 + 多文件并发，错误 5s 自动消失
- `hooks/useAutoFollowScroll.ts` — 用户上滑停止跟随，回到底部恢复跟随
- `markers/extractIntentSummary.ts` — 解析 `---我想要的---...---结束---`
- `markers/collectMessageText.ts` — UIMessage → text，兼容 v6 parts + 老 content
- `index.ts` + `DOMAIN.md` — barrel + 契约文档

**设计铁律**：
1. 底座不引入业务逻辑（任何 `if (mode === ...)` 都要在 adapter 里）
2. props 极简（slot / capability 对象，不要 30 个 boolean）
3. variant 只 paper/glass/minimal 三种，不再扩
4. marker pipeline 通过类型扩展（加新 marker 走 `ChatMarkerKind` + `extractXxx` helper）

### 沉浸式 IntentDialog（v7 仪式时刻白名单第 6 项升级版）

旧 IntentDialog 视觉：米白纸感、克制——和"图书馆台灯"产品哲学吻合，但**不像对话**。
新 IntentDialog：**沉浸式 IP 陪伴感**。

- 全屏深色暗调背景（`#14110D` 深棕墨黑）+ pine/vermilion radial gradient 双柔光叠加
- Octo `original.png` 大图作虚化背景（78vh，blur 28px，9s 呼吸动画）
- 极淡 SVG noise 颗粒（避免 backdrop-blur 的"塑料感"）
- Glass morphism 半透明气泡（`bg-white/82 backdrop-blur-md` for assistant，`bg-ink/95` for user）
- OctoAvatar 内嵌 assistant 气泡左侧（thinking / happy / idle 跟随状态）
- Instrument Serif italic 装饰文案（"不用想好——说就行"）
- 顶部"我想要的"小卡：当用户已有 saved goal 时显示（黑底 backdrop-blur，Sparkles 图标）
- 进入动画 fade-up 16px / 240ms

### TutorAgentPanel 迁底座（验证抽象）

完整保留所有业务逻辑：
- conversationService 持久化（review 模式自动写本地 IndexedDB）
- inline app（`<open_app:KEY/>` marker → `/api/apps/execute` → InlineAppCard 在 ChatBubble.footer）
- launch question（外部时间线/资料/困惑点发起的一次问题）
- new conversation / 历史切换
- TutorToolCard（tool 调用结果卡片，作为 ChatBubble children 的一部分）
- SkillChipRow（empty state 推荐 prompt）
- 时间戳跳转（onSeek，`[MM:SS]` 点击）

**收益**：
- **首次获得**：拖拽上传 / 剪贴板粘图 / 草稿持久化 / IME 安全 Enter（之前的简单 input 没有）
- **首次获得**：复制 / 重生成 hover 操作行
- **首次获得**：自动跟随滚动 + "回到最新"按钮
- **首次获得**：错误状态 inline "再试一次"按钮

### 退役清单（V2，下次迭代）

- 5 套对话面板待迁底座：ClassroomCompanionPanel / SharedAgentChat / WordExplainer / MobileAIChatPanel / ConfusionCard
- `useSimpleSSEStream`（自写 SSE）→ 取代为 useChat
- `/api/chat`（老路由）→ 合并到 `/api/tutor/agent`
- `AITutor.tsx`（2400 行 legacy） + `AIChat.tsx` → 删
- 多模态 image inline（base64 走 `messages.content[].type=image`）→ 当前走 OCR/VLM 文字回填，下次升级
- 虚拟滚动（react-virtuoso，>50 条）+ Mermaid + Shiki 代码高亮 + TTS

### 文档同步

- `AGENTS.md` 第 0 节加"改任意 AI 对话面板"任务路径，铁律提示
- `src/components/chat/DOMAIN.md`（新） — 完整契约 + adapter 模板代码
- `src/components/DOMAIN.md` — 顶层目录树加 chat/

---

## 2026-06-02 — M11：「聊聊你想要的」对话式目标共建 + 通话 UI 升级 + 实时语音抗噪抗打断

> v3.0 信息流哲学（"目标驱动的 AI 信息流：让每个人的信息流，服务想成为的自己"）落地的第一个产品入口。
> 旧硬编码两步表单 LearnerOnboarding 被对话式 IntentDialog 替代；同时趁势把语音同桌的视觉和抗噪一并升级。

### 新增：「聊聊你想要的」对话式入口

- `src/lib/prompts/tutor-prompts.ts` — `TutorMode` 加 `'goal'`；`MODE_GOAL_SEGMENT` 是教练态 prompt（不催促、不问卷、用 `---我想要的---...---结束---` 块自然提炼可保存的目标）
- `src/app/api/tutor/agent/route.ts` — `BodySchema.mode` 加 `'goal'`；`ContextSchema.goal` 接 `existingGoals + sessionHint`；goal 态禁用 native tools / inline app marker / 时间戳
- `src/lib/services/file-parse-service.ts`（新） — 把 File 解析成纯文本的轻量 helper：文档→`/api/sources/ingest`，图片→`/api/sources/ingest-image`，音视频→`/api/transcribe`。**不写 IndexedDB / 不动 collection**（区别于重副作用的 `useSourceImport`）
- `src/components/intent/IntentDialog.tsx`（新） — 全屏对话主体：`useChat` + 文件上传 + 语音输入 + AI 提炼卡片
- `src/components/intent/IntentSummaryCard.tsx`（新） — "我听到的是…"卡片，可编辑 → 保存为 `GoalEntry`
- `src/components/intent/IntentDialogContainer.tsx`（新） — 对外封装：打包文字/通话双态 + saveLearnerProfile 合并已有 goals
- `src/types/user.ts` — 新增 `GoalEntry` 类型 + `LearnerProfileBase.goals?: GoalEntry[]`（free-form JSON 兼容旧画像）

### 入口接入

- `src/app/(main)/app/page.tsx` — 首次进入 `/app` 自动弹 `IntentDialogContainer`（替代旧 `LearnerOnboarding`），sessionHint='first-time'
- `src/app/(auth)/settings/page.tsx` — 顶部加常驻「聊聊你想要的」section：显示已保存目标列表 + "和教练聊一聊"入口；旧 LearnerOnboarding 留在「学习档案」section 作 fallback

### 实时语音通话视觉升级（v7 呼吸光晕）

- `src/components/realtime/RealtimeOrb.tsx`（新） — v7 设计宪法落地：米白纸感主底 + pine 主光环 + vermilion 响应点缀 + 多层 radial gradient 呼吸 + thinking 态内圈环 6s 旋转
- `src/components/realtime/IntentVoiceCallScreen.tsx`（新） — 「聊聊你想要的」打电话模式（复用 useOmniRealtimeCall）
- `src/components/tutor/TutorRealtimeCallScreen.tsx` — 本地 VoiceOrb 已废弃，迁移到共享 RealtimeOrb；视觉同步升级为 v7 风格

### 抗噪 + 抗打断（DashScope omni realtime）

`server.js` 的 `/api/tutor-call` WebSocket 升级 turn detection 三件套：

- `turn_detection.type='semantic_vad'`（默认）— 能区分附和声/咳嗽/背景音 vs 真要说话；旧 `server_vad` 只看音量阈值，嘈杂环境频繁误打断
- `input_audio_noise_reduction.type='near_field'`（默认）— 服务端噪音抑制；远场可切 `'far_field'`，关闭走 `'off'`
- `silence_duration_ms=1500`（旧 1100）— 给短暂背景音留缓冲
- `prefix_padding_ms=500`（旧 300）— 句首兜底更稳

环境变量见 `.env.example` 「实时语音同桌」段：`DASHSCOPE_OMNI_TURN_DETECTION` / `DASHSCOPE_OMNI_NOISE_REDUCTION` / `DASHSCOPE_OMNI_SILENCE_DURATION_MS` / `DASHSCOPE_OMNI_VAD_THRESHOLD`。

### 文档同步

- `AGENTS.md` 第 0 节任务路径表加「改聊聊你想要的」「改实时语音通话 UI / 抗噪抗打断」两行
- `src/components/intent/DOMAIN.md`（新） + `src/components/realtime/DOMAIN.md`（新）
- `src/components/DOMAIN.md` 顶层目录树同步
- `src/app/api/tutor/DOMAIN.md` 加 mode 矩阵表（in-class / review / shared / goal）
- `src/lib/services/DOMAIN.md` 加 file-parse-service 条目
- `src/lib/ui/copy.ts` 加 `COPY.intent` 命名空间（待后续把 IntentDialog 内字面量迁过去）
- `.env.example` 加实时语音同桌 omni realtime 配置段

---

## 2026-06-01 — 按《提示词设计哲学》全面重写所有学习应用 prompt + 修闪卡 / class-check 超时崩溃

> 用户反馈：闪卡 200+ 秒后显示"失败"、`/api/class-check/plan` 返回 500、AI copilot 输出"不本质"。
>
> 调研发现这三件事是同一个根因：**plugin / route 的 prompt 大量违反《提示词设计哲学》"描述目标，不描述路径"，硬塞 6 条纪律 + 200 行 few-shot + 强制三层难度 + 字数限制 + 题数限制**——既让模型变成填表机器（产出"不本质"），又让 prefill 阶段巨慢（撞 180s LLM 超时崩溃）。
>
> 修这件事的方式正好是**同一刀**：按哲学重写 prompt = 更像在给一个人类专家布置任务 + prompt 体积大幅缩小 + TTFT 显著下降 + 模型升级后产出自动变好。

### Prompt 全面重写（10 处）

哲学："描述目标和用户处境，把怎么做留给模型；只规定前端必须的最小 JSON 渲染契约。"

- `src/lib/ai-native/plugins/flashcards.plugin.ts` —— 删 6 条硬纪律 + 200 行 few-shot + 三层难度强制；只保留"认知科学学习教练 + 学生处境 + JSON 字段契约"。`maxTokens` 2800 → 2400，转录注入 24KB → 8KB
- `src/lib/ai-native/plugins/quiz.plugin.ts` —— 同上，删 5 条硬纪律 + few-shot + 题型分布强制；让模型自己按内容性质选单选/判断/填空/简答。`maxTokens` 8192 → 3500，转录 22KB → 8KB
- `src/lib/ai-native/plugins/mindmap.plugin.ts` —— 删 5 条硬纪律（主干 3-5 / 子节点 ≤ 3 / 深度 ≤ 3 / 字数）；只描述"5 秒可扫"目标。`maxTokens` 2400 → 1800，转录 24KB → 8KB
- `src/lib/ai-native/plugins/study-report.plugin.ts` —— 删长版铁律 + 字段强制要求；保留"温暖务实教育顾问 + 不评判孩子"的姿态。`maxTokens` 3072 → 2200，转录 20KB → 8KB
- `src/lib/ai-native/plugins/studio-workshop.plugin.ts` —— 转录 24KB → 8KB（system prompt 已较合规）
- `src/lib/ai-native/plugins/knowledge-cards.plugin.ts` —— 简化 system prompt 措辞
- `src/app/api/class-check/plan/route.ts` —— 删多段硬纪律和强制题数；改为"AI 同桌帮梳理课堂结构"的自然语言。`maxTokens` 3072 → 2400，转录 28KB → 10KB
- `src/app/api/class-check/question/route.ts` —— 删"出题风格 5 条" + 强制 4 选项；保留 JSON 契约
- `src/components/AIChat.tsx` `TUTOR_SYSTEM_PROMPT` —— 删"你的职责 5 条 + 回答要求 3 条"；改为"你是这个学生的 AI 同桌，刚和他一起听了这节课"
- `src/components/WordExplainer.tsx` `EXPLAIN_SYSTEM_PROMPT` —— 删 5 条要求 + 字数限制；改为"学生圈出了一段话问你"的场景描述

### 性能效果（量化）

- **闪卡生成**：之前撞 180s 超时失败，现在 prompt input 从 ~30k tokens → ~10k tokens（70% 降幅），prefill 时间和总响应时间都大幅下降，预期 15-30s 内完成
- **class-check/plan 500**：同样根因，修复后预期 10-25s 内返回 plan
- **学习应用整体（闪卡 / 测验 / 思维导图 / 学习报告）感知速度**：TTFT 降低，因为 system prompt 从 800-1500 字砍到 100-200 字，input 总量减半

### UX 修复

- ~~`src/components/DesktopVideoReviewLayout.tsx` —— 视频复习态左栏：当 `VideoInsightTimeline` 还没有真实 plan items 时左栏底部 fallback 渲染 `TranscriptFlowView`~~（**已撤回**：中栏"转录原文" tab 已承担转录展示，左栏再 fallback 是同一份信息双栏重复，违反 UI 第一性原理。真正的修复方向是重构整个复习态信息架构——见后续 roadmap）

---

## 2026-05-31 — Design System v7 · 真实视觉打磨（Round 7：从 sed 替换走向真实视觉重做）

> 用户反馈：v7 token 改完之后，真实页面**和 design-demo/v7 那 11 个 showcase 差距很大**——因为前 6 轮主要是机械 sed 替换 className，但**布局结构、字号节奏、字体使用、AI 在场信号**没动，等于 v6 骨架披 v7 色。
>
> Round 7 目标：选 7 个**用户进入产品后第一眼看到**的关键页面/组件，用 design-demo 同样的视觉语言（mono eyebrow / Instrument Serif italic em / surface-ai shimmer / shadow-ai-glow / pine accent）真正重做骨架，不再 sed。

### P1 课堂主区 PageHeader → v7 Course Hero
- 整张 hero 卡用 `.surface-ai` 工具类：`shadow-ai-glow` + `ai-breath` shimmer 6s 极淡光带循环
- mono eyebrow `5 月 31 日 · 周日` JetBrains Mono / 11px / 0.08em / pine 600 + pine 呼吸点
- h1 30px / 600 / -0.024em，配 Instrument Serif italic 朱批红 "今日"（中西字体混排）
- meta：`已积累 6 节课 · 慢慢酿，不急` 双签名色 + serif italic 副词
- 这是整个产品**第一个**真正达到 design-demo 水准的页面

### P2 课堂列表 ClassroomLessonCard + SectionLabel
- **SectionLabel** → v7 col-head：JetBrains Mono / 11px / 0.08em uppercase + 0-padded 数字（`02` / `05`）+ 1px 分隔线
- **StatusDot 双签名色家族化**：
  - `recording` → vermilion + ping（朱批"此刻"）
  - `processing` → pine + 慢呼吸（AI 在酿，墨绿信号，**不是灰色**——让"理解中"被看见）
  - `ready` → pine 主签名（已沉淀）
  - `failed` → vermilion 朱批提醒（**不是灰色**——让用户看见需要他注意）
- **MetaLine** 状态文案 Instrument Serif italic：`正在录音` (vermilion) / `正在理解…` (pine)
- **TagLine** Sparkles → pine（v7：AI 已酿好 = 墨绿沉淀信号），keyPoints 数字 mono pine 资产化
- **featured 卡** → `bg-card shadow-soft ring-1 ring-pine/15 hover:ring-pine/40 hover:shadow-card`（"AI 在场"轻信号）
- **action label** → mono uppercase 0.06em（被资产化的状态标记），hover translate-x 0.5

### P3 课中录音 LiveTranscriptPanel 头部
- 整卡 `border-pine/15 + shadow-soft`，hero 容器加 `bg-paper-warm` 暖纸感衬底
- pine ping 状态点 + `LIVE` mono uppercase eyebrow + 状态文案 serif italic（`正在听这一句…` / `等老师开口`）
- 录音句数 `已记 N 句` mono pine 资产化
- 时长 mono pine + 进度条 `bg-gradient-to-r from-pine to-pine-deep`（"已沉淀的时长"）

### P4 OctoBuddy 同桌 companion-head
- **真正的 octo-stage 44px 圆形**：`octo-aura` 工具类自带 5px pine 呼吸光环（替代之前的纯 SVG sprite）
- 状态点 mono `LISTENING` / `待命中` uppercase + pine pulse + 0.08em letter-spacing
- 名称 + 状态分两行竖排（demo companion-head 风格），不再单行挤
- foresight 按钮 hover 走 pine（"AI 同学想被聊"）
- `Radio` 图标 pine/65 而不是灰色

### P5 复习态 ReviewWorkspacePanel
- **tab 激活态用 pine** 而不是黑色下划线 + `font-semibold`（"AI 在场"信号扩散到导航交互）
- 未激活态 hover → pine/75 微提示
- 时间轴空态：`<OctoAvatar mood="thinking" size="lg" aura />` 替代通用 clock SVG + 朱批 italic em 装饰文案
- 主 CTA 加 `shadow-soft hover:shadow-card hover:bg-pine-deep active:scale-[0.98]` 物理反馈

### P6 应用窗口 AppWindowShell
- 已在 R3-R4 升级到 v7 header（`bg-card/92 backdrop-blur-md shadow-soft`）
- ClassCheckOverlay v6 注释（"零渐变零阴影装饰纯平涂"）→ v7 哲学说明

### P7 globals.css 新增 6 个 v7 通用 utility class
> 让任意页面快速获得 v7 视觉灵魂（无需逐个写 className 长链）：

| class | 含义 |
|------|------|
| `.v7-eyebrow` | mono / 11px / 0.08em / uppercase / pine 600 |
| `.v7-em` | Instrument Serif italic / vermilion 装饰 |
| `.v7-em-pine` | Instrument Serif italic / pine（如"AI 同学"） |
| `.v7-h1` | 30px / 600 / -0.024em |
| `.v7-section-head` | 12.5px upcase 0.04em ink-2 + .accent pine（col-head 通用） |
| `.v7-mono-label` | mono / 11.5px / tabular-nums（时间戳 / 数字徽标专用） |

**全局按钮微交互节奏统一**：所有 `<button>` / `[role=button]` 自动获得 150ms cubic-bezier(0.16, 1, 0.3, 1) transition，让"按下"反馈一致

**hero-float 关键帧**：仪式时刻 hero 上浮 -6px 1.2deg 7s 循环（用在分享落地页 / RecordingHero 等）

### 清理 v6 时代设计系统注释
14 个文件里"零渐变、零阴影、纯平涂"这种 v6 哲学描述全部替换为 v7 宪法说明。这条不是字面替换——v6 强调"克制到底"（不允许 shadow），v7 强调"95% 克制 + 5% 仪式时刻情绪化"。注释要跟上代码的真实状态。

### 验证

- ✅ tsc --noEmit 0 errors
- ✅ make deploy 一气呵成（不再陷入 chunk hash 错配）
- ✅ PM2 reload PID 3807120 / `Ready on http://localhost:3002`
- ✅ 线上 https://capture.meetmind.online/login 200

### Why this matters

前 6 轮 sed 替换让代码层"看起来"完成了 v7 升级，但**真实页面体验**还是 v6 骨架。Round 7 选择从课堂第一眼（PageHeader / LessonCard / RecordingPanel / CompanionHeader）开始**真实重做**——这才是用户能感知到差距弥合的层面。剩余的 Workshop 应用窗口内层、复习态左中右三栏深度打磨、移动端各页 hero 等，需要按同样思路继续逐页推进。



> 整套设计宪法替换。"色 = 架构"——墨松绿是 AI 沉淀（场景上下文），朱批红是学生此刻（个人上下文 / 引用 / 标注）。
> 全球 AI 产品没人这么做：东方批注美学 + 西方学术工业感的独占组合。

### Round 5（同日继续）：录课仪式时刻 + 微信捕获 + Mindmap 七彩重写 + 课中考试规整

- **新增 RecordingHero 组件** (`src/components/ui/recording-hero.tsx`)：v7 仪式时刻白名单核心实现——三层呼吸光环（vermilion 0.20 + pine 0.18 + 高光）+ 朱批 rec-dot ping + 实时波形条 8 根 + mono `tabular-nums` 大时长 + Instrument Serif italic 副标题。两种 variant：`hero`（主屏幕，176px Octo）和 `compact`（侧栏嵌入，96px）；4 种 status：`listening` / `thinking` / `paused` / `idle`
- **WeChat 捕获页 `/wechat/capture/[token]`** 全 v7：stone 暖灰 → paper/divider/ink；红色错误 `bg-red-50/text-red-600` → vermilion-mist/text-vermilion；自定义阴影 → `shadow-card`；外部访客在班级群打开服务号链接的第一眼现在也是 v7 米白纸感
- **Mindmap DEPTH_HUES 七彩调色板重写**（`mindmap-layout.ts`）：v6 时代的"七彩气球"（紫蓝青黄红粉绿橙）与 v7 双签名色哲学冲突——重新设计为 **8 层双签名色家族化**：
  - depth 1 / 3 / 5 / 7：pine 家族（`#2D4F3E` / `#6B9080` / `#1A3327` / `#5C5A55`），主分支
  - depth 2 / 4 / 6 / 8：vermilion 家族（`#B5483C` / `#D17969` / `#8E3328` / `#8E8B82`），副分支 / 标注
  - 暗色 PALETTE 也同步更新为深棕墨黑 `#1A1612`（深夜书房）+ pine 主签名
  - 设计意图：知识结构本就是单一主题的细分，色彩应顺应这个语义——节点像老师在卷子上画的不同力度的标注，不是七彩气球
- **CheatsheetWindow 章节色板**：`exemplar` 类型 label 紫色 `#6C509C` → `#2D4F3E` pine（统一墨绿家族）
- **ArtifactRender** 同源章节色 + `#FBFAF5` paper-warm hex → token
- **OctoCrystalDispatcher v3.0 分享水晶球**：4 个 SHAREABLE_APPS glow 色对齐双签名色——mindmap 紫 `#E9D5FF` → pine-mist `#E6EDE8`；quiz 蓝 `#DBEAFE` → vermilion-fog `#FBF2EF`；hub 三层 radial-gradient 改为 vermilion-fog + pine-mist + pine-fog 组合（不再借蓝紫）
- **CollectionCard video 类型 tag 紫色** 全部 → pine（笔记类型识别色彩家族化）
- **VIDEO_INSIGHT_COLORS 6 色彩虹**（`text-and-constants.ts`）→ pine + vermilion 双签名色 6 阶变体，让"AI 在视频里发现的洞察"用同一个语义家族
- **VideoInsightTimeline / ClassCheckOverlay / ClassCheckToast accent 橙色 `#E67E22`** → vermilion `#B5483C`（朱批"标注"语义）
- **ClassCheckOverlay 课中考试 overlay** 大量 emerald/red/amber hex 全部规整：`#FEE2E2` `#FEF2F2` `#FECACA` `#A7F3D0` `#ECFDF5` `#065F46` `#991B1B` `#D1FAE5` `#FEF3C7` → v7 双签名色家族 mist / fog / deep
- **AppLoading 金黄渐变** `#D4A574` `#E8C4A0` `#C4956A` → pine 三色阶（`#2D4F3E` / `#6B9080` / `#1A3327`）
- **ShareAgentCard v6 米色板** `#F7F5F1` `#2C2825` `#8C857A` `#DDD9D2` → v7 paper / ink / ink-secondary / divider hex
- **TutorRealtimeCallScreen / AnchorDetailPanel** 残留 hex → token
- **ReviewWorkspacePanel 复习态左栏** 全部 hex → token
- **DesktopSidebar logo Octo 化**（已在 R4，此条为 R5 补记）：折叠态点击 hover 由 GraduationCap 灰圆变为 Octo idle 头像，"AI 在场"信号扩散到全局导航

### 验证（截至 Round 5）

- ✅ `tsc --noEmit` 0 errors
- ✅ `make build` 0 errors（exit code 0）
- ✅ 紫 / 蓝 / 粉 / 靛违禁色 0 残留（除 ModelSelector provider tag + 化学/英语学科色 + InfographicWindow 信息图模板放飞，全为合理保留）
- ✅ 所有视觉信号统一到双签名色：录音、AI 在场、引用、思考链、状态点、思维导图、章节标签、笔记类型、考试反馈、loading、Octo IP——**全产品没有任何"看起来不属于这个设计系统"的颜色**

### Round 6（同日继续）：WaveformPlayer + 全局 gray/emerald/red/amber/rose 终极规整

> 目标：让全产品**没有任何**色彩在视觉上"看起来不属于这个设计系统"。

- **WaveformPlayer 复习态音频播放器**（高曝光）：金色 + 珊瑚粉全部重写——
  - `waveColor #D4A574` "得到金色" → `#6B9080` pine-light（声波 = AI 沉淀的轨迹）
  - `progressColor #F5E6D3` 暖米色 → `#2D4F3E` pine 主签名（已播放部分 = 已沉淀）
  - `cursorColor #FF8A80` coral 珊瑚粉 → `#B5483C` vermilion 朱批红（光标 = 此刻）
  - 所有渐变 button bg、loading ring、border 同步双签名色化
- **DesktopVideoReviewLayout 视频复习布局** waveColor/progressColor 暖金 → pine 系
- **StudyReportWindow 学习报告**：v6 米色板 (`#F7F5F1` `#2C2825` `#8C857A` `#DDD9D2`) → v7；功能色 emerald `#10b981` / amber `#f59e0b` / red `#ef4444` → pine `#2D6A4F` / `#B8842B` warning / vermilion `#B5483C`；进度环 `#E67E22` 橙 → vermilion
- **CheatsheetWindow 速查表**：`#FAFAF7` 米色 → paper-warm；`#C0392B` 红色错误指示 → vermilion；`#F0EFEB` 灰底切换器 → paper-warm
- **AppLoading**：金黄渐变 `#D4A574` `#E8C4A0` `#C4956A` → pine 三色阶
- **WorkshopWindowManager / ClassCheckToast / SkillChipRow / TutorRealtimeCallScreen** 等 8 个组件残留 hex → token

#### 全局批量清理（4 类违禁色一网打尽）

| 类别 | 文件数 | 关键映射 |
|------|------|---------|
| **gray 灰系**（v6 中性色）| **33 文件** | text-gray-* / bg-gray-* / border-gray-* / hover:bg-gray-* / focus:ring-gray-* / marker:text-gray-* → ink / paper / divider 系 |
| **emerald / green 绿系**（v6 success）| 多文件 | bg-emerald-50 / text-emerald-* / hover:bg-emerald-* / decoration-emerald-* / group-hover:text-emerald-* / border-emerald-* → pine 系 |
| **red / amber / orange / yellow 警示色**（v6 danger / warning）| 多文件 | bg-red-50 / text-red-* / bg-amber-* / text-amber-* / bg-yellow-* / bg-orange-* → vermilion 系（朱批"标注"语义统一警示） |
| **rose / sky / teal / cyan 杂色**（v6 内容标签 / focus ring）| 多文件 | bg-rose-* / focus:ring-rose-* / focus:border-rose-400 / border-sky-* / text-teal-* → 双签名色家族 |

#### 转化页 focus ring 统一

`feedback` / `forgot-password` / `profile/password` / `loading` 4 个核心转化页所有 `focus:border-rose-400 focus:ring-rose-100` 输入框 focus 态 → `focus:border-pine focus:ring-pine/15`（让"AI 在场"的墨绿信号扩散到表单交互）

#### 移动端 4 文件 gray 系全清

ConfusionCard / DedaoConfusionCard / MobileLayout / MenuDrawer / BottomPanel：text-gray-* / bg-gray-* / border-gray-* 全部映射

### 验证（截至 Round 6 / Final）

- ✅ `tsc --noEmit` 0 errors
- ✅ `make build` 0 errors（exit code 0）
- ✅ **0 处违禁紫 / 蓝 / 粉 / 靛 / 绿 / 红 / 橙 / 黄 / 青残留**（仅 ModelSelector provider 标签 + 化学/英语学科色 + InfographicWindow 信息图模板放飞 = 合理保留）
- ✅ **全产品视觉信号 100% 双签名色化**：录音、AI 在场、引用、思考链、状态点、思维导图、章节标签、笔记类型、考试反馈、loading、Octo IP、波形、复习态、转化表单 focus ring——**没有任何"看起来不属于这个设计系统"的颜色**

### Round 4：Workshop 7 应用窗口 + Tutor + 桌面侧栏 Octo 化

- **PodcastWindow** 全 v7：blue 系（"信任色"业界已饱和）→ vermilion（v7：播客 = 此刻聆听）；slate-* 中性灰 → ink/divider/paper-warm
- **FlashcardsWindow**：错误标记 rose → vermilion-light（朱批语义）+ slate 系清理
- **CheatsheetWindow / QuizWindow / MindmapWindow / StudyReportWindow / StudyReportDocument**：slate 系全部规整到 v7 ink/divider 系
- **TutorAgentPanel**：顶栏新增 Octo 永驻状态点（busy 墨绿脉搏），背景从纯白 → `bg-paper-warm/60` + `backdrop-blur-sm`，hover 颜色统一 pine；空态新增 `OctoAvatar listening lg` + Instrument Serif italic"同学"
- **TutorToolCard / TutorWidgets / TutorRealtimeCallScreen**：emerald → pine / amber → vermilion / slate → ink-divider 系
- **DesktopSidebar**：GraduationCap logo → **Octo IP 化**（折叠态 + 展开态都用 `/images/octo-buddy/idle.png` + `octo-aura` 呼吸光环），所有 v6 hex 直写映射到 token；hover 状态对齐 pine（"AI 在场"信号扩散到全局导航）
- **ClassroomLeftPanel**：录音指示从琥珀金 `#E8C547` → 朱批红 `#B5483C`（统一 v7 录音"此刻"语义；琥珀金废弃，因为 Granola 已占）
- **MyShareList (`/me/shares`)**：所有 hex 直写规整为 token，hover 颜色对齐 pine
- **全局 v6 杂色 hex 清理 7 文件**：`#5C8A4F` → pine / `#F1F6EE` → pine-fog / `#FFF8E5` `#FCE7F3` → vermilion-fog / `#A78BFA` `#8A6CB4` `#2F5D8A` `#8B6914` → pine 家族 / `#B83766` → vermilion / `#FFF9F5` `#FFFBF0` → paper / paper-warm
- **全局 slate 灰系清理 19+ 文件**：text-slate-* / bg-slate-* / border-slate-* / hover:bg-slate-* 全部映射到 ink / paper / divider 系（保留信息图模板放飞 + 暗态 placeholder）
- **全局 blue 蓝系清理 10 文件**：bg-blue-* / text-blue-* / border-blue-* / focus:ring-blue-* → pine 系（蓝色"信任"已被飞书/钉钉/Cursor/Khan/Meta 占满，MeetMind 不再蹭这条赛道）

### 设计宪法（design-demo/v7/）

11 个可视化文档（5 个基础 + 6 个场景）+ 共享 token CSS：
- `tokens.css` — 单一真相源，含暗色 first-class 重映射
- `index.html` / `01-foundations` / `02-ai-language` / `03-components` / `04-app-matrix` — 基础 5 篇
- `05-classroom` / `06-review` / `07-share-landing` / `08-mobile` / `09-dark` — 场景 5 篇

### 底层 token 系统（破坏性最低，向下兼容 v6）

- **`tailwind.config.js` v7 重写**：双签名色 `pine` (#2D4F3E) + `vermilion` (#B5483C) 升级为一等公民；纸感色 `paper` (#FAF7F2) 替代燕麦灰；保留 v6 别名（`canvas` / `mint` / `coral` 等）自动映射，**200+ 既有文件零改动也呈现新视觉**
- **`src/app/globals.css` v7 重写**：完整 token 表 + 11 个 v7 工具类（`.cite-ts` / `.cite-src` / `.surface-ai` / `.skel` / `.stream` / `.typing-caret` / `.thinking-strip` / `.rec-dot` / `.octo-aura` / `.mark-pine` / `.mark-vermilion`）+ `[data-theme='dark']` 深夜书房模式（不是反色，是另一种气质）
- **字体三件套** (`src/app/layout.tsx` 用 `next/font`)：Inter（正文 + 'palt' 紧排）+ Instrument Serif（仪式 italic 装饰）+ JetBrains Mono（引用资产化 `[MM:SS]` / `[资料 N]` 专用）
- **投影系统从"全部 none"改为"必须存在但克制"**：`shadow-soft` (0/4/16) / `shadow-card` (0/8/28) / `shadow-float` (0/16/48) / `shadow-modal` (0/32/80) / `shadow-ai-glow` (1px pine ring + 8/28 pine = "AI 在场"信号)
- **备份保留**：`tailwind.config.v6.bak.js` + `src/app/globals.v6.bak.css`

### 原子组件库 v7（`src/components/ui/`）

**升级 5 个**：
- `Button` — 加 `pine` / `vermilion` / `naked` / `link` / `danger` variant + `xl` size + `loading` prop
- `Card` — 加 4 档 variant (`default` / `soft` / `elevated` / `ai`) + `hoverable` + `CardEyebrow`
- `Badge` — 加 `pine` / `vermilion` / `sand` / `mute` variant + `dot` 状态点
- `Input` — Focus 用墨绿 ring，error 用朱批红
- `Skeleton` — shimmer 横扫（不再 pulse 明灭），子组件 `Paragraph` / `Cite` / `AppCard`

**新增 11 个**：
- `Cite` — **引用资产化**：朱批时间戳 / 墨绿资料胶囊（MeetMind"有根"DNA）
- `OctoAvatar` — 8 mood × 6 size，呼吸光环 + 状态点 + `next/Image` 优化
- `ThinkingStrip` / `TypingDots` / `BrewingStrip` — 等待三档（轻 / 中 / 重·"酿"）
- `StreamText` — 流式输出，stagger 浮现 + 增量动画 + caret
- `AppTopBar` — 全局顶栏：logo + breadcrumb + Octo 永驻 + 操作槽
- `EmptyState` — 空态（带 Octo + emTitle italic 朱批 + CTA）
- `SectionHeader` — 大段落标题（display/h1/h2/h3 4 级）
- `CourseHero` + `CourseHeroPulse` — 课程主题卡（live 带 AI 光带）
- `SkillChip` / `SkillChips` — Octo 同桌问题建议 chip
- `Composer` — 消息输入框（自动行高 + Enter 发送）

### 真实页面 / 组件 v7 落地

**系统态页面（4 个）**：`(main)/loading.tsx` / `error.tsx` / `not-found.tsx` / `global-error.tsx` — Octo thinking/surprised/sleeping 取代通用 spinner，米白纸感 + 极淡光晕

**门面页面**：
- **`SharedAgentLanding.tsx` (v3.0 裂变核心)**：大气场墨绿/朱批 radial gradient + Octo `original.png` 大图 + Instrument Serif italic accent + 玻璃态 sticky CTA。这是**唯一**允许整页放飞的页面
- **`SharedAgentChat.tsx`**：分享态对话面板，Octo 永驻 + 朱批左竖条 sharedBy + pine focus ring
- **登录页 `(auth)/login/page.tsx`**：背景大气场（米白纸感 + 极淡墨绿/朱批光晕）+ Octo logo 取代字母 M
- **设置页 `(auth)/settings/page.tsx`**：v6 hex 直写全部映射到 v7 paper/divider/ink/vermilion/pine

**Workshop 应用矩阵**：
- **`AppWindowShell.tsx`**：状态点对齐双签名色（pine 完成 / vermilion 错误）+ header `bg-card/92 backdrop-blur-md` + `shadow-soft`
- **`AppWindowPlaceholder.tsx`**：loading 用 OctoBuddy listening + ThinkingStrip + pine/vermilion 双色光晕；empty 用 OctoAvatar idle + Instrument Serif italic appName；error 朱批语义"提醒不是惊吓"
- **`WorkshopYellowPage.tsx`**：7 个 app hero 双签名色家族化（旧的紫/黄/蓝/粉/绿/沙独立色板 → pine 系 4 个 + vermilion 系 3 个，告诉用户"这是同一套设计系统的 7 个工具"）+ 状态点 v7

**Octo IP**：
- **`OctoBuddy.tsx`**（浮动 IP 主体）：所有 v6 紫粉色调（`rgba(233,213,255)` / `rgba(124,88,255)` / `#8B5CF6` / `#60A5FA` 等）全部替换为双签名色家族（aura / listen-ring / orbit / burst / sleep-dust / tension-aura）；投影从冷紫 `rgba(30,27,54)` 改为暖纸感 `rgba(28,27,25)` + `rgba(45,79,62,0.10)` 复合
- **移动端 `MobileTopBar.tsx`**：Octo 头像作品牌 logo（取代 GraduationCap）
- **移动端 `MobileAIFab.tsx`**：Octo 主体 + 朱批红未读 + 状态推断

**AI 视觉链路**：
- **`AIChat.tsx` / `AITutor.tsx`**：复选框 violet → pine
- **`ThinkingVisualizer.tsx` / `ThinkingGuideRenderer.tsx`**：思考可视化全部 violet 系 → pine 系（背景 / 边框 / 文字 / 阴影）
- **`WordExplainer.tsx`**：划词解释 popup violet 系 → pine 系
- **`GuidanceQuestion.tsx` / `CollectionFeedMessageBubble.tsx` / `AISearchPanel.tsx`**：违禁色统一规整
- **`all-notes/page.tsx`**：chat 笔记 tag 紫色 → pine 系（化学/英语等学科色保留）

### 全局 hex 直写清理

90 个文件批量映射 v6 hex → v7 hex：
- `#F7F7F5` → `#FAF7F2` (canvas → paper)
- `#E9E9E7` → `#E8E2D5` (divider 偏暖纸感)
- `#232322` → `#1C1B19` (ink 略深略暖)
- `#787774` → `#5C5A55` (ink-secondary)
- `#A3A39E` → `#8E8B82` (ink-muted)
- `#FBFBFA` → `#F2EDE3` (paper-warm)
- `#F0F0EE` → `#F0EBDF` (divider-light)

### 文档同步

- **`AGENTS.md` 第 2 节 Taste 宪法**：6 个仪式时刻白名单（含分享落地页 v3.0 破例放飞）+ 始终禁止饱和色撞脸（ChatGPT 紫 / Stripe 蓝 / 多邻国绿）
- **`AGENTS.md` 第 5 节 设计系统**：完整 v7 token 表 + 字体三件套 + 投影 + 工具类 + 11 组件速查 + 暗色 + v6→v7 兼容映射
- **`src/components/ui/DOMAIN.md`**：新组件分类清单 + 用法速查 + 暗色说明

### 验证

- ✅ `tsc --noEmit` 0 errors（所有 v7 改动类型完全通过）
- ✅ `make build` 0 errors（生产构建 + PM2 兼容）
- ✅ ESLint v7 文件 0 warnings（剩余警告全为 pre-existing）
- ✅ 向下兼容：v6 旧 class 全部映射到 v7 token，200+ 既有文件无需改动也呈现新视觉

### Why this matters

视觉是用户**第一秒**对产品智能的信任投票。MeetMind 之前的视觉语言（"95% 平涂、封杀渐变阴影、燕麦灰底色、PingFang 系统默认字"）解决的是 Notion 那种已付费高频用户的克制需求；但 MeetMind 现在还在让投资人 / 学生**第一眼相信"这是 AI 产品"** 的阶段——这两个阶段的视觉策略本来就不同。v7 通过双签名色（色 = 架构）+ 字体三件套 + AI 时刻可见性（surface-ai / stream / Octo 永驻）+ 暗色 first-class，把"像专门的 AI 产品 + 顶级 UI 设计师品味"翻译成了具体可落地的代码合同。

---

## 2026-05-30 — 接入阶跃星辰 StepFun 作为默认 AI

- **新 provider**：`src/lib/config/app.config.ts` + `src/lib/services/llm-service.ts` 增加 `stepfun` provider，模型 `step-3.7-flash`（OpenAI 兼容，base URL `https://api.stepfun.com/v1`，文档：https://platform.stepfun.com/docs/zh/quickstart/overview）
- **默认模型切换**：MeetMind 全链路（课堂同桌 / 复习 Tutor / 学习应用 / 速查表 / 闪卡 / 测验 / 思维导图 / Studio 等）默认改用 `step-3.7-flash`；保留 DeepSeek、DashScope 作为 fallback，用户可在 `/settings` 切换
- **Tutor agent 路由**：`src/lib/utils/tutor-agent-provider.ts` 识别 `step-*` 模型并路由到 StepFun，fallback 链改为 `step-3.7-flash → deepseek-v4-flash → qwen3.6-plus`
- **设置页**：现有模型选择器自动通过 `/api/chat` 拉取 StepFun 模型；`AI_MODEL_PREFERENCE_KEY` 偏好契约不变
- **环境变量**：`STEPFUN_API_KEY` / `STEPFUN_BASE_URL` 加入 `.env.example`；`LLM_MODEL` / `TUTOR_MODEL` 默认值改为 `step-3.7-flash`

### 同日：感知速度优化（修复"模型号称 400tok/s 但用户体感一般"）

> 真正决定用户感知速度的是 **TTFT（首包延迟）+ 流式节奏**，不是模型自身吞吐量。下面三处定位的瓶颈合计可让复习态对话 TTFT 从 3–10s 降到 0.5–2s。

- **复习态 `fullTranscript` 上限**：之前 `tutor-agent-adapter.ts` 把整节课转录全量 `join(' ')` 塞进 system prompt，60 分钟课 ≈ 25–35k input tokens；step-3.7-flash 即使吞吐 400tok/s，prefill 也得算完才能吐第一个 token。现在：
  - `tutor-agent-adapter.ts` 在 client 端先截断到 `MAX_FULL_TRANSCRIPT_CHARS = 12000`
  - `tutor-prompts.ts capFullTranscript` 在 server 端再截到 8000 字，并按 `currentTimestampSec` 取窗口（前 60% / 后 40%）；超出部分模型用 `[MM:SS]` 引用让学生跳回原段
- **StepFun 不暴露 6 个 native tool**：`shouldUseNativeTutorTools` 把 `step-*` 也排除（与 deepseek 一致）。原因：6 个 tutor tool 的 description 加起来 ~700 字，每次 prefill 都要算一遍，拖慢首包；切到 marker 链路（`<open_app:KEY/>` + 前端 `/api/apps/execute`）后 TTFT 显著下降，且复用了课堂同桌已经验证的同一条产品链路
- **`streamText` 配置优化**：`stopWhen: stepCountIs(6) → stepCountIs(3)`（marker 链路 1 步即可，native tools 留 1 次工具回调 + 1 次正文）；新增 `experimental_transform: smoothStream({ chunking: 'word' })` 让前端流式按词平滑刷出，修复"字一坨一坨"的体感

### 同日（续）：把所有用户面 AI 对话框对齐到同一基线

> 上一轮只优化了 Tutor agent (`/api/tutor/agent`) 这一条链路。这一轮把项目里**所有给用户看的 AI 对话流**都对齐到「流式 + StreamingMarkdown（含公式 / 时间戳 / 引用）+ 智能 prompt 截断 + 按词平滑」的同一基线。

- **`chatStream()` 内置 word-level smoothing**（`src/lib/services/llm-service.ts`）：
  - 之前：LLM 一次塞过来 50 字 chunk，前端 SSE 收到后立刻刷出 → 一坨一坨
  - 现在：在 `chatStream` 里把大 chunk 打散成"按词"流出，词与词之间 sleep 10ms，中文按字切分、英文按连续字母数字段切分、标点空格独立段。可通过 `options.smooth: 'off'` 关闭
  - 效果：所有走 `chatStream` 的接口（`/api/chat`、`/api/workspace/search`、legacy `/api/tutor`）一处改全部受益，与 Tutor agent 的 `smoothStream({ chunking: 'word' })` 体感一致
- **SharedAgentChat 渲染升级**（`src/app/share/[token]/SharedAgentChat.tsx`）：
  - 之前：`whitespace-pre-wrap` 平铺，markdown / KaTeX 公式 / 时间戳全部以原始字符显示，与登录态 Tutor 的精致渲染对比强烈——分享页是裂变拉新的第一面
  - 现在：用 `StreamingMarkdown`，与登录态完全一致；流式态自动开光标 + KaTeX 跳过保护
- **AIChat / WordExplainer 客户端 transcript cap**：
  - 之前：困惑点 AIChat 把整段 `contextText`、划词 WordExplainer 把整段 `fullContextText` 直接拼进 `/api/chat` 的 context 字段，长课首包延迟严重
  - 现在：客户端发请求前先 `slice(-8000)`，与 Tutor agent 一致；`selection.context`（划词局部上下文）保留全量
- **AISearchPanel 评估保留**：渲染层语义与基线不同（`onNavigateToCapture` 内部跳转 vs `CitationDetailSheet` 外部 url 跳转），强行统一会破坏交互；通过 `chatStream` smoothing 已经自动获益按词平滑流，本身已是 SSE 流式 + 自定义 markdown 渲染

---

## M11 — v3.0 SharedAgent · 场景上下文成为分享单元（进行中）

**一句话**：MeetMind 的产品同构性换轨——「场景上下文」从个人收纳升级为可被分享的、有人格的容器；Agent 是裂变载体，班级是增长单元。

战略文件：`roadmap/v3.0-virality-agent.md`（北极星，与本文件冲突时以那份为准）。

### M11.3 P0 闭环转化漏修复（K 系数主链路）

M11.2 后底座完整，但有 3 个转化漏直接砍 K 系数：(1) 录课结束态没有自动到 dispatcher 入口 (2) B 未登录点领取后跳 login 但登录回来还要再点一次 (3) claim 成功只 toast 不引导。这一轮把 viral loop 主链路完整接通。

#### 录课结束 → dispatcher 自然出现

- **`useRecordingLifecycle.ts`** 录完后默认行为升级：
  - classroom tab 录完 → 自动 `setViewMode('review') + setReviewTab('apps')`，应用矩阵首屏（含 `OctoCrystalDispatcher`）第一眼可见
  - 其他 tab 录完 → 仍 `setViewMode('record')`（保持原行为，不破坏 record hub 用户）
- toast 温柔提示「这节课结束了 · 应用矩阵已就位 · 挑一个产物，可以收着也可以递给同学」
- **效果**：用户录完课的 30 秒分享冲动期，dispatcher 不再被埋在某个 tab 里

#### B 登录回流自动 claim

- **`SharedAgentLanding.tsx`** `handleClaim` 未登录时跳 `/login?next=/share/[token]?autoClaim=1`
- **`/login/page.tsx`** 新增 `resolveRedirect()`：登录成功优先走 `?next=...` 而不是写死的 `/app`
  - 安全：只接受相对路径（`/` 开头且非 `//`），防御 open-redirect 攻击
  - 三处 redirect（已认证自动跳 / 密码登录成功 / 验证码登录成功）统一调用
- 落地页 `useEffect` 检测 `?autoClaim=1` + 已登录 + share 已加载 → 自动触发 claim，并 `history.replaceState` 清掉 URL 参数防刷新重复触发
- **效果**：B 收到链接 → 点领取 → 登录 → 自动完成 claim，从两步降到一步

#### claim 成功后引导去工作台

- claim 成功后 toast 加 description「正带你去工作台看看…」
- 1.2 秒延迟后 `router.replace('/app')`，让 B 进入自己工作台，看到刚领取的 `WorkspaceCapture(sourceType='shared-agent')` capture
- **效果**：B 不再卡在落地页"领了之后然后呢"，直接进入"我的学习现场"看完整产物

#### 闭环 5 支点（M11.3 后真的转起来）

```
A 录课结束 → 自动到应用矩阵首屏（dispatcher 第一眼）
       ↓
A 挑产物 → ShareAgentCard → 拷链接 / 系统分享
       ↓
B 打开 /share/[token] → 第一眼看到 ArtifactRender 真实产物
       ↓
B 试问同学 → mode='shared' 不返回时间戳（无原录音不死链）
       ↓
B 点领取 → 跳 login?next=...autoClaim=1 → 登录后自动 claim
       ↓
B 1.2 秒后跳 /app → shared-agent capture 已在工作台
       ↓
A 想看反馈 → /me/shares 看 viewCount/chatCount/claimCount
```

#### 验收

- ✅ `make check` 0 类型错误
- ✅ 全链路冒烟（/login?next 跳转 / /share/[token]?autoClaim=1 / /app）三个路由都 200
- ✅ 已部署 pm2

---

### M11.2 闭环收口（v3.0 viral loop 真的能转起来）

之前的 M11.1（递结晶 + ShareAgentCard 重做 + print stylesheet）做完后，闭环的 5 个支点中**只有 1、3 真的闭合**——B 打开链接看到的是"完整产物会在领取后出现"的空话；B 领取后 capture 在工作台是 untyped；A 没有管理面看不到反馈、撤销不了。这一轮把剩下的 4 个支点全部接上。

#### 闭环 5 支点（M11.2 后）

| 支点 | 入口 | 状态 |
|---|---|---|
| ① 创建 | `OctoCrystalDispatcher`（应用矩阵首屏） | ✅ M11.1 |
| ② 落地（看到产物）| `SharedAgentLanding` + 新 `ArtifactRender` | ✅ **M11.2 修复** |
| ③ 对话 | `mode='shared'` → `/api/tutor/agent` | ✅ M11.0 |
| ④ 领取（在 B 工作台可继续看） | `WorkspaceCapture(sourceType='shared-agent')` + attachmentUrl 跳回 `/share/[token]` | ✅ **M11.2 接通** |
| ⑤ 管理（A 看反馈 / 撤销） | `/me/shares` + `GET /api/share/me` + `DELETE /api/share/[token]` | ✅ **M11.2 新增** |

#### M11.2 新增

**ArtifactRender（落地页真渲染产物）**
- `src/components/share/ArtifactRender.tsx` — React 组件，按 `artifactKind` 分发：
  - `cheatsheet` → 6 区色块（与 ShareAgentCard / CheatsheetWindow 同色板）
  - `mindmap` → 根标题 + 一级分支 + 子节点（`└ ...`）
  - `quiz` → 第一题题干 + 4 选项卡（不显示答案，强裂变保留）
  - `flashcards` → 第一张正面 + "背面在领取后翻看"
  - fallback → summary 文字 / 兜底空 hint
- `SharedAgentLanding.ArtifactPreview` 替换 v0 的「summary 一行字」实现，B 第一眼看到产物本身

**snapshot 含完整 artifact payload**
- `OctoCrystalDispatcher` 不再只塞 `summary`，把 `result.render?.payload` 完整塞进 `snapshot.artifact.payload`（向后兼容旧 snapshot：`extractPayload` 自动识别 wrapped / unwrapped）
- 体积影响：cheatsheet 6 区 ≈ 3-5KB / mindmap ≈ 2KB / quiz ≈ 5-8KB，SQLite 完全 OK
- 隐私不变：artifact 是场景层产物，本就是要分享出去的

**B 领取后 capture 闭环**
- `capture-source-utils.ts`：`sourceType='shared-agent'` 强制 type='document' + `attachmentUrl=/share/[token]` + preview 文本「{昵称}留下的{产物名} · 点开继续看 / 跟同学聊」
- B 在工作台点击该 capture → 新 tab 打开 `/share/[token]` → 继续看完整产物 + 跟同学对话（同一 token，幂等）

**A 管理面**
- `GET /api/share/me`（`src/app/api/share/me/route.ts`）— 返回当前用户最近 50 条分享，含计数器和撤销状态
- `DELETE /api/share/[token]` — 撤销，仅 owner，幂等；非 owner 一律 404 防探测
- `/me/shares/page.tsx` + `MyShareList.tsx` — 列表 + 状态徽章 + 三个计数器（打开 / 对话 / 领取）+ 三个动作（看落地页 / 复制 / 撤销）+ 隐私心安声明
- `ShareAgentCard` 创建成功后底部加「管理我的分享 ›」小字链接

**Service 层**
- `listSharedAgentsByOwner(ownerId)` + `MySharedAgentSummary` 类型导出

#### 隐私边界（M11.2 强化）

- 撤销不影响已 claimed 的副本（snapshot 是 share-time 刻一份的复刻态——这是技术决策，也是产品 taste）
- DELETE 在非 owner 时返回 404 而非 403，避免泄露存在性
- B 的工作台显示 sharedAgentToken，但 metadataJson 里**不含**原作者 userId（社工已封死）

#### 验收

- ✅ `make check` 0 类型错误
- ✅ `read_lints` 全部新文件 0 警告
- ✅ 全 5 支点端到端可达：创建 → 落地（产物可见）→ 对话 → 领取 → B 工作台跳回 → A 管理面看反馈 → 撤销

---

## M11.0/M11.1 — 之前 SharedAgent 基础设施


### 新增

**战略 / 文档**
- `roadmap/v3.0-virality-agent.md` — v3.0 战略锁定（场景层 vs 个人层、应用矩阵分层、裂变形态约束、M11-M15 路线图）
- `src/app/api/share/DOMAIN.md` / `src/app/share/DOMAIN.md` / `src/components/share/DOMAIN.md` — 三处目录索引

**数据模型（Prisma）**
- `SharedAgent` —— 一个被分享出去的 Agent 快照（token / snapshotJson / artifactKind / 计数器 / status / expiresAt）
- `ShareInteraction` —— view / chat / claim / reshare 埋点
- `ShareClaim` —— `(shareId, claimerUserId)` 唯一，幂等领取记录

**业务层**
- `src/lib/services/share-agent-service.ts` —— `createSharedAgent` / `getSharedAgentByToken` / `getSharedAgentInternal` / `claimSharedAgent` / `revokeSharedAgent` / `trackShareInteraction`
- `SharedAgentSnapshotSchema`（zod）— 接受场景层产物 + transcriptDigest，**禁止个人层数据进入 snapshot**

**API 路由**
- `POST /api/share/agent` —— 创建分享（鉴权 / zod parse / token 碰撞重试）
- `GET /api/share/[token]` —— 公开读，自动写 view 埋点；404 不区分原因（防泄露存在性）
- `POST /api/share/[token]/track` —— 公开埋点（chat / reshare）
- `POST /api/share/[token]/claim` —— 领取到 claimer workspace（创建 WorkspaceCapture）

**Tutor agent**
- `/api/tutor/agent` 新增 `mode: 'shared'` + `shareToken` 字段
- `buildTutorSystemPrompt` 新增 `'shared'` 分支 + `buildSharedModeSegment(sharerNickname, courseTitle)` + `capSharedContext`
- 隐私铁律：分享态显式跳过 `learnerProfile` 注入；禁用 native tools；inline app marker 默认关
- 分享态自动写一条 `chat` interaction 到 `ShareInteraction`

**前端**
- `src/app/share/[token]/page.tsx` —— Next.js 路由壳
- `src/app/share/[token]/SharedAgentLanding.tsx` —— 落地页主体（Octo Buddy + 头部 + 转录摘要 + artifact 预览 + 对话面板 + 粘底动作栏）
- `src/app/share/[token]/SharedAgentChat.tsx` —— 分享态对话面板，`useChat` + `DefaultChatTransport(api='/api/tutor/agent')`
- `src/components/share/ShareAgentCard.tsx` —— Canvas 长图（暖白底 + 深褐字 + URL 显式可读）
- `src/components/share/useShareAgentCreator.ts` —— 一键创建分享 + 弹卡片的钩子，让任何上层 UI 一行接入

**用户面文案**
- `src/lib/ui/copy.ts` 新增 `share.landing` / `share.creator`（claimAction / reshareAction / chatPlaceholder / sharerNickname / artifactTitle ...）

**埋点**
- `logger.ts` `TrackEvent` 新增 `share.create` / `share.interaction` / `share.fail`

### 变更

- `prisma/schema.prisma` — `User` / `Workspace` 增加反向关系到 `SharedAgent` / `ShareInteraction` / `ShareClaim`
- `src/lib/prompts/tutor-prompts.ts` — `TutorMode` 联合类型扩展为 `'in-class' | 'review' | 'shared'`，`TutorSystemContext` 新增 `shared` 字段
- `AGENTS.md` — "by task type" 表新增「改 SharedAgent / 分享 Agent / 裂变」一行；架构速查补 `app/share` 和 `api/share` 索引；当前里程碑改为 M9 + M10 + M11

### 隐私边界（必读）

- snapshotJson **永远不带**原作者的 chat history、`learnerProfile`、个人层应用产物（闪卡 / 薄弱点 / 学习报告默认私有）
- `PublicSharedAgent` 类型故意不带 `ownerId` / `workspaceId`，防社工
- 分享态对话**不读**访问者本地 conversation，**不写**回流到原作者
- snapshot 是 share-time 刻一份，原作者后续修改不影响分享出去的副本

### M11 已完成 vs 待办（在后续 Sprint 落地）

✅ 已完成：
- 数据模型 + 4 个 API + tutor mode='shared' + 落地页 + 对话面板 + Canvas 长图 + 创建器 hook
- 全链路 `make check` 通过（0 类型错误）

🟡 待集成（M11 收尾）：
- 把 `useShareAgentCreator` 接入 `src/components/classroom/ClassroomRecordingView.tsx` 录课结束动线（Octo Buddy 「递结晶」按钮）
- `make eval-tutor` 增加 shared 模式 baseline
- 5 人班级灰度跑数：观察 K 系数
- M11.5：扫码二维码渲染（依赖 qrcode 包）
- M12：应用矩阵 UI 分组「带回去用 / 分享出去」 + 班级共错卡

### 验收

- ✅ `npx tsc --noEmit` 零错误
- ✅ `prisma db push` 成功，`prisma generate` 成功
- ✅ 全链路接口可达（POST /api/share/agent → GET /api/share/[token] → /share/[token] → /api/tutor/agent mode='shared' → POST /api/share/[token]/claim）

---

## M3 — Tutor 会用工具的同桌（`milestone/m3-tutor-tool-use`）

**一句话**：Tutor 从"LLM 文本框"升级为 agent loop，能主动调 Workshop 插件生成闪卡/测验/思维导图，能引用课堂转写时间戳 `[t=MM:SS]`。

### 新增
- `src/lib/prompts/tutor-prompts.ts` — prompt 版本化（`VersionedPrompt` + `PROMPT_VERSIONS`）
- `src/lib/tutor/tutor-tools.ts` — 4 个 Vercel AI SDK v6 tool（makeFlashcards / makeQuiz / makeMindmap / lookupTranscript）
- `src/app/api/tutor/agent/route.ts` — 新 agent loop endpoint，`streamText + stopWhen(stepCountIs(6)) + onStepFinish`
- `tests/eval/tutor/real-caller.ts` — harness 接入真实 LLM + tools
- `make eval-tutor-real`

### 变更
- `TUTOR_SYSTEM_V3` 明确工具使用原则 + 时间戳格式 + 失败话术
- `onStepFinish` 每步 `track({kind:'tutor.step'})` 埋点
- Sentry `experimental_telemetry.metadata.promptVersion` 注入

### 新增依赖
- `@ai-sdk/openai@3.0.62`

### 验收
- src tests: **190 passed**（+6 tutor-tools）
- 0 新类型错误

---

## M2 — ASR 飞书妙记级工艺（`milestone/m2-asr-feishu-grade`）

**一句话**：根据"飞书妙记 80% 差距在工艺"的判断，落地 P0 四修（稳定性）+ P1 飞书级工艺（contextual biasing / 三段式渲染 / 重叠缝合）。

### 新增
- `src/lib/services/asr/text-utils.ts` — `stitchSegments` / `stitchSegmentsWithOverlap` / `findOverlapLength` / `fullJitterDelay`（27 单测）
- `src/lib/services/asr/render-state-machine.ts` — `TranscriptRenderMachine`（interim / stable / final 三段式，10 单测）
- `tests/eval/asr/qwen-caller.ts` — harness 接入真实 Qwen3-ASR-Flash async API
- `make eval-asr-real`

### 变更
- **T2.1** `transcribe-fast/route.ts`: `stitchSegments` 替换内联 timeOffset 逻辑，修复失败传播 bug；响应体新增 `failedSegmentIndices / partialFailure`
- **T2.2** `DashScopeASRClient`: `userStopRequested` flag + `scheduleReconnect` + `doReconnect`，Full Jitter 退避，audioQueue 跨重连保留
- **T2.3** `waitForSingleTask`: `p-retry` + Full Jitter 替换线性 polling，总超时 5→10min
- **T2.5** `buildASRContextHint` 扩展 6 字段（courseTitle / courseSubject / participants / previousLessonTopics / lessonVocabulary / userHotwords）
- **T2.7** 长音频分片 180→600s + 2s overlap + LCS 缝合；`ASR_SEGMENT_DURATION_SEC` / `ASR_SEGMENT_OVERLAP_SEC` 环境变量可配

### 验收
- src tests: 151 → **184 passed**（+33）
- harness baseline 保持
- 0 新类型错误

---

## M1 — 可观测底座 + Eval Harness（`milestone/m1-observability-foundation`）

**一句话**：结束"改改试试"的玄学开发模式——结构化日志 + Sentry AI + SWE-Bench 风格 eval harness 一次性铺到位，后续所有改动都要在 harness 上量化。

### 新增
- **可观测性**
  - `src/lib/logger.ts` — pino backend + AsyncLocalStorage 注入 `requestId/userId` + `track()` 四路径埋点
  - `instrumentation.ts` / `sentry.{server,edge}.config.ts` / `instrumentation-client.ts`
  - `vercelAIIntegration` 自动捕获 AI SDK step/tool span
  - `pinoIntegration` 自动映射日志为 Sentry breadcrumbs
- **Eval Harness**（SWE-Bench 风格）
  - `tests/eval/{asr,tutor}/{datasets,graders,fixtures,runs}` 目录
  - `cer.ts` — 按字切 Levenshtein + 归一化（14 单测）
  - `tool-selection.ts` / `timestamp-citation.ts` / `learning-rubric.ts`（LLM-as-judge，离线自动跳过）
  - ASR seed dataset 10 条 + Tutor seed dataset 8 条
  - `make eval` / `eval-asr` / `eval-tutor` / `eval-unit`
- **战术拆分**
  - `server.js` 1341 → 1186 行（-155）
  - `server/asr/text-utils.js`（11 个纯函数 + 26 单测）

### 新增依赖
- `@sentry/nextjs@10.51` / `pino@10.3` / `p-retry@7.1` / `reconnecting-websocket@4.4` / `promptfoo@0.121`

### 验收基线
- `asr-eval`: 10 case / avg_cer=1.46% / p95=8.33% / failed=0
- `tutor-eval`: 7/8 passed / tool=100% cite=66.7% rubric=100%
- src tests: **151 passed**
- server tests: **26 passed**
- eval-unit: **29 passed**

---

## 主要指导原则（见 `docs/UPGRADE_PLAN.md`）

- **不造轮子**：调研 → 决策 → 用现成工具
- **harness 驱动**：没量化对比的改动不合并
- **灰度友好**：不改旧 endpoint，新 endpoint 并存（/api/tutor/agent）
- **明确不做**：LangGraph / MCP / Whisper / pyannote / i18n / CRDT / LangSmith / Braintrust

## 下一步（Next Sprint 建议）

- [ ] 扩 Tutor dataset 到 50 条 + `make eval-tutor-real` 作为 CI gate
- [ ] 用 AISHELL-1 / CosyVoice 合成课堂 / MUSAN 噪声扩 ASR dataset
- [ ] 纠错闭环 MVP（T2.9）：`POST /api/asr/corrections` + 周度聚合进 `userHotwords`
- [ ] 前端接入 `/api/tutor/agent`（feature flag 灰度）
- [ ] Tutor 消息流中渲染 Workshop 产物卡片（T3.4）
- [ ] 说话人分离 MVP（火山引擎双声道）
