export type MobileScreen = 'home' | 'recording' | 'processing' | 'review' | 'flashcards' | 'quiz' | 'cheatsheet' | 'mindmap' | 'audio-overview' | 'infographic' | 'teach-back' | 'apps' | 'classmate' | 'echo' | 'empty';

export type ReviewContentType = 'audio' | 'video' | 'article';

export interface ReviewContext {
  sessionId: string;
  contentType: ReviewContentType;
  title: string;
  segments?: Array<{ id: string; text: string; startMs: number; endMs: number; isFinal?: boolean }>;
  images?: Array<{ imageId: string; capturedAtMs: number | null; title?: string }>;
  /** 从应用证据返回时，课后页需要切到原文并定位的课堂时间。 */
  focusTimestampMs?: number;
}

export interface ScreenState {
  screen: MobileScreen;
  reviewContext?: ReviewContext;
}

export function resolveRetainedReviewContext(stack: ScreenState[]): ReviewContext | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].reviewContext) return stack[index].reviewContext;
  }
  return undefined;
}

export function popMobileStackTo(
  stack: ScreenState[],
  screen: MobileScreen,
  reviewContextPatch?: Partial<ReviewContext>,
): ScreenState[] {
  let targetIndex = -1;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].screen === screen) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) return stack;

  const target = stack[targetIndex];
  const nextTarget = reviewContextPatch && target.reviewContext
    ? { ...target, reviewContext: { ...target.reviewContext, ...reviewContextPatch } }
    : target;
  return [...stack.slice(0, targetIndex), nextTarget];
}
