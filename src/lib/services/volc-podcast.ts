import { randomUUID } from 'crypto';
import type WebSocket from 'ws';

function getWebSocketConstructor(): typeof WebSocket {
  process.env.WS_NO_BUFFER_UTIL = process.env.WS_NO_BUFFER_UTIL || '1';
  process.env.WS_NO_UTF_8_VALIDATE = process.env.WS_NO_UTF_8_VALIDATE || '1';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wsModule = require('ws') as { default?: typeof WebSocket };
  return (wsModule.default || (wsModule as unknown as typeof WebSocket));
}

const WebSocketCtor = getWebSocketConstructor();
const WS_OPEN_STATE = (WebSocketCtor as unknown as { OPEN?: number }).OPEN ?? 1;

const PODCAST_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
const DEFAULT_RESOURCE_ID = 'volc.service_type.10050';
const DEFAULT_APP_KEY = 'aGjiRDfUWi';

enum EventType {
  StartConnection = 1,
  FinishConnection = 2,
  ConnectionStarted = 50,
  ConnectionFinished = 52,
  StartSession = 100,
  FinishSession = 102,
  SessionStarted = 150,
  SessionFinished = 152,
  UsageResponse = 154,
  PodcastRoundStart = 360,
  PodcastRoundResponse = 361,
  PodcastRoundEnd = 362,
  PodcastEnd = 363,
}

enum MessageType {
  FullClientRequest = 0b0001,
  FullServerResponse = 0b1001,
  AudioOnlyServer = 0b1011,
  Error = 0b1111,
}

enum MessageFlag {
  NoSeq = 0b0000,
  WithEvent = 0b0100,
}

enum SerializationMethod {
  Raw = 0b0000,
  Json = 0b0001,
}

enum CompressionMethod {
  None = 0b0000,
}

interface WireMessage {
  version: number;
  headerSize: number;
  type: number;
  flag: number;
  serialization: number;
  compression: number;
  event?: number;
  sessionId?: string;
  payload: Uint8Array;
}

interface ParsedMessage {
  type: number;
  flag: number;
  event?: number;
  sessionId?: string;
  connectionId?: string;
  errorCode?: number;
  payload: Buffer;
}

interface PodcastCredentials {
  appId: string;
  accessToken: string;
  resourceId: string;
  appKey: string;
}

export interface VolcPodcastParams {
  inputText: string;
  inputId?: string;
  sessionId?: string;
  requestId?: string;
  timeoutMs?: number;
  useHeadMusic?: boolean;
  useTailMusic?: boolean;
  speechRate?: number;
  sampleRate?: 16000 | 24000 | 48000;
  format?: 'mp3' | 'ogg_opus' | 'aac' | 'pcm';
}

export interface VolcPodcastRound {
  roundId: number;
  speaker?: string;
  text?: string;
}

export interface VolcPodcastResult {
  inputId: string;
  sessionId: string;
  requestId: string;
  audioUrl?: string;
  audioBytes: number;
  roundCount: number;
  rounds: VolcPodcastRound[];
  usage: {
    inputTextTokens: number;
    outputAudioTokens: number;
  };
  events: Record<string, number>;
  trace: string[];
}

function readConfig(): PodcastCredentials | null {
  const appId = (process.env.VOLCENGINE_PODCAST_APP_ID || '').trim();
  const accessToken = (
    process.env.VOLCENGINE_PODCAST_ACCESS_TOKEN ||
    process.env.VOLCENGINE_PODCAST_ACCESS_KEY ||
    ''
  ).trim();
  const resourceId = (process.env.VOLCENGINE_PODCAST_RESOURCE_ID || DEFAULT_RESOURCE_ID).trim();
  const appKey = (process.env.VOLCENGINE_PODCAST_APP_KEY || DEFAULT_APP_KEY).trim();

  if (!appId || !accessToken || !resourceId || !appKey) {
    return null;
  }

  return {
    appId,
    accessToken,
    resourceId,
    appKey,
  };
}

export function isVolcPodcastEnabled(): boolean {
  return readConfig() !== null;
}

