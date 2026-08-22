import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractTextFromImage,
  isQwenOcrAvailable,
  getQwenOcrModel,
} from './qwen-ocr-service';

describe('isQwenOcrAvailable / getQwenOcrModel', () => {
  beforeEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_OCR_MODEL;
  });

  it('未配置 DASHSCOPE_API_KEY 时不可用', () => {
    expect(isQwenOcrAvailable()).toBe(false);
    process.env.DASHSCOPE_API_KEY = 'sk-test';
    expect(isQwenOcrAvailable()).toBe(true);
  });

  it('默认模型为 qwen-vl-ocr（与 qwen-image-service 同款模块级 env 解析）', () => {
    expect(getQwenOcrModel()).toBe('qwen-vl-ocr');
  });
});

describe('extractTextFromImage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.DASHSCOPE_API_KEY = 'sk-test';
  });

  it('解析 DashScope 原生响应的 text 段并拼接', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'req-1' },
      text: async () =>
        JSON.stringify({
          request_id: 'req-1',
          output: {
            choices: [
              {
                message: {
                  content: [{ text: '# 标题' }, { text: '正文 $E=mc^2$' }],
                },
              },
            ],
          },
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await extractTextFromImage({ imageUrl: 'data:image/png;base64,AAA' });

    expect(result.text).toBe('# 标题\n正文 $E=mc^2$');
    expect(result.requestId).toBe('req-1');
    expect(result.model).toBe(getQwenOcrModel());
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('multimodal-generation/generation');
    const body = JSON.parse(init.body as string);
    expect(body.input.messages[0].content[0].image).toBe('data:image/png;base64,AAA');
    expect(typeof body.input.messages[0].content[1].text).toBe('string');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('兼容 content 为纯字符串的响应', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ output: { choices: [{ message: { content: '纯文本结果' } }] } }),
      })
    );

    const result = await extractTextFromImage({ imageUrl: 'https://example.com/a.png' });
    expect(result.text).toBe('纯文本结果');
  });

  it('响应非 ok 时抛出带 message 的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: () => 'req-err' },
        text: async () => JSON.stringify({ code: 'InvalidParameter', message: '图片格式不支持' }),
      })
    );

    await expect(
      extractTextFromImage({ imageUrl: 'data:image/png;base64,AAA' })
    ).rejects.toThrow('图片格式不支持');
  });

  it('响应 ok 但没有 text 段时抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify({ output: { choices: [{ message: { content: [] } }] } }),
      })
    );

    await expect(
      extractTextFromImage({ imageUrl: 'data:image/png;base64,AAA' })
    ).rejects.toThrow('未找到文本内容');
  });

  it('未配置 DASHSCOPE_API_KEY 时直接抛错', async () => {
    delete process.env.DASHSCOPE_API_KEY;
    await expect(
      extractTextFromImage({ imageUrl: 'data:image/png;base64,AAA' })
    ).rejects.toThrow('DASHSCOPE_API_KEY');
  });
});
