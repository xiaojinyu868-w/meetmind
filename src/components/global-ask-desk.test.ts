import { describe, expect, it } from 'vitest';
import type { LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import type { MasteryTrailEntry } from '@/components/mastery-trail';
import { buildAskDesk, isMaterialTitle, topicLabel, type AskDeskInput, type DeskAnchor } from './global-ask-desk';

const base: AskDeskInput = {
  hasCurrentTranscript: false,
  materialTitles: [],
  anchors: [],
  recentActivities: [],
  trail: [],
  memories: [],
};

const anchor = (over: Partial<DeskAnchor> & Pick<DeskAnchor, 'id' | 'timestamp'>): DeskAnchor => ({
  type: 'confusion', resolved: false, cancelled: false, ...over,
});

const activity = (over: Partial<LearningActivityEntry> & Pick<LearningActivityEntry, 'id' | 'title'>): LearningActivityEntry => ({
  kind: 'lesson', occurredAt: '2026-09-08T08:00:00Z', ...over,
});

const memory = (over: Partial<LearningMemoryEntry> & Pick<LearningMemoryEntry, 'id' | 'title' | 'kind'>): LearningMemoryEntry => ({
  status: 'active', summary: '', confidence: 0.8, updatedAt: '2026-09-08T08:00:00Z', ...over,
} as LearningMemoryEntry);

const trail = (concept: string, status: MasteryTrailEntry['status']): MasteryTrailEntry => ({
  concept, status, steps: [], lastAt: 0,
});

describe('buildAskDesk', () => {
  it('全空时返回空桌面', () => {
    expect(buildAskDesk(base)).toEqual([]);
  });

  it('当前课堂有转录：正在读点名课程，你标的时刻按「没跟上优先、时间顺序」排列，取消的不上桌', () => {
    const groups = buildAskDesk({
      ...base,
      hasCurrentTranscript: true,
      currentLessonTitle: '贝叶斯 · 概率论 · 9-8',
      materialTitles: ['讲义 A', '讲义 B', '讲义 C', '讲义 D'],
      anchors: [
        anchor({ id: 'a1', timestamp: 90_000, resolved: true }),
        anchor({ id: 'a2', timestamp: 30_000, note: '没听懂归一化' }),
        anchor({ id: 'a3', timestamp: 60_000, type: 'important' }),
        anchor({ id: 'a4', timestamp: 10_000, cancelled: true }),
      ],
    });
    const reading = groups.find((g) => g.id === 'reading');
    expect(reading?.items[0]).toMatchObject({ id: 'reading:current-lesson', label: '贝叶斯 · 概率论 · 9-8' });
    expect(reading?.items[0].prompt).toContain('《贝叶斯 · 概率论 · 9-8》');
    // 正在读最多 3 件（1 节课 + 2 份材料），其余折成 +N
    expect(reading?.items).toHaveLength(3);
    expect(reading?.overflow).toBe(2);

    const moments = groups.find((g) => g.id === 'moments');
    expect(moments?.items.map((i) => i.id)).toEqual(['moment:a2', 'moment:a3', 'moment:a1']);
    expect(moments?.items[0]).toMatchObject({ label: '00:30', meta: '没听懂归一化', tone: 'vermilion' });
    expect(moments?.items[0].prompt).toContain('00:30');
    expect(moments?.items[1].prompt).toContain('老师强调');
    // 有当前课堂时不再摆「最近」——注意力留在这节课
    expect(groups.find((g) => g.id === 'recent')).toBeUndefined();
  });

  it('有转录时「你标的」chip 带上那一刻老师的原话，问句也点名那句话（同一套时刻命名）', () => {
    const groups = buildAskDesk({
      ...base,
      hasCurrentTranscript: true,
      segments: [
        { startMs: 0, endMs: 5000, text: "Good morning ma'am and welcome." },
        { startMs: 30000, endMs: 34000, text: 'My name is Jane, Jane Bond.' },
      ],
      anchors: [anchor({ id: 'a1', timestamp: 30_500 })],
    });
    const moment = groups.find((g) => g.id === 'moments')?.items[0];
    expect(moment?.label).toBe('00:30 · My name is Jane, Jane Bond');
    expect(moment?.prompt).toBe('00:30「My name is Jane, Jane Bond」那里我没跟上，从这讲一下');
  });

  it('没有当前课堂：用最近学过把人接回上一节，同名去重、最多两件', () => {
    const groups = buildAskDesk({
      ...base,
      recentActivities: [
        activity({ id: 'r1', title: '线性代数 · 9-1' }),
        activity({ id: 'r2', title: '概率论 · 9-5' }),
        activity({ id: 'r3', title: '概率论 · 9-5', kind: 'app', appKey: 'quiz' }),
        activity({ id: 'r4', title: '随手一问', kind: 'conversation' }),
      ],
    });
    const recent = groups.find((g) => g.id === 'recent');
    expect(recent?.items.map((i) => i.label)).toEqual(['概率论 · 9-5', '线性代数 · 9-1']);
    expect(recent?.items[0].prompt).toContain('《概率论 · 9-5》');
  });

  it('还没稳排在刚记住之前，已经稳的不上桌；长期理解里困惑先于主题，偏好不上桌', () => {
    const groups = buildAskDesk({
      ...base,
      trail: [trail('归一化', 'improving'), trail('先验概率', 'stable'), trail('后验', 'unstable')],
      memories: [
        memory({ id: 'm1', title: '喜欢先看例子', kind: 'preference' }),
        memory({ id: 'm2', title: '概率论', kind: 'topic' }),
        memory({ id: 'm3', title: '条件概率的方向', kind: 'challenge' }),
      ],
    });
    const unstable = groups.find((g) => g.id === 'unstable');
    expect(unstable?.items.map((i) => i.label)).toEqual(['后验', '归一化']);
    expect(unstable?.items[0]).toMatchObject({ tone: 'vermilion' });
    expect(unstable?.items[0].prompt).toContain('换一个新的例子');
    expect(unstable?.items[1].prompt).toContain('考考我');

    const mem = groups.find((g) => g.id === 'memory');
    expect(mem?.items.map((i) => i.label)).toEqual(['条件概率的方向', '概率论']);
    expect(mem?.items[0]).toMatchObject({ tone: 'vermilion' });
  });

  it('长标题按显示宽度截断（CJK 记 2），英文课名不会半句被剪；prompt 里用更短的标题', () => {
    const longCjk = '一个非常非常长的课程标题一直写到看不见结尾的地方还在继续写下去';
    const [reading] = buildAskDesk({ ...base, materialTitles: [longCjk] });
    expect(reading.items[0].label.length).toBeLessThanOrEqual(25);
    expect(reading.items[0].label.endsWith('…')).toBe(true);
    expect(reading.items[0].prompt.length).toBeLessThan(longCjk.length + 20);

    const latin = "Australia's Moving Experience · IELTS 听力练习";
    const [reading2] = buildAskDesk({ ...base, materialTitles: [latin] });
    expect(reading2.items[0].label).toBe(latin);
  });

  it('句子不是标题：口袋收的一句话、贴的对话不进「正在读」，也不进 prompt 的《》里', () => {
    const groups = buildAskDesk({
      ...base,
      materialTitles: ['这台设备上的课堂历史已同步到账号。', 'hello 你好你好。感觉不对劲，为什么现在又可以了?', '线性规划讲义.pdf', 'Chapter 3 · Duality'],
    });
    const reading = groups.find((g) => g.id === 'reading');
    expect(reading?.items.map((i) => i.label)).toEqual(['线性规划讲义.pdf', 'Chapter 3 · Duality']);
    expect(isMaterialTitle('第三章 对偶问题')).toBe(true);
    expect(isMaterialTitle('notes.md')).toBe(true);
    expect(isMaterialTitle('This is a sentence.')).toBe(false);
    expect(isMaterialTitle('课堂录音')).toBe(false);
  });

  it('应用活动"完成了「讲给同桌听」"不是课名：顺着 sessionId 找回那节课；找不到就不上', () => {
    const groups = buildAskDesk({
      ...base,
      recentActivities: [
        activity({ id: 'l1', title: '线性规划：从业务问题到数学建模', sessionId: 's1', occurredAt: '2026-09-07T08:00:00Z' }),
        activity({ id: 'a1', title: '完成了「讲给同桌听」', kind: 'app', appKey: 'teach-back', sessionId: 's1', occurredAt: '2026-09-08T08:00:00Z' }),
        activity({ id: 'a2', title: '完成了「测验」', kind: 'app', appKey: 'quiz', sessionId: 'unknown', occurredAt: '2026-09-09T08:00:00Z' }),
      ],
    });
    const recent = groups.find((g) => g.id === 'recent');
    expect(recent?.items).toHaveLength(1);
    // 时间跟着听课那天走，不是做应用那天
    expect(recent?.items[0]).toMatchObject({ label: '线性规划：从业务问题到数学建模', at: '2026-09-07T08:00:00Z' });
    expect(recent?.items[0].prompt).toContain('《线性规划：从业务问题到数学建模》');
  });

  it('长期理解的标题去掉开头动词再念；一整句话的记忆不念', () => {
    expect(topicLabel('关注线性规划的建模与转化能力')).toBe('线性规划的建模与转化能力');
    expect(topicLabel('掌握 对偶问题')).toBe('对偶问题');
    expect(topicLabel('关注')).toBe('关注');
    const groups = buildAskDesk({
      ...base,
      memories: [
        memory({ id: 'm1', title: '关注线性规划的建模与转化能力', kind: 'topic' }),
        memory({ id: 'm2', title: '上次说自己总是把条件概率的方向搞反了。', kind: 'challenge' }),
      ],
    });
    const mem = groups.find((g) => g.id === 'memory');
    expect(mem?.items.map((i) => i.label)).toEqual(['线性规划的建模与转化能力']);
    expect(mem?.items[0].prompt).toBe('围绕「线性规划的建模与转化能力」，我现在该学什么？');
  });
});
