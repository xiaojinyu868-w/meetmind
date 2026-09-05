import { describe, expect, it } from 'vitest';
import { normalizeTeachBackSay } from './teach-back-respond-service';

describe('normalizeTeachBackSay', () => {
  it('合法 say 原样透传', () => {
    expect(normalizeTeachBackSay({ say: '这里我没跟上，为什么是三次握手？' }))
      .toBe('这里我没跟上，为什么是三次握手？');
  });

  it('多余空白收敛', () => {
    expect(normalizeTeachBackSay({ say: '  那  拥塞控制   呢？\n' })).toBe('那 拥塞控制 呢？');
  });

  it('say 为 null → 同桌保持安静', () => {
    expect(normalizeTeachBackSay({ say: null })).toBeNull();
  });

  it('say 是字面量「null」字符串 → null', () => {
    expect(normalizeTeachBackSay({ say: 'null' })).toBeNull();
    expect(normalizeTeachBackSay({ say: ' NULL ' })).toBeNull();
  });

  it('非对象 / undefined / 数组 → null', () => {
    expect(normalizeTeachBackSay(undefined)).toBeNull();
    expect(normalizeTeachBackSay(null)).toBeNull();
    expect(normalizeTeachBackSay('开口说句话')).toBeNull();
    expect(normalizeTeachBackSay([{ say: '喂' }])).toBeNull();
  });

  it('say 为非字符串 → null', () => {
    expect(normalizeTeachBackSay({ say: 42 })).toBeNull();
    expect(normalizeTeachBackSay({ say: ['嗯'] })).toBeNull();
    expect(normalizeTeachBackSay({})).toBeNull();
  });

  it('纯空白 → null', () => {
    expect(normalizeTeachBackSay({ say: '   \n\t  ' })).toBeNull();
  });

  it('超过 120 字截断', () => {
    const long = `问：${'好'.repeat(200)}`;
    const result = normalizeTeachBackSay({ say: long });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(120);
  });
});
