# Consult Components

> 学生端 To B agent 对话的生成式 UI block 渲染层。

## 依赖规则

```
consult components -> hooks + components/academic + local consult components
```

- 可以调用客户端 hooks，例如 `useOmniRealtimeCall`
- 可以渲染 `academic/primitives` 和本目录组件
- 不直接 import `lib/services/` 或 `app/api/`
- API 交互仅限 UI block 自身的用户动作，例如上传文件、提交联系方式、接听语音

## 文件索引

| 文件 | 职责 |
|------|------|
| `blocks.tsx` | agent tool UI block 分发器：askOptions / showOutreachWorkspace / showDraft / ctaWechat / fileUpload / startVoiceCall |
| `advisor-discovery.tsx` | 导师/方向探索工作台：候选、可信度、证据缺口、下一步收窄动作 |
| `consultant-move.tsx` | 顾问动作卡：展示 agent 对用户真实意图、画像信号和下一步动作的判断 |
| `service-plan.tsx` | 全周期服务方案板：服务前获客/准备、服务中面试评估、服务后下一步行动 |
| `cv-diagnosis-artifact.tsx` | CV 诊断活文档：当前版本聚合展示，旧版本折叠为更新记录 |
| `assistant-turn-frame.tsx` | 旧 assistant 回合折叠条：把历史 UI 归档为一行决策记录，降低当前任务负荷 |
| `assistant-turn-summary.ts` | 旧回合摘要纯函数：优先取最新有意义的 UI tool，再回退到文字首句 |
| `outreach-workspace.tsx` | 导师外联生成式工作台：导师档案、来源、fit map、外联计划、下一步动作 |
| `inline-voice-call.tsx` | 对话内 realtime 语音卡：接听、连接、通话状态、静音、结束 |
| `inline-voice-call-parts.tsx` | 语音卡纯展示零件：音量条、receipt、历史通话折叠行 |
| `pixel-agent-status.tsx` | 像素 Agent 在场感组件：空状态、等待态、tool timeline 的状态化视觉反馈 |
| `text-choice-fallback.tsx` | 文本 A/B/C 选择题兜底渲染：模型漏调 askOptions 时仍给可点选项 |
| `text-choice-parser.ts` | A/B/C 选择题文本解析纯函数 |
| `workbench-compass.tsx` | 当前咨询工作台条：聚合最新 artifact、服务动作原子、来源/画像信号和继续动作 |
| `workbench-compass-model.ts` | 工作台状态模型纯函数：从 UIMessage 推导当前焦点、原子覆盖、下一步和 volatile 提醒 |
| `activity-timeline.tsx` | 能力型 tool 的进度时间线 |
| `consult-markdown.tsx` | consult 对话中的 markdown 渲染 |
| `skeletons.tsx` | 对话等待态和 block 骨架 |
