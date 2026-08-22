const fs = require('fs');
const path = require('path');
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
} else {
  require('dotenv').config({ path: '.env' });
}

const { createServer, request: httpRequest } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer, WebSocket } = require('ws');
const { installGracefulShutdown, resolveServerHost } = require('./server/runtime-lifecycle');

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = resolveServerHost({ dev, configuredHost: process.env.HOST });
const port = parseInt(process.env.PORT || '3001', 10);
const devDistDir = process.env.NEXT_DEV_DIST_DIR || '.next-dev';
const activeDistDir = dev ? devDistDir : '.next';

// Guard against "node -e require('./server.js')" startup.
// Next worker processes inherit execArgv; leaving -e here can recursively restart this server in children.
if (Array.isArray(process.execArgv) && process.execArgv.length > 0) {
  const evalIndex = process.execArgv.findIndex((arg) => arg === '-e' || arg === '--eval');
  if (evalIndex !== -1) {
    const removed = process.execArgv.slice(evalIndex, evalIndex + 2).join(' ');
    process.execArgv.splice(evalIndex, 2);
    console.warn(`[Server] Detected eval startup args ("${removed}"). Sanitized worker execArgv to avoid recursive boot.`);
  }
}

const app = next({ dev, hostname, port, conf: { distDir: activeDistDir } });
const handle = app.getRequestHandler();

// ============================================================
// ASR 工具函数从 ./server/asr/text-utils.js 引入（M1 提纯，抽出后带单测）
// ============================================================
const {
  normalizeCompareText: _unusedNormalize, // 保留导出以便日后可能的调试
  longestCommonSubstringRatio,
  shouldDedupSegment,
  splitLongTranscript,
  extractItemId,
  extractFinalText,
  extractServerTimestamp,
  extractInterimPayload,
  isIgnorableCommitError,
  isIgnorableSessionUpdateError,
  isLikelyHallucination,
} = require('./server/asr/text-utils');
const { buildQwenAsrFinishEvent, buildQwenAsrSessionConfig } = require('./server/asr/qwen-session');
// 新一代 Qwen-Audio-3.0-ASR / Fun-ASR 的 duplex 任务协议（与旧 Omni Realtime 协议按模型族分派）
const {
  isDuplexAsrModel,
  resolveAsrWsUrl,
  generateDuplexTaskId,
  buildDuplexRunTask,
  buildDuplexContinueTask,
  buildDuplexFinishTask,
  parseDuplexServerEvent,
} = require('./server/asr/duplex-session');
void _unusedNormalize;
void longestCommonSubstringRatio;

let eventCounter = 0;
function generateEventId() {
  return `event_${Date.now()}_${eventCounter++}`;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// 积分 Phase 2：ASR 连接关闭后按连接时长回调节点内结算接口。
// server.js 是纯 Node 不能 import src TS，走 127.0.0.1 内部 HTTP；
// INTERNAL_API_SECRET 未配置时静默跳过（settle 路由侧同样拒绝），绝不阻塞 ASR。
function settleAsrUsageOnClose({ connectionId, connectedAtMs, token, guestKey }) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return;
  const durationMs = Date.now() - connectedAtMs;
  const payload = JSON.stringify({
    connectionId,
    durationMs,
    token: token || undefined,
    guestKey: guestKey || undefined,
  });
  const req = httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/points/settle-asr',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-internal-secret': secret,
      },
      timeout: 10_000,
    },
    (res) => {
      res.resume();
    }
  );
  req.on('timeout', () => req.destroy());
  req.on('error', (error) => {
    console.warn('[ASR-Proxy] points settle request failed:', error.message);
  });
  req.end(payload);
}

// ASR 录课前服务端额度预检（L1/L3 堵漏：登录用户免费分钟+余额、guest 日分钟上限）。
// 返回 Promise<{ allowed, reason? }>；secret 未配置 / 请求失败一律 fail-open（allowed:true），
// 与结算路径"绝不阻塞 ASR"的行为一致。
function precheckAsrAllowance({ token, guestKey }) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return Promise.resolve({ allowed: true });
  const payload = JSON.stringify({
    token: token || undefined,
    guestKey: guestKey || undefined,
  });
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/points/precheck-asr',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-internal-secret': secret,
        },
        timeout: 5_000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve({ allowed: parsed.allowed !== false, reason: parsed.reason });
          } catch {
            resolve({ allowed: true });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ allowed: true }); });
    req.on('error', () => resolve({ allowed: true }));
    req.end(payload);
  });
}

// 与 point-meter.meterUserIdFromRequest 同一取头顺序，保证 guest 归属键一致
function guestKeyFromRequest(request) {
  const headers = request?.headers || {};
  const forwarded = typeof headers['x-forwarded-for'] === 'string'
    ? headers['x-forwarded-for'].split(',')[0].trim()
    : '';
  const ip = forwarded
    || (typeof headers['x-real-ip'] === 'string' ? headers['x-real-ip'].trim() : '')
    || request?.socket?.remoteAddress
    || '';
  return ip ? `guest_${ip}` : '';
}

function isMissingNextChunkError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const missingChunkPattern = /Cannot find module '\.\/\d+\.js'/;
  return missingChunkPattern.test(message) && (
    stack.includes(`${path.sep}${activeDistDir}${path.sep}server${path.sep}webpack-runtime.js`) ||
    message.includes('webpack-runtime.js')
  );
}

