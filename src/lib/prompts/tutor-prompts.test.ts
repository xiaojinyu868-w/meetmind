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
  it('in-class：要求简洁但完整并帮助跟上，没有复习态的长回答许可', () => {
    const prompt = buildTutorSystemPrompt('in-class');
    expect(prompt).toMatch(/简洁但完整/);
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

  it('身份基底保持场景中立，不把 goal/shared/word 误写成刚上完课', () => {
    for (const mode of ['goal', 'shared', 'word', 'global'] as const) {
      const prompt = buildTutorSystemPrompt(mode);
      expect(prompt).not.toMatch(/刚上完一节课/);
      expect(prompt).toMatch(/正在学、正在想的东西/);
    }
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

describe('buildTutorSystemPrompt — global Ask 与深度学习', () => {
  it('普通全局提问直接回答，不自动沉淀记忆', () => {
    const prompt = buildTutorSystemPrompt('global', { global: { depth: 'quick' } });
    expect(prompt).toMatch(/全局 Ask MeetMind/);
    expect(prompt).toMatch(/先直接回答/);
    expect(prompt).toMatch(/不要输出“学习进展” marker/);
  });

  it('深度学习使用已确认意图，并输出待用户确认的进展块', () => {
    const prompt = buildTutorSystemPrompt('global', {
      global: {
        depth: 'deep',
        intent: {
          title: '真正理解反向传播',
          outcome: '能自己推导一次参数更新',
          checkpoints: ['说清梯度从哪里来'],
        },
        memories: [{ title: '更喜欢用图理解', kind: 'preference' }],
        recentActivities: [{ title: '刚完成神经网络闪卡' }],
      },
    });
    expect(prompt).toMatch(/已经确认要进入一次深度学习会话/);
    expect(prompt).toMatch(/真正理解反向传播/);
    expect(prompt).toMatch(/更喜欢用图理解/);
    expect(prompt).toMatch(/刚完成神经网络闪卡/);
    expect(prompt).toMatch(/---学习进展---/);
    expect(prompt).toMatch(/没有被确认的内容不能当成长久记忆/);
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

describe('buildTutorSystemPrompt — fullTranscript 在 in-class 和 review 注入', () => {
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

  it('in-class 场景：fullTranscript 被拼进 prompt，帮助同桌理解课堂上下文', () => {
    const prompt = buildTutorSystemPrompt('in-class', { fullTranscript: transcript });
    expect(prompt).toMatch(/整节课的转录/);
    expect(prompt).toMatch(/牛顿定律/);
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
  // 注意：匹配 "时间戳" 标题 + [MM:SS] 真渲染契约——不绑死具体措辞，
  // 这样 prompt 文风调整（比如让 step-3.7-flash 等高速模型更稳遵循）时测试不会脆崩。
  it('review mode 默认开启时间戳指令', () => {
    const prompt = buildTutorSystemPrompt('review');
    expect(prompt).toMatch(/【时间戳/);
    expect(prompt).toMatch(/\[MM:SS\]/);
  });

  it('in-class mode 默认关闭时间戳指令', () => {
    const prompt = buildTutorSystemPrompt('in-class');
    expect(prompt).not.toMatch(/【时间戳/);
  });

  it('review mode 可以手动关闭', () => {
    const prompt = buildTutorSystemPrompt('review', {}, { returnTimestamps: false });
    expect(prompt).not.toMatch(/【时间戳/);
  });

  it('in-class mode 即使手动传 true 也强制关闭', () => {
    const prompt = buildTutorSystemPrompt('in-class', {}, { returnTimestamps: true });
    expect(prompt).not.toMatch(/【时间戳/);
  });
});

describe('buildTutorSystemPrompt — thinkingGuide 开关', () => {
  it('review mode + thinkingGuide=true：拼思维引导段，含 ---思维演示--- 标记', () => {
    const prompt = buildTutorSystemPrompt('review', {}, { thinkingGuide: true });
    expect(prompt).toMatch(/---思维演示---/);
    expect(prompt).toMatch(/---正式回答---/);
    expect(prompt).toMatch(/💡/);
    expect(prompt).toMatch(/🌟/);
    // 用更柔的 anchor 匹配"思维引导"段——文风可以演化，分段标记是渲染契约不能动
    expect(prompt).toMatch(/推理过程|思维演示|思考过程/);
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

describe('buildTutorSystemPrompt — goal 模式沉淀边界', () => {
  it('首次会面在身份已知后转向最近状态，而不是继续盘问资料字段', () => {
    const prompt = buildTutorSystemPrompt('goal');
    expect(prompt).toMatch(/身份或阶段一旦已经清楚/);
    expect(prompt).toMatch(/不要继续盘问专业、学校、年级/);
    expect(prompt).toMatch(/我是大三学生/);
    expect(prompt).toMatch(/而不是追问“什么专业”/);
    expect(prompt).toMatch(/最近的状态/);
  });

  it('回访确认具体愿望时优先输出我想要的 marker', () => {
    const prompt = buildTutorSystemPrompt('goal', {
      goal: {
        existingBio: { headline: '工作三年的产品经理' },
      },
    });
    expect(prompt).toMatch(/“对，就这样”“帮我记下”/);
    expect(prompt).toMatch(/直接沉淀为 `---我想要的---`/);
    expect(prompt).toMatch(/“我想要的”优先级最高/);
    expect(prompt).toMatch(/用用户的第一人称表达/);
  });
});

describe('buildTutorSystemPrompt — 组合场景', () => {
  it('课堂同桌全配：mode + recentFocus + materials', () => {
    const prompt = buildTutorSystemPrompt(
      'in-class',
      {
        recentFocus: '导数链式法则',
        supportMaterials: [{ title: 'ch3.md', content: 'prereq...' }],
      },
    );
    expect(prompt).toMatch(/简洁但完整/);         // in-class mode
    expect(prompt).toMatch(/刚才这 30s/);         // recentFocus
    expect(prompt).toMatch(/\[资料1\]/);          // materials
    expect(prompt).not.toMatch(/\[MM:SS\]/);      // in-class 默认不带时间戳
  });

  it('复习态全配：mode + fullTranscript + timestamps + thinkingGuide', () => {
    const prompt = buildTutorSystemPrompt(
      'review',
      {
        fullTranscript: '0:00 引言...5:00 定理证明...',
        currentTimestampSec: 300,
      },
      { thinkingGuide: true, returnTimestamps: true },
    );
    expect(prompt).toMatch(/整节课的转录/);
    expect(prompt).toMatch(/05:00/);
    expect(prompt).toMatch(/\[MM:SS\]/);
    expect(prompt).toMatch(/---思维演示---/);
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
    { thinkingGuide: true, returnTimestamps: true },
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

// ──────────────────────────────────────────────────────────────
// v3.0 SharedAgent — mode='shared' 隐私铁律 + 行为冻结
//
// 这一组测试把分享态的隐私边界冻结成契约：
//   - 不注入 learnerProfile（访问者画像不能灌给"分享者刻下的同学"）
//   - 不暴露 inline app marker（场景层产物不能在分享态二次生成）
//   - 不读 fullTranscript / recentFocus（这些只属于 review / in-class）
//   - 必须把 sharerNickname + courseTitle 拼进 system prompt
//   - 必须把 transcriptDigest / artifactDescription / extraContext 注入
// ──────────────────────────────────────────────────────────────

describe('buildTutorSystemPrompt — shared 模式（v3.0）', () => {
  const sharedContext: TutorSystemContext = {
    shared: {
      sharerNickname: 'Alice',
      courseTitle: '决策树原理',
      transcriptDigest: '[00:01] 老师：决策树用基尼系数选切分点',
      artifactDescription: '一张考试速查表',
      extraContext: '这是 ML 课的第三章',
    },
  };

  it('身份段把分享者昵称和课程标题拼进来', () => {
    const prompt = buildTutorSystemPrompt('shared', sharedContext);
    expect(prompt).toMatch(/Alice/);
    expect(prompt).toMatch(/决策树原理/);
    expect(prompt).toMatch(/留下的那位同学/);
  });

  it('注入 transcriptDigest / artifactDescription / extraContext', () => {
    const prompt = buildTutorSystemPrompt('shared', sharedContext);
    expect(prompt).toMatch(/基尼系数/);
    expect(prompt).toMatch(/一张考试速查表/);
    expect(prompt).toMatch(/ML 课的第三章/);
  });

  it('隐私铁律：即使传了 learnerProfile 也绝不注入分享态 prompt', () => {
    const prompt = buildTutorSystemPrompt('shared', {
      ...sharedContext,
      learnerProfile: '【这个学生】研一 NLP 方向 · 导师 Alice',
    });
    expect(prompt).not.toMatch(/研一 NLP/);
    expect(prompt).not.toMatch(/【这个学生】/);
  });

  it('隐私铁律：分享态不读 fullTranscript / recentFocus', () => {
    const prompt = buildTutorSystemPrompt('shared', {
      ...sharedContext,
      fullTranscript: '老师：这是一段不该被注入分享态的复习态转录',
      recentFocus: '老师：这是一段不该被注入分享态的课中 30s 焦点',
    });
    expect(prompt).not.toMatch(/不该被注入分享态/);
  });

  it('默认禁用 inline app marker（分享态不让访问者持续生成产物）', () => {
    const prompt = buildTutorSystemPrompt('shared', sharedContext);
    expect(prompt).not.toMatch(/<open_app:/);
    expect(prompt).not.toMatch(/产物合约/);
  });

  it('默认禁用时间戳合约——访客没有原录音，[MM:SS] 点了死链', () => {
    const prompt = buildTutorSystemPrompt('shared', sharedContext);
    // 不应包含「【时间戳」段（capTimestampsInstruction 的标签）
    expect(prompt).not.toMatch(/【时间戳/);
    // capSharedContext 会显式告诉模型不要返回时间戳
    expect(prompt).toMatch(/不要写 \[MM:SS\] 时间戳/);
  });

  it('分享态即使显式传 returnTimestamps:true 也强制关闭', () => {
    const prompt = buildTutorSystemPrompt('shared', sharedContext, { returnTimestamps: true });
    expect(prompt).not.toMatch(/【时间戳/);
  });

  it('thinkingGuide 在分享态被忽略（仅 review 生效）', () => {
    const prompt = buildTutorSystemPrompt('shared', sharedContext, { thinkingGuide: true });
    expect(prompt).not.toMatch(/---思维演示---/);
  });

  it('沿用 TUTOR_IDENTITY_BASE 同桌身份', () => {
    const prompt = buildTutorSystemPrompt('shared', sharedContext);
    expect(prompt).toMatch(/你是这个学生的同桌/);
  });

  it('缺失 sharerNickname / courseTitle 时安全兜底', () => {
    const prompt = buildTutorSystemPrompt('shared', {
      shared: {
        sharerNickname: '',
        courseTitle: '',
        transcriptDigest: '',
      },
    });
    expect(prompt).toMatch(/一个同学/);
    expect(prompt).toMatch(/这节课/);
    expect(prompt.length).toBeGreaterThan(200);
  });
});

describe('buildTutorSystemPrompt — TutorMode 联合扩展（v3.0）', () => {
  it('类型上接受 in-class / review / shared 三种值（编译期检查 + 行为非空）', () => {
    const modes: TutorMode[] = ['in-class', 'review', 'shared'];
    for (const m of modes) {
      const ctx: TutorSystemContext = m === 'shared'
        ? { shared: { sharerNickname: 'A', courseTitle: 'B', transcriptDigest: '[00:00] x' } }
        : {};
      const prompt = buildTutorSystemPrompt(m, ctx);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });
});
