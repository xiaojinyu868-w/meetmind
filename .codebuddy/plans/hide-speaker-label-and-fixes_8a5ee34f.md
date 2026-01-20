---
name: hide-speaker-label-and-fixes
overview: 隐藏 UI 中的说话人标签（直到有真正的 diarization），并修复类型定义不一致、VAD 暂停状态重置、WebSocket finished 事件缺失等问题。
todos:
  - id: hide-speaker-timeline
    content: 隐藏 MobileTimeline 中的说话人标签，注释掉 speaker 字段传递
    status: completed
  - id: remove-speaker-inference
    content: 移除 tutor/route.ts 中的 identifyStudent 调用，使用通用文本格式
    status: completed
  - id: fix-notesource-type
    content: 在 longcut/types.ts 的 NoteSource 类型中添加 'anchor' 选项
    status: completed
  - id: fix-vad-resume
    content: 在 Recorder.tsx 的 resumeRecording 函数中重置 VAD 状态
    status: completed
  - id: add-finished-event
    content: 在 server.js 的 DashScope close 事件处理中补充 finished 事件发送
    status: completed
---

## 产品概述

针对 MeetMind 录音转录应用进行多项技术修复，主要包括隐藏 UI 中的说话人标签（直到真正实现 diarization 功能）以及修复类型定义不一致、VAD 暂停状态重置、WebSocket finished 事件缺失等问题。

## 核心修复点

1. **隐藏说话人标签** - 在 MobileTimeline 组件中暂时不传递 speaker 字段，在 tutor/route.ts 中移除自动推断的说话人标识
2. **类型定义统一** - 在 NoteSource 类型中添加缺失的 'anchor' 类型
3. **VAD 暂停状态重置** - 在 resumeRecording 函数中重置 VAD 状态，避免暂停恢复后 VAD 检测异常
4. **WebSocket finished 事件** - 在 server.js 的 DashScope close 事件处理中补充 finished 事件发送

## 技术栈

- 前端框架: Next.js + TypeScript + React
- 后端: Node.js (server.js WebSocket 代理)
- 实时通信: WebSocket
- 语音识别: DashScope ASR

## 修复详情

### 1. 隐藏说话人标签

**问题描述**: 当前 UI 显示的说话人标签是基于文本内容推断的，不准确，需要隐藏直到实现真正的 diarization 功能。

**修改位置**:

- `src/components/mobile/MobileTimeline.tsx:230` - 不传递 speaker 字段
- `src/app/api/tutor/route.ts:138-143` - 移除 identifyStudent 调用，使用通用标识

**实现方案**:

```typescript
// MobileTimeline.tsx - segmentsToTimelineEntries 函数
return {
  id: segment.id,
  content: segment.text,
  startMs: segment.startMs,
  endMs: segment.endMs,
  hasConfusion: !!confusion,
  confusionResolved: confusion?.resolved,
  // speaker: segment.speakerId,  // 暂时隐藏，直到有真正的 diarization
};

// tutor/route.ts - 使用通用标识
const contextText = mergedSegments.map(s => {
  const timeStr = formatTimestamp(s.startMs);
  // 暂时使用通用标识，直到有真正的 diarization
  return `[${timeStr}] ${s.text}`;
}).join('\n');
```

### 2. NoteSource 类型统一

**问题描述**: NoteSource 类型缺少 'anchor' 选项，导致类型检查错误。

**修改位置**: `src/lib/longcut/types.ts:84`

**实现方案**:

```typescript
// 添加 'anchor' 到 NoteSource 类型
export type NoteSource = 'chat' | 'takeaways' | 'transcript' | 'custom' | 'anchor';
```

### 3. VAD 暂停状态重置

**问题描述**: 在 resumeRecording 函数中没有重置 VAD 状态，导致暂停恢复后 VAD 检测可能异常。

**修改位置**: `src/components/Recorder.tsx:323-333`

**实现方案**:

```typescript
const resumeRecording = () => {
  if (mediaRecorderRef.current?.state === 'paused') {
    mediaRecorderRef.current.resume();
    const pausedTime = elapsedMs;
    startTimeRef.current = Date.now() - pausedTime;
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    
    // 重置 VAD 状态，避免暂停期间的静音被误判
    vadStateRef.current = {
      isSpeaking: false,
      speechStartMs: 0,
      silenceStartMs: 0,
    };
    
    setStatus('recording');
  }
};
```

### 4. WebSocket finished 事件补充

**问题描述**: 在 DashScope WebSocket close 事件处理中，没有发送 finished 事件通知前端。

**修改位置**: `server.js:362-368`

**实现方案**:

```javascript
dashscopeWs.on('close', (code, reason) => {
  console.log('[ASR-Proxy] DashScope closed:', code, reason.toString());
  isSessionReady = false;
  if (clientWs.readyState === WebSocket.OPEN) {
    // 先发送 finished 事件，通知前端 ASR 会话已完成
    clientWs.send(JSON.stringify({ event: 'finished', code }));
    // 再发送 closed 事件
    clientWs.send(JSON.stringify({ event: 'closed', code }));
  }
});
```

## 修改文件清单

```
project-root/
├── src/
│   ├── components/
│   │   └── mobile/
│   │       └── MobileTimeline.tsx    # 修改: 隐藏 speaker 字段
│   │   └── Recorder.tsx              # 修改: VAD 暂停状态重置
│   ├── app/
│   │   └── api/
│   │       └── tutor/
│   │           └── route.ts          # 修改: 移除说话人推断
│   └── lib/
│       └── longcut/
│           └── types.ts              # 修改: 添加 'anchor' 类型
└── server.js                         # 修改: 补充 finished 事件
```

## 技术考量

### 向后兼容性

- 说话人标签隐藏不影响数据结构，仅影响 UI 显示
- NoteSource 类型扩展是添加新值，向后兼容
- VAD 状态重置是内部逻辑修复，不影响外部接口
- finished 事件补充是新增事件，前端需处理但不会破坏现有逻辑

### 测试要点

- 验证 MobileTimeline 不再显示说话人标签
- 验证 tutor API 返回的上下文不包含说话人推断
- 验证暂停恢复录音后 VAD 检测正常工作
- 验证 WebSocket 断开时前端收到 finished 事件