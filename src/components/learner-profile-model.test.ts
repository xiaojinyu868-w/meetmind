import { describe, expect, it } from 'vitest';
import { buildLearnerProfile } from './learner-profile-model';
import type { LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import type { MasteryTrailEntry } from '@/lib/learning/mastery-trail-model';

const NOW = new Date('2026-09-09T12:00:00Z');

const memory = (over: Partial<LearningMemoryEntry>): LearningMemoryEntry => ({
  id: 'm', kind: 'topic', title: '', status: 'active', source: 'ai',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...over,
});
const lesson = (title: string, sessionId: string, at: string): LearningActivityEntry => ({
  id: `a-${sessionId}`, kind: 'lesson', title, sessionId, occurredAt: at,
});
const trail = (concept: string, status: MasteryTrailEntry['status']): MasteryTrailEntry => ({ concept, status, steps: [], lastAt: 0 });

describe('buildLearnerProfile', () => {
  it('小传按 正在学 → 检验过 → 最近的课 → 你说过的 说成最多四句', () => {
    const view = buildLearnerProfile({
      now: NOW,
      knownSince: '2026-08-29T00:00:00Z',
      activeThread: { id: 't', title: '线性规划：从业务问题到数学建模', intent: '搞懂建模', depth: 'deep', status: 'active', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
      trail: [trail('线性规划的建模', 'unstable'), trail('对偶问题', 'improving'), trail('单纯形法', 'stable'), trail('松弛变量', 'stable')],
      recentActivities: [
        lesson('Australia\'s Moving Experience · IELTS 听力练习 · 9-8', 's1', '2026-09-08T08:00:00Z'),
        lesson('课堂录音', 's2', '2026-09-07T08:00:00Z'),
        lesson('线性规划：从业务问题到数学建模', 's3', '2026-09-05T08:00:00Z'),
        lesson('线性规划：从业务问题到数学建模', 's3', '2026-09-05T09:00:00Z'), // 同一节课的重复活动
      ],
      memories: [
        memory({ id: 'p', kind: 'preference', title: '喜欢先看例子再看定义。', source: 'user' }),
        memory({ id: 'c', kind: 'challenge', title: '关注线性规划的建模', source: 'ai' }),
      ],
    });
    expect(view.bio).toEqual([
      '你在学「线性规划：从业务问题到数学建模」。',
      '「线性规划的建模」还没稳，「对偶问题」刚记住，2 个概念已经稳了。',
      '最近听了 2 节课，最近一节是《Australia\'s Moving Experience》。',
      '你说过：喜欢先看例子再看定义。',
    ]);
    // 弱项与还没稳的是同一个概念，不重复念
    expect(view.bio.some((s) => s.startsWith('上次没弄明白'))).toBe(false);
    expect(view.thread?.title).toBe('线性规划：从业务问题到数学建模');
    expect(view.mastery.map((m) => [m.concept, m.statusLabel])).toEqual([
      ['线性规划的建模', '还没稳'], ['对偶问题', '刚记住'], ['单纯形法', '已经稳了'], ['松弛变量', '已经稳了'],
    ]);
    // 记住的：弱项先于偏好；同学猜的带 guessed
    expect(view.memories.map((m) => [m.kindLabel, m.guessed])).toEqual([['弱项', true], ['偏好', false]]);
    expect(view.ledger).toEqual({ days: 12, lessons: 2, memories: 2 });
    expect(view.empty).toBe(false);
  });

  it('什么都没有 → empty；台账天数按最早记录算；停用的记忆沉底', () => {
    expect(buildLearnerProfile({ now: NOW, trail: [], recentActivities: [], memories: [] }).empty).toBe(true);
    const view = buildLearnerProfile({
      now: NOW,
      trail: [],
      recentActivities: [lesson('概率论 · 期中复习', 's1', '2026-09-07T08:00:00Z')],
      memories: [
        memory({ id: 'x', kind: 'topic', title: '贝叶斯', status: 'paused', createdAt: '2026-09-06T00:00:00Z' }),
        memory({ id: 'y', kind: 'strength', title: '公式推导', createdAt: '2026-09-08T00:00:00Z' }),
      ],
    });
    expect(view.bio).toEqual(['最近听了《概率论》。']);
    expect(view.memories.map((m) => [m.id, m.paused])).toEqual([['y', false], ['x', true]]);
    expect(view.ledger).toEqual({ days: 4, lessons: 1, memories: 1 });
  });
});
