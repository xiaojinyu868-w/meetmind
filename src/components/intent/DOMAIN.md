# components/intent — 「聊聊你想要的」选择题式目标共建入口

> M15 重做：从"开放式闲聊"改为**选择题驱动的短仪式**（用户心理：不想久聊、能选就不说）。
> 替代旧的硬编码两步表单 `LearnerOnboarding`（保留作 settings 备用 fallback）。

## 这一域做的事

让用户带着一个愿望、困扰或没说完的念头来，用**最少的打字**把它捋成一条确认过的 `GoalEntry` 写到 `learnerProfile.goals`。后续信息流（首页、复习、应用矩阵）围绕这些 target 工作。

**核心动作（M15 交互模型，对齐 Duolingo / Noom 式成熟 onboarding）**：
1. **固定开场选择题**（首次会面前端写死，零 LLM 往返）：Q1 稳定身份 → Q2 分支阶段（学生/工作才有）→ Q3 目标时间尺度；三题答完合成一条第一人称消息发给 AI。**稳定属性（身份/阶段）进 bio，易变的意图按时间尺度进 goals**——这是记忆框架的分层判断
2. **AI 动态选择题**：goal 模式 prompt 要求每轮回复必带 `---选项---` 块（2-4 个 ≤12 字选项）→ 前端渲染果冻按钮，输入框始终保留
3. **收敛义务**：3 轮内必须产出 `---我想要的---` 确认卡 → 用户逐条确认/否定 → 保存
4. **horizon 时间尺度**：每张目标卡必须标 `[短期]`（有明确节点、会过期）/ `[中期]`（学期/季度）/ `[长期]`（方向能力），写在 marker 首行开头，解析进 `GoalEntry.horizon`，卡片与设置页显示角标
5. **完成态**：保存成功弹出定格时刻（记下了 / 去主页 / 再记一件），给对话一个句号
6. **步骤条**：顶部 `说说 → 捋一捋 → 记下了` 随对话状态推进，用户随时知道在哪一步

首次会面不是 onboarding 访谈：不从身份、年级、专业、学校开始采集资料；先接住当前需要，能行动就先行动。身份、阶段和习惯只在自然出现且会影响未来帮助时静默沉淀；一时情绪、模型建议和猜测不能进入长期上下文。

## 文件清单

| 文件 | 职责 |
|---|---|
| `IntentDialog.tsx` | 全屏对话主体（v7 米白纸感）。`useChat` 打 `/api/tutor/agent` mode='goal'；编排开场问题流、步骤条、完成态、错误条与卡死看门狗（45s 无响应主动掐断 + 一键重试） |
| `IntentOpeningFlow.tsx` | Elys 式开场问题流：问句是 AI 气泡、回答是用户气泡，三步固定题像聊天一样推进；回访用户一句欢迎 + 快捷入口 |
| `IntentMessageItem.tsx` | 单条消息渲染：可见文本 + bio/goal 确认卡 + 选项果冻行；流式剃除半截 marker；模型漏给选项时给兜底快答 |
| `IntentOptionChips.tsx` | 果冻选项软行（整行软卡 + stagger 弹入 + 按压回弹） |
| `IntentStepBar.tsx` | 顶部步骤条（说说 → 捋一捋 → 记下了），纯展示 |
| `IntentCompletionOverlay.tsx` | 保存成功完成态浮层 |
| `IntentErrorBanner.tsx` | 请求失败/卡死时的错误条（重试 / 忽略） |
| `IntentSummaryCard.tsx` | "我想要的"逐条确认卡（带 horizon 时间尺度角标），编辑后保存为 GoalEntry |
| `IntentBioCard.tsx` | "我了解到的你"逐条确认卡 |
| `IntentDialogContainer.tsx` | 对外封装：对话 + saveLearnerProfile。父组件只 open/onClose |

`---选项---` 解析器在 `src/components/chat/markers/extractIntentOptions.ts`（含流式半截 marker 剃除 `stripPartialIntentBlocks`）。

通话态视图 `src/components/realtime/IntentVoiceCallScreen.tsx` 已随实时语音通话下线标记 deprecated（保留一个周期后物理删除）；意图录入走 IntentDialog，文字为主，输入条带语音听写（ChatComposer `mic` 能力 → `VoiceMicButton` → `/api/asr/oneshot`，识别文字回填输入框，不直接发送）。

