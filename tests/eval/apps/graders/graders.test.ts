import { describe, expect, it } from 'vitest';
import { gradeQuizQuality, nearlySame, NEGATIVE_STEM_PATTERN } from './quiz-quality';
import { frontRevealsBack, gradeFlashcardsQuality, isTitleLikeFront } from './flashcards-quality';

const goodQuiz = [
  { stem: '若映射 f 的值域等于 Y，则 f 称为？', type: 'single', options: ['单射', '满射', '一一映射', '逆映射'], answer: '满射', explanation: '14:54 老师说"如果它的值域就是 Y，就叫满射"。单射要求不同 x 对应不同 y；一一映射要既单又满；逆映射是倒过来的映射。' },
  { stem: '为什么 $y=x^2$ 在 R 上没有逆映射？', type: 'short', options: [], answer: '不是单射：2 和 -2 都对应 4。', explanation: '22:08 老师以 y=x² 为例：二跟负二对的都是四，反过来四就对应两个点，不符合映射要求。' },
  { stem: '判断：两个 x 对应同一个 y 的映射也能定义逆映射。', type: 'judge', options: ['正确', '错误'], answer: '错误', explanation: '19:11 老师解释：反过来一个 y 对应两个 x，不再是映射；只有单射才有逆映射。' },
  { stem: '关于映射 f: X → Y，下列说法正确的是？', type: 'multiple', options: ['X 中每个元素在 Y 中有唯一像', 'Y 中每个元素必有原像', '值域是 Y 的子集', '不同的 x 必须对应不同的 y'], answer: 'A、C', explanation: 'A 是定义（3:02）；C：R_f 包含于 Y（8:04）。B 是满射的要求，D 是单射的要求，普通映射都不强制。' },
];

describe('quiz-quality grader', () => {
  it('好题全过；软项单独计分', () => {
    const grade = gradeQuizQuality(goodQuiz, goodQuiz.map((q) => q.stem), { minQuestions: 3, mustCover: ['单射', '满射'] });
    expect(grade.pass).toBe(true);
    expect(grade.score).toBe(1);
  });

  it('缺解析 / 重复题干 / "以下哪个不是" / 模板选项 / 段号漏进解析 → 硬项不过', () => {
    const noExplanation = gradeQuizQuality(goodQuiz.map((q, i) => (i === 0 ? { ...q, explanation: '略' } : q)), goodQuiz.map((q) => q.stem));
    expect(noExplanation.checks.everyQuestionExplained).toBe(false);
    expect(noExplanation.pass).toBe(false);

    const duplicated = gradeQuizQuality(goodQuiz, [...goodQuiz.map((q) => q.stem), goodQuiz[0].stem]);
    expect(duplicated.checks.noDuplicateStems).toBe(false);

    const negative = gradeQuizQuality([{ ...goodQuiz[0], stem: '以下哪个不是映射的性质？' }, ...goodQuiz.slice(1)], []);
    expect(negative.checks.noNegativeStems).toBe(false);
    expect(NEGATIVE_STEM_PATTERN.test('下列说法错误的是')).toBe(true);
    expect(NEGATIVE_STEM_PATTERN.test('若映射 f 的值域等于 Y，则 f 称为？')).toBe(false);

    const template = gradeQuizQuality([{ ...goodQuiz[0], options: ['满射', '该片段主要讨论了映射', '跳过了这个话题', '单射'] }, ...goodQuiz.slice(1)], []);
    expect(template.checks.noTemplateOptions).toBe(false);

    const segmentLeak = gradeQuizQuality([{ ...goodQuiz[0], explanation: '课堂原文段032明确指出值域是 Y 的子集，所以选满射。' }, ...goodQuiz.slice(1)], []);
    expect(segmentLeak.checks.noSegmentIndexInExplanation).toBe(false);
  });

  it('mustCover 关键词落不到任何题上 → 不过；多选答案必须是字母契约', () => {
    const uncovered = gradeQuizQuality(goodQuiz, [], { mustCover: ['复合映射'] });
    expect(uncovered.checks.mustCover).toBe(false);
    const badMultiple = gradeQuizQuality([{ ...goodQuiz[3], answer: '值域是 Y 的子集' }], []);
    expect(badMultiple.checks.answersResolvable).toBe(false);
  });

  it('nearlySame 认出换了两个字的同一题', () => {
    expect(nearlySame('为什么只有单射才能定义逆映射？', '为什么只有单射才有逆映射？')).toBe(true);
    expect(nearlySame('为什么只有单射才有逆映射？', '$y=x^2$ 在 R 上有逆映射吗？')).toBe(false);
  });
});

