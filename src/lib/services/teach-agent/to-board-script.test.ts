import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { collectImageJobs, messagesToBoardScript } from './to-board-script';
import type { NarrationSegment, CheckpointSegment } from '@/lib/ai-native/plugins/board-script';

/** 构造 assistant 消息（text / tool-call part 按序） */
function assistant(
  ...parts: ({ text: string } | { toolName: string; input?: Record<string, unknown>; id?: string })[]
): ModelMessage {
  return {
    role: 'assistant',
    content: parts.map((part, index) =>
      'text' in part
        ? { type: 'text' as const, text: part.text }
        : {
            type: 'tool-call' as const,
            toolCallId: part.id ?? `call_${index}`,
            toolName: part.toolName,
            input: part.input ?? {},
          },
    ),
  } as ModelMessage;
}

describe('messagesToBoardScript', () => {
  it('文本 run → 段；段后动作锚到讲稿末尾（说完就写）', () => {
    const messages = [
      assistant(
        { text: '今天我们讲配方法。' },
        { toolName: 'write', input: { text: '配方法', role: 'title' } },
        { text: '先看这个方程。' },
        { toolName: 'write', input: { text: 'x² + 6x = 0', role: 'step' } },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: '配方法' });
    expect(script.pages).toHaveLength(1);
    const [seg1, seg2] = script.pages[0].segments as NarrationSegment[];
    expect(seg1.narrationDisplay).toBe('今天我们讲配方法。');
    expect(seg1.actions).toEqual([{ type: 'write', text: '配方法', role: 'title' }]);
    // 锚在讲稿末尾
    expect(seg1.cues).toEqual([{ charIndex: seg1.narrationDisplay!.length, actionIndex: 0 }]);
    expect(seg2.narrationDisplay).toBe('先看这个方程。');
    expect(seg2.actions[0]).toMatchObject({ type: 'write', text: 'x² + 6x = 0' });
  });

  it('页首先写后开口：孤儿动作锚到段首 charIndex 0', () => {
    const messages = [
      assistant(
        { toolName: 'write', input: { text: '判别式', role: 'title' } },
        { text: '这节课我们解决一个问题。' },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: '判别式' });
    const seg = script.pages[0].segments[0] as NarrationSegment;
    expect(seg.actions[0]).toMatchObject({ type: 'write', text: '判别式' });
    expect(seg.cues).toEqual([{ charIndex: 0, actionIndex: 0 }]);
  });

  it('相邻纯口述合并为一段', () => {
    const messages = [assistant({ text: '第一句。' }, { text: '第二句。' })];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    expect(script.pages[0].segments).toHaveLength(1);
    expect((script.pages[0].segments[0] as NarrationSegment).narrationDisplay).toBe('第一句。 第二句。');
  });

  it('flip_page 开新页；空页不产生', () => {
    const messages = [
      assistant(
        { text: '第一页。' },
        { toolName: 'flip_page' },
        { toolName: 'flip_page' },
        { text: '第二页。' },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    expect(script.pages).toHaveLength(2);
  });

  it('v31：new_column 映射为分栏标记动作（不占 wN，消毒后保留）', () => {
    const messages = [
      assistant(
        { text: '左栏写满，换右栏。' },
        { toolName: 'write', input: { text: '左栏要点', role: 'step' } },
        { toolName: 'new_column' },
        { toolName: 'write', input: { text: '右栏要点', role: 'step' } },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    const seg = script.pages[0].segments[0] as NarrationSegment;
    expect(seg.actions.map((a) => a.type)).toEqual(['write', 'new_column', 'write']);
  });

  it('v31：formula role 的 write 原样保留 LaTeX 文本', () => {
    const messages = [
      assistant(
        { text: '看求根公式。' },
        { toolName: 'write', input: { text: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', role: 'formula' } },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    const seg = script.pages[0].segments[0] as NarrationSegment;
    expect(seg.actions[0]).toMatchObject({ type: 'write', role: 'formula' });
  });

  it('ask：紧前纯口述段提升为提问口述，不重复朗读', () => {
    const messages = [
      assistant(
        { text: '现在换你试试这道题。' },
        {
          toolName: 'ask',
          input: {
            question: 'x² + 6x + 5 = 0',
            role: 'step',
            hints: ['试着配方', '左边凑完全平方', '(x+3)² = 4'],
            answer: '配方得 (x+3)² = 4，解得 x = -1 或 -5。',
            demoActions: [{ type: 'write', text: '(x+3)² = 4', role: 'step' }],
          },
        },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    const segments = script.pages[0].segments;
    expect(segments).toHaveLength(1);
    const checkpoint = segments[0] as CheckpointSegment;
    expect(checkpoint.type).toBe('checkpoint');
    expect(checkpoint.narration).toBe('现在换你试试这道题。');
    expect(checkpoint.question.text).toBe('x² + 6x + 5 = 0');
    expect(checkpoint.hints).toHaveLength(3);
  });

  it('image 工具按 toolCallId 回填 url；未回填保留空 url + prompt', () => {
    const messages = [
      assistant(
        { text: '看这条抛物线。' },
        { toolName: 'image', input: { prompt: '手绘风抛物线 y=x²', caption: '图1' }, id: 'img_1' },
      ),
    ];
    const withImage = messagesToBoardScript(messages, {
      title: 't',
      images: { img_1: '/demo/img/parabola.png' },
    });
    const action = (withImage.script.pages[0].segments[0] as NarrationSegment).actions[0];
    expect(action).toMatchObject({ type: 'image', url: '/demo/img/parabola.png', caption: '图1' });

    const without = messagesToBoardScript(messages, { title: 't' });
    expect((without.script.pages[0].segments[0] as NarrationSegment).actions[0]).toMatchObject({
      type: 'image',
      url: '',
    });
  });

  it('连续同题 ask 去重：后者覆盖前者、保住提问口述', () => {
    const messages = [
      assistant(
        { text: '听题：x²−4x+k=0 有相等实根，求 k。' },
        {
          toolName: 'ask',
          input: { question: 'x²−4x+k=0 求 k', role: 'step', hints: ['', 'h2', 'h3'], answer: 'k=4', demoActions: [] },
        },
        {
          toolName: 'ask',
          input: { question: 'x²−4x+k=0 求 k', role: 'step', hints: ['h1', 'h2', 'h3'], answer: 'k=4', demoActions: [] },
        },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    const segments = script.pages[0].segments;
    expect(segments).toHaveLength(1);
    const checkpoint = segments[0] as CheckpointSegment;
    expect(checkpoint.narration).toBe('听题：x²−4x+k=0 有相等实根，求 k。');
    expect(checkpoint.hints[0]).toBe('h1'); // 后者（修正版）生效
  });

  it('单页段数超上限时 walker 机械自动翻页（不让 sanitize 静默丢段）', () => {
    // 文本间插 write 阻止相邻纯口述合并，造出 8 个独立段
    const parts = Array.from({ length: 8 }, (_, i) => [
      { text: `第${i + 1}句。` },
      { toolName: 'write', input: { text: `s${i + 1}`, role: 'step' } },
    ]).flat();
    const messages = [assistant(...(parts as Parameters<typeof assistant>))];
    const { script, stats } = messagesToBoardScript(messages, { title: 't' });
    expect(stats.autoFlips).toBe(1);
    expect(script.pages).toHaveLength(2);
    expect(script.pages[0].segments).toHaveLength(6);
    expect(script.pages[1].segments).toHaveLength(2);
  });

  it('flip_page 前给当页收尾：末段有动作时补 1200ms 停顿（成品页停留一拍）', () => {
    const messages = [
      assistant(
        { text: '第一页讲完。' },
        { toolName: 'write', input: { text: '结论', role: 'term' } },
        { toolName: 'flip_page' },
        { text: '第二页。' },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    const seg = script.pages[0].segments[0] as NarrationSegment;
    expect(seg.actions.map((a) => a.type)).toEqual(['write', 'pause']);
    expect((seg.actions[1] as { ms: number }).ms).toBe(1200);
    // 末段无动作（纯口述）不补
    const messages2 = [
      assistant({ text: '纯口述。' }, { toolName: 'flip_page' }, { text: '下一页。' }),
    ];
    const { script: script2 } = messagesToBoardScript(messages2, { title: 't' });
    expect((script2.pages[0].segments[0] as NarrationSegment).actions).toHaveLength(0);
  });

  it('finish 终止；其后的内容不进脚本', () => {
    const messages = [
      assistant(
        { text: '前面。' },
        { toolName: 'finish', input: { summary: '完了' } },
        { text: '不该出现。' },
      ),
    ];
    const { script } = messagesToBoardScript(messages, { title: 't' });
    expect(script.pages[0].segments).toHaveLength(1);
  });

  it('wN 越界的标注被 sanitize 丢弃并计数', () => {
    const messages = [
      assistant(
        { text: '圈一下。' },
        { toolName: 'circle', input: { target: 'w9' } },
      ),
    ];
    const { script, stats } = messagesToBoardScript(messages, { title: 't' });
    const seg = script.pages[0].segments[0] as NarrationSegment;
    expect(seg.actions).toHaveLength(0);
    expect(stats.droppedActions).toBe(0); // sanitize 丢弃，不算 walker 丢弃
  });
});

describe('collectImageJobs', () => {
  it('按序收集 image 调用的 toolCallId + prompt', () => {
    const messages = [
      assistant(
        { toolName: 'image', input: { prompt: '图A' }, id: 'a' },
        { text: '说话' },
        { toolName: 'image', input: { prompt: '图B' }, id: 'b' },
      ),
    ];
    expect(collectImageJobs(messages)).toEqual([
      { toolCallId: 'a', prompt: '图A' },
      { toolCallId: 'b', prompt: '图B' },
    ]);
  });
});
