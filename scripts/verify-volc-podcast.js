#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';

const EventType = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFinished: 52,
  StartSession: 100,
  FinishSession: 102,
  SessionStarted: 150,
  SessionFinished: 152,
  UsageResponse: 154,
  PodcastRoundStart: 360,
  PodcastRoundResponse: 361,
  PodcastRoundEnd: 362,
  PodcastEnd: 363,
};

const MsgType = {
  FullClientRequest: 0b1,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  Error: 0b1111,
};

const Flag = {
  NoSeq: 0,
  WithEvent: 0b100,
};

const Serialization = {
  JSON: 0b1,
};

const Compression = {
  None: 0,
};

function u32be(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0, 0);
  return b;
}

function createMessage(type, flag) {
  return {
    version: 1,
    headerSize: 1, // 4-byte
    type,
    flag,
    serialization: Serialization.JSON,
    compression: Compression.None,
    event: undefined,
    sessionId: undefined,
    payload: new Uint8Array(0),
  };
}

function marshalMessage(msg) {
  const parts = [];
  const header = Buffer.alloc(4);
  header[0] = (msg.version << 4) | msg.headerSize;
  header[1] = (msg.type << 4) | msg.flag;
  header[2] = (msg.serialization << 4) | msg.compression;
  header[3] = 0;
  parts.push(header);

  if (msg.flag === Flag.WithEvent) {
    parts.push(u32be(msg.event || 0));
    if (
      msg.event !== EventType.StartConnection &&
      msg.event !== EventType.FinishConnection &&
      msg.event !== EventType.ConnectionStarted
    ) {
      const sid = Buffer.from(msg.sessionId || '', 'utf8');
      parts.push(u32be(sid.length));
      if (sid.length > 0) parts.push(sid);
    }
  }

  const payload = Buffer.from(msg.payload || []);
  parts.push(u32be(payload.length));
  if (payload.length > 0) parts.push(payload);

  return Buffer.concat(parts);
}

function readU32(data, offset) {
  if (offset + 4 > data.length) {
    throw new Error(`readU32 overflow at ${offset}, len=${data.length}`);
  }
  return data.readUInt32BE(offset);
}

function unmarshalMessage(raw) {
  const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (data.length < 4) {
    throw new Error(`message too short: ${data.length}`);
  }

  const msg = {
    version: data[0] >> 4,
    headerSize: data[0] & 0x0f,
    type: data[1] >> 4,
    flag: data[1] & 0x0f,
    serialization: data[2] >> 4,
    compression: data[2] & 0x0f,
    event: undefined,
    sessionId: undefined,
    connectId: undefined,
    errorCode: undefined,
    payload: Buffer.alloc(0),
  };

  let offset = msg.headerSize * 4;
  if (offset < 4) offset = 4;

  if (msg.type === MsgType.Error) {
    msg.errorCode = readU32(data, offset);
    offset += 4;
  }

  if (msg.flag === Flag.WithEvent) {
    msg.event = readU32(data, offset);
    offset += 4;

    if (
      msg.event !== EventType.StartConnection &&
      msg.event !== EventType.FinishConnection &&
      msg.event !== EventType.ConnectionStarted &&
      msg.event !== EventType.ConnectionFinished
    ) {
      const sidLen = readU32(data, offset);
      offset += 4;
      if (sidLen > 0) {
        msg.sessionId = data.slice(offset, offset + sidLen).toString('utf8');
        offset += sidLen;
      }
    }

    if (
      msg.event === EventType.ConnectionStarted ||
      msg.event === EventType.ConnectionFinished
    ) {
      const cidLen = readU32(data, offset);
      offset += 4;
      if (cidLen > 0) {
        msg.connectId = data.slice(offset, offset + cidLen).toString('utf8');
        offset += cidLen;
      }
    }
  }

  const payloadLen = readU32(data, offset);
  offset += 4;
  msg.payload = payloadLen > 0 ? data.slice(offset, offset + payloadLen) : Buffer.alloc(0);
  return msg;
}

function payloadToText(msg) {
  if (!msg.payload || msg.payload.length === 0) return '';
  return Buffer.from(msg.payload).toString('utf8');
}

function parsePayloadJson(msg) {
  const text = payloadToText(msg);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sendMessage(ws, msg) {
  return new Promise((resolve, reject) => {
    ws.send(marshalMessage(msg), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function sendEvent(ws, event, payloadObj, sessionId) {
  const msg = createMessage(MsgType.FullClientRequest, Flag.WithEvent);
  msg.event = event;
  msg.sessionId = sessionId;
  msg.payload = new TextEncoder().encode(JSON.stringify(payloadObj || {}));
  return sendMessage(ws, msg);
}

function receiveFactory(ws) {
  const queue = [];
  const waiters = [];

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = unmarshalMessage(raw);
    } catch (err) {
      msg = { type: MsgType.Error, errorCode: -1, payload: Buffer.from(String(err)) };
    }
    if (waiters.length > 0) {
      const r = waiters.shift();
      r(msg);
      return;
    }
    queue.push(msg);
  });

  return function receive() {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise((resolve) => waiters.push(resolve));
  };
}

async function waitForEvent(receive, expectedType, expectedEvent, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const timeout = Math.max(1, deadline - Date.now());
    const msg = await Promise.race([
      receive(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('wait event timeout')), timeout)),
    ]);

    if (msg.type === MsgType.Error) {
      throw new Error(`ServerError code=${msg.errorCode || 'unknown'} payload=${payloadToText(msg).slice(0, 400)}`);
    }
    if (msg.type === expectedType && msg.event === expectedEvent) {
      return msg;
    }
  }
  throw new Error(`waitForEvent timeout type=${expectedType} event=${expectedEvent}`);
}