function u32be(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function createMessage(type: number, flag: number): WireMessage {
  return {
    version: 1,
    headerSize: 1,
    type,
    flag,
    serialization: SerializationMethod.Json,
    compression: CompressionMethod.None,
    payload: new Uint8Array(0),
  };
}

function marshalMessage(message: WireMessage): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(4);
  header[0] = (message.version << 4) | message.headerSize;
  header[1] = (message.type << 4) | message.flag;
  header[2] = (message.serialization << 4) | message.compression;
  header[3] = 0;
  chunks.push(header);

  if (message.flag === MessageFlag.WithEvent) {
    chunks.push(u32be(message.event || 0));
    if (
      message.event !== EventType.StartConnection &&
      message.event !== EventType.FinishConnection &&
      message.event !== EventType.ConnectionStarted
    ) {
      const sessionIdBuffer = Buffer.from(message.sessionId || '', 'utf8');
      chunks.push(u32be(sessionIdBuffer.length));
      if (sessionIdBuffer.length > 0) {
        chunks.push(sessionIdBuffer);
      }
    }
  }

  const payloadBuffer = Buffer.from(message.payload || []);
  chunks.push(u32be(payloadBuffer.length));
  if (payloadBuffer.length > 0) {
    chunks.push(payloadBuffer);
  }

  return Buffer.concat(chunks);
}

function readU32(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) {
    throw new Error(`readU32 越界：offset=${offset}, length=${buffer.length}`);
  }
  return buffer.readUInt32BE(offset);
}

function unmarshalMessage(raw: unknown): ParsedMessage {
  let buffer: Buffer;
  if (Buffer.isBuffer(raw)) {
    buffer = raw;
  } else if (raw instanceof ArrayBuffer) {
    buffer = Buffer.from(raw);
  } else if (ArrayBuffer.isView(raw)) {
    buffer = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  } else if (Array.isArray(raw)) {
    buffer = Buffer.concat(
      raw.map((item) => {
        if (Buffer.isBuffer(item)) return item;
        if (item instanceof ArrayBuffer) return Buffer.from(item);
        if (ArrayBuffer.isView(item)) return Buffer.from(item.buffer, item.byteOffset, item.byteLength);
        return Buffer.from(String(item), 'utf8');
      })
    );
  } else {
    buffer = Buffer.from(String(raw ?? ''), 'utf8');
  }

  if (buffer.length < 4) {
    throw new Error(`消息过短：${buffer.length}`);
  }

  const parsed: ParsedMessage = {
    type: buffer[1] >> 4,
    flag: buffer[1] & 0x0f,
    payload: Buffer.alloc(0),
  };

  const headerSize = buffer[0] & 0x0f;
  let offset = Math.max(4, headerSize * 4);

  if (parsed.type === MessageType.Error) {
    parsed.errorCode = readU32(buffer, offset);
    offset += 4;
  }

  if (parsed.flag === MessageFlag.WithEvent) {
    parsed.event = readU32(buffer, offset);
    offset += 4;

    if (
      parsed.event !== EventType.StartConnection &&
      parsed.event !== EventType.FinishConnection &&
      parsed.event !== EventType.ConnectionStarted &&
      parsed.event !== EventType.ConnectionFinished
    ) {
      const sessionLength = readU32(buffer, offset);
      offset += 4;
      if (sessionLength > 0) {
        parsed.sessionId = buffer.slice(offset, offset + sessionLength).toString('utf8');
        offset += sessionLength;
      }
    }

    if (parsed.event === EventType.ConnectionStarted || parsed.event === EventType.ConnectionFinished) {
      const connectionLength = readU32(buffer, offset);
      offset += 4;
      if (connectionLength > 0) {
        parsed.connectionId = buffer.slice(offset, offset + connectionLength).toString('utf8');
        offset += connectionLength;
      }
    }
  }

  const payloadLength = readU32(buffer, offset);
  offset += 4;
  parsed.payload = payloadLength > 0 ? buffer.slice(offset, offset + payloadLength) : Buffer.alloc(0);
  return parsed;
}

