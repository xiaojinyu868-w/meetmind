import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  submitDiarizationTask,
  runDiarization,
} from './diarization-tasks';

const TASK_ID = 'task-abc';

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status })) as unknown as ReturnType<typeof fetch>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('submitDiarizationTask', () => {
  it('submits next-gen filetrans model with diarization enabled', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ output: { task_id: TASK_ID } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitDiarizationTask('https://example.com/a.mp3', 'sk-test', 'zh');

    expect(result).toEqual({ success: true, taskId: TASK_ID });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('qwen-audio-3.0-asr-flash-filetrans');
    expect(body.input.file_urls).toEqual(['https://example.com/a.mp3']);
    expect(body.parameters.diarization_enabled).toBe(true);
    expect(body.parameters.language_hints).toEqual(['zh']);
    // 新族参数表没有这两个旧字段
    expect(body.parameters.language).toBeUndefined();
    expect(body.parameters.enable_itn).toBeUndefined();
  });
});

describe('runDiarization', () => {
  it('reads transcription_url from output.results[0] (next-gen shape)', async () => {
    const sentences = [{ text: '你好', begin_time: 0, end_time: 900, speaker_id: 1 }];
    const fetchMock = vi.fn()
      // submit
      .mockImplementationOnce(() => jsonResponse({ output: { task_id: TASK_ID } }))
      // query: SUCCEEDED，结果 URL 在新族位置
      .mockImplementationOnce(() => jsonResponse({
        output: {
          task_status: 'SUCCEEDED',
          results: [{ transcription_url: 'https://oss.example.com/result.json', subtask_status: 'SUCCEEDED' }],
        },
      }))
      // fetch result json
      .mockImplementationOnce(() => jsonResponse({ transcripts: [{ sentences }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runDiarization('https://example.com/a.mp3', 'sk-test', 'zh');

    expect(result.success).toBe(true);
    expect(result.sentences).toEqual([{ text: '你好', beginTime: 0, endTime: 900, speakerId: 1 }]);
    expect(result.speakerCount).toBe(2);
  });

  it('fails fast when task succeeds but subtask failed (no result URL)', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({ output: { task_id: TASK_ID } }))
      .mockImplementationOnce(() => jsonResponse({
        output: {
          task_status: 'SUCCEEDED',
          results: [{ code: 'FILE_DOWNLOAD_FAILED', message: 'FILE_DOWNLOAD_FAILED', subtask_status: 'FAILED' }],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runDiarization('https://example.com/a.mp3', 'sk-test', 'zh');

    expect(result.success).toBe(false);
    expect(result.error).toBe('FILE_DOWNLOAD_FAILED');
    // 快速失败：不再空转轮询
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
