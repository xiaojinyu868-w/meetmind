/**
 * teach 老师 narration 偶发把讲义高亮语法 ==重点== 漏进对话文本
 * （prompt 里 == 是给 write 工具的马克笔语法，见 teach-teacher-prompt）。
 * 显示层归一成 markdown 加粗，不留字面 ==。成对才替换，单个 == 原样保留。
 */
export function normalizeNarrationMarks(text: string): string {
  return text.replace(/==([^=\n]+)==/g, '**$1**');
}
