import { describe, expect, it } from 'vitest';
import {
  translateMessages,
  translateRequest,
  translateTools,
  ResponsesStreamBuilder,
  type ResponsesEvent,
} from './shim-translate';

describe('shim-translate: 请求侧（Responses → Chat）', () => {
  it('developer role 映射为 system（chat API 无 developer）', () => {
    const messages = translateMessages({
      input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '人设' }] }],
    });
    expect(messages[0]).toEqual({ role: 'system', content: '人设' });
  });

  it('instructions 置为 system 首条；字符串 input  shorthand 成 user message', () => {
    const messages = translateMessages({ instructions: '规则', input: '你好' });
    expect(messages).toEqual([
      { role: 'system', content: '规则' },
      { role: 'user', content: '你好' },
    ]);
  });

  it('parallel function_call 聚合成一条 assistant 消息的 tool_calls', () => {
    const messages = translateMessages({
      input: [
        { type: 'function_call', call_id: 'c1', name: 'write', arguments: '{"text":"a"}' },
        { type: 'function_call', call_id: 'c2', name: 'pause', arguments: '{"ms":500}' },
        { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
        { type: 'function_call_output', call_id: 'c2', output: '{"ok":true}' },
      ],
    });
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].tool_calls).toHaveLength(2);
    expect(messages[0].tool_calls![0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 'write', arguments: '{"text":"a"}' },
    });
    expect(messages[1]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
  });

  it('namespace(MCP) 工具展平为 flat 名，历史 item 带 namespace 时拼回', () => {
    const { tools, nsMap } = translateTools([
      {
        type: 'namespace',
        name: 'mcp__teach',
        tools: [
          { type: 'function', name: 'write', description: 'd', parameters: { type: 'object' } },
        ],
      },
    ]);
    expect(tools).toEqual([
      {
        type: 'function',
        function: { name: 'mcp__teach__write', description: 'd', parameters: { type: 'object' } },
      },
    ]);
    expect(nsMap['mcp__teach__write']).toEqual({ namespace: 'mcp__teach', name: 'write' });

    const messages = translateMessages({
      input: [
        { type: 'function_call', call_id: 'c1', namespace: 'mcp__teach', name: 'write', arguments: '{}' },
      ],
    });
    expect(messages[0].tool_calls![0].function.name).toBe('mcp__teach__write');
  });

  it('max_output_tokens/temperature 透传，store/previous_response_id 忽略', () => {
    const { chat } = translateRequest({
      model: 'm',
      input: 'x',
      max_output_tokens: 100,
      temperature: 0.5,
    });
    expect(chat.max_tokens).toBe(100);
    expect(chat.temperature).toBe(0.5);
    expect(chat.stream).toBe(true);
    expect(chat).not.toHaveProperty('store');
  });
});

describe('shim-translate: 响应侧（Chat SSE → Responses 事件）', () => {
  function types(events: ResponsesEvent[]): string[] {
    return events.map((e) => e.type);
  }

  it('文本 chunk → output_item.added + output_text.delta，finish 后幂等收尾', () => {
    const b = new ResponsesStreamBuilder('m');
    const e1 = b.handleChunk({ choices: [{ delta: { content: '好的' } }] });
    expect(types(e1)).toEqual([
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
    ]);
    const e2 = b.handleChunk({ choices: [{ delta: { content: '，' }, finish_reason: 'stop' }] });
    expect(types(e2)).toContain('response.output_text.delta');
    expect(types(e2)).toContain('response.output_item.done');
    const done = e2.find((e) => e.type === 'response.output_item.done') as {
      item: { content: { text: string }[] };
    };
    expect(done.item.content[0].text).toBe('好的，');
    // close 幂等：不再重复 done 事件，只补 completed
    const tail = b.close();
    expect(types(tail)).toEqual(['response.completed']);
  });

  it('reasoning_content 被忽略', () => {
    const b = new ResponsesStreamBuilder('m');
    const events = b.handleChunk({ choices: [{ delta: { reasoning_content: '想…' } }] });
    expect(events).toEqual([]);
  });

  it('工具调用 chunk 流 → function_call item，namespace 按 nsMap 还原', () => {
    const b = new ResponsesStreamBuilder('m', {
      mcp__teach__write: { namespace: 'mcp__teach', name: 'write' },
    });
    const e1 = b.handleChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'mcp__teach__write', arguments: '' } },
            ],
          },
        },
      ],
    });
    const added = e1.find((e) => e.type === 'response.output_item.added') as {
      item: { name: string; namespace?: string };
    };
    expect(added.item.name).toBe('write');
    expect(added.item.namespace).toBe('mcp__teach');

    b.handleChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"text":"x"}' } }] } }],
    });
    const e3 = b.handleChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const doneItem = e3.find((e) => e.type === 'response.output_item.done') as {
      item: { name: string; namespace?: string; arguments: string };
    };
    expect(doneItem.item.name).toBe('write');
    expect(doneItem.item.arguments).toBe('{"text":"x"}');

    const completed = b.close().find((e) => e.type === 'response.completed') as {
      response: { usage: { input_tokens: number; output_tokens: number } };
    };
    expect(completed.response.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  });

  it('缺 finish_reason 时 close() 兜底关闭所有 item', () => {
    const b = new ResponsesStreamBuilder('m');
    b.handleChunk({ choices: [{ delta: { content: '半句' } }] });
    const tail = b.close();
    expect(types(tail)).toContain('response.output_item.done');
    expect(types(tail)).toContain('response.completed');
  });
});
