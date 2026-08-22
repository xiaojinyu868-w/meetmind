import { describe, expect, it } from 'vitest';
import type { BoardPage } from '@/lib/ai-native/plugins/board-script';
import {
  buildPageTimeline,
  buildWritePace,
  charPaceMs,
  estimateWriteMs,
  paceScaleFor,
  tokenizeBoardText,
  windowSubtitle,
  CHAR_PACE,
  PACE_SCALE_LIMIT,
  estimateNarrationMs,
  hashSeed,
  isAsciiBoardPunct,
  isLatinBoardChar,
  shouldDeferForInk,
  MAX_INK_HOLD_MS,
  MS_PER_CHAR,
  MIN_ACTION_SLOT_MS,
  MIN_SEGMENT_MS,
} from './board-model';
import {
  estimateTextWidth,
  layoutBoardPage,
  layoutWithExtras,
  resolveTargetRect,
  wrapText,
  writeTipPosition,
  ROLE_FONT_RATIO,
  MIN_FONT_RATIO,
} from './board-layout';

const W = 960;
const H = 540; // 16:9

describe('buildPageTimeline', () => {
  const page: BoardPage = {
    segments: [
      {
        narration: '好，我们来看这个概念。', // 11 字 → 3080ms
        actions: [
          { type: 'write', text: '边际成本', role: 'term' },
          { type: 'pause', ms: 800 },
          { type: 'circle', target: 'w1' },
        ],
      },
      {
        narration: '短句',
        actions: [{ type: 'mark', mark: 'check', target: 'w1' }],
      },
    ],
  };

  it('segment 时长按 narration 字数 × 280ms 估算，短句有下限', () => {
    expect(estimateNarrationMs('好，我们来看这个概念。')).toBe(11 * MS_PER_CHAR);
    expect(estimateNarrationMs('短句')).toBe(MIN_SEGMENT_MS);
  });

  it('v15：全部动作锚定讲稿字位（cueCharIndex），pause 也占均分位', () => {
    const timeline = buildPageTimeline(page);
    const [first] = timeline.segments;
    const [write, pause, circle] = first.actions;
    // 所有动作都带字位锚（含无 LLM cue 的）；pause 保留自身时长
    expect(write.cueCharIndex).toBeGreaterThanOrEqual(0);
    expect(pause.cueCharIndex).toBeGreaterThanOrEqual(0);
    expect(circle.cueCharIndex).toBeGreaterThanOrEqual(0);
    expect(pause.durationMs).toBe(800);
    // 字位都在讲稿范围内（11 字）
    for (const timed of first.actions) {
      expect(timed.cueCharIndex!).toBeLessThanOrEqual(11);
    }
    expect(first.endMs).toBe(first.startMs + 11 * MS_PER_CHAR);
  });

  it('segment 顺序首尾相接，时间轴单调递增，totalMs 为末段结束', () => {
    const timeline = buildPageTimeline(page);
    expect(timeline.segments[1].startMs).toBe(timeline.segments[0].endMs);
    expect(timeline.totalMs).toBe(timeline.segments[1].endMs);
    for (const segment of timeline.segments) {
      for (const timed of segment.actions) {
        expect(timed.startMs).toBeGreaterThanOrEqual(segment.startMs);
        expect(timed.startMs).toBeLessThanOrEqual(segment.endMs);
      }
    }
  });

  it('空 actions 的 segment 也有朗读时长', () => {
    const timeline = buildPageTimeline({
      segments: [{ narration: '这一段只有讲，没有写。', actions: [] }],
    });
    expect(timeline.segments[0].endMs).toBeGreaterThanOrEqual(MIN_SEGMENT_MS);
  });
});

