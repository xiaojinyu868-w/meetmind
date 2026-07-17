import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { buildPromptTranscriptContext } from './prompt-context';

describe('buildPromptTranscriptContext', () => {
  it('announces each source lesson once at the source boundary', () => {
    const transcript: TranscriptSegment[] = [
      {
        id: 'a:1',
        text: '第一段内容足够长，能够进入应用生成的原文上下文。',
        startMs: 0,
        endMs: 4_000,
        isFinal: true,
        sourceItemId: 'a',
        sourceTitle: '第一讲',
      },
      {
        id: 'a:2',
        text: '第一讲继续解释同一个概念，不需要重复打印来源名。',
        startMs: 4_000,
        endMs: 8_000,
        isFinal: true,
        sourceItemId: 'a',
        sourceTitle: '第一讲',
      },
      {
        id: 'b:1',
        text: '第二讲开始讨论新的内容，需要显示新的来源边界。',
        startMs: 9_000,
        endMs: 13_000,
        isFinal: true,
        sourceItemId: 'b',
        sourceTitle: '第二讲',
      },
    ];

    const result = buildPromptTranscriptContext(transcript, {
      includeTimestamp: true,
      includeIndex: false,
    });

    expect(result.text.match(/【来源：第一讲】/g)).toHaveLength(1);
    expect(result.text.match(/【来源：第二讲】/g)).toHaveLength(1);
    expect(result.text.indexOf('【来源：第一讲】')).toBeLessThan(result.text.indexOf('第一段内容'));
    expect(result.text.indexOf('【来源：第二讲】')).toBeLessThan(result.text.indexOf('第二讲开始'));
  });
});
