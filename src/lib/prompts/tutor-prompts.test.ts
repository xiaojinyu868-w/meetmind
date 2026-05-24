/**
 * buildTutorSystemPrompt — 行为测试
 *
 * 这个 prompt builder 是三个 AI 对话入口（课堂同桌 / 录音复习 / 视频复习）的唯一来源。
 * 这些测试把"课中 vs 课后的故意差别"冻结成契约——任何改动都要显式通过。
 */

import { describe, it, expect } from 'vitest';
import {
  buildTutorSystemPrompt,
  type TutorMode,
  type TutorSystemContext,
  type TutorSystemOptions,
} from './tutor-prompts';

describe('buildTutorSystemPrompt — mode 决定基础骨架', () => {
  it('in-class：提到"一两句话"和"跟上"，没有复习态的长回答许可', () => {
    const prompt = buildTutorSystemPrompt('in-class');
    expect(prompt).toMatch(/一两句话/);
    expect(prompt).toMatch(/跟上/);
    // 确保不会错误地提示复习态行为
    expect(prompt).not.toMatch(/把整节课拎回来问/);
  });

  it('review：提到"把整节课拎回来问"和"复习"，允许结构化长答', () => {
    const prompt = buildTutorSystemPrompt('review');
    expect(prompt).toMatch(/复习/);
    expect(prompt).toMatch(/把整节课拎回来问/);
    expect(prompt).not.toMatch(/一两句话讲完/);
  });

  it('两种 mode 都注入同一份身份基底（TUTOR_IDENTITY_BASE）', () => {
    const inClass = buildTutorSystemPrompt('in-class');
    const review = buildTutorSystemPrompt('review');
    expect(inClass).toMatch(/你是这个学生的同桌/);
    expect(review).toMatch(/你是这个学生的同桌/);
  });

  it('两种 mode 都把意图理解交给模型智能，而不是写成硬判断或主动推下一步', () => {
    const inClass = buildTutorSystemPrompt('in-class');
    const review = buildTutorSystemPrompt('review');
    expect(inClass).toMatch(/把判断交给模型/);
    expect(review).toMatch(/模型基于上下文理解/);
    expect(inClass).not.toMatch(/只有当.*明确|下一步动作/);
    expect(review).not.toMatch(/只有当.*明确|下一步动作|轻轻带一个下一步|马上能做/);
  });
});

describe('buildTutorSystemPrompt — recentFocus 仅在 in-class 注入', () => {
  const context: TutorSystemContext = {
    recentFocus: '老师讲到了 derivative 的链式法则',
  };

  it('in-class 场景：recentFocus 被拼进 prompt', () => {
    const prompt = buildTutorSystemPrompt('in-class', context);
    expect(prompt).toMatch(/刚才这 30s 老师讲到/);
    expect(prompt).toMatch(/derivative 的链式法则/);
    expect(prompt).toMatch(/他用代词问东西时/);
  });

  it('review 场景：recentFocus 被忽略（防止污染复习态）', () => {
    const prompt = buildTutorSystemPrompt('review', context);
    expect(prompt).not.toMatch(/刚才这 30s 老师讲到/);
    expect(prompt).not.toMatch(/derivative 的链式法则/);
  });

  it('空 recentFocus 不拼空段', () => {
    const prompt = buildTutorSystemPrompt('in-class', { recentFocus: '   ' });
    expect(prompt).not.toMatch(/刚才这 30s 老师讲到/);
  });
});

describe('buildTutorSystemPrompt — fullTranscript 仅在 review 注入', () => {
  const transcript = '老师 0:00-3:00 讲了牛顿定律。3:00-5:00 推了 F=ma。';

  it('review 场景：fullTranscript 被拼进 prompt', () => {
    const prompt = buildTutorSystemPrompt('review', { fullTranscript: transcript });
    expect(prompt).toMatch(/整节课的转录/);
    expect(prompt).toMatch(/牛顿定律/);
  });

  it('review + currentTimestampSec：附上"当前播放位置"锚点', () => {
    const prompt = buildTutorSystemPrompt('review', {
      fullTranscript: transcript,
      currentTimestampSec: 123,
    });
    expect(prompt).toMatch(/02:03/);
    expect(prompt).toMatch(/他现在播放到/);
  });

  it('review 但 currentTimestampSec=0：不显示锚点行', () => {
    const prompt = buildTutorSystemPrompt('review', {
      fullTranscript: transcript,
      currentTimestampSec: 0,
    });
    expect(prompt).not.toMatch(/他现在播放到/);
  });

  it('in-class 场景：fullTranscript 被忽略（避免把整节课塞给课堂同桌）', () => {
    const prompt = buildTutorSystemPrompt('in-class', { fullTranscript: transcript });
    expect(prompt).not.toMatch(/整节课的转录/);
  });
});

