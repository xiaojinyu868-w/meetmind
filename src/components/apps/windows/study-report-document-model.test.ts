import { describe, expect, it } from 'vitest';
import { normalizeStudyReportDocument } from './study-report-document-model';

describe('normalizeStudyReportDocument', () => {
  it('keeps the report readable by separating the lead topic from supporting topics', () => {
    const document = normalizeStudyReportDocument({
      title: '听力技巧复盘',
      letterToParent: '这节课围绕搬家咨询场景，练习听懂地点、时间和人物需求。',
      topics: [
        { name: '场景词汇', difficulty: '基础', gist: '理解 relocating 和 getting organised 等表达。' },
        { name: '习语辨析', difficulty: '进阶', gist: '理解 up in the air 表示事情未定。' },
        { name: '信息捕捉', difficulty: '基础', gist: '听出 Jane Bond 等具体事实。' },
      ],
      chatTopics: ['今天听力里那位女士要搬去哪里？'],
      nextSteps: ['做一次随堂检验。'],
    });

    expect(document.title).toBe('听力技巧复盘');
    expect(document.leadTopic?.name).toBe('场景词汇');
    expect(document.supportingTopics.map((topic) => topic.name)).toEqual(['习语辨析', '信息捕捉']);
    expect(document.sections).toEqual([
      { title: '可以这样聊', items: ['今天听力里那位女士要搬去哪里？'] },
      { title: '下一步', items: ['做一次随堂检验。'] },
    ]);
  });

  it('keeps sentence-like English topic names compact for narrow inline report cards', () => {
    const document = normalizeStudyReportDocument({
      topics: [
        { name: 'Listen carefully and answer questions one to six.', difficulty: '基础', gist: '听懂题目要求。' },
        { name: "Well, I hope you can help me. I'm so up in the air right now.", difficulty: '进阶', gist: '理解说话人表达焦虑。' },
      ],
    });

    expect(document.leadTopic?.name).toBe('Listen carefully…');
    expect(document.supportingTopics[0]?.name).toBe('Well, I…');
  });

  it('falls back to quiet empty copy instead of rendering dense blank cards', () => {
    const document = normalizeStudyReportDocument({});

    expect(document.title).toBe('这节课的学习报告');
    expect(document.leadTopic).toBeNull();
    expect(document.supportingTopics).toEqual([]);
    expect(document.sections).toEqual([]);
    expect(document.letterToParent).toBe('这节课的结构还在整理中。');
  });
});
