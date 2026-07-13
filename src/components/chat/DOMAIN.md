# Chat 底座 — DOMAIN.md

> M11 重构（M13 起 5 面板 100% 收口）：把全应用 5 个对话面板的"输入条 / 消息流 / 流式协议 / 文件上传"统一到一个底座。

## 设计契约（"薄底座 + 厚适配"）

底座**不知道**：mode、prompt、endpoint URL、业务后处理、tool card、inline app。
底座**只提供**：消息流容器 + 输入条 + 消息壳 + markdown 渲染 + 文件上传 + 自动跟随滚动。
所有业务（review 持久化 / inline app / shared 鉴权 / intent summary 卡）由 adapter 自己组装。

## 文件清单

```
chat/
├── DOMAIN.md                       # 本文件
├── index.ts                        # barrel
├── ChatBubble.tsx                  # 单条消息壳（avatar / actions / footer slot）
├── ChatMessageList.tsx             # 消息流容器（自动跟随 + jump-to-latest）
├── ChatComposer.tsx                # 输入条（mic / file / call / send / stop）
├── ChatRenderer.tsx                # 流式 markdown 渲染（marker pipeline）
├── ChatThinkingStrip.tsx           # 等待态气泡
├── ChatCodeBlock.tsx               # Shiki 代码高亮（M12）
├── ChatImageLightbox.tsx           # 图片灯箱（M12）
├── ChatMermaidBlock.tsx            # Mermaid 图渲染（M14.5）
├── hooks/
│   ├── useChatComposer.ts          # 草稿 + IME + 自适应高度 + 快捷键
│   ├── useChatFileUpload.ts        # parseFileForChat + 拖拽 + 粘贴 + 多文件并发
│   └── useAutoFollowScroll.ts      # 用户上滑停止跟随 + 回到最新按钮
└── markers/
    ├── collectMessageText.ts       # AI SDK v6 UIMessage → 文本
    ├── copyMessageSmart.ts         # 智能复制（markdown / 纯文本双格式）
    ├── extractIntentSummary.ts     # ---我想要的---...---结束--- 解析
    └── extractIntentBio.ts         # M11.4 bio（headline + detail）解析
```

## 标准 adapter 形态

```tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  ChatBubble, ChatComposer, ChatMessageList, ChatRenderer, ChatThinkingStripBubble,
  useChatComposer, useChatFileUpload, collectMessageText,
} from '@/components/chat';

export function MyChatAdapter({ sessionId, authToken, ... }) {
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/tutor/agent',
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    body: () => ({ sessionId, mode: 'review', context: {...}, options: {...} }),
  }), [...]);

  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';

  const composer = useChatComposer({
    draftKey: sessionId,
    onSubmit: (text) => sendMessage({ text }),
    disabled: busy,
  });

  const composerRef = useRef<HTMLFormElement>(null);
  const fileUpload = useChatFileUpload({
    authToken,
    targetRef: composerRef,
  });

  return (
    <div className="flex h-full flex-col">
      <ChatMessageList watchKey={messages.length} showEmpty={messages.length === 0} emptyState={...}>
        {messages.map((m, idx) => {
          const text = collectMessageText(m);
          const isLast = idx === messages.length - 1;
          const streaming = busy && isLast && m.role === 'assistant';
          return (
            <ChatBubble key={m.id} role={m.role}>
              <ChatRenderer content={text} isStreaming={streaming} markers={['intent-summary']} />
            </ChatBubble>
          );
        })}
        {busy && messages[messages.length - 1]?.role === 'user' ? <ChatThinkingStripBubble /> : null}
      </ChatMessageList>

      <ChatComposer
        containerRef={composerRef}
        textareaProps={composer.textareaProps}
        onSubmit={composer.submit}
        busy={busy}
        onStop={stop}
        attachedFiles={fileUpload.attachedFiles}
        onAddFiles={fileUpload.addFiles}
        onRemoveFile={fileUpload.removeFile}
        uploadBusy={fileUpload.busy}
        uploadError={fileUpload.error}
        isDragging={fileUpload.isDragging}
        capabilities={{ mic: true, file: true, call: true }}
        onCallStart={onSwitchToCall}
        onVoiceTranscript={(t) => composer.setValue(composer.value + (composer.value ? ' ' : '') + t)}
      />
    </div>
  );
}
```

## 已知 adapter

| Adapter | 路径 | mode | variant | 备注 |
|---|---|---|---|---|
| `IntentDialog` | `components/intent/IntentDialog.tsx` | `goal` | `glass` | 沉浸式 octo blur 背景；marker=`intent-summary`；M11.4 bio 双 marker |
| `TutorAgentPanel` | `components/tutor/TutorAgentPanel.tsx` | `review` / `in-class`（预留） | `paper` | 持久化到 `conversationService`；仅 `review` 提供时间戳跳转；M11 迁 |
| `ClassroomCompanionPanel` | `components/classroom/ClassroomCompanionPanel.tsx` | `in-class` | `paper` | M14/M14.5 迁；Octo Buddy chip + inline app；不渲染时间戳回跳 |
| `SharedAgentChat` | `app/share/[token]/SharedAgentChat.tsx` | `shared` | `paper` | M11.5 迁；shareToken 认证 + 隐私铁律 |
| `WordExplainer` | `components/WordExplainer.tsx` | `word` | `minimal` | M13 迁；选词解释浮窗 |

## 退役清单（M12 已完成）

- `useSimpleSSEStream` → 由 useChat（AI SDK v6）取代 ✓
- `/api/chat` route → 合并到 `/api/tutor/agent` ✓
- `AITutor.tsx`（2400 行 legacy） → 删 ✓（M12）
- `AIChat.tsx`（独立栈） → 删 ✓（M12）

## 设计原则（铁律）

1. **底座不引入业务逻辑** — 任何 `if (mode === 'review')` 都是错的，应该移到 adapter
2. **底座 props 极简** — 不要 30 个 boolean flag，用 slot / capability 对象
3. **底座 variant 只 2-3 个** — paper / glass / minimal，不再扩
4. **marker pipeline 通过类型扩展** — 加新 marker 走 `ChatMarkerKind` 类型 + `extractXxx` helper
5. **TTFT 优先** — useChat 自带乐观更新，不要自己包 setState 队列拖慢首字符

## V2 路线图（不阻塞 V1 deploy）

- 虚拟滚动（react-virtuoso）—— 长对话 >50 条
- ~~Mermaid 渲染~~ ✓ 已完成（M14.5，`ChatMermaidBlock`）
- ~~Shiki 代码高亮~~ ✓ 已完成（M12，`ChatCodeBlock`）
- ~~图片 lightbox~~ ✓ 已完成（M12，`ChatImageLightbox`）
- 朗读 / TTS
- 链接 hover preview
- 多模态 image inline（file upload kind=image 直接走 messages.content[].type=image）
- 历史懒加载（滚动顶部 fetch 更早 50 条）
- 消息编辑（user 消息 hover 编辑）