async function main() {
  const appId = (process.env.VOLCENGINE_PODCAST_APP_ID || '').trim();
  const accessToken = (process.env.VOLCENGINE_PODCAST_ACCESS_TOKEN || process.env.VOLCENGINE_PODCAST_ACCESS_KEY || '').trim();
  const resourceId = (process.env.VOLCENGINE_PODCAST_RESOURCE_ID || 'volc.service_type.10050').trim();
  const appKey = (process.env.VOLCENGINE_PODCAST_APP_KEY || 'aGjiRDfUWi').trim();

  if (!appId || !accessToken || !resourceId || !appKey) {
    throw new Error('missing required envs: VOLCENGINE_PODCAST_APP_ID / VOLCENGINE_PODCAST_ACCESS_TOKEN / VOLCENGINE_PODCAST_RESOURCE_ID / VOLCENGINE_PODCAST_APP_KEY');
  }

  const inputText = process.argv.slice(2).join(' ').trim() || '介绍一下火山引擎';
  const sessionId = crypto.randomUUID();
  const connectId = crypto.randomUUID();
  const inputId = `verify_${Date.now()}`;

  const outDir = path.join(process.cwd(), 'test_screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `volc_podcast_verify_${Date.now()}.mp3`);
  const audioStream = fs.createWriteStream(outFile);

  const ws = new WebSocket(ENDPOINT, {
    headers: {
      'X-Api-App-Id': appId,
      'X-Api-App-Key': appKey,
      'X-Api-Access-Key': accessToken,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': connectId,
    },
    handshakeTimeout: 15000,
    skipUTF8Validation: true,
  });

  const events = new Map();
  let audioBytes = 0;
  let podcastEndMeta = null;
  let roundCount = 0;

  const receive = receiveFactory(ws);

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      reject(new Error(`unexpected-response ${res.statusCode} ${res.statusMessage}`));
    });
  });

  const reqPayload = {
    input_id: inputId,
    input_text: inputText,
    action: 0,
    scene: 'deep_research',
    use_head_music: false,
    use_tail_music: false,
    input_info: {
      return_audio_url: true,
    },
    audio_config: {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 0,
    },
  };

  await sendEvent(ws, EventType.StartConnection, {}, undefined);
  await waitForEvent(receive, MsgType.FullServerResponse, EventType.ConnectionStarted, 30000);

  await sendEvent(ws, EventType.StartSession, reqPayload, sessionId);
  await waitForEvent(receive, MsgType.FullServerResponse, EventType.SessionStarted, 30000);

  await sendEvent(ws, EventType.FinishSession, {}, sessionId);

  while (true) {
    const msg = await receive();

    if (msg.type === MsgType.Error) {
      throw new Error(`ServerError code=${msg.errorCode || 'unknown'} payload=${payloadToText(msg).slice(0, 500)}`);
    }

    if (msg.event !== undefined) {
      events.set(msg.event, (events.get(msg.event) || 0) + 1);
    }

    if (msg.event === EventType.PodcastRoundStart) {
      roundCount += 1;
      const body = parsePayloadJson(msg);
      const rid = typeof body?.round_id === 'number' ? body.round_id : -999;
      const speaker = body?.speaker || 'unknown';
      console.log(`[round-start] round_id=${rid} speaker=${speaker}`);
      continue;
    }

    if (msg.event === EventType.PodcastRoundResponse && msg.payload.length > 0) {
      audioStream.write(Buffer.from(msg.payload));
      audioBytes += msg.payload.length;
      continue;
    }

    if (msg.event === EventType.PodcastRoundEnd) {
      const body = parsePayloadJson(msg);
      if (body?.is_error) {
        throw new Error(`PodcastRoundEnd error: ${JSON.stringify(body)}`);
      }
      continue;
    }

    if (msg.event === EventType.PodcastEnd) {
      podcastEndMeta = parsePayloadJson(msg);
      continue;
    }

    if (msg.event === EventType.SessionFinished) {
      break;
    }
  }

  await sendEvent(ws, EventType.FinishConnection, {}, undefined);
  await waitForEvent(receive, MsgType.FullServerResponse, EventType.ConnectionFinished, 15000);

  await new Promise((resolve) => {
    audioStream.end(resolve);
  });
  ws.close();

  const summary = Array.from(events.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`)
    .join(',');

  const audioUrl = podcastEndMeta?.meta_info?.audio_url;
  console.log(`VERIFY_OK rounds=${roundCount} audio_bytes=${audioBytes} events={${summary}}`);
  if (typeof audioUrl === 'string' && audioUrl.length > 0) {
    console.log(`AUDIO_URL ${audioUrl.slice(0, 160)}...`);
  }
  console.log(`OUTPUT_FILE ${outFile}`);

  if (audioBytes <= 0) {
    throw new Error('verification failed: no audio bytes received');
  }
}

main().catch((err) => {
  console.error(`VERIFY_FAIL ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
