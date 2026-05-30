# `src/components/share/` — Domain

> v3.0 SharedAgent 的客户端组件（创建分享 UI、Canvas 长图）。
>
> 设计文档：`roadmap/v3.0-virality-agent.md`
> 落地页：`src/app/share/[token]/`
> API：`src/app/api/share/`

## 目的

把"我想把这节课分享给班里同学"这个动作变成 1-2 步可见的 UI。本目录持有：

| 文件 | 职责 |
|---|---|
| `ShareAgentCard.tsx` | 分享创建成功后弹出的 Canvas 长图（可保存 / 调系统分享 / 复制链接） |
| `useShareAgentCreator.tsx` | 上层组件用的钩子：`openCreator(snapshot)` 创建分享 + 弹出 ShareAgentCard |

## 设计原则（沿用 EchoShareCard）

- **打开即生成**：用户点完一个按钮就能看到完整图，不需要再点"生成图片"
- **长图、暖白底、深褐字**：参考 EchoShareCard 的「实体书封面」排版
- **不画二维码**：v0 用 URL 文本承载（避免新增 qrcode 依赖）；扫码版本是 M11.5 任务
- **微信兼容**：navigator.share 兜底走复制 URL，长按图片保存到相册始终可用

## 集成方式

集成入课堂结束动线（`src/components/classroom/ClassroomRecordingView.tsx` 或 `page.tsx`）的最小改动：

```tsx
import { useShareAgentCreator } from '@/components/share/useShareAgentCreator';

const { openCreator, modal } = useShareAgentCreator();

// 录课结束时给 Octo Buddy 旁边的"递结晶"按钮：
<button onClick={() => openCreator({
  title: courseName,
  subject,
  artifactKind: 'cheatsheet',     // 用户挑了哪个产物
  artifact: cheatsheetResult,     // AppExecutionResult 或简短摘要
  transcriptDigest: {
    totalSec: lesson.durationSec,
    segments: pickKeySegments(transcript, 30),
    keyTerms: lesson.keyTerms,
  },
  sharerNickname: user?.nickname ?? '一位同学',
  conversationContext: lesson.summary, // 可选：给"分享态同学"的额外背景
})}>{COPY.share.creator.submit}</button>

// 渲染 modal（占位，实际显示由 hook 内部状态控制）
{modal}
```

## 隐私边界

- **永远不把个人层数据塞进 snapshot**：上层组件传入的 snapshot 必须只包含场景层产物（cheatsheet / mindmap / quiz / flashcards / infographic / audio-overview / notes / chat-only）
- **闪卡 / 学习报告默认不可分享**：上层 UI 应该把这些应用的"分享"按钮藏起来；如果用户主动选择把它们带上，UI 必须显式问一次"确定要把答题数据带过去吗"
- **昵称去标识化**：sharerNickname 默认用用户昵称，不带真实姓名 / 学号

## 与 EchoShareCard 的关系

`EchoShareCard.tsx`（`src/components/EchoShareCard.tsx`）和这里的 `ShareAgentCard.tsx` 是**两套独立的卡片**：

| | EchoShareCard | ShareAgentCard |
|---|---|---|
| 内容 | Echo（同桌的话 + 金句 + 一句话带走） | 分享 Agent（课名 + 产物 + URL） |
| 入口 | 收集流里的 echo card | 录课结束 Octo Buddy 「递结晶」 |
| 引导对方做什么 | 看完即可 | 打开 URL 跟同学聊 |

两者共享设计语言（暖白底 + 深褐字 + 一根分隔线），但服务于不同的产品目的。**未来不要合并**——它们的视觉收敛是 taste 层面的一致，不是数据层面的复用。

## 不在这里做

- **创建分享的业务逻辑**：在 `src/lib/services/share-agent-service.ts`
- **落地页 UI**：在 `src/app/share/[token]/`
- **API 路由**：在 `src/app/api/share/`
