import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { buildCheatsheetSections, isRejectedCheatsheetDraft } from './cheatsheet.plugin';

const transcript: TranscriptSegment[] = [
  { id: 's1', text: '机会成本是为了得到某个选择而放弃的最佳替代方案。', startMs: 0, endMs: 8_000, isFinal: true },
  { id: 's2', text: '注意，边际成本是额外生产一个单位所增加的成本，这是本节重点。', startMs: 9_000, endMs: 18_000, isFinal: true },
];

describe('buildCheatsheetSections evidence grounding', () => {
  it('drops unsupported items instead of citing the nearest timestamp', () => {
    const sections = buildCheatsheetSections(transcript, {
      sections: [{
        key: 'definition',
        items: [
          { term: '机会成本', body: '放弃的最佳替代方案', startMs: 12_000 },
          { term: '量子纠缠', body: '允许信息超光速传递', startMs: 12_000 },
        ],
      }],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(1);
    expect(sections[0].items[0].term).toBe('机会成本');
    expect(sections[0].items[0].citation?.startMs).toBe(0);
  });

  it('only keeps strong emphasis when the supporting evidence explicitly signals it', () => {
    const sections = buildCheatsheetSections(transcript, {
      sections: [{
        key: 'definition',
        items: [
          { term: '机会成本', body: '放弃的最佳替代方案', emphasis: 'strong' },
          { term: '边际成本', body: '额外生产一单位增加的成本', emphasis: 'strong' },
        ],
      }],
    });

    expect(sections[0].items[0].emphasis).toBe('normal');
    expect(sections[0].items[1].emphasis).toBe('strong');
  });

  it('preserves grounded Markdown tables and Mermaid blocks for print-rich rendering', () => {
    const body = [
      '**机会成本**是放弃的最佳替代方案。',
      '',
      '| 选择 | 放弃 |',
      '| --- | --- |',
      '| 读书 | 一小时休闲 |',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[做出选择] --> B[放弃最佳替代方案]',
      '```',
    ].join('\n');
    const sections = buildCheatsheetSections(transcript, {
      sections: [{ key: 'definition', items: [{ term: '机会成本', body, latex: 'MC = \\frac{\\Delta TC}{\\Delta Q}' }] }],
    });

    expect(sections[0].items[0].body).toContain('| --- | --- |');
    expect(sections[0].items[0].body).toContain('```mermaid\nflowchart LR');
    expect(sections[0].items[0].body).toContain('\n  A[做出选择]');
    expect(sections[0].items[0].latex).toBe('MC = \\frac{\\Delta TC}{\\Delta Q}');
  });

  it('restores a grounded citation to the source lesson and its local time', () => {
    const multiLessonTranscript: TranscriptSegment[] = [
      {
        id: 'lesson-a:s1',
        text: '需求价格弹性衡量需求量变动对价格变动的敏感程度。',
        startMs: 0,
        endMs: 8_000,
        isFinal: true,
        sourceItemId: 'lesson-a',
        sourceTitle: '第一讲 · 需求',
      },
      {
        id: 'lesson-b:s1',
        text: '边际成本是额外生产一个单位所增加的成本。',
        startMs: 9_000,
        endMs: 16_000,
        isFinal: true,
        sourceItemId: 'lesson-b',
        sourceTitle: '第二讲 · 成本',
      },
    ];

    const sections = buildCheatsheetSections(
      multiLessonTranscript,
      {
        sections: [{
          key: 'definition',
          items: [{ term: '边际成本', body: '额外生产一单位增加的成本', startMs: 9_000 }],
        }],
      },
      [
        { sessionId: 'lesson-a', title: '第一讲 · 需求', offsetMs: 0, durationMs: 8_000 },
        { sessionId: 'lesson-b', title: '第二讲 · 成本', offsetMs: 9_000, durationMs: 7_000 },
      ],
    );

    expect(sections[0].items[0].citation).toMatchObject({
      sourceId: 'lesson-b',
      sourceTitle: '第二讲 · 成本',
      sourceStartMs: 0,
      sourceEndMs: 7_000,
    });
  });

  it('grounds exam-only claims in the supplied syllabus instead of a nearby lesson', () => {
    const sections = buildCheatsheetSections(
      transcript,
      {
        sections: [{
          key: 'definition',
          items: [{
            term: '考试范围',
            body: '需求价格弹性与税收归宿',
            sourceId: 'exam-syllabus',
          }],
        }],
      },
      [],
      [{
        id: 'exam-syllabus',
        text: '考试范围包括需求价格弹性与税收归宿。',
        startMs: 0,
        endMs: 0,
        confidence: 1,
        isFinal: true,
        sourceItemId: 'exam-syllabus',
        sourceTitle: '考试大纲',
      }],
    );

    expect(sections[0].items[0].citation).toMatchObject({
      sourceId: 'exam-syllabus',
      sourceTitle: '考试大纲',
      sourceKind: 'syllabus',
    });
  });
});

describe('cheatsheet content-quality gate', () => {
  it('rejects an unavailable or explicitly invalid draft instead of wrapping raw chat as key points', () => {
    expect(isRejectedCheatsheetDraft(null)).toBe(true);
    expect(isRejectedCheatsheetDraft({
      title: '无效数据 · 无法生成速查表',
      overview: '课堂原文是生活闲聊，不含学科考点。',
      sections: [{ key: 'definition', items: [{ term: '要点 1', body: '随便聊聊。' }] }],
    })).toBe(true);
  });

  it('keeps a grounded academic draft', () => {
    expect(isRejectedCheatsheetDraft({
      title: '微观经济学考试速查',
      overview: '用于开卷考试时快速定位定义与公式。',
      sections: [{ key: 'definition', items: [{ term: '机会成本', body: '放弃的最佳替代方案。' }] }],
    })).toBe(false);
  });
});