let isRecoveringDevCache = false;
function recoverDevBuildCacheIfNeeded(error) {
  if (!dev || isRecoveringDevCache || !isMissingNextChunkError(error)) {
    return false;
  }

  isRecoveringDevCache = true;
  const absDistDir = path.join(process.cwd(), activeDistDir);

  try {
    fs.rmSync(absDistDir, { recursive: true, force: true });
    console.warn(`[Server] Cleared corrupted Next.js dev cache: ${absDistDir}`);
  } catch (cleanupError) {
    console.warn('[Server] Failed to clear corrupted Next.js dev cache:', cleanupError);
  }

  setTimeout(() => {
    isRecoveringDevCache = false;
  }, 5000);

  return true;
}

function getRuntimeMediaMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.amr': 'audio/amr',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function tryServeRuntimePublicFile(pathname, req, res) {
  if (!pathname) return false;

  const mappings = [
    {
      prefix: '/temp-audio/',
      baseDir: path.join(process.cwd(), 'public', 'temp-audio'),
    },
    {
      prefix: '/wechat-media/',
      baseDir: path.join(process.cwd(), 'public', 'wechat-media'),
    },
  ];

  for (const mapping of mappings) {
    if (!pathname.startsWith(mapping.prefix)) {
      continue;
    }

    const relativePath = decodeURIComponent(pathname.slice(mapping.prefix.length));
    const safeRelativePath = path.posix.normalize(relativePath).replace(/^\/+/, '');
    const resolvedBaseDir = path.resolve(mapping.baseDir);
    const resolvedFilePath = path.resolve(mapping.baseDir, safeRelativePath);

    if (!safeRelativePath || safeRelativePath.includes('..') || !resolvedFilePath.startsWith(`${resolvedBaseDir}${path.sep}`)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return true;
    }

    try {
      if (fs.existsSync(resolvedFilePath)) {
        const stat = fs.statSync(resolvedFilePath);
        const total = stat.size;
        res.setHeader('Content-Type', getRuntimeMediaMimeType(resolvedFilePath));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

        // Range 请求 → 206 Partial Content：<audio> seek（点时间戳跳转）依赖它，
        // 全量 200 响应会让浏览器把媒体判定为不可拖动，长音频 currentTime 会被钳回 0
        const rangeHeader = req && req.headers ? req.headers.range : undefined;
        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = match[1] ? parseInt(match[1], 10) : 0;
            const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
            if (start >= total || start > end) {
              res.statusCode = 416;
              res.setHeader('Content-Range', `bytes */${total}`);
              res.end();
              return true;
            }
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', end - start + 1);
            fs.createReadStream(resolvedFilePath, { start, end }).pipe(res);
            return true;
          }
        }

        res.setHeader('Content-Length', total);
        fs.createReadStream(resolvedFilePath).pipe(res);
        return true;
      }
    } catch {
      // fall through to 404
    }

    res.statusCode = 404;
    res.end('Not Found');
    return true;
  }

  return false;
}

console.log('[Server] Starting app.prepare()...');
console.log(`[Server] Environment: ${process.env.NODE_ENV}, distDir: ${activeDistDir}`);

