// quiz-quality grader —— 一套题的质量断言（内容层，2026-09-11）。
//
// 断言的是"为这个人出的题"最起码要成立的几件事，不是题好不好（那个靠人读产物）：
//   每题有解析、无重复题干、不出"以下哪个不是"式凑数题、干扰项不是模板空话、
//   有掌握轨迹时对不稳概念有覆盖（mustCover 关键词落在题面 / 解析 / 概念上）、
//   题量够、（软）题型不止一种、（软）选择题的解析长到能说清对错、（软）题干短。
// 硬项全过才 pass；score = 全部检查的通过比例（软项也计入，给 baseline 一个有梯度的数）。

export interface GradedQuizQuestion {
  stem: string;
  type: string;
  options: string[];
  answer: string;
  explanation: string;
  concept?: string;
}

export interface QuizExpect {
  /** 至少几题（默认 3） */
  minQuestions?: number;
  /** 这些关键词（不稳概念）必须出现在某题的题面 / 解析 / 概念 / 选项里 */
  mustCover?: string[];
  /** 上次做过的题面原文：不该原样再出现（runner 从 learner.mastery 的 unstable 里取） */
  avoidRepeating?: string[];
}

export interface QuizGradeResult {
  pass: boolean;
  score: number;
  reason: string;
  checks: Record<string, boolean>;
}

/** "以下哪个不是 / 下列说法错误的是 / 不属于"——把判断外包给选项的凑数题 */
export const NEGATIVE_STEM_PATTERN = /(以下|下列|下面|哪[一个项种]?|哪些).{0,12}(不是|不属于|不正确|错误的?|不对|不包括|不成立|不能)|(不正确|错误|不属于).{0,4}(的是|有哪)|which .{0,30}\b(not|incorrect|false|except)\b/i;
/** 2026-09-09 前模型偶发的模板空话选项 */
export const TEMPLATE_OPTION_PATTERN = /主要讨论了|跳过了(这个)?话题|未做实质|仅做了简单引用|该片段|本片段|这段主要/;

export function stemKey(stem: string): string {
  return stem.replace(/[\s，。？！、,.?!:：;；「」“”"'()（）]/g, '').toLowerCase();
}

/** 两句是否"几乎同一句"：去标点后相等，或字符二元组重合 ≥ 0.8 */
export function nearlySame(a: string, b: string): boolean {
  const ka = stemKey(a);
  const kb = stemKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const grams = (text: string) => {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
    return set;
  };
  const ga = grams(ka);
  const gb = grams(kb);
  if (ga.size === 0 || gb.size === 0) return false;
  let shared = 0;
  ga.forEach((gram) => { if (gb.has(gram)) shared += 1; });
  return shared / Math.min(ga.size, gb.size) >= 0.8;
}

function containsKeyword(question: GradedQuizQuestion, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [question.stem, question.explanation, question.concept ?? '', ...question.options].join('\n').toLowerCase();
  return haystack.includes(needle);
}

export function gradeQuizQuality(questions: GradedQuizQuestion[], rawStems: string[], expect: QuizExpect = {}): QuizGradeResult {
  const minQuestions = expect.minQuestions ?? 3;
  const choice = questions.filter((q) => q.type === 'single' || q.type === 'multiple');
  const zhStems = questions.filter((q) => /[\u4e00-\u9fff]/.test(q.stem));
  const ratio = (ok: number, total: number) => (total === 0 ? 1 : ok / total);

  const hard: Record<string, boolean> = {
    enoughQuestions: questions.length >= minQuestions,
    everyQuestionExplained: questions.every((q) => q.explanation.trim().length >= 12),
    noDuplicateStems: new Set(rawStems.map(stemKey).filter(Boolean)).size === rawStems.filter((s) => stemKey(s)).length,
    noNegativeStems: !questions.some((q) => NEGATIVE_STEM_PATTERN.test(q.stem)),
    noTemplateOptions: !questions.some((q) => q.options.some((o) => TEMPLATE_OPTION_PATTERN.test(o))),
    answersResolvable: choice.every((q) => q.answer.trim().length > 0 && (q.type === 'multiple' ? /^[A-Z](、[A-Z])+$/.test(q.answer) : q.options.includes(q.answer))),
    mustCover: (expect.mustCover ?? []).every((keyword) => questions.some((q) => containsKeyword(q, keyword))),
    // 学生看不到段号；解析里写"段032"是 prompt 上下文漏出来了（v1 实测）
    noSegmentIndexInExplanation: !questions.some((q) => /段\s*0*\d{1,3}/.test(q.explanation)),
  };
  const soft: Record<string, boolean> = {
    // 解析写给答错的人看，一段话说完；"注："、"若严格来说"是模型在自我讨论——那道题本身就拿不准
    noSelfDebateInExplanation: !questions.some((q) => /注[:：]|若严格|严格来说|也可以理解为|更严谨地说/.test(q.explanation)),
    // 有掌握轨迹时，上次做过的那道题不该原样再出现（换角度）
    unstableNotRepeatedVerbatim: !(expect.avoidRepeating ?? []).some((previous) => questions.some((q) => nearlySame(q.stem, previous))),
    typeVariety: questions.length < 4 || new Set(questions.map((q) => q.type)).size >= 2,
    // 选择题的解析要说清"为什么对、其他为什么错"，30 字以下基本只说了前半句
    choiceExplanationsExplainWrong: ratio(choice.filter((q) => q.explanation.trim().length >= 30).length, choice.length) >= 0.8,
    stemsShort: ratio(zhStems.filter((q) => q.stem.length <= 40).length, zhStems.length) >= 0.8,
    // 选项不能是占位（"无" / "A"）；中文术语两个字就是完整选项（"单射" / "满射"）
    distractorsSubstantive: ratio(choice.filter((q) => q.options.every((o) => o.replace(/^[A-Za-z][.、)\s]+/, '').trim().length >= 2)).length, choice.length) >= 0.9,
  };

  const checks = { ...hard, ...soft };
  const passedCount = Object.values(checks).filter(Boolean).length;
  const failedHard = Object.entries(hard).filter(([, ok]) => !ok).map(([name]) => name);
  const failedSoft = Object.entries(soft).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    pass: failedHard.length === 0,
    score: passedCount / Object.keys(checks).length,
    reason: failedHard.length === 0 && failedSoft.length === 0
      ? `ok (${questions.length} questions, types=${Array.from(new Set(questions.map((q) => q.type))).join('/')})`
      : `hard failed: [${failedHard.join(', ')}] soft failed: [${failedSoft.join(', ')}]`,
    checks,
  };
}
