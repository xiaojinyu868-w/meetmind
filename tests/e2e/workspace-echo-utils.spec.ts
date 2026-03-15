import { expect, test } from '@playwright/test';
import {
  buildDailyEchoSourceKey,
  buildEchoPrompt,
  buildEchoPromptPackage,
  evaluateEchoQuality,
  getUtc8DateKey,
  selectRecentPromptCaptures,
  shouldSkipEchoGeneration,
} from '../../src/lib/services/workspace-echo-service';

function capture(overrides: Partial<{
  id: string;
  sourceKey: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string | null;
  normalizedText: string | null;
  tutorContext: string | null;
  occurredAt: Date | null;
  createdAt: Date;
}> = {}) {
  return {
    id: 'capture-1',
    sourceKey: 'manual:capture-1',
    role: 'primary',
    contentType: 'audio',
    title: '课堂原声',
    previewText: '这是预览',
    normalizedText: '老师这里开始讲单调性的判定，我卡在导数符号为什么能直接推出单调区间。',
    tutorContext: null,
    occurredAt: new Date('2026-03-14T02:10:00.000Z'),
    createdAt: new Date('2026-03-14T02:10:00.000Z'),
    ...overrides,
  };
}

test.describe('workspace echo utils', () => {
  test('builds UTC+8 date keys and daily source keys', async () => {
    expect(getUtc8DateKey(new Date('2026-03-14T15:30:00.000Z'))).toBe('2026-03-14');
    expect(getUtc8DateKey(new Date('2026-03-14T16:30:00.000Z'))).toBe('2026-03-15');
    expect(buildDailyEchoSourceKey('workspace-1', '2026-03-15')).toBe('daily:workspace-1:2026-03-15');
  });

  test('builds prompt package with today captures first and recent echoes for de-dup', async () => {
    const promptPackage = buildEchoPromptPackage({
      captures: [
        capture({
          id: 'today-1',
          sourceKey: 'manual:today-1',
          title: '原声一',
          occurredAt: new Date('2026-03-14T02:10:00.000Z'),
        }),
        capture({
          id: 'today-2',
          sourceKey: 'manual:today-2',
          role: 'support',
          contentType: 'document',
          title: '讲义',
          normalizedText: '这份讲义里把单调区间和极值放在一起讲，我还没完全连起来。',
          occurredAt: new Date('2026-03-14T03:10:00.000Z'),
        }),
        capture({
          id: 'older-1',
          sourceKey: 'manual:older-1',
          role: 'support',
          contentType: 'text',
          title: '昨天的困惑',
          normalizedText: '昨天我还在想导数大于零到底代表什么。',
          occurredAt: new Date('2026-03-13T03:10:00.000Z'),
        }),
      ],
      recentEchoes: [
        {
          id: 'echo-1',
          title: '先别急着总结',
          body: '你最近一直在围着单调性和导数关系打转，今天值得顺着这条继续收。',
          createdAt: new Date('2026-03-13T11:00:00.000Z'),
          updatedAt: new Date('2026-03-13T11:00:00.000Z'),
        },
      ],
      now: new Date('2026-03-14T06:00:00.000Z'),
    });

    expect(promptPackage.todayCaptures).toHaveLength(2);
    expect(promptPackage.todayCaptures.map((item) => item.id)).toEqual(['today-1', 'today-2']);
    expect(promptPackage.recentCaptures).toHaveLength(1);
    expect(promptPackage.recentEchoes).toHaveLength(1);
    expect(promptPackage.activityHints.hasPrimaryAudio).toBeTruthy();
    expect(promptPackage.activityHints.hasSupportMaterial).toBeTruthy();
  });

  test('renders prompt with minimal contract and recent echo de-dup context', async () => {
    const prompt = buildEchoPrompt(
      buildEchoPromptPackage({
        captures: [capture()],
        recentEchoes: [
          {
            id: 'echo-1',
            title: '昨天的回声',
            body: '顺着导数这条线继续记，会比重新总结更有价值。',
            createdAt: new Date('2026-03-13T11:00:00.000Z'),
            updatedAt: new Date('2026-03-13T11:00:00.000Z'),
          },
        ],
        now: new Date('2026-03-14T06:00:00.000Z'),
      })
    );

    expect(prompt).toContain('输出纯 JSON：{"title": string, "body": string}');
    expect(prompt).toContain('你是一位敏锐但克制的学习回声编辑。');
    expect(prompt).toContain('最近几天的回声');
  });

  test('detects thin context and repeated outputs', async () => {
    const thinPackage = buildEchoPromptPackage({
      captures: [
        capture({
          normalizedText: '导数。',
          occurredAt: new Date('2026-03-14T06:00:00.000Z'),
        }),
      ],
      recentEchoes: [],
      now: new Date('2026-03-14T06:00:00.000Z'),
    });

    expect(shouldSkipEchoGeneration(thinPackage)).toBeTruthy();

    const quality = evaluateEchoQuality({
      candidate: {
        title: '顺着导数继续记',
        body: '顺着导数这条线继续记，会比重新总结更有价值。',
      },
      recentEchoes: [
        {
          title: '昨天的回声',
          body: '顺着导数这条线继续记，会比重新总结更有价值。',
        },
      ],
    });

    expect(quality.valid).toBeFalsy();
    expect(quality.reason).toBe('too-similar');
  });

  test('keeps the newest captures when the lookback window is crowded', async () => {
    const now = new Date('2026-03-14T12:00:00.000Z');
    const captures = Array.from({ length: 30 }, (_, index) =>
      capture({
        id: `capture-${index + 1}`,
        sourceKey: `manual:capture-${index + 1}`,
        title: `线索 ${index + 1}`,
        occurredAt: new Date(now.getTime() - (29 - index) * 3 * 60 * 60 * 1000),
        createdAt: new Date(now.getTime() - (29 - index) * 3 * 60 * 60 * 1000),
      })
    );

    const selected = selectRecentPromptCaptures(captures, 24);

    expect(selected).toHaveLength(24);
    expect(selected[0]?.id).toBe('capture-30');
    expect(selected[selected.length - 1]?.id).toBe('capture-7');
    expect(selected.map((item) => item.id)).not.toContain('capture-1');
  });
});