describe('layoutBoardPage：字号分级与流式排版', () => {
  const page: BoardPage = {
    segments: [
      {
        narration: 'x',
        actions: [
          { type: 'write', text: '这节课的课题', role: 'title' },
          { type: 'write', text: '核心概念', role: 'term' },
          { type: 'write', text: '第一步推导', role: 'step' },
          { type: 'write', text: '小字注释', role: 'note' },
        ],
      },
    ],
  };

  it('字号分级：title / term / step / note 按 ROLE_FONT_RATIO × scale（v25 起测试页会触发收缩或放大，断言换算后比例）', () => {
    const layout = layoutBoardPage(page, W, H);
    const [title, term, step, note] = layout.writes;
    expect(title.fontSize).toBeCloseTo(H * ROLE_FONT_RATIO.title * layout.scale, 1);
    expect(term.fontSize).toBeCloseTo(H * ROLE_FONT_RATIO.term * layout.scale, 1);
    expect(step.fontSize).toBeCloseTo(H * ROLE_FONT_RATIO.step * layout.scale, 1);
    expect(note.fontSize).toBeCloseTo(H * ROLE_FONT_RATIO.note * layout.scale, 1);
    expect(title.fontSize).toBeGreaterThan(term.fontSize);
    expect(term.fontSize).toBeGreaterThan(step.fontSize);
    expect(step.fontSize).toBeGreaterThan(note.fontSize);
  });

  it('wN 注册表按动作顺序编号', () => {
    const layout = layoutBoardPage(page, W, H);
    expect(layout.writes.map((write) => write.id)).toEqual(['w1', 'w2', 'w3', 'w4']);
  });

  it('title 顶部居中；step 缩进一档、note 缩进两档；从上到下流式排', () => {
    const layout = layoutBoardPage(page, W, H);
    const [title, term, step, note] = layout.writes;
    // title 居中
    expect(title.rect.x + title.rect.width / 2).toBeCloseTo(W / 2, 0);
    // 缩进：marginX=67.2，一档=38.4
    expect(term.rect.x).toBeCloseTo(W * 0.07, 1);
    expect(step.rect.x).toBeCloseTo(W * 0.07 + W * 0.04, 1);
    expect(note.rect.x).toBeCloseTo(W * 0.07 + W * 0.08, 1);
    // 流式：y 严格递增
    for (let i = 1; i < layout.writes.length; i += 1) {
      expect(layout.writes[i].rect.y).toBeGreaterThan(layout.writes[i - 1].rect.y);
    }
    expect(layout.overflow).toBe(false);
    // v25 起主字号上抬，本页轻微收缩（scale 略小于 1）也属正常——只约束不溢出
    expect(layout.scale).toBeGreaterThan(0.9);
    expect(layout.scale).toBeLessThanOrEqual(1);
  });

  it('超长 write 按板宽 86% 折行，仍是一个 target 整体', () => {
    const longText = '这是一句特别特别长的推导步骤需要折成多行才能放得下继续往下写还有很多内容';
    const layout = layoutBoardPage(
      { segments: [{ narration: 'x', actions: [{ type: 'write', text: longText, role: 'step' }] }] },
      W,
      H,
    );
    const [write] = layout.writes;
    expect(write.lines).toBeGreaterThan(1);
    expect(write.rect.width).toBeLessThanOrEqual(W * 0.86 - W * 0.04 + 1);
    expect(write.rect.height).toBeCloseTo(write.lines * write.fontSize * 1.4, 1);
    expect(write.id).toBe('w1');
  });

  it('wrapText 按宽度折行且不丢字', () => {
    const lines = wrapText('一二三四五六七八九十', 20, 100);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('一二三四五六七八九十');
    for (const line of lines) {
      expect(estimateTextWidth(line, 20)).toBeLessThanOrEqual(101);
    }
  });

  it('内容超过可用高度时按比例收缩字号，最小不低于板高 3.2%', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      type: 'write' as const,
      text: `第${i + 1}个关键概念要点`,
      role: 'term' as const,
    }));
    const layout = layoutBoardPage(
      { segments: [{ narration: 'x', actions: many }] },
      W,
      H,
    );
    expect(layout.scale).toBeLessThan(1);
    for (const write of layout.writes) {
      expect(write.fontSize).toBeGreaterThanOrEqual(H * MIN_FONT_RATIO - 0.01);
    }
  });

  it('装不下时标记 overflow: true', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      type: 'write' as const,
      text: `第${i + 1}个关键概念要点写满板面`,
      role: 'term' as const,
    }));
    const layout = layoutBoardPage(
      { segments: [{ narration: 'x', actions: many }] },
      W,
      H,
    );
    expect(layout.overflow).toBe(true);
  });

  it('v25 稀疏放大：内容装不满时放大字号撑满黑板（上限 1.5×，重折行后仍装得下）', () => {
    const page: BoardPage = {
      segments: [
        {
          type: 'narration',
          narration: 'x',
          actions: [
            { type: 'write', text: '供给', role: 'term' },
            { type: 'write', text: '需求', role: 'term' },
          ],
        },
      ],
    };
    const layout = layoutBoardPage(page, W, H);
    const usable = H * (1 - 0.1 - 0.1);
    expect(layout.scale).toBeGreaterThan(1.02);
    expect(layout.scale).toBeLessThanOrEqual(1.5);
    // 放大后仍不越界，且填充率显著提升（不再两三行小字浮空板）
    expect(layout.totalHeight).toBeLessThanOrEqual(usable + 1);
    expect(layout.totalHeight).toBeGreaterThan(usable * 0.4);
    // 字号随 scale 等比变大
    expect(layout.writes[0].fontSize).toBeGreaterThan(H * 0.08);
  });

  it('v10 防回归：追加 extras 若未触发收缩，页级 write 的 rect 不变', () => {
    const page: BoardPage = {
      segments: [
        {
          type: 'narration',
          narration: 'x',
          actions: [
            { type: 'write', text: '供给', role: 'term' },
            { type: 'write', text: '需求', role: 'term' },
          ],
        },
      ],
    };
    const base = layoutBoardPage(page, W, H);
    // v25 起宽松页面会稀疏放大（scale > 1），本测试的不变式是「extras 不回搬页级」
    const withExtras = layoutWithExtras(
      page,
      [{ text: '补一句注释', role: 'note' }],
      W,
      H,
    );
    expect(withExtras.scale).toBe(base.scale);
    // 页级 write 的 rect 逐个相等（标注跟随文字的前提是文字没动）
    for (let i = 0; i < base.writes.length; i += 1) {
      expect(withExtras.writes[i].rect).toEqual(base.writes[i].rect);
    }
    // extras 接在最后且 id 顺延
    expect(withExtras.writes[2].id).toBe('w3');
  });

  it('v11：extras 追加式布局——大量 extras 也不回搬任何已排内容（页级与既有 extras）', () => {
    const page: BoardPage = {
      segments: [
        {
          type: 'narration',
          narration: 'x',
          actions: [
            { type: 'write', text: '供给定律', role: 'term' },
            { type: 'write', text: '价格上升，供给增加', role: 'step' },
            { type: 'write', text: '需求不变为前提', role: 'note' },
          ],
        },
      ],
    };
    const extras3 = [
      { text: '问题：价格上升时供给量怎么变？', role: 'step' as const },
      { text: '提示一：看横轴', role: 'note' as const },
      { text: '提示二：看曲线方向', role: 'note' as const },
    ];
    const extras6 = [
      ...extras3,
      { text: '提示三：向右上倾斜', role: 'note' as const },
      { text: '示范：从点到线', role: 'step' as const },
      { text: '结论：正相关', role: 'note' as const },
    ];
    const layout3 = layoutWithExtras(page, extras3, W, H);
    const layout6 = layoutWithExtras(page, extras6, W, H);
    // extras 从 3 个增加到 6 个，前 3 个 extras 与全部页级 write 的 rect 逐像素不变
    expect(layout6.writes.length).toBe(9);
    for (let i = 0; i < layout3.writes.length; i += 1) {
      expect(layout6.writes[i].rect).toEqual(layout3.writes[i].rect);
    }
    // 所有 extras 都在板面内（左栏续排或右栏），且不越过上边距
    for (const write of layout6.writes.slice(3)) {
      expect(write.rect.y).toBeGreaterThanOrEqual(H * 0.1 - 1);
      expect(write.rect.x + write.rect.width).toBeLessThanOrEqual(W);
    }
  });

  it('v11：右栏 extras 避开伸进右半板的居中 title（不与页级内容重叠）', () => {
    const page: BoardPage = {
      segments: [
        {
          type: 'narration',
          narration: 'x',
          actions: [
            { type: 'write', text: '关键一：抓姓名', role: 'title' },
            { type: 'write', text: '名在前，姓在后', role: 'step' },
          ],
        },
      ],
    };
    // 足够多的 extras 迫使换到右栏
    const extras = Array.from({ length: 8 }, (_, i) => ({
      text: `补充内容 ${i + 1}：这是一段需要换行的说明文字`,
      role: 'note' as const,
    }));
    const layout = layoutWithExtras(page, extras, W, H);
    const title = layout.writes[0];
    const rightColX = W * 0.55;
    for (const write of layout.writes.slice(2)) {
      if (write.rect.x >= rightColX) {
        // 右栏 extras：顶边必须在 title 底部之下（允许 1px 误差）
        expect(write.rect.y).toBeGreaterThanOrEqual(title.rect.y + title.rect.height - 1);
      }
    }
  });

  it('v22：extras 换右栏避开越过中线的已排内容 + 按真实折行高度防溢出（同行相撞/压字幕回归）', () => {
    // 复刻 2026-08-19 实拍事故：页级长行越过中线，旧实现右栏起点只避页级
    // write（宽 extras 被右栏新内容撞车）且换栏只按单行高判定（多行溢出字幕区）
    const page: BoardPage = {
      segments: [
        {
          type: 'narration',
          narration: 'x',
          actions: [
            { type: 'write', text: '铁律1：边听边答', role: 'term' },
            { type: 'write', text: '铁律2：只听一遍', role: 'term' },
            { type: 'write', text: '对策：听前预读空格', role: 'step' },
            { type: 'write', text: '例：姓名空 → Jane Bond（已示范）', role: 'step' },
          ],
        },
      ],
    };
    const layout = layoutWithExtras(
      page,
      [
        { text: 'work phone number 一空：预读时要准备抓什么？', role: 'term' },
        { text: 'work phone → 数字串，即听即记', role: 'step' },
      ],
      W,
      H,
    );
    expect(layout.overflow).toBe(false);
    // 任意两个 write 不得矩形相交（1px 容差）——同行相撞的直接回归断言
    const intersects = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) =>
      a.x < b.x + b.width - 1 &&
      b.x < a.x + a.width - 1 &&
      a.y < b.y + b.height - 1 &&
      b.y < a.y + a.height - 1;
    for (let i = 0; i < layout.writes.length; i += 1) {
      for (let j = i + 1; j < layout.writes.length; j += 1) {
        expect(intersects(layout.writes[i].rect, layout.writes[j].rect)).toBe(false);
      }
    }
    // 字幕区（板面下 10%）不被任何 write 侵入
    for (const write of layout.writes) {
      expect(write.rect.y + write.rect.height).toBeLessThanOrEqual(H * 0.9 + 1);
    }
  });

  it('v24：超载页 extras 分区进右栏 + 双栏候选 + 字幕区红线/弃写（用户实拍"重叠压字幕"回归）', () => {
    // 复刻 2026-08-19 用户拍题实拍：7 个页级 write（含 3 个长英文 term）写满
    // 上半板，checkpoint 的长英文 question/hints/demo 作 extras 上板——旧实现
    // extras 在左栏缝隙 weave 且越界硬塞进字幕区（与字幕文字双影重叠）；
    // clamp 单栏兜底又把 demo 叠在 hint 上（兜底位叠影）
    const page: BoardPage = {
      segments: [
        {
          type: 'narration',
          narration: 'x',
          actions: [
            { type: 'write', text: "I'm so up in the air right now.", role: 'term' },
            { type: 'write', text: 'calm down = 冷静（接线员的反应）', role: 'note' },
            { type: 'write', text: 'moving → a little confused', role: 'note' },
            { type: 'write', text: 'relocate to = 迁居到（比 move 正式）', role: 'term' },
            { type: 'write', text: 'have a hard time getting organised', role: 'term' },
            { type: 'write', text: 'have a hard time (in) doing sth. = 做某事很费劲', role: 'note' },
            { type: 'write', text: "I'm so up in the air right now.", role: 'note' },
          ],
        },
      ],
    };
    const layout = layoutWithExtras(
      page,
      [
        { text: "I'm having a hard time finding a flat. 是什么意思？", role: 'step' },
        { text: '只换了 doing 后面的内容，句型纹丝不动', role: 'note' },
        { text: 'find 加 ing 就是 finding', role: 'note' },
        { text: "I'm having a hard time finding a flat.", role: 'step' },
        { text: '= 找房找得很费劲', role: 'note' },
      ],
      W,
      H,
    );
    // 分区：页级内容写满上半板 → 首个 extra（提问）进右栏
    expect(layout.writes[7].rect.x).toBe(W * 0.55);
    // 字幕区红线：任何 write 底边不越过字幕区上沿（1px 容差）
    for (const write of layout.writes) {
      expect(write.rect.y + write.rect.height).toBeLessThanOrEqual(H * 0.9 + 1);
    }
    // 任意两个 write 不得矩形相交（1px 容差）——clamp 叠影的直接回归断言
    const intersects = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) =>
      a.x < b.x + b.width - 1 &&
      b.x < a.x + a.width - 1 &&
      a.y < b.y + b.height - 1 &&
      b.y < a.y + a.height - 1;
    for (let i = 0; i < layout.writes.length; i += 1) {
      for (let j = i + 1; j < layout.writes.length; j += 1) {
        expect(intersects(layout.writes[i].rect, layout.writes[j].rect)).toBe(false);
      }
    }
    // 板面物理写满：实在放不下的 extra 干净弃写（零尺寸占位），绝不叠影
    const dropped = layout.writes.filter((write) => write.dropped);
    expect(dropped.length).toBeLessThanOrEqual(1);
    for (const write of dropped) {
      expect(write.rect.width).toBe(0);
      expect(write.textLines).toEqual([]);
    }
  });
});