## 入口

| 入口 | 触发 | sessionHint |
|---|---|---|
| 设置页常驻 | `(auth)/settings/page.tsx` 的「关于你」/「聊聊你想要的」section（4 个触发点：「和教练再聊聊(更新画像)」/「和教练聊一聊」/「和教练再聊一会」） | `undefined` |

> M14.6 起移除首登强制整页替换：新注册用户直接进 `/app` 主页面（工具心智），引导教练只在设置页出现。自然引导到设置页的入口待后续设计。

## 数据流

```
用户点选选项 / 打字 / (可选)文件解析后的纯文本
  → IntentDialog 透传给 /api/tutor/agent (mode='goal')
  → 服务端 buildTutorSystemPrompt('goal', { goal: { existingGoals, sessionHint }, supportMaterials })
  → AI 流式回复（末尾必带 ---选项--- 块）
  → extractIntentOptions 渲染果冻按钮；extractIntentSummary 拦截 ---我想要的--- 块
  → IntentSummaryCard 逐条确认 → 用户点"记下确认的"
  → IntentDialogContainer.handleSaveGoal
  → useAuth.saveLearnerProfile(merged learnerProfile)
  → PATCH /api/auth/learner-profile
  → 服务端写 learnerProfileJson + onboardingCompletedAt
  → IntentCompletionOverlay 完成态（去主页 / 再记一件）
```

Marker 选择遵循内容语义：身份、阶段、状态沉淀为 `---我了解到的你---`；愿望、方向、想完成的事沉淀为 `---我想要的---`。当用户明确确认并要求保存一个具体愿望时，目标 marker 优先，不再继续追问，也不改写成画像 marker；目标卡内使用用户第一人称，让内容像用户自己的话。

当用户尚未填写结构化学习档案时，保存 bio/goals 会使用 `LearnerProfile.stage='unknown'`。自然语言画像可以先成立，但不能为了满足旧类型而伪造“大学生 / 大一”等字段；用户之后在设置页填写学习档案时再写入真实阶段。

## 文件解析（多模态输入）

`IntentDialog` 内部使用 `src/lib/services/file-parse-service.ts` 的 `parseFileForChat`：
- 文档（pdf/docx/ppt/纯文本） → `/api/sources/ingest`
- 图片                          → `/api/sources/ingest-image`
- 音频/视频                     → `/api/transcribe`

解析后的纯文本作为 `supportMaterials` 注入给 `/api/tutor/agent`，**不发到用户消息里**——AI 看到内容，用户只看到"我上传了 xxx"。

## 后端契约

`/api/tutor/agent` 的 `mode='goal'` 分支（详见 `src/lib/prompts/tutor-prompts.ts` 的 GOAL_HEADER / GOAL_PATH_A/B / GOAL_COMMON）：
- 跳过 `transcript` / `recentFocus` / `fullTranscript`（无课堂上下文）
- 注入 `context.goal.existingGoals` + `context.goal.sessionHint`
- **每轮必须输出** `---选项---` 快答块（2-4 个 ≤12 字选项）
- **收敛义务**：3 轮内产出 `---我想要的---` 卡；保存后一句话收尾
- **禁用** native tools（无 transcript 可查）
- **禁用** inline app marker（goal 态不生产学习产物）
- **禁用** 时间戳 `[MM:SS]`（无原录音可跳）

## 通话态（2026-08 已下线）

实时语音通话整体下线：`/api/tutor-call` 代理已拆除，`IntentDialogContainer` 的
`mode: 'text' | 'call'` 切换与「打电话聊」入口已移除，`IntentVoiceCallScreen` /
`useOmniRealtimeCall` 标记 deprecated，保留一个周期后物理删除。

## 设计宪法

视觉走 v7：米白纸感整页 + pine 主签名色 + vermilion 响应点缀（M15 起弃用旧深色沉浸风）。
果冻动效（spring 回弹 `cubic-bezier(0.34, 1.56, 0.64, 1)`）只用于选项按钮与完成态定格。

## 不做的事

- ✗ 不写 IndexedDB / conversationService（这一态对话不持久化历史）
- ✗ 不接 SharedAgent（这是个人态，不是分享态）
- ✗ 不做 viral 机制（没有 "分享你的目标" 按钮）
- ✗ 不替用户做决定 / 不催促 / 不弹任务清单
