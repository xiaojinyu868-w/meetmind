import { describe, expect, it } from 'vitest';
import { resolveTutorAgentProviderConfig } from './tutor-agent-provider';

describe('resolveTutorAgentProviderConfig', () => {
  it('uses DashScope key before OpenAI key when baseURL is DashScope-compatible', () => {
    const config = resolveTutorAgentProviderConfig({
      OPENAI_API_KEY: 'openai-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
      LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });

    expect(config.apiKey).toBe('dashscope-key');
    expect(config.keySource).toBe('DASHSCOPE_API_KEY');
  });

  it('honors explicit tutor API key first', () => {
    const config = resolveTutorAgentProviderConfig({
      TUTOR_API_KEY: 'tutor-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
    });

    expect(config.apiKey).toBe('tutor-key');
    expect(config.keySource).toBe('TUTOR_API_KEY');
  });
});
