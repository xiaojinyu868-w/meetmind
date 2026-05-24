import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_AUTO_VALUE,
  AI_MODEL_PREFERENCE_KEY,
  resolveAiModelPreference,
} from './ai-model-preference';

describe('ai model preference', () => {
  it('uses a shared settings key for all AI surfaces', () => {
    expect(AI_MODEL_PREFERENCE_KEY).toBe('settings_model_preference');
  });

  it('falls back to default model when preference is auto or empty', () => {
    expect(resolveAiModelPreference(AI_MODEL_AUTO_VALUE, 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(resolveAiModelPreference('', 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });

  it('returns an explicit model preference unchanged after trimming', () => {
    expect(resolveAiModelPreference('  deepseek-v4-pro  ', 'deepseek-v4-flash')).toBe('deepseek-v4-pro');
  });
});
