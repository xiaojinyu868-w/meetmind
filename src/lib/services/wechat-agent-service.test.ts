import { describe, expect, it } from 'vitest';
import {
  buildWechatAgentMessages,
  buildWechatAgentSystemPrompt,
  isWechatAgentCandidate,
  splitWechatText,
} from './wechat-agent-service';

describe('isWechatAgentCandidate', () => {
  it('绑定用户的纯文字消息交给 Agent', () => {
    expect(isWechatAgentCandidate(
      { msgType: 'text', sourceUrl: undefined, reach: { channel: 'quick-note' } as never },
      'bound',
    )).toBe(true);
  });

  it('未绑定用户不走 Agent（维持收集 + 绑定引导）', () => {
    expect(isWechatAgentCandidate(
      { msgType: 'text', sourceUrl: undefined, reach: { channel: 'quick-note' } as never },
      'unresolved',
    )).toBe(false);
  });

  it('链接 / 语音 / 图片仍走收集线', () => {
    expect(isWechatAgentCandidate(
      { msgType: 'text', sourceUrl: 'https://example.com', reach: { channel: 'web-link' } as never },
      'bound',
    )).toBe(false);
    expect(isWechatAgentCandidate(
      { msgType: 'voice', sourceUrl: undefined, reach: undefined },
      'bound',
    )).toBe(false);
    expect(isWechatAgentCandidate(
      { msgType: 'image', sourceUrl: undefined, reach: undefined },
      'bound',
    )).toBe(false);
  });
});

describe('buildWechatAgentMessages', () => {
  it('system 注入上下文，历史过滤非法角色', () => {
    const messages = buildWechatAgentMessages({
      systemPrompt: buildWechatAgentSystemPrompt(),
      contextSections: '这个人：大三，计算机专业',
      history: [
        { role: 'user', text: '上次说的三次握手我还有点绕' },
        { role: 'assistant', text: '哪一步绕？' },
        { role: 'system', text: '不应出现' },
        { role: 'user', text: '   ' },
      ],
      text: '就是第二次握手的目的',
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('这个人：大三，计算机专业');
    expect(messages).toHaveLength(4);
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '就是第二次握手的目的' });
    expect(messages.some((m) => m.content === '不应出现')).toBe(false);
  });

  it('无上下文时 system 保持原样', () => {
    const messages = buildWechatAgentMessages({
      systemPrompt: 'SYS',
      contextSections: '',
      history: [],
      text: '你好',
    });
    expect(messages[0].content).toBe('SYS');
  });
});

describe('splitWechatText', () => {
  it('短文本不拆', () => {
    expect(splitWechatText('一句话。')).toEqual(['一句话。']);
  });

  it('长文本优先按换行/句号切，不丢内容', () => {
    const sentence = '这是一句完整的话。';
    const text = sentence.repeat(120); // ~1080 字
    const chunks = splitWechatText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 101)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('空文本返回空数组', () => {
    expect(splitWechatText('   ')).toEqual([]);
  });
});
