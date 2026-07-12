import { describe, expect, it } from 'vitest';
import { formatTranscriptWithSpeakers, hasSpeakerMarker } from './transcript-format';

describe('formatTranscriptWithSpeakers', () => {
  it('keeps plain transcript segments readable', () => {
    expect(formatTranscriptWithSpeakers([
      { text: '第一段内容' },
      { text: '第二段内容' },
    ])).toBe('第一段内容 第二段内容');
  });

  it('marks speaker changes without repeating the same speaker label', () => {
    const transcript = formatTranscriptWithSpeakers([
      { text: '先看定义。', speakerId: '0' },
      { text: '再看例子。', speakerId: '0' },
      { text: '这里我没听懂。', speakerId: '1' },
    ]);

    expect(transcript).toBe([
      '[说话人1] 先看定义。',
      '再看例子。',
      '[说话人2] 这里我没听懂。',
    ].join(' '));
    expect(hasSpeakerMarker(transcript)).toBe(true);
  });

  it('does not invent a label for an invalid speaker id', () => {
    const transcript = formatTranscriptWithSpeakers([
      { text: '无法识别说话人。', speakerId: 'unknown' },
    ]);

    expect(transcript).toBe('无法识别说话人。');
    expect(hasSpeakerMarker(transcript)).toBe(false);
  });
});
