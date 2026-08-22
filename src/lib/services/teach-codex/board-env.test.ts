import { describe, expect, it } from 'vitest';
import { createBoardEnv } from '@/lib/services/teach-agent/tools';
import {
  listTeachToolDescriptors,
  rebuildBoardEnv,
  runTeachTool,
  TEACH_CODEX_TOOL_NAMES,
} from './board-env';

describe('board-env: 工具描述（schema 单一事实源 = teach-agent/tools.ts）', () => {
  it('导出 11 个工具（无 ask），inputSchema 是 JSON Schema', () => {
    const descriptors = listTeachToolDescriptors();
    expect(descriptors.map((d) => d.name)).toEqual([...TEACH_CODEX_TOOL_NAMES]);
    expect(descriptors).toHaveLength(11);
    expect(descriptors.map((d) => d.name)).not.toContain('ask');

    const write = descriptors.find((d) => d.name === 'write')!;
    const props = (write.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props).sort()).toEqual(['role', 'text']);
    expect(write.description).toContain('讲义');
  });
});

describe('board-env: 执行与 digest', () => {
  it('write 返回 BoardEnv digest 与 wN 引用', async () => {
    const env = createBoardEnv();
    const result = await runTeachTool(env, 'write', { text: '求根公式', role: 'title' });
    expect(result.ok).toBe(true);
    expect(result.ref).toBe('w1');
    expect(String(result.board)).toContain('第1页');
    expect(String(result.board)).toContain('w1「求根公式」');
  });

  it('wN 越界当场 ok:false（让模型自纠）；参数不合法也 ok:false', async () => {
    const env = createBoardEnv();
    const bad = await runTeachTool(env, 'circle', { target: 'w9' });
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toContain('wN');

    const invalid = await runTeachTool(env, 'write', { text: 123 });
    expect(invalid.ok).toBe(false);
    expect(String(invalid.error)).toContain('参数不合法');

    const unknown = await runTeachTool(env, 'shell_exec', {});
    expect(unknown.ok).toBe(false);
  });
});

describe('board-env: 事件日志重放恢复环境', () => {
  it('write/new_column/flip_page 重放后页码/栏号/清单一致', async () => {
    const env = await rebuildBoardEnv([
      { type: 'thread', threadId: 'x' },
      { type: 'text-delta', text: '讲课…' },
      { type: 'tool-call', id: 'a', name: 'write', args: { text: '课题', role: 'title' } },
      { type: 'tool-result', id: 'a', result: { ok: true } },
      { type: 'tool-call', id: 'b', name: 'write', args: { text: '定义', role: 'step' } },
      { type: 'tool-call', id: 'c', name: 'new_column', args: {} },
      { type: 'tool-call', id: 'd', name: 'flip_page', args: {} },
      { type: 'tool-call', id: 'e', name: 'write', args: { text: '第二页', role: 'title' } },
      // 失败调用（w9 不存在）不改变环境，重放天然一致
      { type: 'tool-call', id: 'f', name: 'circle', args: { target: 'w9' } },
    ]);
    expect(env.page).toBe(2);
    expect(env.column).toBe(1);
    expect(env.writes).toEqual(['第二页']);
  });
});
