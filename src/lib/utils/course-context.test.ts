import { describe, expect, it } from 'vitest';
import type { AudioSession } from '@/lib/db';
import { buildCourseContextGroups } from './course-context';

function session(overrides: Partial<AudioSession> & { sessionId: string; createdAt: Date }): AudioSession {
  return {
    userId: 'u1',
    mimeType: 'audio/webm',
    duration: 45 * 60_000,
    status: 'completed',
    updatedAt: overrides.createdAt,
    ...overrides,
  };
}

describe('course context grouping', () => {
  it('groups lessons by explicit subject and exposes a recurring timetable hint', () => {
    const groups = buildCourseContextGroups([
      session({ sessionId: 'a', subject: '线性代数', topic: '矩阵', createdAt: new Date('2026-07-06T02:00:00.000Z') }),
      session({ sessionId: 'b', subject: '线性代数', topic: '行列式', createdAt: new Date('2026-07-13T02:05:00.000Z') }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: '线性代数', confidence: 'confirmed' });
    expect(groups[0].scheduleLabel).toContain('周一');
    expect(groups[0].lessons.map((lesson) => lesson.title)).toEqual(['行列式', '矩阵']);
  });

  it('uses a repeated generic timetable slot as a suggestion, not a confirmed fact', () => {
    const groups = buildCourseContextGroups([
      session({ sessionId: 'a', subject: '课堂', topic: '课堂录音', createdAt: new Date('2026-07-07T06:00:00.000Z') }),
      session({ sessionId: 'b', subject: '课堂', topic: '课堂录音', createdAt: new Date('2026-07-14T06:10:00.000Z') }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ origin: 'schedule', confidence: 'suggested' });
  });

  it('applies user rename and pause without deleting the objective lessons', () => {
    const groups = buildCourseContextGroups([
      session({ sessionId: 'a', subject: '课堂', topic: '概率论 第 1 讲', createdAt: new Date('2026-07-07T06:00:00.000Z') }),
      session({ sessionId: 'b', subject: '课堂', topic: '概率论 第 2 讲', createdAt: new Date('2026-07-14T06:00:00.000Z') }),
    ], [{
      courseKey: 'topic:概率论',
      displayName: '概率论与数理统计',
      tags: ['专业课', '期末重点'],
      status: 'paused',
      confirmedByUser: true,
      updatedAt: '2026-07-17T00:00:00.000Z',
    }]);
    expect(groups[0]).toMatchObject({
      title: '概率论与数理统计',
      status: 'paused',
      confidence: 'confirmed',
      tags: ['专业课', '期末重点'],
    });
    expect(groups[0].lessons).toHaveLength(2);
  });

  it('does not expose links or bare timestamps as course and lesson titles', () => {
    const groups = buildCourseContextGroups([
      session({
        sessionId: 'url-course',
        subject: 'https://www.bilibili.com/video/BV123',
        topic: '20:30',
        sourceType: 'video-link',
        createdAt: new Date('2026-07-17T12:30:00.000Z'),
      }),
    ]);

    expect(groups[0].title).toBe('待命名课程');
    expect(groups[0].lessons[0].title).toBe('视频课堂');
  });

  it('detaches a wrongly grouped lesson and can restore it without deleting the session', () => {
    const sessions = [
      session({ sessionId: 'a', subject: '课堂', topic: '概率论 第 1 讲', createdAt: new Date('2026-07-07T06:00:00.000Z') }),
      session({ sessionId: 'b', subject: '课堂', topic: '概率论 第 2 讲', createdAt: new Date('2026-07-14T06:00:00.000Z') }),
    ];
    const detached = buildCourseContextGroups(sessions, [{
      courseKey: 'topic:概率论',
      status: 'active',
      confirmedByUser: true,
      excludedSessionIds: ['b'],
      updatedAt: '2026-07-17T00:00:00.000Z',
    }]);
    expect(detached).toHaveLength(2);
    expect(detached.find((group) => group.courseKey === 'topic:概率论')?.lessons.map((lesson) => lesson.sessionId)).toEqual(['a']);
    expect(detached.find((group) => group.courseKey === 'session:b')).toMatchObject({
      detachedFromCourseKey: 'topic:概率论',
      confidence: 'unclassified',
    });

    const restored = buildCourseContextGroups(sessions, [{
      courseKey: 'topic:概率论',
      status: 'active',
      confirmedByUser: true,
      excludedSessionIds: [],
      updatedAt: '2026-07-17T00:01:00.000Z',
    }]);
    expect(restored).toHaveLength(1);
    expect(restored[0].lessons).toHaveLength(2);
  });

  it('exposes only the latest active assessment on its course', () => {
    const groups = buildCourseContextGroups([
      session({ sessionId: 'a', subject: '线性代数', topic: '矩阵', createdAt: new Date('2026-07-07T06:00:00.000Z') }),
      session({ sessionId: 'b', subject: '线性代数', topic: '行列式', createdAt: new Date('2026-07-14T06:00:00.000Z') }),
    ], [{
      courseKey: 'subject:线性代数',
      status: 'active',
      assessments: [
        {
          id: 'midterm',
          name: '期中考试',
          mode: 'closed-book',
          status: 'completed',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z',
        },
        {
          id: 'final',
          name: '期末考试',
          mode: 'open-book',
          syllabus: '第一章到第四章',
          status: 'active',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-17T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-07-17T00:00:00.000Z',
    }]);

    expect(groups[0].assessment).toMatchObject({
      id: 'final',
      name: '期末考试',
      mode: 'open-book',
      syllabus: '第一章到第四章',
    });
  });

  it('ignores malformed assessment history from persisted profile JSON', () => {
    const groups = buildCourseContextGroups([
      session({ sessionId: 'a', subject: '线性代数', createdAt: new Date('2026-07-07T06:00:00.000Z') }),
    ], [{
      courseKey: 'subject:线性代数',
      status: 'active',
      assessments: { bad: true } as unknown as [],
      updatedAt: '2026-07-17T00:00:00.000Z',
    }]);

    expect(groups[0].assessment).toBeUndefined();
    expect(groups[0].lessons).toHaveLength(1);
  });
});