describe('writeTipPosition（v10 虚拟粉笔手）', () => {
  const page: BoardPage = {
    segments: [
      {
        narration: 'x',
        actions: [
          { type: 'write', text: '这节课的课题', role: 'title' },
          { type: 'write', text: '边际成本', role: 'term' },
        ],
      },
    ],
  };

  it('首字时光标在行首附近，写完一字向右推进一个字宽', () => {
    const layout = layoutBoardPage(page, W, H);
    const term = layout.writes[1]; // '边际成本' term，左对齐
    const at0 = writeTipPosition(term, 0);
    const at1 = writeTipPosition(term, 1);
    expect(at0.x).toBeCloseTo(term.rect.x + term.fontSize * 0.35, 1);
    expect(at0.y).toBeCloseTo(term.rect.y + term.fontSize * 0.72, 1);
    // '边' 全角 → 推进 1em
    expect(at1.x - at0.x).toBeCloseTo(term.fontSize, 1);
    expect(at1.y).toBeCloseTo(at0.y, 1);
  });

  it('title 行居中：光标含居中偏移', () => {
    const layout = layoutBoardPage(page, W, H);
    const title = layout.writes[0]; // '这节课的课题' title 居中
    const lineWidth = estimateTextWidth(title.textLines[0], title.fontSize);
    const at0 = writeTipPosition(title, 0);
    expect(at0.x).toBeCloseTo(
      title.rect.x + Math.max(0, (title.rect.width - lineWidth) / 2) + title.fontSize * 0.35,
      1,
    );
  });

  it('charIndex 跨行落在第二行；超出全文落在末行末尾', () => {
    const longText = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十';
    const layout = layoutBoardPage(
      { segments: [{ narration: 'x', actions: [{ type: 'write', text: longText, role: 'step' }] }] },
      W,
      H,
    );
    const write = layout.writes[0];
    expect(write.lines).toBeGreaterThan(1);
    const firstLineLength = Array.from(write.textLines[0]).length;
    const secondLine = writeTipPosition(write, firstLineLength);
    expect(secondLine.y).toBeCloseTo(write.rect.y + write.fontSize * 1.4 + write.fontSize * 0.72, 1);
    const end = writeTipPosition(write, 999);
    const lastLine = write.textLines[write.textLines.length - 1];
    expect(end.x).toBeCloseTo(
      write.rect.x + estimateTextWidth(lastLine, write.fontSize) + write.fontSize * 0.35,
      1,
    );
  });
});

