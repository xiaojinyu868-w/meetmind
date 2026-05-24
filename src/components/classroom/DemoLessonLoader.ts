/**
 * DemoLessonLoader — 一键把 demo 课堂灌进 capture-editor-store。
 *
 * 用户点"试听一节 demo 课"后走到这里。不打任何 LLM、不做任何网络请求——
 * 纯 fixtures 塞进 zustand store，然后跳进课堂录课视图（但不真正录音）。
 * 用户一眼看到转录已经在那里，可以立刻点任何 chip 体验"AI 陪我听"的完整闭环。
 *
 * 为什么做成纯函数而非 hook：
 *   - 可在任何组件里直接调
 *   - 不涉及副作用生命周期，便于测试
 *   - actions 由调用方从 `useCaptureEditorActions()` 拿到后传入
 */

import { DEMO_SEGMENTS, DEMO_AUDIO_URL, DEMO_ANCHORS, createDemoTimeline } from '@/fixtures/demo-data';
import type { CaptureEditorStore } from '@/stores/capture-editor-store';

export interface LoadDemoLessonOptions {
  /** 从 useCaptureEditorActions() 取出 */
  actions: CaptureEditorStore['actions'];
  /** 可选：加载完成后调用，一般用来把 viewMode 切到课堂详情 */
  onLoaded?: () => void;
}

/**
 * 把 demo 课堂的 segments + audioUrl 写进 store。
 * 音频走 /demo-audio.mp3（public 目录），不需要 blob——用 audioUrl 就够了。
 */
export function loadDemoLesson({ actions, onLoaded }: LoadDemoLessonOptions): void {
  actions.resetCaptureEditorState();
  actions.setSegments(DEMO_SEGMENTS);
  actions.setAnchors(DEMO_ANCHORS);
  actions.setTimeline(createDemoTimeline());
  actions.setAudioUrl(DEMO_AUDIO_URL);
  // 不设置 audioBlob——demo 不生成可下载的本地音频
  onLoaded?.();
}

/**
 * 是否已经在 demo 态（segments 完全等于 DEMO_SEGMENTS）。
 * 供 UI 在 hero 里提示"你正在体验 demo 课堂"。
 */
export function isDemoLessonLoaded(segments: { id: string }[] | null | undefined): boolean {
  if (!segments || segments.length !== DEMO_SEGMENTS.length) return false;
  // 比对第一段和最后一段 id 即可——demo 的 id 是固定的 s1..s16
  return segments[0]?.id === DEMO_SEGMENTS[0].id && segments[segments.length - 1]?.id === DEMO_SEGMENTS[DEMO_SEGMENTS.length - 1].id;
}

export function selectDemoLiveSegments(elapsedSeconds: number) {
  const elapsedMs = Math.max(0, elapsedSeconds * 1000);
  return DEMO_SEGMENTS.filter((segment) => segment.endMs <= elapsedMs);
}
