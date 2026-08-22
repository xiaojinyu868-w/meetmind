import { describe, expect, it } from 'vitest';
import duplex from './duplex-session.js';

const {
  isDuplexAsrModel,
  resolveAsrWsUrl,
  generateDuplexTaskId,
  buildDuplexContextMessages,
  buildDuplexRunTask,
  buildDuplexContinueTask,
  buildDuplexFinishTask,
  parseDuplexServerEvent,
} = duplex;

describe('isDuplexAsrModel（按模型族分派协议）', () => {
  it('qwen-audio-3.0 / fun-asr 走新 duplex 协议', () => {
    expect(isDuplexAsrModel('qwen-audio-3.0-asr-flash-streaming')).toBe(true);
    expect(isDuplexAsrModel('qwen-audio-3.0-asr-flash')).toBe(true);
    expect(isDuplexAsrModel('fun-asr-realtime')).toBe(true);
    expect(isDuplexAsrModel('fun-asr-realtime-2025-11-07')).toBe(true);
  });

  it('qwen3-asr 走旧 Omni Realtime 协议', () => {
    expect(isDuplexAsrModel('qwen3-asr-flash-realtime-2026-02-10')).toBe(false);
    expect(isDuplexAsrModel('qwen3-asr-flash-2026-02-10')).toBe(false);
    expect(isDuplexAsrModel('')).toBe(false);
  });
});

describe('resolveAsrWsUrl', () => {
  it('新族默认 /api-ws/v1/inference 且不带 ?model=', () => {
    expect(resolveAsrWsUrl('qwen-audio-3.0-asr-flash-streaming', undefined)).toBe(
      'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
    );
  });

  it('旧族默认 /api-ws/v1/realtime?model=', () => {
    expect(resolveAsrWsUrl('qwen3-asr-flash-realtime-2026-02-10', undefined)).toBe(
      'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime-2026-02-10'
    );
  });

  it('env 覆盖优先（WorkspaceId 专属域名场景）', () => {
    const custom = 'wss://ws-xxx.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference';
    expect(resolveAsrWsUrl('qwen-audio-3.0-asr-flash-streaming', custom)).toBe(custom);
    expect(resolveAsrWsUrl('qwen3-asr-flash-realtime', custom)).toBe(custom);
  });
});

describe('generateDuplexTaskId', () => {
  it('生成 32 位 hex task_id', () => {
    const id = generateDuplexTaskId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(generateDuplexTaskId()).not.toBe(id);
  });
});

describe('buildDuplexRunTask', () => {
  it('构造官方 run-task 形状（task_group/task/function/model/parameters/input）', () => {
    const msg = buildDuplexRunTask({
      taskId: 'a'.repeat(32),
      model: 'qwen-audio-3.0-asr-flash-streaming',
      sampleRate: 16000,
      languageMode: 'auto',
      contextHint: '',
      maxSentenceSilenceMs: 1000,
    });

    expect(msg.header).toEqual({ action: 'run-task', task_id: 'a'.repeat(32), streaming: 'duplex' });
    expect(msg.payload.task_group).toBe('audio');
    expect(msg.payload.task).toBe('asr');
    expect(msg.payload.function).toBe('recognition');
    expect(msg.payload.model).toBe('qwen-audio-3.0-asr-flash-streaming');
    expect(msg.payload.parameters.format).toBe('pcm');
    expect(msg.payload.parameters.sample_rate).toBe(16000);
    expect(msg.payload.parameters.max_sentence_silence).toBe(1000);
    // 长静音段保活：默认 60s 无语音也会被服务端断开，课堂场景必须开
    expect(msg.payload.parameters.heartbeat).toBe(true);
    expect(msg.payload.input).toEqual({});
  });

  it('auto 模式省略 language_hints；zh/en 映射为 language_hints 数组', () => {
    const auto = buildDuplexRunTask({
      taskId: 't', model: 'm', sampleRate: 16000, languageMode: 'auto', contextHint: '',
    });
    expect('language_hints' in auto.payload.parameters).toBe(false);

    const zh = buildDuplexRunTask({
      taskId: 't', model: 'm', sampleRate: 16000, languageMode: 'zh', contextHint: '',
    });
    expect(zh.payload.parameters.language_hints).toEqual(['zh']);

    const en = buildDuplexRunTask({
      taskId: 't', model: 'm', sampleRate: 16000, languageMode: 'en', contextHint: '',
    });
    expect(en.payload.parameters.language_hints).toEqual(['en']);
  });

  it('contextHint 映射为 input.context 的 input_text 消息（每条约 400 字上限）', () => {
    const msg = buildDuplexRunTask({
      taskId: 't', model: 'm', sampleRate: 16000, languageMode: 'auto',
      contextHint: '线性代数；特征向量',
    });
    expect(msg.payload.input.context).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: '线性代数；特征向量' }] },
    ]);
  });

  it('长 contextHint 切分为最多 5 条 ≤400 字的消息', () => {
    const hint = 'x'.repeat(1200);
    const messages = buildDuplexContextMessages(hint);
    expect(messages.length).toBe(3);
    for (const m of messages) {
      expect(m.role).toBe('user');
      expect(m.content[0].type).toBe('input_text');
      expect(m.content[0].text.length).toBeLessThanOrEqual(400);
    }
    expect(buildDuplexContextMessages('x'.repeat(5000)).length).toBe(5);
    expect(buildDuplexContextMessages('')).toEqual([]);
  });

  it('max_sentence_silence 夹在官方区间 [200, 6000]', () => {
    const low = buildDuplexRunTask({ taskId: 't', model: 'm', sampleRate: 16000, maxSentenceSilenceMs: 50 });
    expect(low.payload.parameters.max_sentence_silence).toBe(200);
    const high = buildDuplexRunTask({ taskId: 't', model: 'm', sampleRate: 16000, maxSentenceSilenceMs: 99999 });
    expect(high.payload.parameters.max_sentence_silence).toBe(6000);
  });
});