describe('resolveTargetRect：标注 bounds', () => {
  const page: BoardPage = {
    segments: [
      {
        narration: 'x',
        actions: [
          { type: 'write', text: '供给', role: 'term' },
          { type: 'write', text: '需求', role: 'term' },
        ],
      },
    ],
  };

  it('单 target 套住对应 write（带内边距）', () => {
    const layout = layoutBoardPage(page, W, H);
    const bounds = resolveTargetRect('w1', layout);
    const target = layout.writes[0].rect;
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeLessThan(target.x);
    expect(bounds!.y).toBeLessThan(target.y);
    expect(bounds!.x + bounds!.width).toBeGreaterThan(target.x + target.width);
  });

  it('多 target 取并集', () => {
    const layout = layoutBoardPage(page, W, H);
    const bounds = resolveTargetRect(['w1', 'w2'], layout);
    const [first, second] = layout.writes.map((write) => write.rect);
    expect(bounds!.y).toBeLessThanOrEqual(first.y);
    expect(bounds!.y + bounds!.height).toBeGreaterThanOrEqual(second.y + second.height);
  });

  it('非法引用返回 null', () => {
    const layout = layoutBoardPage(page, W, H);
    expect(resolveTargetRect('w9', layout)).toBeNull();
    expect(resolveTargetRect('B3', layout)).toBeNull();
  });
});

