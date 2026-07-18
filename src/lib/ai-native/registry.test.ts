import { describe, expect, it } from 'vitest';
import { AppPluginRegistry } from './registry';
import type { AppExecutionContext, AppPlugin } from './types';

const context = {
  goal: { intent: '整理考试范围', expectedOutput: 'mixed', appKey: 'cheatsheet' },
  input: { sessionId: 'test', dataSource: 'unknown', transcript: [], anchors: [], metadata: {} },
  memory: {},
  contextTier: 'unit',
} as AppExecutionContext;

function pluginThatThrows(message: string): AppPlugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'Test plugin',
      tags: [],
      capabilities: [],
      enabledByDefault: true,
    },
    canHandle: () => true,
    run: async () => { throw new Error(message); },
  };
}

describe('AppPluginRegistry error contract', () => {
  it('rethrows semantic content rejection so the API can return 422', async () => {
    const registry = new AppPluginRegistry([pluginThatThrows('CONTENT_NOT_READY')]);
    await expect(registry.execute(context, 'test-plugin')).rejects.toThrow('CONTENT_NOT_READY');
  });

  it('keeps an operational plugin failure inside a renderable result', async () => {
    const registry = new AppPluginRegistry([pluginThatThrows('provider timeout')]);
    const result = await registry.execute(context, 'test-plugin');
    expect(result.raw).toMatchObject({ error: 'provider timeout' });
    expect(result.trace).toContain('plugin_execution_failed=provider timeout');
  });
});