describe('buildTutorSystemPrompt — supportMaterials 两 mode 共用', () => {
  const materials = [
    { title: 'intro.md', content: '这是一份预习材料。' },
    { title: 'formula.md', content: 'F = ma' },
  ];

  it('in-class：材料被拼，带 [资料N] 编号约束', () => {
    const prompt = buildTutorSystemPrompt('in-class', { supportMaterials: materials });
    expect(prompt).toMatch(/课前预习材料/);
    expect(prompt).toMatch(/\[资料1\] intro\.md/);
    expect(prompt).toMatch(/\[资料2\] formula\.md/);
    expect(prompt).toMatch(/不要自己造编号/);
  });

  it('review：同样拼', () => {
    const prompt = buildTutorSystemPrompt('review', { supportMaterials: materials });
    expect(prompt).toMatch(/课前预习材料/);
  });

  it('空数组不拼段', () => {
    const prompt = buildTutorSystemPrompt('in-class', { supportMaterials: [] });
    expect(prompt).not.toMatch(/课前预习材料/);
  });
});

describe('buildTutorSystemPrompt — returnTimestamps 开关', () => {
  it('review mode 默认开启时间戳指令', () => {
    const prompt = buildTutorSystemPrompt('review');
    expect(prompt).toMatch(/引用课堂原话时在方括号里写时间/);
    expect(prompt).toMatch(/\[MM:SS\]/);
  });

  it('in-class mode 默认关闭时间戳指令', () => {
    const prompt = buildTutorSystemPrompt('in-class');
    expect(prompt).not.toMatch(/引用课堂原话时在方括号里写时间/);
  });

  it('review mode 可以手动关闭', () => {
    const prompt = buildTutorSystemPrompt('review', {}, { returnTimestamps: false });
    expect(prompt).not.toMatch(/引用课堂原话时在方括号里写时间/);
  });

  it('in-class mode 理论上也可以手动开（虽然默认不开）', () => {
    const prompt = buildTutorSystemPrompt('in-class', {}, { returnTimestamps: true });
    expect(prompt).toMatch(/引用课堂原话时在方括号里写时间/);
  });
});

describe('buildTutorSystemPrompt — allowInlineApp 开关（open_app marker 合约）', () => {
  it('in-class 默认只开放课中适合的产物，不把课后报告/闪卡/测验推到课中', () => {
    const inClass = buildTutorSystemPrompt('in-class');
    expect(inClass).toMatch(/<open_app:KEY\/>/);
    expect(inClass).not.toMatch(/flashcards|quiz|study-report|闪卡|测验|学习报告/);
    expect(inClass).toMatch(/mindmap.*cheatsheet/s);
  });

  it('review 默认保留闪卡和测验等课后复习产物', () => {
    const review = buildTutorSystemPrompt('review');
    expect(review).toMatch(/<open_app:KEY\/>/);
    expect(review).toMatch(/flashcards.*quiz.*mindmap.*cheatsheet.*study-report/s);
    expect(review).toMatch(/闪卡/);
    expect(review).toMatch(/测验/);
  });

  it('手动关闭后 marker 合约消失', () => {
    const prompt = buildTutorSystemPrompt('review', {}, { allowInlineApp: false });
    expect(prompt).not.toMatch(/<open_app:KEY\/>/);
    expect(prompt).not.toMatch(/产物合约/);
  });
});