describe('buildPageTimeline v3：cue 与 checkpoint', () => {
  it('v15：LLM cue 透传倒排；无 cue 动作按字位均分（含手先于口倒排）', () => {
    const timeline = buildPageTimeline({
      segments: [
        {
          type: 'narration',
          narration: '说到这个概念，注意这里。', // 12 字 × 150ms
          narrationDisplay: '说到这个概念，注意这里。',
          cues: [
            { charIndex: 6, actionIndex: 0 },
            { charIndex: 9, actionIndex: 2 },
          ],
          actions: [
            { type: 'write', text: '概念', role: 'term' },
            { type: 'write', text: '补充', role: 'note' },
            { type: 'circle', target: 'w1' },
          ],
        },
      ],
    });
    const [write, note, circle] = timeline.segments[0].actions;
    // v20 嘴手一体：write 只微提前一个起笔量 ceil(300/150)=2 字；标注提前 ceil(500/150)=4 字
    expect(write.cueCharIndex).toBe(4);
    expect(circle.cueCharIndex).toBe(5);
    // v15：无 cue 的 note 也锚定字位——均分位 6，微提前 2 → 4
    expect(note.cueCharIndex).toBe(4);
    // startMs 由字位折算（估算触发时刻），都在段内
    for (const timed of timeline.segments[0].actions) {
      expect(timed.startMs).toBeGreaterThanOrEqual(0);
      expect(timed.startMs).toBeLessThanOrEqual(timeline.segments[0].endMs);
    }
  });

  it('checkpoint 段发占位段（零时长、无动作），下标与 page.segments 对齐', () => {
    const timeline = buildPageTimeline({
      segments: [
        {
          type: 'narration',
          narration: '先讲一段。',
          actions: [{ type: 'write', text: '甲', role: 'term' }],
        },
        {
          type: 'checkpoint',
          narration: '考考你。',
          question: { text: '题', role: 'term' },
          hints: ['一', '二', '三'],
          answer: '答案。',
          demoActions: [],
        },
        {
          type: 'narration',
          narration: '接着讲。',
          actions: [{ type: 'write', text: '乙', role: 'term' }],
        },
      ],
    });
    expect(timeline.segments).toHaveLength(3);
    expect(timeline.segments[1].actions).toEqual([]);
    expect(timeline.segments[1].startMs).toBe(timeline.segments[1].endMs);
    // 后续段不受影响，时间轴连续
    expect(timeline.segments[2].startMs).toBe(timeline.segments[0].endMs);
  });
});

