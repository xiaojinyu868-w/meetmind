// Grader: 工具选择正确性
// 判断 Tutor 的 toolCalls 序列是否符合预期。
// 模式:
//   - exact: 必须首个工具等于 expectedTool
//   - contains: 某一步用过 expectedTool
//   - none: 应该完全不调用工具（纯对话）

export interface ToolSelectionCase {
  id: string;
  question: string;
  expectedTool?: string;
  mode?: 'exact' | 'contains' | 'none';
}

export interface ToolCall {
  toolName: string;
  args?: unknown;
  step?: number;
}

export interface GraderResult {
  pass: boolean;
  score: number;
  reason: string;
  details?: Record<string, unknown>;
}

export function gradeToolSelection(
  toolCalls: ToolCall[],
  caseDef: ToolSelectionCase,
): GraderResult {
  const mode = caseDef.mode ?? 'exact';
  const called = toolCalls.map((t) => t.toolName);

  if (mode === 'none') {
    const pass = called.length === 0;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass ? 'no tool call as expected' : `unexpected tool call(s): ${called.join(', ')}`,
      details: { called },
    };
  }

  if (!caseDef.expectedTool) {
    return { pass: false, score: 0, reason: 'expectedTool missing in case', details: { called } };
  }

  if (mode === 'exact') {
    const first = called[0];
    const pass = first === caseDef.expectedTool;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass
        ? `first tool correct: ${first}`
        : `expected first tool=${caseDef.expectedTool}, got=${first ?? '(none)'}`,
      details: { called, expected: caseDef.expectedTool },
    };
  }

  // contains
  const pass = called.includes(caseDef.expectedTool);
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `tool ${caseDef.expectedTool} was called`
      : `tool ${caseDef.expectedTool} never called; got=${called.join(', ') || '(none)'}`,
    details: { called, expected: caseDef.expectedTool },
  };
}
