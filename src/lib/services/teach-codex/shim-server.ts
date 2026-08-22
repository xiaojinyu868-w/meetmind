/**
 * shim HTTP 服务（127.0.0.1 常驻，Next 进程内单例）。
 *
 * codex config.toml 的 model_provider.base_url 指向这里（/v1/responses），
 * 本服务用 shim-translate 把请求翻译成上游 chat completions，再把上游 SSE
 * 翻译回 Responses 事件。只做协议翻译，不加编排逻辑；上游 baseUrl/apiKey
 * 来自 teach.config 的 provider 注册表。
 *
 * 生命周期由 teach-session-service 管：首次拉起会话时 ensureShimServer()，
 * 端口被占用则 GET /health 复用已有健康 shim（dev 热更/多进程场景）。
 */

import http from 'node:http';
import { createLogger } from '@/lib/logger';
import { resolveTeachProvider, teachProviderApiKey, TeachConfig } from '@/lib/config/teach.config';
import {
  translateRequest,
  ResponsesStreamBuilder,
  type ResponsesRequest,
} from './shim-translate';

const log = createLogger('teach-shim');

const HOST = '127.0.0.1';

function sseWrite(res: http.ServerResponse, obj: Record<string, unknown>) {
  res.write(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
}

/** 逐行解析上游 chat SSE，产出每个 data: payload 的 JSON */
async function* readSseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let dataLines: string[] = [];
  const flush = function* (): Generator<unknown> {
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    dataLines = [];
    if (payload === '[DONE]') return;
    try {
      yield JSON.parse(payload);
    } catch {
      // 忽略畸形 JSON 行
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        yield* flush();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      // event:/id:/retry:/注释行忽略
    }
  }
  yield* flush();
}

function jsonError(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message } }));
}

async function handleResponses(res: http.ServerResponse, bodyText: string) {
  let reqBody: ResponsesRequest;
  try {
    reqBody = JSON.parse(bodyText) as ResponsesRequest;
  } catch {
    jsonError(res, 400, 'invalid JSON body');
    return;
  }

  const provider = resolveTeachProvider();
  const apiKey = teachProviderApiKey(provider);
  if (!apiKey) {
    jsonError(res, 500, `teach provider ${provider.id} 未配置 ${provider.apiKeyEnv}`);
    return;
  }

  const clientWantsStream = reqBody.stream === true;
  const { chat, nsMap } = translateRequest(reqBody);
  if (!chat.model) {
    jsonError(res, 400, 'missing model');
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(chat),
    });
  } catch (cause) {
    log.error('upstream fetch failed', { error: cause instanceof Error ? cause.message : String(cause) });
    jsonError(res, 502, `upstream fetch failed: ${cause instanceof Error ? cause.message : cause}`);
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    log.warn('upstream http error', { status: upstream.status, body: text.slice(0, 500) });
    let message = text;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      message = j.error?.message || text;
    } catch {
      // 保留原文
    }
    jsonError(res, upstream.status || 502, message);
    return;
  }

  const builder = new ResponsesStreamBuilder(chat.model, nsMap);

  if (clientWantsStream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    sseWrite(res, builder.createdEvent());
    try {
      for await (const chunk of readSseLines(upstream.body)) {
        for (const event of builder.handleChunk(chunk)) sseWrite(res, event);
      }
    } catch (cause) {
      log.error('error reading upstream stream', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
    for (const event of builder.close()) sseWrite(res, event); // 幂等收尾
    res.end();
    return;
  }

  // 非流式：聚合后返回单个 response 对象
  try {
    for await (const chunk of readSseLines(upstream.body)) {
      builder.handleChunk(chunk);
    }
  } catch (cause) {
    jsonError(res, 502, `upstream stream error: ${cause instanceof Error ? cause.message : cause}`);
    return;
  }
  builder.close();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(builder.finalResponse()));
}

function createShimHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}`);
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/v1/responses' || url.pathname === '/responses')) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      await handleResponses(res, Buffer.concat(chunks).toString('utf8'));
      return;
    }
    jsonError(res, 404, `not found: ${req.method} ${url.pathname}`);
  });
}

// ---------- 单例生命周期（dev 热更安全：挂 globalThis） ----------

interface ShimState {
  server: http.Server | null;
  starting: Promise<void> | null;
}

const globalForShim = globalThis as unknown as { __teachShim?: ShimState };
const state: ShimState = globalForShim.__teachShim ?? { server: null, starting: null };
globalForShim.__teachShim = state;

async function healthOk(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 确保 shim 在跑（幂等）。端口被占用时复用已有健康 shim，否则抛错。 */
export async function ensureShimServer(): Promise<{ port: number; baseUrl: string }> {
  const port = TeachConfig.shimPort;
  if (state.server) return { port, baseUrl: `http://${HOST}:${port}/v1` };
  if (state.starting) {
    await state.starting;
    return { port, baseUrl: `http://${HOST}:${port}/v1` };
  }

  state.starting = new Promise<void>((resolve, reject) => {
    const server = createShimHttpServer();
    server.on('error', async (cause: NodeJS.ErrnoException) => {
      if (cause.code === 'EADDRINUSE' && (await healthOk(port))) {
        log.info('shim port busy, reusing healthy instance', { port });
        state.starting = null;
        resolve();
        return;
      }
      state.starting = null;
      reject(cause);
    });
    server.listen(port, HOST, () => {
      state.server = server;
      state.starting = null;
      log.info('shim listening', { port, provider: resolveTeachProvider().id });
      resolve();
    });
  });
  await state.starting;
  return { port, baseUrl: `http://${HOST}:${port}/v1` };
}