describe('buildTutorSystemPrompt — thinkingGuide 开关', () => {
  it('review mode + thinkingGuide=true：拼思维引导段，含 ---思维演示--- 标记', () => {
    const prompt = buildTutorSystemPrompt('review', {}, { thinkingGuide: true });
    expect(prompt).toMatch(/---思维演示---/);
    expect(prompt).toMatch(/---正式回答---/);
    expect(prompt).toMatch(/💡/);
    expect(prompt).toMatch(/🌟/);
    expect(prompt).toMatch(/学霸思维引导/);
  });

  it('review mode 默认不拼思维引导', () => {
    const prompt = buildTutorSystemPrompt('review');
    expect(prompt).not.toMatch(/---思维演示---/);
  });

  it('in-class mode + thinkingGuide=true：仍然不拼（课中禁用长回答）', () => {
    const prompt = buildTutorSystemPrompt('in-class', {}, { thinkingGuide: true });
    expect(prompt).not.toMatch(/---思维演示---/);
  });
});

describe('buildTutorSystemPrompt — learnerProfile 注入', () => {
  it('有 profile：拼"这个学生"段', () => {
    const prompt = buildTutorSystemPrompt('review', {
      learnerProfile: '- 高三学生\n- 物理基础薄弱',
    });
    expect(prompt).toMatch(/【这个学生】/);
    expect(prompt).toMatch(/高三学生/);
  });

  it('空 profile 不拼段', () => {
    const prompt = buildTutorSystemPrompt('review', { learnerProfile: '' });
    expect(prompt).not.toMatch(/【这个学生】/);
  });
});

describe('buildTutorSystemPrompt — 组合场景', () => {
  it('课堂同桌全配：mode + recentFocus + materials + allowInlineApp（默认）', () => {
    const prompt = buildTutorSystemPrompt(
      'in-class',
      {
        recentFocus: '导数链式法则',
        supportMaterials: [{ title: 'ch3.md', content: 'prereq...' }],
      },
    );
    expect(prompt).toMatch(/一两句话/);           // in-class mode
    expect(prompt).toMatch(/刚才这 30s/);         // recentFocus
    expect(prompt).toMatch(/\[资料1\]/);          // materials
    expect(prompt).toMatch(/<open_app:KEY\/>/);   // marker 默认开
    expect(prompt).not.toMatch(/\[MM:SS\]/);      // in-class 默认不带时间戳
  });

  it('复习态全配：mode + fullTranscript + timestamps + thinkingGuide', () => {
    const prompt = buildTutorSystemPrompt(
      'review',
      {
        fullTranscript: '0:00 引言...5:00 定理证明...',
        currentTimestampSec: 300,
      },
      { thinkingGuide: true, returnTimestamps: true, allowInlineApp: true },
    );
    expect(prompt).toMatch(/整节课的转录/);
    expect(prompt).toMatch(/05:00/);
    expect(prompt).toMatch(/\[MM:SS\]/);
    expect(prompt).toMatch(/---思维演示---/);
    expect(prompt).toMatch(/<open_app:KEY\/>/);
  });

  it('最小参数 in-class：什么都不给', () => {
    const prompt = buildTutorSystemPrompt('in-class');
    expect(prompt).toMatch(/你是这个学生的同桌/);
    expect(prompt).toMatch(/此刻他还在课上/);
    // 什么 context 都没有时 prompt 仍然是完整的
    expect(prompt.length).toBeGreaterThan(200);
  });
});

describe('buildTutorSystemPrompt — 回归：所有必选参数组合都产生非空字符串', () => {
  const modes: TutorMode[] = ['in-class', 'review'];
  const optionCombos: TutorSystemOptions[] = [
    {},
    { thinkingGuide: true },
    { returnTimestamps: true },
    { returnTimestamps: false },
    { allowInlineApp: false },
    { thinkingGuide: true, returnTimestamps: true, allowInlineApp: true },
  ];

  for (const mode of modes) {
    for (const options of optionCombos) {
      it(`${mode} + ${JSON.stringify(options)} → 非空 prompt`, () => {
        const prompt = buildTutorSystemPrompt(mode, {}, options);
        expect(prompt.length).toBeGreaterThan(100);
        expect(prompt.trim()).not.toBe('');
      });
    }
  }
});
