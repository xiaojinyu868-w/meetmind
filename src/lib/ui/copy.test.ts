import { describe, it, expect } from 'vitest';
import { COPY } from './copy';

describe('COPY catalogue', () => {
  it('身份、CTA、listening 文案都有非空值', () => {
    expect(COPY.identity.name).toBeTruthy();
    expect(COPY.identity.tagline.length).toBeGreaterThanOrEqual(6);
    expect(COPY.cta.demo).toBeTruthy();
    expect(COPY.cta.record).toBeTruthy();
  });

  it('品牌主心智表达学习理解，而不是把收集功能当成产品定位', () => {
    expect(COPY.identity.tagline).toContain('学');
    expect(COPY.identity.tagline).toContain('AI 同学');
    expect(COPY.identity.tagline).not.toContain('收下');
    expect(COPY.login.subtitle).not.toContain('收下');
  });

  it('banned 词列表本身不出现在任何用户可见字符串里——防止退化', () => {
    // 递归扫所有 string 值，出现 banned 词就失败。这是 M8 agent-native 的
    // 口吻护栏：只要文案调整时不小心加了"回声卡 / 预知气泡 / 工坊 / 研判 / 引擎"
    // 中的任何一个，测试立刻就红。
    const banned = COPY.bannedWords;
    const visit = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        for (const word of banned) {
          expect(
            node.includes(word),
            `"${path}" contains banned word "${word}": ${node}`,
          ).toBe(false);
        }
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          // bannedWords 自身是检查清单，跳过
          if (k === 'bannedWords') continue;
          visit(v, `${path}.${k}`);
        }
      }
    };
    visit(COPY, 'COPY');
  });

  it('stop.summary 在极端输入下也返回合理的中文句子', () => {
    expect(COPY.stop.summary(0, 0)).toMatch(/很少/);
    expect(COPY.stop.summary(47, 0)).toBe('共 47 句。');
    expect(COPY.stop.summary(47, 3)).toBe('共 47 句，标了 3 处你标的困惑。');
  });
});
