import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import {
  fallbackWorkshopReadiness,
  sanitizeWorkshopReadinessAssessment,
} from './workshop-readiness-service';

function segment(text: string, startMs: number, endMs: number): TranscriptSegment {
  return {
    id: `${startMs}`,
    sessionId: 'test-session',
    text,
    startMs,
    endMs,
    isFinal: true,
    createdAt: startMs,
  };
}

describe('workshop readiness', () => {
  it('blocks a short casual fragment instead of defaulting to a cheatsheet', () => {
    const assessment = fallbackWorkshopReadiness({
      transcript: [
        segment('家庭条件得跟得上。', 0, 5_000),
        segment('上一段感情谈了五年。', 6_000, 14_000),
      ],
    });

    expect(assessment).toMatchObject({
      status: 'not_ready',
      recommendedAppKey: null,
      allowedAppKeys: [],
      reason: 'insufficient_content',
    });
  });

  it('does not invent a recommendation when the fallback only knows that content is substantial', () => {
    const transcript = Array.from({ length: 12 }, (_, index) => segment(
      `第${index + 1}段解释一个可以核对的知识点，并补充它与前后内容之间的关系。`,
      index * 10_000,
      (index + 1) * 10_000,
    ));
    const assessment = fallbackWorkshopReadiness({ transcript });

    expect(assessment.status).toBe('ready');
    expect(assessment.recommendedAppKey).toBeNull();
    expect(assessment.allowedAppKeys).toHaveLength(5);
    expect(assessment.allowedAppKeys).not.toContain('cheatsheet');
  });

  it('does not expose a contradictory limited state when a short lesson has no grounded learning signal', () => {
    const assessment = fallbackWorkshopReadiness({
      transcript: [
        segment('这一段开始解释机会成本的基本含义，并提到选择一项活动意味着放弃另一项活动，但课程还没有进入完整例子和推导。', 0, 22_000),
        segment('老师刚准备说明如何比较被放弃选项的价值，以及为什么不能只看已经付出的成本，录音就在这里结束了。', 22_000, 44_000),
      ],
    });

    expect(assessment).toMatchObject({
      status: 'not_ready',
      recommendedAppKey: null,
      allowedAppKeys: [],
    });
  });

  it('allows only the learning action grounded by a learner mark for partial content', () => {
    const assessment = fallbackWorkshopReadiness({
      transcript: [
        segment('这一段开始解释机会成本，并用社团活动和周末兼职做了一个可以检验理解的例子，但完整定义还没有收束。', 0, 24_000),
        segment('后续推导还没有讲完，老师正在比较两个选择的隐含代价，学生已经在最容易混淆的位置留下标记。', 24_000, 48_000),
      ],
      activeAnchorCount: 1,
    });

    expect(assessment).toMatchObject({
      status: 'limited',
      recommendedAppKey: 'quiz',
      allowedAppKeys: ['quiz'],
    });
  });

  it('keeps every single-lesson capability visible for the curated guest demo', () => {
    const transcript = Array.from({ length: 4 }, (_, index) => segment(
      `试听片段第${index + 1}段提供可以核对的听力内容、关键词和上下文。`,
      index * 12_000,
      (index + 1) * 12_000,
    ));
    const assessment = fallbackWorkshopReadiness({ transcript, contextType: 'demo' });

    expect(assessment).toMatchObject({
      status: 'ready',
      contentKind: 'lecture',
      recommendedAppKey: 'flashcards',
      confidence: 'high',
    });
    expect(assessment.allowedAppKeys).toHaveLength(5);
    expect(assessment.allowedAppKeys).not.toContain('cheatsheet');
  });

  it('forces not-ready model output to remove every app', () => {
    const transcript = [
      segment('大家下周三换到第二教室上课，记得带校园卡。', 0, 30_000),
      segment('今天就通知到这里，没有新的课程内容。', 31_000, 62_000),
    ];
    const assessment = sanitizeWorkshopReadinessAssessment({
      status: 'not_ready',
      contentKind: 'administrative',
      recommendedAppKey: 'cheatsheet',
      allowedAppKeys: ['cheatsheet', 'quiz'],
      reason: 'not_learning',
      confidence: 'high',
    }, { transcript });

    expect(assessment).toMatchObject({
      status: 'not_ready',
      contentKind: 'administrative',
      recommendedAppKey: null,
      allowedAppKeys: [],
      reason: 'not_learning',
      confidence: 'high',
    });
  });

  it('uses content kind when the model returns a non-standard not-learning reason', () => {
    const transcript = Array.from({ length: 10 }, (_, index) => segment(
      '这是一段有足够长度但只是讨论个人偏好的普通聊天。',
      index * 10_000,
      (index + 1) * 10_000,
    ));
    const assessment = sanitizeWorkshopReadinessAssessment({
      status: 'not_ready',
      contentKind: 'casual',
      reason: 'not_learning_content',
      recommendedAppKey: null,
      allowedAppKeys: [],
      confidence: 'high',
    }, { transcript });

    expect(assessment.reason).toBe('not_learning');
    expect(assessment.allowedAppKeys).toEqual([]);
  });

  it('keeps at most two model-approved apps for partial learning content', () => {
    const transcript = Array.from({ length: 8 }, (_, index) => segment(
      `这里正在解释机会成本的含义和一个校园生活例子，内容仍然没有讲完。`,
      index * 10_000,
      (index + 1) * 10_000,
    ));
    const assessment = sanitizeWorkshopReadinessAssessment({
      status: 'limited',
      contentKind: 'lecture',
      recommendedAppKey: 'flashcards',
      allowedAppKeys: ['flashcards', 'quiz', 'mindmap'],
      confidence: 'medium',
    }, { transcript });

    expect(assessment.status).toBe('limited');
    expect(assessment.allowedAppKeys).toEqual(['flashcards', 'quiz']);
    expect(assessment.recommendedAppKey).toBe('flashcards');
    expect(assessment.reason).toBe('partial_learning');
  });

  it('uses the safe substantial-content fallback when a ready response omits allowed apps', () => {
    const transcript = Array.from({ length: 12 }, (_, index) => segment(
      `第${index + 1}段解释一个完整知识点，并说明它与前一个知识点之间的关系。`,
      index * 10_000,
      (index + 1) * 10_000,
    ));
    const assessment = sanitizeWorkshopReadinessAssessment({
      status: 'ready',
      contentKind: 'lecture',
      recommendedAppKey: null,
      allowedAppKeys: [],
      confidence: 'low',
    }, { transcript });

    expect(assessment.status).toBe('ready');
    expect(assessment.allowedAppKeys).toHaveLength(5);
    expect(assessment.allowedAppKeys).not.toContain('cheatsheet');
  });

  it('keeps every stable capability available when a ready response suggests only a subset', () => {
    const transcript = Array.from({ length: 12 }, (_, index) => segment(
      `第${index + 1}段完整解释定义、例子和知识关系，足以继续做不同形式的学习加工。`,
      index * 10_000,
      (index + 1) * 10_000,
    ));
    const assessment = sanitizeWorkshopReadinessAssessment({
      status: 'ready',
      contentKind: 'lecture',
      recommendedAppKey: 'mindmap',
      allowedAppKeys: ['mindmap', 'cheatsheet'],
      confidence: 'high',
    }, { transcript });

    expect(assessment.allowedAppKeys).toHaveLength(5);
    expect(assessment.allowedAppKeys).toEqual(expect.arrayContaining([
      'flashcards',
      'quiz',
      'mindmap',
      'infographic',
      'audio-overview',
    ]));
    expect(assessment.recommendedAppKey).toBe('mindmap');
  });

  it('allows a cheatsheet only when the context is cross-lesson or exam scoped', () => {
    const transcript = Array.from({ length: 12 }, (_, index) => segment(
      `第${index + 1}段解释跨课需要合并的定义、公式、适用条件和易错点。`,
      index * 10_000,
      (index + 1) * 10_000,
    ));

    const classAssessment = fallbackWorkshopReadiness({ transcript, contextTier: 'class' });
    const unitAssessment = fallbackWorkshopReadiness({ transcript, contextTier: 'unit' });
    const examAssessment = fallbackWorkshopReadiness({ transcript, contextTier: 'exam' });

    expect(classAssessment.allowedAppKeys).not.toContain('cheatsheet');
    expect(unitAssessment.allowedAppKeys).toContain('cheatsheet');
    expect(examAssessment.allowedAppKeys).toContain('cheatsheet');
  });
});