function parsePayloadJson(message: ParsedMessage): Record<string, unknown> | null {
  if (!message.payload || message.payload.length === 0) return null;
  try {
    return JSON.parse(message.payload.toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sendMessage(ws: WebSocket, message: WireMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(marshalMessage(message), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function sendEvent(
  ws: WebSocket,
  event: EventType,
  payload: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  const message = createMessage(MessageType.FullClientRequest, MessageFlag.WithEvent);
  message.event = event;
  message.sessionId = sessionId;
  message.payload = Buffer.from(JSON.stringify(payload || {}), 'utf8');
  return sendMessage(ws, message);
}

function createReceiveQueue(ws: WebSocket): () => Promise<ParsedMessage> {
  const queue: ParsedMessage[] = [];
  const waiters: Array<(message: ParsedMessage) => void> = [];

  const push = (message: ParsedMessage) => {
    if (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.(message);
      return;
    }
    queue.push(message);
  };

  ws.on('message', (raw) => {
    try {
      push(unmarshalMessage(raw));
    } catch (error) {
      push({
        type: MessageType.Error,
        flag: MessageFlag.NoSeq,
        errorCode: -1,
        payload: Buffer.from(error instanceof Error ? error.message : String(error), 'utf8'),
      });
    }
  });

  ws.on('close', (code, reason) => {
    const reasonText = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '');
    push({
      type: MessageType.Error,
      flag: MessageFlag.NoSeq,
      errorCode: code || -1,
      payload: Buffer.from(`WebSocket closed: ${reasonText}`, 'utf8'),
    });
  });

  return () => {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift() as ParsedMessage);
    }
    return new Promise<ParsedMessage>((resolve) => {
      waiters.push(resolve);
    });
  };
}

async function receiveWithTimeout(
  receive: () => Promise<ParsedMessage>,
  timeoutMs: number,
  timeoutLabel: string
): Promise<ParsedMessage> {
  return Promise.race([
    receive(),
    new Promise<ParsedMessage>((_, reject) => {
      setTimeout(() => reject(new Error(`${timeoutLabel} 超时（${timeoutMs}ms）`)), timeoutMs);
    }),
  ]);
}

async function waitForEvent(
  receive: () => Promise<ParsedMessage>,
  type: number,
  event: EventType,
  timeoutMs: number
): Promise<ParsedMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await receiveWithTimeout(receive, Math.max(1, deadline - Date.now()), '等待事件');
    if (message.type === MessageType.Error) {
      throw new Error(
        `服务端错误 code=${message.errorCode ?? 'unknown'} ${message.payload.toString('utf8').slice(0, 260)}`
      );
    }
    if (message.type === type && message.event === event) {
      return message;
    }
  }
  throw new Error(`等待事件失败：type=${type}, event=${event}`);
}

function sanitizeInputText(inputText: string): string {
  const compact = (inputText || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= 12000) return compact;
  return compact.slice(0, 12000);
}

