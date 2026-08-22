import { describe, expect, it } from 'vitest';
import {
  alignTimingsToInput,
  charIndexAtMs,
  parseSseStream,
} from './board-tts-service';

// 2026-08 实测 cosyvoice-v2 + longanpei 返回（try-dashscope-tts 验证）
const RAW_WORDS_PLAIN = [
  { text: '同', begin_index: 0, end_index: 1, begin_time: 80, end_time: 160 },
  { text: '学', begin_index: 1, end_index: 2, begin_time: 160, end_time: 280 },
  { text: '们', begin_index: 2, end_index: 3, begin_time: 280, end_time: 400 },
  { text: '好', begin_index: 3, end_index: 4, begin_time: 400, end_time: 640 },
  { text: '。', begin_index: 4, end_index: 5, begin_time: 640, end_time: 680 },
];

// 实测混合文本「她报名字 Jane Bond，2025 年考的。」：引擎剥空格 + TN 展开 2025→二零二五，
// 下标是归一化文本坐标系，且 "字Jane" 是引擎合并产物（跳过）
const RAW_WORDS_MIXED = [
  { text: '她', begin_index: 0, end_index: 1, begin_time: 80, end_time: 200 },
  { text: '报', begin_index: 1, end_index: 2, begin_time: 200, end_time: 360 },
  { text: '名', begin_index: 2, end_index: 3, begin_time: 360, end_time: 600 },
  { text: '字', begin_index: 3, end_index: 4, begin_time: 600, end_time: 680 },
  { text: '字Jane', begin_index: 3, end_index: 4, begin_time: 600, end_time: 1200 },
  { text: ' Bond', begin_index: 4, end_index: 5, begin_time: 1200, end_time: 1520 },
  { text: '，', begin_index: 5, end_index: 6, begin_time: 1560, end_time: 1920 },
  { text: '二', begin_index: 6, end_index: 7, begin_time: 1920, end_time: 2080 },
  { text: '零', begin_index: 7, end_index: 8, begin_time: 2080, end_time: 2320 },
  { text: '二', begin_index: 8, end_index: 9, begin_time: 2360, end_time: 2480 },
  { text: '五', begin_index: 9, end_index: 10, begin_time: 2560, end_time: 2760 },
  { text: '年', begin_index: 10, end_index: 11, begin_time: 2760, end_time: 2920 },
  { text: '考', begin_index: 11, end_index: 12, begin_time: 2920, end_time: 3200 },
  { text: '的', begin_index: 12, end_index: 13, begin_time: 3200, end_time: 3400 },
  { text: '。', begin_index: 13, end_index: 14, begin_time: 3400, end_time: 3680 },
];

describe('alignTimingsToInput', () => {
  it('纯中文：坐标原样对齐输入文本', () => {
    const timings = alignTimingsToInput('同学们好。', RAW_WORDS_PLAIN);
    expect(timings).toHaveLength(5);
    expect(timings[0]).toMatchObject({ charStart: 0, charEnd: 1, beginMs: 80 });
    expect(timings[4]).toMatchObject({ text: '。', charStart: 4, charEnd: 5 });
  });

  it('中英混合 + 数字 TN：映射回输入文本坐标系', () => {
    const text = '她报名字 Jane Bond，2025 年考的。';
    const timings = alignTimingsToInput(text, RAW_WORDS_MIXED);
    const byText = (t: string) => timings.find((timing) => timing.text === t);

    // 引擎合并产物 "字Jane" 在剥空白坐标系命中输入的 字+Jane（3-9）
    expect(byText('字Jane')).toMatchObject({ charStart: 3, charEnd: 9, beginMs: 600, endMs: 1200 });
    // Bond 命中输入的 10-14
    expect(byText(' Bond')).toMatchObject({ charStart: 10, charEnd: 14 });
    // 数字段 2025（输入下标 15-19）均分给 二零二五
    expect(byText('零')).toMatchObject({ charStart: 16, charEnd: 17 });
    // 尾部汉字继续对齐
    expect(byText('年')).toMatchObject({ charStart: 20, charEnd: 21 });
    // 整体单调
    for (let i = 1; i < timings.length; i += 1) {
      expect(timings[i].charStart).toBeGreaterThanOrEqual(timings[i - 1].charStart);
    }
  });

  it('空 words → 空结果', () => {
    expect(alignTimingsToInput('任何文本', [])).toEqual([]);
  });
});

describe('charIndexAtMs', () => {
  const timings = alignTimingsToInput('同学们好。', RAW_WORDS_PLAIN);

  it('词内线性插值', () => {
    expect(charIndexAtMs(timings, 0, 5)).toBe(0);
    expect(charIndexAtMs(timings, 100, 5)).toBe(0); // 同 80-160 内
    expect(charIndexAtMs(timings, 200, 5)).toBe(1); // 学 开始
    expect(charIndexAtMs(timings, 500, 5)).toBe(3); // 好 400-640 内
    expect(charIndexAtMs(timings, 9999, 5)).toBe(5); // 末尾
  });

  it('空 timings → 0', () => {
    expect(charIndexAtMs([], 500, 10)).toBe(0);
  });
});

describe('parseSseStream', () => {
  it('解析音频块 + 字级时间戳；error 事件上报', () => {
    const audioB64 = Buffer.from('fake-audio').toString('base64');
    const raw = [
      `data:${JSON.stringify({ output: { type: 'sentence-begin', sentence: { words: RAW_WORDS_PLAIN, index: 0 }, audio: { data: '' } } })}`,
      `data:${JSON.stringify({ output: { audio: { data: audioB64 } } })}`,
      `data:${JSON.stringify({ output: { finish_reason: 'stop' } })}`,
    ].join('\n\n');
    const { audio, words, error } = parseSseStream(raw);
    expect(error).toBeNull();
    expect(audio.toString()).toBe('fake-audio');
    expect(words).toHaveLength(5);

    const bad = parseSseStream(`data:${JSON.stringify({ code: 'InvalidParameter', message: 'engine 418' })}`);
    expect(bad.error).toBe('engine 418');
    expect(bad.audio.length).toBe(0);
  });

  it('同一句的累积 words 数组只保留最长一份（实测 cosyvoice 是 5→13→26 累积）', () => {
    const cumulative = [
      `data:${JSON.stringify({ output: { sentence: { words: RAW_WORDS_PLAIN.slice(0, 2), index: 0 } } })}`,
      `data:${JSON.stringify({ output: { sentence: { words: RAW_WORDS_PLAIN, index: 0 } } })}`,
      `data:${JSON.stringify({ output: { sentence: { words: [], index: 0 } } })}`,
    ].join('\n\n');
    const { words } = parseSseStream(cumulative);
    expect(words).toHaveLength(5);
    expect(words[4].text).toBe('。');
  });
});

describe('synthesizeBoardNarration 早退路径', () => {
  it('空文本直接返回 null（不触网）', async () => {
    const { synthesizeBoardNarration } = await import('./board-tts-service');
    expect(await synthesizeBoardNarration('   ')).toBeNull();
  });
});