const goodCards = [
  { front: '为什么只有单射才有逆映射？', back: '不是单射时一个 y 对应多个 x，反过来不再是映射。' },
  { front: '$y=x^2$ 从 R 到 R 是满射吗？为什么', back: '不是：负数没有原像，值域 [0,+∞) 是 R 的真子集。' },
  { front: '老师用哪个例子说明一个 y 可以对应两个 x？', back: '$y=x^2$：2 和 -2 都对应 4。', hint: '想想平方' },
  { front: '复合映射 $f\\circ g$ 里哪个先作用在 x 上？', back: 'g 先作用，再算 f。' },
];

describe('flashcards-quality grader', () => {
  it('好卡全过', () => {
    const grade = gradeFlashcardsQuality(goodCards, goodCards, { minCards: 3, mustCover: ['单射', '满射'] });
    expect(grade.pass).toBe(true);
    expect(grade.score).toBe(1);
  });

  it('词条式正面 / 正面泄答 / 重复正面 / 背面太长 / 复述摘要 → 硬项不过', () => {
    const title = gradeFlashcardsQuality(goodCards, [{ front: '逆映射', back: '把映射倒过来。' }, ...goodCards]);
    expect(title.checks.noTitleLikeFronts).toBe(false);
    expect(isTitleLikeFront('逆映射')).toBe(true);
    expect(isTitleLikeFront('为什么？')).toBe(false);

    const reveal = gradeFlashcardsQuality(goodCards, [{ front: '满射的定义：值域等于 Y，这叫什么？', back: '值域等于 Y' }, ...goodCards]);
    expect(reveal.checks.noFrontRevealsBack).toBe(false);
    expect(frontRevealsBack('满射的定义：值域等于 Y，这叫什么？', '值域等于 Y')).toBe(true);
    expect(frontRevealsBack('为什么只有单射才有逆映射？', '不是单射时一个 y 对应多个 x')).toBe(false);

    const duplicated = gradeFlashcardsQuality(goodCards, [...goodCards, goodCards[0]]);
    expect(duplicated.checks.noDuplicateFronts).toBe(false);

    const longBack = gradeFlashcardsQuality([{ ...goodCards[0], back: '长'.repeat(130) }, ...goodCards.slice(1)], []);
    expect(longBack.checks.backsFitTwoLines).toBe(false);

    const summary = gradeFlashcardsQuality([{ front: '这节课主要讲了什么？', back: '映射。' }, ...goodCards], []);
    expect(summary.checks.noSummaryRestatement).toBe(false);
  });

  it('两问合一的卡按比例记软项；上次没记住的原句再出现记软项', () => {
    const twoQuestions = gradeFlashcardsQuality([{ front: '什么是单射？它排除了哪种情况？', back: '不同 x 对应不同 y。' }, ...goodCards.slice(0, 2)], []);
    expect(twoQuestions.checks.frontsSingleQuestion).toBe(false);
    expect(twoQuestions.pass).toBe(true);
    const repeated = gradeFlashcardsQuality(goodCards, goodCards, { avoidRepeating: ['为什么只有单射才有逆映射？'] });
    expect(repeated.checks.unstableNotRepeatedVerbatim).toBe(false);
    expect(repeated.pass).toBe(true);
  });
});