describe('逐字书写节奏（v8）', () => {
  it('charPaceMs：CJK > 标点 > 拉丁 > 空格', () => {
    expect(charPaceMs('抓', true)).toBe(CHAR_PACE.cjkStrokeMs);
    expect(charPaceMs('抓', false)).toBe(CHAR_PACE.cjkFontMs);
    expect(charPaceMs('B', true)).toBe(CHAR_PACE.latinMs);
    expect(charPaceMs('7', false)).toBe(CHAR_PACE.latinMs);
    expect(charPaceMs('：', true)).toBe(CHAR_PACE.punctMs + CHAR_PACE.punctPauseMs);
    expect(charPaceMs(',', false)).toBe(CHAR_PACE.punctMs + CHAR_PACE.punctPauseMs);
    expect(charPaceMs(' ', true)).toBe(CHAR_PACE.spaceMs);
  });

  it('v19：estimateWriteMs = 人性化计划总时长（含抖动与抬笔停顿）；确定性且 term 慢于 step', () => {
    // 确定性：同一文本同一角色永远同一总时长（无随机源，hash 驱动）
    expect(estimateWriteMs('Jane Bond', 'term')).toBe(estimateWriteMs('Jane Bond', 'term'));
    // term 笔顺档基准 320 > step 手写档 180，抖动区间（0.82~1.25）不会倒挂
    expect(estimateWriteMs('易错点', 'term')).toBeGreaterThan(estimateWriteMs('易错点', 'step'));
    // 下界：不会快过 0.8×逐字基准（抖动下限 0.82，停顿只加不减）
    expect(estimateWriteMs('易错点', 'step')).toBeGreaterThan(3 * CHAR_PACE.cjkFontMs * 0.8);
    // 上界：1.3×基准 + 每字最大停顿（换气 340）以内
    expect(estimateWriteMs('易错点', 'step')).toBeLessThan(3 * CHAR_PACE.cjkFontMs * 1.3 + 2 * 340);
  });

  it('v19：writeMs/restMs 与 token 等长；末 token 停顿恒 0；totalMs = 两者求和', () => {
    const text = '概念是基石，记住它。';
    const plan = buildWritePace(text, 'step');
    const tokens = tokenizeBoardText(text);
    expect(plan.writeMs).toHaveLength(tokens.length);
    expect(plan.restMs).toHaveLength(tokens.length);
    expect(plan.restMs[tokens.length - 1]).toBe(0);
    const sum = (arr: number[]) => arr.reduce((total, ms) => total + ms, 0);
    expect(plan.totalMs).toBe(sum(plan.writeMs) + sum(plan.restMs));
  });

  it('v19：确定性复现；标点后停顿显著大于字间微顿', () => {
    const text = '先写一组，再写一组。';
    expect(buildWritePace(text, 'step')).toEqual(buildWritePace(text, 'step'));
    const tokens = tokenizeBoardText(text);
    const punctIndex = tokens.findIndex((token) => token.text === '，');
    const plan = buildWritePace(text, 'step');
    expect(plan.restMs[punctIndex]).toBeGreaterThanOrEqual(150);
    expect(plan.restMs[punctIndex]).toBeLessThan(270);
    expect(plan.restMs[0]).toBeLessThan(plan.restMs[punctIndex]); // 字间微顿 < 标点停顿
  });

  it('v19：英文词间有抬笔停顿；空格自身零停顿', () => {
    const text = 'name and address';
    const plan = buildWritePace(text, 'step');
    const tokens = tokenizeBoardText(text);
    const wordIndex = tokens.findIndex((token) => token.kind === 'word');
    expect(plan.restMs[wordIndex]).toBeGreaterThanOrEqual(70);
    const spaceIndex = tokens.findIndex((token) => token.kind === 'space');
    expect(plan.restMs[spaceIndex]).toBe(0);
  });

  it('v15：write 不占时隙时长，段长 = 朗读估算；书写节奏由 budgetMs 自适应', () => {
    const timeline = buildPageTimeline({
      segments: [
        {
          type: 'narration',
          narration: '短', // MIN_SEGMENT_MS = 1200
          actions: [{ type: 'write', text: '关键概念要点', role: 'term' }],
        },
      ],
    });
    const [write] = timeline.segments[0].actions;
    // v15：durationMs 恒 0（书写节奏不在时间轴上占位），段长 = 朗读估算下限
    expect(write.durationMs).toBe(0);
    expect(timeline.segments[0].endMs).toBe(1200);
    // 书写时间窗预算延伸到段末，paceScaleFor 据此加速（6 笔顺字 1920ms > 预算）
    expect(write.budgetMs).toBeGreaterThanOrEqual(1200);
  });
});

