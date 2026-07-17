import { describe, expect, it, vi } from 'vitest';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { resolveInfographicGenerationBase } from './infographic-window-data';

function result(version: string): AppExecutionResult {
  return {
    pluginId: 'studio-workshop',
    version,
    model: 'test',
    trace: [],
    cards: [],
    tasks: [],
    render: { mode: 'infographic', payload: {} },
    raw: {},
  };
}

describe('resolveInfographicGenerationBase', () => {
  it('首次生成先取得有课堂依据的智能草案', async () => {
    const generated = result('draft-v1');
    const onGenerateDraft = vi.fn().mockResolvedValue(generated);

    await expect(resolveInfographicGenerationBase(null, onGenerateDraft)).resolves.toBe(generated);
    expect(onGenerateDraft).toHaveBeenCalledTimes(1);
  });

  it('已有草案时不重复调用生成链路', async () => {
    const existing = result('existing-v1');
    const onGenerateDraft = vi.fn().mockResolvedValue(result('unexpected'));

    await expect(resolveInfographicGenerationBase(existing, onGenerateDraft)).resolves.toBe(existing);
    expect(onGenerateDraft).not.toHaveBeenCalled();
  });

  it('兼容没有草案生成器的旧调用方', async () => {
    await expect(resolveInfographicGenerationBase(null)).resolves.toBeNull();
  });
});
