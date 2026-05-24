import { describe, expect, it } from 'vitest';
import {
  buildEchoShareFileName,
  buildEchoShareText,
  dataUrlToFile,
} from './echo-share-actions';
import type { EchoData } from './EchoCard';

const echo: EchoData = {
  id: 'echo-1',
  title: '单调性这条线已经冒头了',
  body: '你把课堂原话和卡住的位置放到了一起，顺着这点能看出它们怎么连上。',
  takeaway: '导数符号不是结论本身，而是看区间变化的入口。',
  highlights: [{ text: '导数大于零时函数递增', timestamp: '12:30', speaker: '老师' }],
  createdAt: '2026-05-21T08:00:00.000Z',
  updatedAt: '2026-05-21T08:10:00.000Z',
};

describe('echo share actions', () => {
  it('builds a share text that can travel outside the product without internal jargon', () => {
    const text = buildEchoShareText(echo, '高数课');

    expect(text).toContain('高数课');
    expect(text).toContain(echo.body);
    expect(text).toContain(echo.takeaway);
    expect(text).toContain('MeetMind');
    expect(text).not.toMatch(/回声卡|酿|工坊|研判|引擎/);
  });

  it('builds a safe png filename from course and date', () => {
    expect(buildEchoShareFileName(echo, '高数/导数?')).toBe('MeetMind-高数-导数-2026-05-21.png');
  });

  it('converts a png data url into a File for native sharing', async () => {
    const file = await dataUrlToFile('data:image/png;base64,aGVsbG8=', 'meetmind.png');

    expect(file.name).toBe('meetmind.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(5);
  });
});
