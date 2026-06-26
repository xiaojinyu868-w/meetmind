import { describe, expect, it } from 'vitest';
import {
  formatTutorAgentUserError,
  resolveTutorAgentProviderConfig,
  resolveTutorAgentProviderFallbacks,
  shouldFallbackTutorAgentError,
} from './tutor-agent-provider';

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

  it('defaults to DeepSeek V4 Flash when DeepSeek is configured', () => {
    const config = resolveTutorAgentProviderConfig({
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    expect(config.apiKey).toBe('deepseek-key');
    expect(config.baseURL).toBe('https://api.deepseek.com');
    expect(config.modelId).toBe('DeepSeek-V4-Flash');
    expect(config.keySource).toBe('DEEPSEEK_API_KEY');
  });

  it('routes an explicitly requested DeepSeek model to DeepSeek even when DashScope is configured', () => {
    const config = resolveTutorAgentProviderConfig({
      DEEPSEEK_API_KEY: 'deepseek-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
      LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    }, { modelId: 'DeepSeek-V4-Pro' });

    expect(config.apiKey).toBe('deepseek-key');
    expect(config.baseURL).toBe('https://api.deepseek.com');
    expect(config.modelId).toBe('DeepSeek-V4-Pro');
    expect(config.keySource).toBe('DEEPSEEK_API_KEY');
    expect(config.modelApi).toBe('chat');
  });

  it('forces DeepSeek models onto Chat Completions even if TUTOR_BASE_URL is stale', () => {
    const config = resolveTutorAgentProviderConfig({
      DEEPSEEK_API_KEY: 'deepseek-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
      TUTOR_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    }, { modelId: 'DeepSeek-V4-Flash' });

    expect(config.baseURL).toBe('https://api.deepseek.com');
    expect(config.keySource).toBe('DEEPSEEK_API_KEY');
    expect(config.modelApi).toBe('chat');
  });

  it('TUTOR_MODEL env var overrides default', () => {
    const config = resolveTutorAgentProviderConfig({ TUTOR_MODEL: 'Qwen3-Max-A' });
    expect(config.modelId).toBe('Qwen3-Max-A');
  });

  it('offers DashScope as a fallback when the primary Tutor model is DeepSeek', () => {
    const configs = resolveTutorAgentProviderFallbacks({
      DEEPSEEK_API_KEY: 'deepseek-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
    }, { modelId: 'DeepSeek-V4-Flash' });

    expect(configs.map((config) => config.modelId)).toEqual(['DeepSeek-V4-Flash', 'qwen3.7-plus']);
    expect(configs.map((config) => config.keySource)).toEqual(['DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY']);
  });

  it('offers DeepSeek as a fallback when the primary Tutor model is DashScope', () => {
    const configs = resolveTutorAgentProviderFallbacks({
      DEEPSEEK_API_KEY: 'deepseek-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
      TUTOR_MODEL: 'Qwen3.6-Plus-A',
    });

    expect(configs.map((config) => config.modelId)).toEqual(['Qwen3.6-Plus-A', 'DeepSeek-V4-Flash']);
    expect(configs.map((config) => config.keySource)).toEqual(['DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY']);
  });

  it('does not invent fallback providers when only one provider key is configured', () => {
    const configs = resolveTutorAgentProviderFallbacks({
      DEEPSEEK_API_KEY: 'deepseek-key',
    }, { modelId: 'DeepSeek-V4-Flash' });

    expect(configs).toHaveLength(1);
    expect(configs[0]?.modelId).toBe('DeepSeek-V4-Flash');
  });

  it('treats provider busy retry exhaustion as fallback-eligible', () => {
    expect(shouldFallbackTutorAgentError('Failed after 3 attempts. Last error: Service is too busy.')).toBe(true);
  });

  it('does not fallback authentication or model configuration errors', () => {
    expect(shouldFallbackTutorAgentError('401 Unauthorized: invalid API key')).toBe(false);
    expect(shouldFallbackTutorAgentError('model not found')).toBe(false);
  });

  it('formats recoverable provider errors without claiming a fallback when none happened', () => {
    expect(formatTutorAgentUserError('Failed after 3 attempts. Last error: Service is too busy.')).toBe(
      '模型服务刚刚有点忙，请稍后再试。',
    );
  });

  it('formats recoverable provider errors differently after fallback was attempted', () => {
    expect(formatTutorAgentUserError('Failed after 3 attempts. Last error: Service is too busy.', {
      attemptedFallback: true,
    })).toBe('模型服务刚刚有点忙，已尝试切换备用通道但仍未成功，请稍后再试。');
  });

  it('defaults to StepFun step-3.7-flash when STEPFUN_API_KEY is configured', () => {
    const config = resolveTutorAgentProviderConfig({
      STEPFUN_API_KEY: 'step-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
    });

    expect(config.modelId).toBe('step-3.7-flash');
    expect(config.baseURL).toBe('https://api.stepfun.com/v1');
    expect(config.apiKey).toBe('step-key');
    expect(config.keySource).toBe('STEPFUN_API_KEY');
    expect(config.modelApi).toBe('chat');
  });

  it('routes an explicitly requested step-* model to StepFun even when DeepSeek is configured', () => {
    const config = resolveTutorAgentProviderConfig({
      STEPFUN_API_KEY: 'step-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
      TUTOR_BASE_URL: 'https://api.deepseek.com',
    }, { modelId: 'step-3.7-flash' });

    expect(config.baseURL).toBe('https://api.stepfun.com/v1');
    expect(config.keySource).toBe('STEPFUN_API_KEY');
  });

  it('offers DeepSeek and DashScope as fallbacks when the primary Tutor model is StepFun', () => {
    const configs = resolveTutorAgentProviderFallbacks({
      STEPFUN_API_KEY: 'step-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
    });

    expect(configs.map((config) => config.modelId)).toEqual([
      'step-3.7-flash',
      'DeepSeek-V4-Flash',
      'qwen3.7-plus',
    ]);
    expect(configs.map((config) => config.keySource)).toEqual([
      'STEPFUN_API_KEY',
      'DEEPSEEK_API_KEY',
      'DASHSCOPE_API_KEY',
    ]);
  });
});