describe('buildDuplexContinueTask / buildDuplexFinishTask', () => {
  it('continue-task 携带更新后的上下文', () => {
    const msg = buildDuplexContinueTask({ taskId: 't1', contextHint: '新术语' });
    expect(msg.header).toEqual({ action: 'continue-task', task_id: 't1', streaming: 'duplex' });
    expect(msg.payload.input.context[0].content[0].text).toBe('新术语');
  });

  it('finish-task 形状与官方一致', () => {
    expect(buildDuplexFinishTask('t1')).toEqual({
      header: { action: 'finish-task', task_id: 't1', streaming: 'duplex' },
      payload: { input: {} },
    });
  });
});

describe('parseDuplexServerEvent', () => {
  it('result-generated 定稿：映射 text/begin_time/end_time/sentence_end/words', () => {
    const parsed = parseDuplexServerEvent({
      header: { event: 'result-generated' },
      payload: {
        output: {
          sentence: {
            begin_time: 170,
            end_time: 920,
            text: '好，我知道了',
            sentence_end: true,
            words: [{ begin_time: 170, end_time: 295, text: '好', punctuation: '，' }],
          },
        },
      },
    });

    expect(parsed.event).toBe('result-generated');
    expect(parsed.sentence).toEqual({
      text: '好，我知道了',
      beginTime: 170,
      endTime: 920,
      isFinal: true,
      words: [{ begin_time: 170, end_time: 295, text: '好', punctuation: '，' }],
    });
  });

  it('result-generated 中间稿：sentence_end=false，end_time 可为 null', () => {
    const parsed = parseDuplexServerEvent({
      header: { event: 'result-generated' },
      payload: { output: { sentence: { begin_time: 0, end_time: null, text: '正在识别', sentence_end: false } } },
    });
    expect(parsed.sentence.isFinal).toBe(false);
    expect(parsed.sentence.endTime).toBeNull();
  });

  it('task-failed 提取 header.error_message', () => {
    const parsed = parseDuplexServerEvent({
      header: { event: 'task-failed', error_code: '401', error_message: 'Invalid API key' },
    });
    expect(parsed.event).toBe('task-failed');
    expect(parsed.errorMessage).toBe('401: Invalid API key');
  });

  it('task-started / task-finished 透传事件名', () => {
    expect(parseDuplexServerEvent({ header: { event: 'task-started' } }).event).toBe('task-started');
    expect(parseDuplexServerEvent({ header: { event: 'task-finished' } }).event).toBe('task-finished');
  });
});