app.prepare().then(() => {
  console.log('[Server] app.prepare() completed');
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);

      // 处理运行时生成的媒体文件请求（如 temp-audio / wechat-media）
      if (tryServeRuntimePublicFile(parsedUrl.pathname, req, res)) {
        return;
      }

      await handle(req, res, parsedUrl);
    } catch (error) {
      if (recoverDevBuildCacheIfNeeded(error)) {
        if (!res.headersSent) {
          res.statusCode = 503;
          res.setHeader('Cache-Control', 'no-store');
        }
        res.end('Detected stale Next.js dev cache. Cache has been reset, please refresh in 2-3 seconds.');
        return;
      }

      console.error('Error occurred handling', req.url, error);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      if (!res.writableEnded) {
        res.end('internal server error');
      }
    }
  });

  // keepAliveTimeout 必须大于上游代理的空闲 keepalive 时间（nginx upstream
  // keepalive_timeout 默认 60s）。Node 默认 5s 时存在经典竞争：连接空闲 >5s 后
  // Node 主动关闭，nginx 同一时刻从 keepalive 池取出该连接复用 → llhttp 报
  // HPE_CLOSED_CONNECTION（Data after Connection: close）→ 用户看到空 body 的 400。
  // headersTimeout 必须大于 keepAliveTimeout（Node 强制约束）。
  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 80_000;

  // 抓 HTTP 解析层的 400（llhttp 拒绝畸形请求时会返回空 body 的 400，
  // 不进 Next 路由、无任何日志——前端表现为"请求失败但重试又成功"）。
  // 记录解析错误与原始包头部，定位是哪个客户端/哪个字段畸形。
  server.on('clientError', (err, socket) => {
    try {
      const rawHead = err.rawPacket
        ? err.rawPacket.subarray(0, 400).toString('latin1').replace(/[^\x20-\x7e\r\n]/g, '?')
        : '';
      console.error('[Server] clientError:', err.code || '', err.message, '| raw:', JSON.stringify(rawHead));
    } catch {
      console.error('[Server] clientError (no detail)');
    }
    if (socket.writable && !socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  });

  const asrWss = new WebSocketServer({ noServer: true });
  const nextUpgradeHandler = app.getUpgradeHandler();

  if ('didWebSocketSetup' in app) {
    app.didWebSocketSetup = true;
  }
  if (app.options) {
    app.options.httpServer = server;
  }

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '', true);

    if (pathname === '/api/asr-stream') {
      asrWss.handleUpgrade(request, socket, head, (ws) => {
        asrWss.emit('connection', ws, request);
      });
      return;
    }

    // 2026-08 决策下线：/api/asr-stream-speaker（腾讯云实时分人实验）与
    // /api/tutor-call（实时语音通话）两条 WS 代理已整体拆除，不再注册。

    try {
      nextUpgradeHandler(request, socket, head);
    } catch (error) {
      console.error('Error delegating upgrade to Next.js:', error);
      socket.destroy();
    }
  });

  asrWss.on('connection', async (clientWs, request) => {
    console.log('[ASR-Proxy] Client connected');

    // 积分 Phase 2：连接级结算标识。token 来自前端 WS URL 的 ?token= 查询参数
    //（浏览器 WebSocket 不能带 Authorization 头）；匿名连接只记影子流水不扣分。
    const asrConnectionQuery = parse(request?.url || '', true).query;
    const asrUserToken = typeof asrConnectionQuery.token === 'string' ? asrConnectionQuery.token : '';
    const asrConnectionId = crypto.randomUUID();
    const asrGuestKey = asrUserToken ? '' : guestKeyFromRequest(request);
    const asrConnectedAtMs = Date.now();
    let asrUsageSettled = false;
    const settleAsrUsageOnce = () => {
      if (asrUsageSettled) return;
      asrUsageSettled = true;
      settleAsrUsageOnClose({
        connectionId: asrConnectionId,
        connectedAtMs: asrConnectedAtMs,
        token: asrUserToken,
        guestKey: asrGuestKey,
      });
    };

    // L1/L3 堵漏：连上游之前先做服务端额度预检（登录：免费分钟+余额；guest：日分钟上限）。
    // 拒绝时给客户端一个可识别的错误码，前端映射成安静的额度说明。
    const asrAllowance = await precheckAsrAllowance({ token: asrUserToken, guestKey: asrGuestKey });
    if (!asrAllowance.allowed) {
      console.warn('[ASR-Proxy] precheck denied:', asrAllowance.reason);
      clientWs.send(JSON.stringify({
        event: 'error',
        error: asrAllowance.reason === 'guest_daily_asr_cap' ? 'GUEST_DAILY_ASR_CAP' : 'ASR_QUOTA_EXCEEDED',
      }));
      clientWs.close();
      return;
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model = process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen-audio-3.0-asr-flash-streaming';
    // 协议分派：qwen-audio-3.0* / fun-asr* 走 duplex 任务协议（/api-ws/v1/inference），
    // qwen3-asr* 走旧 Omni Realtime 协议（/api-ws/v1/realtime?model=）。改 env 即可回退旧模型。
    const useDuplexAsr = isDuplexAsrModel(model);
    const duplexTaskId = useDuplexAsr ? generateDuplexTaskId() : null;
    const upstreamWsUrl = resolveAsrWsUrl(model, process.env.DASHSCOPE_ASR_WS_URL);
    const sampleRate = parseInt(process.env.DASHSCOPE_ASR_WS_SR || '16000', 10);
    const turnSilenceMs = clampNumber(
      parseInt(process.env.DASHSCOPE_ASR_WS_VAD_SILENCE_MS || '1000', 10),
      200,
      3000,
      1000
    );
    const turnVadThreshold = clampNumber(
      parseFloat(process.env.DASHSCOPE_ASR_WS_VAD_THRESHOLD || '0.20'),
      0.05,
      0.95,
      0.20
    );
    const draftFlushMs = clampNumber(
      parseInt(process.env.ASR_DRAFT_FLUSH_MS || '800', 10),
      200,
      2500,
      800
    );
    const dedupSimilarity = clampNumber(
      parseFloat(process.env.ASR_DEDUP_SIMILARITY || '0.95'),
      0.7,
      1,
      0.95
    );
    const dedupGapMs = clampNumber(
      parseInt(process.env.ASR_DEDUP_GAP_MS || '1500', 10),
      200,
      10000,
      1500
    );

    if (!apiKey) {
      clientWs.send(JSON.stringify({ event: 'error', error: 'API Key 未配置' }));
      clientWs.close();
      return;
    }

    let dashscopeWs = null;
    let isSessionReady = false;
    const audioQueue = [];
    const AUDIO_QUEUE_MAX_SIZE = 2000; // 上限 2000 个 chunk（约 200 秒 @16kHz，每 chunk ~100ms/3.2KB）
    // 代理侧丢帧统计：溢出 = 这段音频永远到不了 DashScope，必须告知客户端（单遍化后无兜底）
    let droppedAudioBytes = 0;
    let lastDropNotifiedBytes = 0;

    // DashScope 限速：2560KB/s（约 2.5MB/s）。每个 PCM chunk 3.2KB。
    // 旧 flushAudioQueue 同步 while loop 一次性 send 全部累积 chunks，
    // 瞬时流量可达 1.6MB/极短时间（500 chunks）→ 远超 2560KB/s 限制 →
    // DashScope 服务端 1007 Input traffic exceeds the limit 关闭连接 →
    // "音频转写失败"。
    // 节流策略：每批最多 60 chunks（~192KB），间隔 100ms → ~1.92MB/s ≤ 2.5MB/s 安全。
    const FLUSH_BATCH_SIZE = 60;
    const FLUSH_INTERVAL_MS = 100;
    let isFlushingAudioQueue = false;

    let sessionStartTime = Date.now();
    let sentenceIndex = 0;
    let lastSentenceEndTime = 0;
    let currentSpeechStartMs = null;
    let lastSpeechEndMs = 0;

    let hasAudioAppended = false;
    let hasFinishedSession = false;
    let clientFinishedSent = false;
    let stopRequestedByClient = false;
    let closeTimer = null;

    let receivedBinaryChunks = 0;
    let receivedBinaryBytes = 0;
    let appendedChunks = 0;

    let contextHint = '';
    let initialSessionUpdateTimer = null;
    let initialSessionUpdateSent = false;
    // 语种模式：
    //   'auto' = 不传 language 参数（Qwen 官方推荐：混合语种或不确定时应省略）
    //   'zh'   = 明确中文
    //   'en'   = 明确英文
    // 默认 'auto'，让模型自动识别中英混合。客户端可通过 'context-hint' 消息携带 languageMode 覆盖。
    let languageMode = 'auto';

    const vadTimestampQueue = [];
    const interimByItemId = new Map();
    let activeInterimItemId = null;
    let lastFinalSegment = null;

    function sendClientEvent(payload) {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(JSON.stringify(payload));
    }

    function sendClientFinished(code) {
      if (clientFinishedSent) return;
      clientFinishedSent = true;
      sendClientEvent({ event: 'finished', code });
      sendClientEvent({ event: 'closed', code });
    }

    function buildASRCorpusText() {
      if (!contextHint) return '';
      return `[课程术语与专有名词]\n${contextHint.slice(0, 3000)}`;
    }

    function sendSessionUpdate(extraLog) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return;
      if (initialSessionUpdateSent) return;
      if (initialSessionUpdateTimer) {
        clearTimeout(initialSessionUpdateTimer);
        initialSessionUpdateTimer = null;
      }
      // DashScope qwen3-asr-flash-realtime 不允许 session.updated 之后再发第二次 session.update，
      // 否则会触发 "session already started or finished or failed" 错误并以 1007 断开连接。
      // 因此 session 一旦 ready，后续的 context-hint / dynamic refresh 只更新内存，不再发 update。
      if (isSessionReady) {
        console.log(`[ASR-Proxy] Skipping session.update (${extraLog}) - session already started`);
        return;
      }
      if (hasAudioAppended) {
        console.log(`[ASR-Proxy] Skipping session.update (${extraLog}) - audio already streaming`);
        return;
      }
      if (stopRequestedByClient) {
        return;
      }

      const corpusText = buildASRCorpusText();

      if (useDuplexAsr) {
        // 新 duplex 协议：连接后发送 run-task，上下文走 input.context，VAD 断句走 max_sentence_silence。
        const runTask = buildDuplexRunTask({
          taskId: duplexTaskId,
          model,
          sampleRate,
          languageMode,
          contextHint: corpusText,
          maxSentenceSilenceMs: turnSilenceMs,
        });
        dashscopeWs.send(JSON.stringify(runTask));
        initialSessionUpdateSent = true;
        if (extraLog) {
          console.log(`[ASR-Proxy] run-task sent (${extraLog}), model=${model}, lang=${languageMode}, context length: ${corpusText.length}`);
        }
        return;
      }

      // Qwen 官方最佳实践：混合语种或不确定时，不传 language 参数，让模型自动识别。
      // 只有客户端明确指定 'zh' 或 'en' 时才下发 language。
      const sessionConfig = buildQwenAsrSessionConfig({
        sampleRate,
        languageMode,
        // Qwen Realtime 官方字段是 input_audio_transcription.corpus.text。
        // 旧代码误发 prompt，课程术语上下文并未按协议生效。
        contextHint: corpusText,
        vadThreshold: turnVadThreshold,
        vadSilenceMs: turnSilenceMs,
      });

      dashscopeWs.send(JSON.stringify({
        event_id: generateEventId(),
        type: 'session.update',
        session: sessionConfig,
      }));
      initialSessionUpdateSent = true;

      if (extraLog) {
        console.log(`[ASR-Proxy] Session updated (${extraLog}), lang=${languageMode}, corpus length: ${corpusText.length}`);
      }
    }

    function scheduleDashscopeClose(reason, delayMs = 200) {
      if (closeTimer) return;
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
          dashscopeWs.close(1000, reason);
        }
      }, delayMs);
    }

    function finishDashscopeSession(finishReason) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return false;
      if (hasFinishedSession) return false;
      if (!hasAudioAppended && audioQueue.length === 0) return false;

      if (isFlushingAudioQueue || audioQueue.length > 0) return false;

      try {
        // 新 duplex 协议发 finish-task；旧 Omni Realtime 在 server_vad 下必须发 session.finish
        // （input_audio_buffer.commit 仅属 manual mode，会报错并吞掉尾句）。
        const finishMessage = useDuplexAsr
          ? buildDuplexFinishTask(duplexTaskId)
          : buildQwenAsrFinishEvent(generateEventId());
        dashscopeWs.send(JSON.stringify(finishMessage));
        hasFinishedSession = true;
        console.log(`[ASR-Proxy] Session finish sent (${finishReason})`);
        return true;
      } catch (error) {
        console.error('[ASR-Proxy] Session finish failed:', error);
        return false;
      }
    }

    function maybeFinishAfterFlush(reason) {
      if (!stopRequestedByClient || hasFinishedSession) return;
      if (finishDashscopeSession(reason)) {
        // 官方建议最多等待 20 秒拿 session.finished；这里保留 20 秒异常兜底，
        // 正常路径由 session.finished 立即关闭，不平白增加用户等待。
        scheduleDashscopeClose('session.finish timeout', 20000);
      }
    }

    function sendAudioToDashScope(pcmData) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return;
      const chunkSize = pcmData?.length || pcmData?.byteLength || 0;
      if (chunkSize <= 0) return;

      if (useDuplexAsr) {
        // 新 duplex 协议：task-started 后直接发二进制 PCM 帧，不再 base64 包 JSON。
        dashscopeWs.send(Buffer.from(pcmData));
        hasAudioAppended = true;
        appendedChunks += 1;
        return;
      }

      const base64Audio = Buffer.from(pcmData).toString('base64');
      if (!base64Audio) return;

      dashscopeWs.send(JSON.stringify({
        event_id: generateEventId(),
        type: 'input_audio_buffer.append',
        audio: base64Audio,
      }));

      hasAudioAppended = true;
      appendedChunks += 1;
    }

    function flushAudioQueue() {
      if (isFlushingAudioQueue) return;
      if (audioQueue.length === 0) return;
      isFlushingAudioQueue = true;
      flushNextAudioBatch();
    }

    function flushNextAudioBatch() {
      if (!isFlushingAudioQueue) return;
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) {
        isFlushingAudioQueue = false;
        return;
      }

      const batchSize = Math.min(FLUSH_BATCH_SIZE, audioQueue.length);
      for (let i = 0; i < batchSize; i += 1) {
        const audioData = audioQueue.shift();
        if (audioData) sendAudioToDashScope(audioData);
      }

      if (audioQueue.length === 0) {
        isFlushingAudioQueue = false;
        maybeFinishAfterFlush('audio queue drained');
        return;
      }

      setTimeout(flushNextAudioBatch, FLUSH_INTERVAL_MS);
    }

    function resolveTimestamp(msg) {
      const currentElapsedMs = Date.now() - sessionStartTime;
      let beginTime = 0;
      let endTime = 0;

      if (currentSpeechStartMs !== null) {
        beginTime = currentSpeechStartMs;
        endTime = lastSpeechEndMs > currentSpeechStartMs ? lastSpeechEndMs : currentElapsedMs;
        currentSpeechStartMs = null;
      } else {
        const queued = vadTimestampQueue.shift();
        if (queued) {
          beginTime = queued.startMs;
          endTime = queued.endMs;
        } else {
          const serverBegin = extractServerTimestamp(msg, 'begin');
          const serverEnd = extractServerTimestamp(msg, 'end');
          if (serverBegin !== null && serverEnd !== null) {
            beginTime = serverBegin;
            endTime = serverEnd;
          } else {
            beginTime = lastSentenceEndTime;
            endTime = currentElapsedMs;
          }
        }
      }

      if (endTime < beginTime) {
        endTime = beginTime;
      }

      lastSentenceEndTime = Math.max(lastSentenceEndTime, endTime);
      return { beginTime, endTime };
    }

    /**
     * 新 duplex 协议定稿时间戳：优先使用服务端句级 begin_time/end_time（毫秒），
     * 缺失时才回退到客户端 VAD 猜测（resolveTimestamp）。
     */
    function resolveDuplexTimestamps(sentence, rawMsg) {
      if (typeof sentence.beginTime === 'number' && typeof sentence.endTime === 'number') {
        const beginTime = sentence.beginTime;
        const endTime = Math.max(sentence.endTime, beginTime);
        lastSentenceEndTime = Math.max(lastSentenceEndTime, endTime);
        return { beginTime, endTime };
      }
      return resolveTimestamp(rawMsg);
    }

    /** 新 duplex 协议服务端事件分派（task-started / result-generated / task-finished / task-failed） */
    function handleDuplexServerEvent(msg) {
      const { event, sentence, errorMessage } = parseDuplexServerEvent(msg);

      switch (event) {
        case 'task-started':
          isSessionReady = true;
          sessionStartTime = Date.now();
          sendClientEvent({ event: 'ready' });
          flushAudioQueue();
          break;

        case 'result-generated': {
          if (!sentence || !sentence.text) break;
          const itemId = `duplex-${sentenceIndex}`;

          if (!sentence.isFinal) {
            // 中间稿：sentence_end=false，同一句话会持续覆盖更新
            activeInterimItemId = itemId;
            const payload = {
              text: sentence.text,
              stableText: '',
              unstableText: sentence.text,
              beginTime: typeof sentence.beginTime === 'number' ? sentence.beginTime : undefined,
            };
            const state = upsertInterimState(itemId, payload);
            const now = Date.now();
            const shouldForce = !state.lastSentText || (payload.text.length - state.lastSentText.length >= 8);
            maybeSendInterim(itemId, shouldForce || now - state.lastSentAt >= draftFlushMs);
            break;
          }

          // 定稿：sentence_end=true。抗幻觉门控 / 去重 / 长句切分与旧协议共用同一条路径。
          const finalText = sentence.text.trim();
          const { beginTime, endTime } = resolveDuplexTimestamps(sentence, msg);
          clearInterim(itemId);
          if (!finalText) break;

          const durationMs = Math.max(0, endTime - beginTime);
          if (isLikelyHallucination(finalText, durationMs)) {
            console.log(`[ASR-Proxy] Dropped likely hallucination: "${finalText}" (duration=${durationMs}ms)`);
            break;
          }

          const splitSegments = splitLongTranscript(finalText, beginTime, endTime);
          for (const seg of splitSegments) {
            sendFinalSegment(seg, itemId);
          }
          break;
        }

        case 'task-finished':
          // 新协议的正式收尾事件：只有收到它，最后一段语音才视为完整定稿。
          sendClientFinished(1000);
          if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
          }
          scheduleDashscopeClose('task-finished', 100);
          break;

        case 'task-failed': {
          const error = errorMessage || '识别错误';
          console.error('[ASR-Proxy] Duplex task failed:', error);
          sendClientEvent({ event: 'error', error });
          scheduleDashscopeClose('task-failed', 100);
          break;
        }

        default:
          break;
      }
    }

    function upsertInterimState(itemId, payload) {
      const currentElapsedMs = Date.now() - sessionStartTime;
      const prev = interimByItemId.get(itemId) || {
        text: '',
        stableText: '',
        unstableText: '',
        beginTime: typeof payload.beginTime === 'number'
          ? payload.beginTime
          : (currentSpeechStartMs ?? Math.max(0, lastSentenceEndTime)),
        endTime: currentElapsedMs,
        lastSentAt: 0,
        lastSentText: '',
      };

      const next = {
        ...prev,
        text: payload.text,
        stableText: payload.stableText,
        unstableText: payload.unstableText,
        beginTime: typeof payload.beginTime === 'number' ? payload.beginTime : prev.beginTime,
        endTime: currentElapsedMs,
      };

      interimByItemId.set(itemId, next);
      return next;
    }

    function maybeSendInterim(itemId, force = false) {
      const state = interimByItemId.get(itemId);
      if (!state) return;

      const now = Date.now();
      const changed = state.text !== state.lastSentText;
      const due = now - state.lastSentAt >= draftFlushMs;
      if (!force && !(changed && due)) return;
      if (!state.text && !force) return;

      state.lastSentAt = now;
      state.lastSentText = state.text;

      sendClientEvent({
        event: 'interim',
        itemId,
        text: state.text,
        stableText: state.stableText,
        unstableText: state.unstableText,
        provisional: true,
        beginTime: state.beginTime,
        endTime: state.endTime,
      });
    }

    function clearInterim(itemId) {
      if (!itemId) return;
      interimByItemId.delete(itemId);
      if (activeInterimItemId === itemId) {
        activeInterimItemId = null;
      }

      sendClientEvent({
        event: 'interim',
        itemId,
        text: '',
        stableText: '',
        unstableText: '',
        provisional: true,
      });
    }

    function sendFinalSegment(segment, itemId) {
      const nextFinal = {
        id: `seg-${sentenceIndex++}`,
        text: segment.text,
        beginTime: segment.beginTime,
        endTime: segment.endTime,
        isFinal: true,
        itemId: itemId || undefined,
      };

      let replaces;
      if (shouldDedupSegment(lastFinalSegment, nextFinal, dedupSimilarity, dedupGapMs)) {
        replaces = [lastFinalSegment.id];
      }

      sendClientEvent({
        event: 'result',
        provisional: false,
        replaces,
        sentence: nextFinal,
      });

      lastFinalSegment = nextFinal;
    }

    try {
      // 新族模型在 run-task 里带 model，URL 不带 ?model=；鉴权头按官方示例用小写 bearer。
      dashscopeWs = new WebSocket(upstreamWsUrl, {
        headers: {
          Authorization: useDuplexAsr ? `bearer ${apiKey}` : `Bearer ${apiKey}`,
        },
      });

      dashscopeWs.on('open', () => {
        initialSessionUpdateTimer = setTimeout(() => {
          sendSessionUpdate('initial');
        }, 120);
      });

      dashscopeWs.on('message', (data, isBinary) => {
        try {
          if (isBinary) return;

          const msg = JSON.parse(data.toString());

          if (useDuplexAsr) {
            handleDuplexServerEvent(msg);
            return;
          }

          const msgType = msg.type;

          switch (msgType) {
            case 'session.created':
              break;

            case 'session.updated':
              isSessionReady = true;
              sessionStartTime = Date.now();
              sendClientEvent({ event: 'ready' });
              flushAudioQueue();
              break;

            case 'input_audio_buffer.speech_started':
              if (currentSpeechStartMs === null) {
                currentSpeechStartMs = Math.max(lastSentenceEndTime, Date.now() - sessionStartTime);
              }
              break;

            case 'input_audio_buffer.speech_stopped':
              lastSpeechEndMs = Math.max(lastSpeechEndMs, Date.now() - sessionStartTime);
              break;

            case 'conversation.item.created': {
              const itemId = extractItemId(msg);
              if (itemId) {
                activeInterimItemId = itemId;
                if (!interimByItemId.has(itemId)) {
                  interimByItemId.set(itemId, {
                    text: '',
                    stableText: '',
                    unstableText: '',
                    beginTime: currentSpeechStartMs ?? Math.max(0, lastSentenceEndTime),
                    endTime: Date.now() - sessionStartTime,
                    lastSentAt: 0,
                    lastSentText: '',
                  });
                }
              }
              break;
            }

            case 'conversation.item.input_audio_transcription.partial':
            case 'conversation.item.input_audio_transcription.text':
            case 'conversation.item.input_audio_transcription.delta': {
              const itemId = extractItemId(msg) || activeInterimItemId || `item-${sentenceIndex}`;
              if (!itemId) break;
              activeInterimItemId = itemId;

              const payload = extractInterimPayload(msg);
              const state = upsertInterimState(itemId, payload);

              const now = Date.now();
              const shouldForce = !state.lastSentText || (payload.text && payload.text.length - state.lastSentText.length >= 8);
              maybeSendInterim(itemId, shouldForce || now - state.lastSentAt >= draftFlushMs);
              break;
            }

            case 'conversation.item.input_audio_transcription.completed': {
              const itemId = extractItemId(msg) || activeInterimItemId;
              const finalText = extractFinalText(msg);
              const { beginTime, endTime } = resolveTimestamp(msg);

              clearInterim(itemId);

              if (!finalText) {
                break;
              }

              // 【抗幻觉 · VAD 能量门控】
              // 详细策略见 ./server/asr/text-utils.js 的 isLikelyHallucination。
              // M1 抽出后带单测，M2 可无忧改进。
              const durationMs = Math.max(0, endTime - beginTime);
              if (isLikelyHallucination(finalText, durationMs)) {
                console.log(`[ASR-Proxy] Dropped likely hallucination: "${finalText}" (duration=${durationMs}ms)`);
                break;
              }

              const splitSegments = splitLongTranscript(finalText, beginTime, endTime);
              for (const seg of splitSegments) {
                sendFinalSegment(seg, itemId);
              }
              break;
            }

            case 'input_audio_buffer.committed':
              break;

            case 'session.finished':
              // Qwen ASR VAD 模式的正式收尾事件。只有收到它，最后一段语音
              // 才能视为已经完整定稿；不能用 response.done 或固定 sleep 猜测。
              sendClientFinished(1000);
              if (closeTimer) {
                clearTimeout(closeTimer);
                closeTimer = null;
              }
              scheduleDashscopeClose('session.finished', 100);
              break;

            case 'error': {
              const error = msg.error?.message || msg.message || '识别错误';
              if (isIgnorableCommitError(error)) {
                if (stopRequestedByClient || hasFinishedSession) {
                  scheduleDashscopeClose('Client disconnected', 100);
                }
                break;
              }
              if (isIgnorableSessionUpdateError(error)) {
                console.warn('[ASR-Proxy] Ignoring session update error (non-fatal):', error);
                break;
              }

              console.error('[ASR-Proxy] Error:', msg.error || msg);
              sendClientEvent({ event: 'error', error });
              break;
            }

            default:
              break;
          }
        } catch (error) {
          console.error('[ASR-Proxy] Parse error:', error);
        }
      });

      dashscopeWs.on('error', (error) => {
        console.error('[ASR-Proxy] DashScope error:', error.message);
        // M13-fix: 把 401 / 403 等不可恢复的鉴权错误专门标记，让客户端立刻停止重连。
        // 默认无差别 close=1011 会让客户端反复重试 30 次（每次都失败），日志风暴。
        const authFailed = /401|403|InvalidApiKey|Unauthorized|access denied/i.test(error.message || '');
        if (authFailed) {
          sendClientEvent({ event: 'auth_failed', error: `识别服务密钥失效或无权限：${error.message}` });
        } else {
          sendClientEvent({ event: 'error', error: `DashScope 连接错误: ${error.message}` });
        }
        // DashScope 连接异常，关闭客户端避免 audioQueue 无限增长
        if (clientWs.readyState === WebSocket.OPEN) {
          // 4401 = 自定义不可重连码（应用层语义：鉴权失败，重连无意义）
          clientWs.close(authFailed ? 4401 : 1011, authFailed ? 'DashScope auth failed' : 'DashScope connection error');
        }
      });

      dashscopeWs.on('close', (code, reason) => {
        console.log('[ASR-Proxy] DashScope closed:', code, String(reason || ''));
        isSessionReady = false;

        if (clientWs.readyState === WebSocket.OPEN) {
          sendClientFinished(code);
          // 仅异常断开时主动关闭客户端（code 1000 = 正常关闭，由客户端 stop 触发）
          if (code !== 1000 && !stopRequestedByClient) {
            clientWs.close(1000, 'DashScope disconnected unexpectedly');
          }
        }
      });
    } catch (error) {
      console.error('[ASR-Proxy] Failed to connect:', error);
      sendClientEvent({ event: 'error', error: '连接失败' });
      clientWs.close();
      return;
    }

    clientWs.on('message', (data, isBinary) => {
      const dataLen = data.length || data.byteLength || 0;

      if (isBinary) {
        receivedBinaryChunks += 1;
        receivedBinaryBytes += dataLen;
        if (receivedBinaryChunks % 50 === 0) {
          console.log(`[ASR-Proxy] Audio ingress: chunks=${receivedBinaryChunks}, bytes=${receivedBinaryBytes}, appended=${appendedChunks}`);
        }

        if (isSessionReady && !isFlushingAudioQueue && audioQueue.length === 0) {
          sendAudioToDashScope(data);
        } else {
          if (audioQueue.length < AUDIO_QUEUE_MAX_SIZE) {
            audioQueue.push(data);
          } else {
            // 缓冲溢出 = 这段音频永久丢失：累计并按秒上报给客户端（约 32 字节/ms）
            droppedAudioBytes += dataLen;
            if (droppedAudioBytes - lastDropNotifiedBytes >= 32000) {
              lastDropNotifiedBytes = droppedAudioBytes;
              console.warn(`[ASR-Proxy] audioQueue overflow, dropped ${Math.round(droppedAudioBytes / 32)}ms audio total`);
              sendClientEvent({ event: 'audio-dropped', droppedMsTotal: Math.round(droppedAudioBytes / 32) });
            }
          }
          if (isSessionReady) flushAudioQueue();
        }
        return;
      }

      try {
        const jsonText = typeof data === 'string' ? data : data.toString('utf8');
        const msg = JSON.parse(jsonText);

        if (msg.type === 'ping') {
          sendClientEvent({ event: 'pong', at: msg.at || Date.now() });
          return;
        }

        if (msg.type === 'vad-event') {
          if (msg.event === 'start') {
            currentSpeechStartMs = msg.timestampMs;
          } else if (msg.event === 'end') {
            lastSpeechEndMs = msg.timestampMs;
          }
          return;
        }

        if (msg.type === 'vad-timestamp') {
          vadTimestampQueue.push({
            startMs: msg.startMs,
            endMs: msg.endMs,
          });
          return;
        }

        if (msg.type === 'context-hint') {
          const hint = typeof msg.contextHint === 'string' ? msg.contextHint.trim() : '';
          let languageModeChanged = false;
          // 接收客户端声明的语种模式。允许值：'auto' | 'zh' | 'en'。其他值一律落回 'auto'。
          if (typeof msg.languageMode === 'string') {
            const mode = msg.languageMode.trim().toLowerCase();
            if (mode === 'zh' || mode === 'en' || mode === 'auto') {
              if (languageMode !== mode) {
                languageMode = mode;
                languageModeChanged = true;
                console.log(`[ASR-Proxy] languageMode set to '${mode}'`);
              }
            }
          }
          if (hint) {
            contextHint = hint.slice(0, 3000);
            console.log('[ASR-Proxy] Received context hint, length:', contextHint.length);
          }
          // 只要 hint 或 languageMode 有变化，且 session 还没起来，就刷新 session.update。
          // 旧协议 session 已建立则只更新内存变量（DashScope 不允许二次 session.update）；
          // 新 duplex 协议支持任务进行中用 continue-task 更新上下文。
          if ((hint || languageModeChanged) && !isSessionReady && !initialSessionUpdateSent) {
            sendSessionUpdate('context-hint received (pre-ready)');
          } else if (useDuplexAsr && isSessionReady && hint && dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
            try {
              dashscopeWs.send(JSON.stringify(buildDuplexContinueTask({
                taskId: duplexTaskId,
                contextHint: buildASRCorpusText(),
              })));
              console.log('[ASR-Proxy] continue-task sent (context updated mid-task), length:', contextHint.length);
            } catch (error) {
              console.warn('[ASR-Proxy] continue-task failed:', error);
            }
          } else if (hint || languageModeChanged) {
            console.log('[ASR-Proxy] context-hint/languageMode received AFTER session ready - stored for next session only');
          }
          return;
        }

        if (msg.action === 'stop') {
          stopRequestedByClient = true;
          if (!finishDashscopeSession('client stop')) {
            // 首次连接/重连的有界队列尚未排空时，flush 完成后再 finish；
            // 没有音频则无需等待模型。
            if (!hasAudioAppended && audioQueue.length === 0) {
              scheduleDashscopeClose('Client stop without audio', 100);
            }
          } else {
            scheduleDashscopeClose('session.finish timeout', 20000);
          }
        }
      } catch {
        // 文本消息 JSON 解析失败，记录警告并忽略（不当作音频处理）
        console.warn('[ASR-Proxy] Ignoring non-JSON text message, length:', dataLen);
      }
    });

    clientWs.on('close', () => {
      console.log(
        `[ASR-Proxy] Client disconnected, recvChunks=${receivedBinaryChunks}, recvBytes=${receivedBinaryBytes}, appended=${appendedChunks}, queue=${audioQueue.length}`
      );

      // 积分 Phase 2：只结算真正有音频流过的连接（空连接/秒断不计分钟）。
      // 幂等键 asr:{userId}:{connectionId}，路由侧重复结算安全。
      if (hasAudioAppended || appendedChunks > 0) {
        settleAsrUsageOnce();
      }

      stopRequestedByClient = true;
      if (!finishDashscopeSession('client disconnected')) {
        if (!hasAudioAppended && audioQueue.length === 0) {
          scheduleDashscopeClose('Client disconnected without audio', 100);
        }
      } else {
        scheduleDashscopeClose('session.finish timeout after client disconnect', 20000);
      }
    });

    clientWs.on('error', (error) => {
      console.error('[ASR-Proxy] Client error:', error.message);
    });
  });

  installGracefulShutdown({
    server,
    webSocketServers: [asrWss],
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket proxy available at ws://${hostname}:${port}/api/asr-stream`);
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${port} is already in use. Stop the existing process or run another port.`);
      process.exit(1);
    }
    console.error('[Server] Server error:', error);
  });
}).catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});
