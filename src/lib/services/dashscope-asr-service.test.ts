import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DashScopeASRClient,
  type ASRSentence,
} from './dashscope-asr-service';

interface ClientInternals {
  isReady: boolean;
  isFlushing: boolean;
  audioQueue: ArrayBuffer[];
  connectionGeneration: number;
  ws: { readyState: number; send: (data: ArrayBuffer) => void } | null;
  flushAudioQueue: () => void;
  handleResult: (
    sentence: {
      id?: string;
      text?: string;
      beginTime?: number;
      endTime?: number | null;
      isFinal?: boolean;
      itemId?: string;
    },
    replaces?: string[],
  ) => void;
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
}

describe('DashScopeASRClient ordered handoff', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket,
    });
  });

  it('queues live PCM behind reconnect backlog instead of sending it out of order', () => {
    const client = new DashScopeASRClient('');
    const internals = client as unknown as ClientInternals;
    const sent: ArrayBuffer[] = [];
    const first = Uint8Array.from([1]).buffer;
    const second = Uint8Array.from([2]).buffer;

    internals.isReady = true;
    internals.isFlushing = true;
    internals.audioQueue = [first];
    internals.ws = {
      readyState: FakeWebSocket.OPEN,
      send: (data) => sent.push(data),
    };

    client.sendAudio(second);

    expect(sent).toEqual([]);
    expect(internals.audioQueue).toEqual([first, second]);

    internals.isFlushing = false;
    internals.flushAudioQueue();
    expect(sent).toEqual([first, second]);
  });

  it('namespaces remote ids per connection so engine switches cannot collide', () => {
    const sentences: ASRSentence[] = [];
    const client = new DashScopeASRClient('', {
      onSentence: (sentence) => sentences.push(sentence),
    });
    const internals = client as unknown as ClientInternals;

    internals.connectionGeneration = 1;
    internals.handleResult({
      id: 'seg-0',
      itemId: 'item-0',
      text: '旧引擎最后一句',
      beginTime: 0,
      endTime: 1000,
      isFinal: true,
    });
    internals.connectionGeneration = 2;
    internals.handleResult({
      id: 'seg-0',
      itemId: 'item-0',
      text: '新引擎第一句',
      beginTime: 1000,
      endTime: 2000,
      isFinal: true,
    });

    expect(sentences[0].id).not.toBe(sentences[1].id);
    expect(sentences[0].itemId).not.toBe(sentences[1].itemId);
  });
});