export async function generateVolcPodcast(params: VolcPodcastParams): Promise<VolcPodcastResult> {
  const credentials = readConfig();
  if (!credentials) {
    throw new Error(
      '火山播客参数未配置，请设置 VOLCENGINE_PODCAST_APP_ID 和 VOLCENGINE_PODCAST_ACCESS_TOKEN'
    );
  }

  const timeoutMs = Math.max(30_000, params.timeoutMs ?? 180_000);
  const inputText = sanitizeInputText(params.inputText);
  if (!inputText) {
    throw new Error('播客输入文本为空');
  }

  const inputId = params.inputId || `meetmind_${Date.now()}`;
  const sessionId = params.sessionId || randomUUID();
  const requestId = params.requestId || randomUUID();
  const trace: string[] = [];

  const ws = new WebSocketCtor(PODCAST_ENDPOINT, {
    headers: {
      'X-Api-App-Id': credentials.appId,
      'X-Api-App-Key': credentials.appKey,
      'X-Api-Access-Key': credentials.accessToken,
      'X-Api-Resource-Id': credentials.resourceId,
      'X-Api-Request-Id': requestId,
    },
    handshakeTimeout: 15_000,
    skipUTF8Validation: true,
  });

  const receive = createReceiveQueue(ws);
  const events = new Map<number, number>();
  const rounds: VolcPodcastRound[] = [];
  let audioBytes = 0;
  let roundCount = 0;
  let audioUrl = '';
  const usage = { inputTextTokens: 0, outputAudioTokens: 0 };

  const requestPayload: Record<string, unknown> = {
    input_id: inputId,
    input_text: inputText,
    action: 0,
    scene: 'deep_research',
    use_head_music: params.useHeadMusic ?? false,
    use_tail_music: params.useTailMusic ?? false,
    input_info: {
      return_audio_url: true,
      input_text_max_length: 12_000,
    },
    audio_config: {
      format: params.format ?? 'mp3',
      sample_rate: params.sampleRate ?? 24_000,
      speech_rate: params.speechRate ?? 0,
    },
  };

  const settleOpen = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (error) => reject(error));
    ws.once('unexpected-response', (_request, response) => {
      reject(new Error(`建连失败：${response.statusCode} ${response.statusMessage}`));
    });
  });

  await Promise.race([
    settleOpen,
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('建连超时')), Math.min(20_000, timeoutMs));
    }),
  ]);
  trace.push('connection=open');

  let needClose = true;
  try {
    await sendEvent(ws, EventType.StartConnection, {});
    await waitForEvent(receive, MessageType.FullServerResponse, EventType.ConnectionStarted, 30_000);
    trace.push('event=ConnectionStarted');

    await sendEvent(ws, EventType.StartSession, requestPayload, sessionId);
    await waitForEvent(receive, MessageType.FullServerResponse, EventType.SessionStarted, 30_000);
    trace.push('event=SessionStarted');

    await sendEvent(ws, EventType.FinishSession, {}, sessionId);

    const loopDeadline = Date.now() + timeoutMs;
    while (Date.now() < loopDeadline) {
      const message = await receiveWithTimeout(receive, Math.max(1, loopDeadline - Date.now()), '接收播客流');

      if (message.type === MessageType.Error) {
        throw new Error(
          `服务端错误 code=${message.errorCode ?? 'unknown'} ${message.payload.toString('utf8').slice(0, 260)}`
        );
      }

      if (typeof message.event === 'number') {
        events.set(message.event, (events.get(message.event) || 0) + 1);
      }

      if (message.event === EventType.PodcastRoundStart) {
        roundCount += 1;
        const body = parsePayloadJson(message);
        rounds.push({
          roundId: typeof body?.round_id === 'number' ? body.round_id : roundCount,
          speaker: typeof body?.speaker === 'string' ? body.speaker : undefined,
          text: typeof body?.text === 'string' ? body.text : undefined,
        });
        continue;
      }

      if (message.event === EventType.PodcastRoundResponse) {
        if (message.payload.length > 0) {
          audioBytes += message.payload.length;
        }
        continue;
      }

      if (message.event === EventType.UsageResponse) {
        const body = parsePayloadJson(message);
        const usageBody = body?.usage as Record<string, unknown> | undefined;
        const inputTextTokens = Number(usageBody?.input_text_tokens || 0);
        const outputAudioTokens = Number(usageBody?.output_audio_tokens || 0);
        usage.inputTextTokens += Number.isFinite(inputTextTokens) ? inputTextTokens : 0;
        usage.outputAudioTokens += Number.isFinite(outputAudioTokens) ? outputAudioTokens : 0;
        continue;
      }

      if (message.event === EventType.PodcastRoundEnd) {
        const body = parsePayloadJson(message);
        if (body?.is_error === true) {
          throw new Error(`播客轮次失败：${JSON.stringify(body)}`);
        }
        continue;
      }

      if (message.event === EventType.PodcastEnd) {
        const body = parsePayloadJson(message);
        const metaInfo = body?.meta_info as Record<string, unknown> | undefined;
        if (typeof metaInfo?.audio_url === 'string') {
          audioUrl = metaInfo.audio_url;
        }
        continue;
      }

      if (message.event === EventType.SessionFinished) {
        trace.push('event=SessionFinished');
        break;
      }
    }

    await sendEvent(ws, EventType.FinishConnection, {});
    await waitForEvent(receive, MessageType.FullServerResponse, EventType.ConnectionFinished, 20_000);
    trace.push('event=ConnectionFinished');

    needClose = false;
    ws.close();
  } finally {
    if (needClose && ws.readyState === WS_OPEN_STATE) {
      try {
        await sendEvent(ws, EventType.FinishConnection, {});
      } catch {
        // ignore
      }
      ws.close();
    }
  }

  if (!audioUrl && audioBytes <= 0) {
    throw new Error('播客未返回可用音频');
  }

  return {
    inputId,
    sessionId,
    requestId,
    audioUrl: audioUrl || undefined,
    audioBytes,
    roundCount,
    rounds,
    usage,
    events: Object.fromEntries(
      Array.from(events.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([event, count]) => [String(event), count])
    ),
    trace,
  };
}