describe('v20 嘴手一体：cue 微提前、时间窗预算、书写变速', () => {
  it('write 提前量 = 起笔量 300ms（书写与讲解共现，不按总时长倒排），词首 clamp 到 0', () => {
    const timeline = buildPageTimeline({
      segments: [
        {
          type: 'narration',
          narration: '看这里。', // 4 字 → 1200ms（MIN_SEGMENT_MS 下限）→ 300ms/字
          cues: [{ charIndex: 1, actionIndex: 0 }],
          actions: [{ type: 'write', text: '边际成本递减', role: 'term' }],
        },
      ],
    });
    // 起笔提前 ceil(300/300)=1 字：cue 1 - 1 = 0（嘴上开讲 = 落笔开始）
    expect(timeline.segments[0].actions[0].cueCharIndex).toBe(0);
  });

  it('v20：write 提前量不再随书写总时长增长——长 write 也只在开讲时起笔', () => {
    const timeline = buildPageTimeline({
      segments: [
        {
          type: 'narration',
          narration: '这一句话有十二个字长度。', // 12 字 × 150ms → 150ms/字
          narrationDisplay: '这一句话有十二个字长度。',
          cues: [{ charIndex: 8, actionIndex: 0 }],
          actions: [{ type: 'write', text: '一个非常长的关键概念要点', role: 'term' }],
        },
      ],
    });
    // 提前 ceil(300/150)=2 字 → 8-2=6（v9 会按总时长 ~3.8s 倒排 26 字 clamp 到 0）
    expect(timeline.segments[0].actions[0].cueCharIndex).toBe(6);
  });

  it('每个非 pause 动作都有 budgetMs；末动作的预算延伸到段末', () => {
    const timeline = buildPageTimeline({
      segments: [
        {
          type: 'narration',
          narration: '这一段话足够长，可以容纳两个动作的时间窗。',
          actions: [
            { type: 'write', text: '甲', role: 'term' },
            { type: 'pause', ms: 500 },
            { type: 'write', text: '乙', role: 'term' },
          ],
        },
      ],
    });
    const [first, pause, second] = timeline.segments[0].actions;
    expect(first.budgetMs).toBeGreaterThanOrEqual(MIN_ACTION_SLOT_MS);
    expect(pause.budgetMs).toBeUndefined();
    // 第一个 write 的预算终点 = 下一个非 pause 动作的触发时刻
    expect(first.budgetMs).toBe(second.startMs - first.startMs);
    // 末动作预算延伸到段末
    expect(second.budgetMs).toBe(timeline.segments[0].endMs - second.startMs);
  });

  it('paceScaleFor：预算=自然时长时 1；预算紧 clamp 到 0.7；宽裕不再拉慢（恒 1）', () => {
    const action = { type: 'write' as const, text: '易错点', role: 'step' as const };
    const natural = estimateWriteMs(action.text, action.role);
    expect(paceScaleFor(action, natural)).toBe(1);
    // v19：预算宽裕不匀速慢放——按自然节奏写完抬笔休息，窗口剩余留给讲解
    expect(paceScaleFor(action, natural * 10)).toBe(1);
    expect(paceScaleFor(action, natural * 0.1)).toBe(PACE_SCALE_LIMIT.min);
    expect(paceScaleFor(action, 0)).toBe(1); // 无预算不退化
  });
});

