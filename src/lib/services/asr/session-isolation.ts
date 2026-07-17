/**
 * 判断一次异步转写结果能否更新当前正在看的课堂。
 *
 * 只有显式携带 sessionId 且与当前课堂严格相等，才能覆盖 editor/ref。
 * 结果仍可持久化到它自己的 session，但不能因为旧调用方漏传标识而污染新课。
 */
export function shouldApplyTranscriptToActiveSession(
  resultSessionId: string | undefined,
  activeSessionId: string,
): boolean {
  return Boolean(resultSessionId && activeSessionId && resultSessionId === activeSessionId);
}
