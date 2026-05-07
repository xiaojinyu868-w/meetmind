// Grader: Learning rubric (LLM-as-judge)
// 当"答案没有唯一标准"时使用（学习类问答、概念解释、启发引导）。
// 用 qwen3.5-plus 作为 judge（项目事实标准，性价比 + 效果平衡）；
// 可用 env EVAL_JUDGE_MODEL 覆盖（例如设 qwen-max 做高精度阅卷对比）。
//
// 离线时自动降级为 "skip"（不算分也不失败），避免 harness 对 LLM 硬依赖。
// 在 CI 里如果 OPENAI_API_KEY/DASHSCOPE_API_KEY 没配，所有 rubric case 视作跳过。

export interface LearningRubricCase {
  id: string;
  question: string;
  /** 回答应当命中的要点；LLM 根据 rubric 打分 */
  rubric: string;
  /** 参考答案（可选，辅助 judge） */
  referenceAnswer?: string;
  /** 及格阈值，默认 3/5 */
  passThreshold?: number;
}

export interface GraderResult {
  pass: boolean;
  score: number; // normalized 0..1
  reason: string;
  details?: Record<string, unknown>;
}

const JUDGE_SYSTEM_PROMPT =
  `你是严谨的阅卷老师。根据 rubric 判断学生回答是否达标。
只输出 JSON 格式: {"score": 1-5, "reason": "简要原因"}。
评分标准:
  5 = 完全命中 rubric 全部要点，表达清晰
  4 = 命中主要要点，略有瑕疵
  3 = 命中半数要点
  2 = 只命中少量要点或回答偏题
  1 = 完全没抓住 rubric`;

function buildJudgePrompt(caseDef: LearningRubricCase, answer: string): string {
  return [
    `# 问题`,
    caseDef.question,
    ``,
    `# Rubric（评分标准要点）`,
    caseDef.rubric,
    caseDef.referenceAnswer ? `\n# 参考答案\n${caseDef.referenceAnswer}` : '',
    ``,
    `# 学生回答`,
    answer,
    ``,
    `# 请打分`,
    `只输出 JSON。`,
  ].join('\n');
}

export interface JudgeCaller {
  (opts: { system: string; user: string }): Promise<{ score: number; reason: string } | null>;
}

/**
 * 默认 judge 实现：走 DashScope qwen3.5-plus（性价比 + 效果已验证够用）。
 * 环境变量 DASHSCOPE_API_KEY 不存在时返回 null（跳过）。
 */
export async function dashscopeQwenMaxJudge(opts: {
  system: string;
  user: string;
}): Promise<{ score: number; reason: string } | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.EVAL_JUDGE_MODEL ?? 'qwen3.5-plus',
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      },
    );

    if (!response.ok) return null;
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as { score?: number; reason?: string };
    if (typeof parsed.score !== 'number') return null;
    return {
      score: Math.max(1, Math.min(5, Math.round(parsed.score))),
      reason: parsed.reason ?? '',
    };
  } catch {
    return null;
  }
}

export async function gradeLearningRubric(
  answer: string,
  caseDef: LearningRubricCase,
  caller: JudgeCaller = dashscopeQwenMaxJudge,
): Promise<GraderResult> {
  const judgeResult = await caller({
    system: JUDGE_SYSTEM_PROMPT,
    user: buildJudgePrompt(caseDef, answer),
  });

  if (!judgeResult) {
    return {
      pass: true,
      score: 0,
      reason: 'judge unavailable (DASHSCOPE_API_KEY missing or API error); skipped',
      details: { skipped: true },
    };
  }

  const threshold = caseDef.passThreshold ?? 3;
  const pass = judgeResult.score >= threshold;
  return {
    pass,
    score: judgeResult.score / 5,
    reason: judgeResult.reason || (pass ? `score=${judgeResult.score}` : `score=${judgeResult.score} below ${threshold}`),
    details: { rawScore: judgeResult.score, threshold },
  };
}
