import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fenshenCreateEgo,
  fenshenErrorMessage,
  fenshenFetchEvents,
  fenshenListEgos,
  fenshenPostFeedback,
  fenshenPostInterrupt,
  fenshenPostMessage,
} from './fenshen-client';

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fenshenErrorMessage', () => {
  it('优先掏 {error} 人可读消息；非 JSON / 缺字段回落 HTTP 状态码', async () => {
    await expect(
      fenshenErrorMessage(jsonResponse({ error: '分身还在备课' }, { status: 409 })),
    ).resolves.toBe('分身还在备课');
    await expect(
      fenshenErrorMessage(new Response('not json', { status: 502 })),
    ).resolves.toBe('HTTP 502');
    await expect(
      fenshenErrorMessage(jsonResponse({}, { status: 500 })),
    ).resolves.toBe('HTTP 500');
  });
});

describe('fenshen-client 请求形状（契约：api/fenshen/DOMAIN.md）', () => {
  it('listEgos 命中 GET /api/fenshen/egos 并返回 egos 数组', async () => {
    const spy = stubFetch(() => jsonResponse({ egos: [{ id: 'e1' }, { id: 'e2' }] }));
    await expect(fenshenListEgos()).resolves.toEqual([{ id: 'e1' }, { id: 'e2' }]);
    expect(spy).toHaveBeenCalledWith('/api/fenshen/egos', { cache: 'no-store' });
  });

  it('createEgo POST {name, sourceType, sourceRef?}，失败抛人可读 error', async () => {
    const spy = stubFetch(() => jsonResponse({ ego: { id: 'e1', status: 'learning' } }));
    await fenshenCreateEgo({ name: '孔子', sourceType: 'hall' });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/fenshen/egos');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: '孔子', sourceType: 'hall' });

    stubFetch(() => jsonResponse({ error: '这次没请成' }, { status: 500 }));
    await expect(
      fenshenCreateEgo({ name: 'X', sourceType: 'bilibili', sourceRef: 'https://b23.tv/1' }),
    ).rejects.toThrow('这次没请成');
  });

  it('fetchEvents 命中 GET .../events 返回事件日志（含 user-message）', async () => {
    stubFetch(() =>
      jsonResponse({
        events: [
          { type: 'user-message', text: '讲讲' },
          { type: 'text-delta', text: '好' },
        ],
      }),
    );
    const events = await fenshenFetchEvents('ego-9');
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'user-message', text: '讲讲' });
  });

  it('postMessage / postInterrupt / postFeedback 的 body 契约', async () => {
    const spy = stubFetch(() => jsonResponse({ ok: true }));

    await fenshenPostMessage('e1', '这节最难的是哪');
    await fenshenPostInterrupt('e1');
    await fenshenPostInterrupt('e1', '换个角度讲');
    await fenshenPostFeedback('e1', 'like');
    await fenshenPostFeedback('e1', 'unlike', '太像百科腔');

    const bodies = spy.mock.calls.map((call) => {
      const init = (call as unknown as [string, RequestInit])[1];
      return init?.body ? JSON.parse(String(init.body)) : {};
    });
    expect(bodies).toEqual([
      { text: '这节最难的是哪' },
      {},
      { text: '换个角度讲' },
      { verdict: 'like' },
      { verdict: 'unlike', note: '太像百科腔' },
    ]);

    const urls = spy.mock.calls.map((call) => String((call as unknown as [string])[0]));
    expect(urls).toEqual([
      '/api/fenshen/egos/e1/messages',
      '/api/fenshen/egos/e1/interrupt',
      '/api/fenshen/egos/e1/interrupt',
      '/api/fenshen/egos/e1/feedback',
      '/api/fenshen/egos/e1/feedback',
    ]);
  });

  it('egoId 进 URL 前 encodeURIComponent', async () => {
    const spy = stubFetch(() => jsonResponse({ ok: true }));
    await fenshenPostMessage('ego/奇怪', 'hi');
    expect(String((spy.mock.calls[0] as unknown as [string])[0])).toBe(
      '/api/fenshen/egos/ego%2F%E5%A5%87%E6%80%AA/messages',
    );
  });
});
