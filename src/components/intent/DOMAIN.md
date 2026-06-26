# components/intent — 「聊聊你想要的」对话式目标共建入口

> M11：v3.0 信息流哲学落地的第一个产品入口。  
> 替代旧的硬编码两步表单 `LearnerOnboarding`（保留作 settings 备用 fallback）。

## 这一域做的事

让用户和 AI 教练对话式梳理"我想..."的事，把模糊的念头捋成一条 `GoalEntry` 写到 `learnerProfile.goals`。后续所有信息流（首页、复习、应用矩阵）会围绕这些 target 工作。

**核心动作**：用户表达 → AI 引导 → AI 用 `---我想要的---...---结束---` 自然提炼 → 用户确认/修改/保存。

## 文件清单

| 文件 | 职责 |
|---|---|
| `IntentDialog.tsx` | 全屏文字对话主体。`useChat` 打 `/api/tutor/agent` mode='goal'。内置文字+语音+文件三种输入。 |
| `IntentSummaryCard.tsx` | AI 提炼出的"我听到的是..."卡片，用户可编辑标题/摘要后点"就是这样"保存。 |
| `IntentDialogContainer.tsx` | 对外封装：打包文字态 + 通话态 + saveLearnerProfile。父组件只 open/onClose。 |

通话态视图在 `src/components/realtime/IntentVoiceCallScreen.tsx`，呼吸光晕组件 `RealtimeOrb` 在 `src/components/realtime/`，复习态 `TutorRealtimeCallScreen` 共用一套视觉。

## 入口

| 入口 | 触发 | sessionHint |
|---|---|---|
| 设置页常驻 | `(auth)/settings/page.tsx` 的「关于你」/「聊聊你想要的」section（4 个触发点：「和教练再聊聊(更新画像)」/「和教练聊一聊」/「和教练再聊一会」） | `undefined` |

> M14.6 起移除首登强制整页替换：新注册用户直接进 `/app` 主页面（工具心智），引导教练只在设置页出现。自然引导到设置页的入口待后续设计。

## 数据流

```
用户消息 + (可选)文件解析后的纯文本
  → IntentDialog 透传给 /api/tutor/agent (mode='goal')
  → 服务端 buildTutorSystemPrompt('goal', { goal: { existingGoals, sessionHint }, supportMaterials })
  → AI 流式回复
  → extractIntentSummary 拦截 ---我想要的---...---结束--- 块
  → IntentSummaryCard 渲染
  → 用户点"就是这样"
  → IntentDialogContainer.handleSaveGoal
  → useAuth.saveLearnerProfile(merged learnerProfile)
  → PATCH /api/auth/learner-profile
  → 服务端写 learnerProfileJson + onboardingCompletedAt
```

## 文件解析（多模态输入）

`IntentDialog` 内部使用 `src/lib/services/file-parse-service.ts` 的 `parseFileForChat`：
- 文档（pdf/docx/ppt/纯文本） → `/api/sources/ingest`
- 图片                          → `/api/sources/ingest-image`
- 音频/视频                     → `/api/transcribe`

解析后的纯文本作为 `supportMaterials` 注入给 `/api/tutor/agent`，**不发到用户消息里**——AI 看到内容，用户只看到"我上传了 xxx"。

## 后端契约

`/api/tutor/agent` 新增 `mode='goal'` 分支（详见 `src/lib/prompts/tutor-prompts.ts` 的 `MODE_GOAL_SEGMENT`）：
- 跳过 `transcript` / `recentFocus` / `fullTranscript`（无课堂上下文）
- 注入 `context.goal.existingGoals` + `context.goal.sessionHint`
- **禁用** native tools（无 transcript 可查）
- **禁用** inline app marker（goal 态不生产学习产物）
- **禁用** 时间戳 `[MM:SS]`（无原录音可跳）

## 通话态

`IntentDialogContainer` 内部维护 `mode: 'text' | 'call'` state。点 IntentDialog header 的"打电话聊"切到 `IntentVoiceCallScreen`，复用 `useOmniRealtimeCall` 走 `/api/tutor-call`（DashScope omni realtime）。

通话 instructions 由 `buildCallInstructions(profile)` 拼出来，**不用** `buildTutorSystemPrompt`——那是 `/api/tutor/agent` 的格式，realtime API 走的是 DashScope 原生协议。

## 设计宪法

视觉走 v7：米白纸感 + pine 主签名色 + vermilion 响应点缀。  
通话呼吸光晕是 6 个仪式时刻白名单之一，允许更情绪化（多层 radial gradient + 错位旋转）。

## 不做的事

- ✗ 不写 IndexedDB / conversationService（这一态对话不持久化历史）
- ✗ 不接 SharedAgent（这是个人态，不是分享态）
- ✗ 不做 viral 机制（没有 "分享你的目标" 按钮）
- ✗ 不替用户做决定 / 不催促 / 不弹任务清单