describe('字幕卡拉 OK 窗口：windowSubtitle', () => {
  const TEXT = '对，up in the air 在这里就是心里没底，把它和原句连起来看：搬家千头万绪，所有事情都悬在半空没着落，这个画面就是它的来源。';

  it('短文本原样返回', () => {
    expect(windowSubtitle('短句。', 0)).toBe('短句。');
  });

  it('开头位置：从头装到窗口上限', () => {
    const out = windowSubtitle(TEXT, 0);
    expect(out.startsWith('对，')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(44);
    expect(TEXT.startsWith(out)).toBe(true);
  });

  it('讲到后面：之前的子句滚出，当前位置必然可见', () => {
    const at = TEXT.indexOf('所有事情');
    const out = windowSubtitle(TEXT, at);
    expect(out).toContain('所有事情');
    expect(out.length).toBeLessThanOrEqual(44);
    // 窗口必含朗读位置（不被省略号吃掉）
    const offset = TEXT.indexOf(out);
    expect(at).toBeGreaterThanOrEqual(offset);
    expect(at).toBeLessThan(offset + out.length);
  });

  it('超长单子句：按字滑窗且朗读位置可见', () => {
    const longClause = '一'.repeat(60) + '。';
    const out = windowSubtitle(longClause, 45);
    expect(out.length).toBe(44);
    // 滑窗起点 clamp 到 文本长-窗口宽（61-44=17），窗口尾含句号、位置 45 落在窗内
    expect(out).toBe(longClause.slice(17, 61));
  });
});

describe('isLatinBoardChar / isAsciiBoardPunct', () => {
  it('ASCII 字母/数字分流到 Caveat，其余不分流', () => {
    expect(isLatinBoardChar('a')).toBe(true);
    expect(isLatinBoardChar('Z')).toBe(true);
    expect(isLatinBoardChar('7')).toBe(true);
    expect(isLatinBoardChar('中')).toBe(false);
    expect(isLatinBoardChar(' ')).toBe(false);
    expect(isLatinBoardChar('-')).toBe(false);
    expect(isLatinBoardChar('/')).toBe(false);
    expect(isLatinBoardChar('。')).toBe(false);
    expect(isLatinBoardChar('ab')).toBe(false);
  });

  it('半角标点分流到 Caveat，全角标点不分流', () => {
    expect(isAsciiBoardPunct(':')).toBe(true);
    expect(isAsciiBoardPunct('-')).toBe(true);
    expect(isAsciiBoardPunct('=')).toBe(true);
    expect(isAsciiBoardPunct('/')).toBe(true);
    expect(isAsciiBoardPunct('(')).toBe(true);
    expect(isAsciiBoardPunct('：')).toBe(false);
    expect(isAsciiBoardPunct('，')).toBe(false);
    expect(isAsciiBoardPunct('中')).toBe(false);
    expect(isAsciiBoardPunct('a')).toBe(false);
    expect(isAsciiBoardPunct(' ')).toBe(false);
  });
});

describe('hashSeed', () => {
  it('同输入同 seed，不同输入不同 seed，且为正整数', () => {
    expect(hashSeed('circle:w3')).toBe(hashSeed('circle:w3'));
    expect(hashSeed('circle:w3')).not.toBe(hashSeed('circle:w4'));
    expect(hashSeed('')).toBeGreaterThan(0);
    expect(Number.isInteger(hashSeed('w3'))).toBe(true);
  });
});

describe('v23 反向背压：shouldDeferForInk', () => {
  it('笔无积压时任何动作都不延后', () => {
    expect(shouldDeferForInk({ type: 'write', text: '边际成本', role: 'term' }, 0)).toBe(false);
    expect(shouldDeferForInk({ type: 'circle', target: 'w1' }, 0)).toBe(false);
    expect(shouldDeferForInk({ type: 'pause', ms: 800 }, 0)).toBe(false);
  });

  it('笔有积压时 write / 标注类延后到笔追上', () => {
    expect(shouldDeferForInk({ type: 'write', text: '第二步', role: 'step' }, 1)).toBe(true);
    expect(shouldDeferForInk({ type: 'circle', target: 'w1' }, 2)).toBe(true);
    expect(shouldDeferForInk({ type: 'underline', target: ['w1', 'w2'] }, 1)).toBe(true);
    expect(shouldDeferForInk({ type: 'arrow', from: 'w1', to: 'w2' }, 1)).toBe(true);
    expect(shouldDeferForInk({ type: 'mark', mark: 'check', target: 'w1' }, 1)).toBe(true);
  });

  it('pause（静默拍）与 ref（自带插播暂停）不背压', () => {
    expect(shouldDeferForInk({ type: 'pause', ms: 800 }, 3)).toBe(false);
    expect(shouldDeferForInk({ type: 'ref', page: 1, target: 'w2' }, 3)).toBe(false);
  });

  it('背压 hold 上限覆盖笔顺字自然书写的最坏情况', () => {
    // 标定依据见 board-model.MAX_INK_HOLD_MS 注释（笔顺 title/term 最长 ~4.5s）
    expect(MAX_INK_HOLD_MS).toBeGreaterThanOrEqual(4500);
  });
});
