const fs = require('fs');
const path = require('path');
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
} else {
  require('dotenv').config({ path: '.env' });
}

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer, WebSocket } = require('ws');

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
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

const DASHSCOPE_WSS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

let eventCounter = 0;
function generateEventId() {
  return `event_${Date.now()}_${eventCounter++}`;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeCompareText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()【】\[\]-]/g, '');
}

function longestCommonSubstringRatio(a, b) {
  const left = normalizeCompareText(a);
  const right = normalizeCompareText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;

  const dp = new Array(shorter.length + 1).fill(0);
  let maxLen = 0;

  for (let i = 1; i <= longer.length; i += 1) {
    for (let j = shorter.length; j >= 1; j -= 1) {
      if (longer[i - 1] === shorter[j - 1]) {
        dp[j] = dp[j - 1] + 1;
        if (dp[j] > maxLen) maxLen = dp[j];
      } else {
        dp[j] = 0;
      }
    }
  }

  return maxLen / shorter.length;
}

function shouldDedupSegment(lastSegment, nextSegment, dedupSimilarity, dedupGapMs) {
  if (!lastSegment || !nextSegment) return false;

  const similarity = longestCommonSubstringRatio(lastSegment.text, nextSegment.text);
  const overlap = nextSegment.beginTime <= lastSegment.endTime;
  const gap = Math.max(0, nextSegment.beginTime - lastSegment.endTime);

  return similarity >= dedupSimilarity && (overlap || gap <= dedupGapMs);
}

function splitLongTranscript(text, beginTime, endTime) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];

  if (normalized.length <= 80) {
    return [{ text: normalized, beginTime, endTime }];
  }

  const chunks = [];
  let current = '';
  const punctuation = /[。！？!?；;]/;

  for (const ch of normalized) {
    current += ch;
    if ((punctuation.test(ch) && current.length >= 20) || current.length >= 60) {
      if (current.trim()) chunks.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) chunks.push(current.trim());

  if (chunks.length <= 1) {
    return [{ text: normalized, beginTime, endTime }];
  }

  const duration = Math.max(1, endTime - beginTime);
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalChars <= 0) {
    return [{ text: normalized, beginTime, endTime }];
  }

  let consumed = 0;
  return chunks.map((chunk, index) => {
    const segBegin = Math.round(beginTime + (duration * consumed) / totalChars);
    consumed += chunk.length;
    let segEnd = index === chunks.length - 1
      ? endTime
      : Math.round(beginTime + (duration * consumed) / totalChars);

    if (segEnd <= segBegin) {
      segEnd = Math.min(endTime, segBegin + 200);
    }

    return {
      text: chunk,
      beginTime: segBegin,
      endTime: segEnd,
    };
  });
}

function extractItemId(msg) {
  return msg.item_id || msg.item?.id || null;
}

function extractFinalText(msg) {
  const candidates = [
    msg.item?.content?.[0]?.text,
    msg.transcript,
    msg.text,
    msg.item?.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function extractServerTimestamp(msg, kind) {
  const beginFields = ['begin_time', 'start_time', 'beginTime', 'startTime', 'audio_start_ms'];
  const endFields = ['end_time', 'endTime', 'audio_end_ms'];
  const fields = kind === 'begin' ? beginFields : endFields;

  for (const field of fields) {
    if (msg[field] !== undefined) return Number(msg[field]);
    if (msg.item?.[field] !== undefined) return Number(msg.item[field]);
  }

  return null;
}

function extractInterimPayload(msg) {
  const stableText = typeof msg.text === 'string' ? msg.text : '';
  const unstableText = typeof msg.stash === 'string'
    ? msg.stash
    : (typeof msg.delta === 'string' ? msg.delta : '');

  let composed = `${stableText}${unstableText}`.trim();
  if (!composed) {
    composed = stableText || unstableText || '';
  }

  return {
    stableText,
    unstableText,
    text: composed,
  };
}

function isIgnorableCommitError(message) {
  return typeof message === 'string' && /error committing input audio buffer/i.test(message);
}

function isIgnorableSessionUpdateError(message) {
  return typeof message === 'string' && /session already started or finished or failed/i.test(message);
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

function tryServeRuntimePublicFile(pathname, res) {
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
        res.setHeader('Content-Type', getRuntimeMediaMimeType(resolvedFilePath));
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
      if (tryServeRuntimePublicFile(parsedUrl.pathname, res)) {
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

  const asrWss = new WebSocketServer({ noServer: true });
  const tutorCallWss = new WebSocketServer({ noServer: true });
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

    if (pathname === '/api/tutor-call') {
      tutorCallWss.handleUpgrade(request, socket, head, (ws) => {
        tutorCallWss.emit('connection', ws, request);
      });
      return;
    }

    try {
      nextUpgradeHandler(request, socket, head);
    } catch (error) {
      console.error('Error delegating upgrade to Next.js:', error);
      socket.destroy();
    }
  });

  asrWss.on('connection', (clientWs) => {
    console.log('[ASR-Proxy] Client connected');

    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model = process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen3-asr-flash-realtime';
    const sampleRate = parseInt(process.env.DASHSCOPE_ASR_WS_SR || '16000', 10);
    const turnSilenceMs = clampNumber(
      parseInt(process.env.DASHSCOPE_ASR_WS_VAD_SILENCE_MS || '800', 10),
      200,
      3000,
      800
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
    const AUDIO_QUEUE_MAX_SIZE = 500; // 上限 500 个 chunk（约 16 秒 @16kHz）

    let sessionStartTime = Date.now();
    let sentenceIndex = 0;
    let lastSentenceEndTime = 0;
    let currentSpeechStartMs = null;
    let lastSpeechEndMs = 0;

    let hasAudioAppended = false;
    let hasCommittedAudioBuffer = false;
    let stopRequestedByClient = false;
    let closeTimer = null;

    let receivedBinaryChunks = 0;
    let receivedBinaryBytes = 0;
    let appendedChunks = 0;

    let contextHint = '';
    let recentFinalTexts = [];
    const CONTEXT_UPDATE_INTERVAL = 5; // update DashScope context every N final segments
    let finalSegmentCountSinceUpdate = 0;

    const vadTimestampQueue = [];
    const interimByItemId = new Map();
    let activeInterimItemId = null;
    let lastFinalSegment = null;

    function sendClientEvent(payload) {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(JSON.stringify(payload));
    }

    function buildASRPrompt() {
      const parts = [];
      if (contextHint) {
        parts.push(contextHint);
      }
      if (recentFinalTexts.length > 0) {
        const recentContext = recentFinalTexts.slice(-15).join('');
        parts.push(`已识别文本：${recentContext}`);
      }
      return parts.join('\n\n').slice(0, 3000) || '';
    }

    function sendSessionUpdate(extraLog) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return;
      // DashScope qwen3-asr-flash-realtime 不允许 session.updated 之后再发第二次 session.update，
      // 否则会触发 "session already started or finished or failed" 错误并以 1007 断开连接。
      // 因此 session 一旦 ready，后续的 context-hint / dynamic refresh 只更新内存，不再发 update。
      if (isSessionReady && extraLog !== 'initial') {
        console.log(`[ASR-Proxy] Skipping session.update (${extraLog}) - session already started`);
        return;
      }
      if (hasAudioAppended && extraLog !== 'initial') {
        console.log(`[ASR-Proxy] Skipping session.update (${extraLog}) - audio already streaming`);
        return;
      }
      if (stopRequestedByClient) {
        return;
      }

      const prompt = buildASRPrompt();
      const sessionConfig = {
        input_audio_format: 'pcm',
        sample_rate: sampleRate,
        input_audio_transcription: {
          language: 'zh',
          semantic_punctuation_enabled: true,
          ...(prompt ? { prompt } : {}),
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.2,
          silence_duration_ms: turnSilenceMs,
        },
      };

      dashscopeWs.send(JSON.stringify({
        event_id: generateEventId(),
        type: 'session.update',
        session: sessionConfig,
      }));

      if (extraLog) {
        console.log(`[ASR-Proxy] Session updated (${extraLog}), prompt length: ${prompt.length}`);
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

    function commitAudioBuffer(commitReason) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return false;
      if (hasCommittedAudioBuffer) return false;
      if (!hasAudioAppended && audioQueue.length === 0) return false;

      try {
        dashscopeWs.send(JSON.stringify({
          event_id: generateEventId(),
          type: 'input_audio_buffer.commit',
        }));
        hasCommittedAudioBuffer = true;
        console.log(`[ASR-Proxy] Audio buffer committed (${commitReason})`);
        return true;
      } catch (error) {
        console.error('[ASR-Proxy] Commit failed:', error);
        return false;
      }
    }

    function sendAudioToDashScope(pcmData) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return;
      const chunkSize = pcmData?.length || pcmData?.byteLength || 0;
      if (chunkSize <= 0) return;

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
      while (audioQueue.length > 0) {
        const audioData = audioQueue.shift();
        if (audioData) sendAudioToDashScope(audioData);
      }
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

    function upsertInterimState(itemId, payload) {
      const currentElapsedMs = Date.now() - sessionStartTime;
      const prev = interimByItemId.get(itemId) || {
        text: '',
        stableText: '',
        unstableText: '',
        beginTime: currentSpeechStartMs ?? Math.max(0, lastSentenceEndTime),
        endTime: currentElapsedMs,
        lastSentAt: 0,
        lastSentText: '',
      };

      const next = {
        ...prev,
        text: payload.text,
        stableText: payload.stableText,
        unstableText: payload.unstableText,
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

      // Track recent final texts for dynamic context updates
      recentFinalTexts.push(segment.text);
      if (recentFinalTexts.length > 30) {
        recentFinalTexts = recentFinalTexts.slice(-20);
      }

      // Periodically re-inject context into DashScope session
      finalSegmentCountSinceUpdate++;
      if (finalSegmentCountSinceUpdate >= CONTEXT_UPDATE_INTERVAL) {
        finalSegmentCountSinceUpdate = 0;
        sendSessionUpdate('dynamic context refresh');
      }
    }

    try {
      const wsUrl = `${DASHSCOPE_WSS_URL}?model=${encodeURIComponent(model)}`;
      dashscopeWs = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      dashscopeWs.on('open', () => {
        sendSessionUpdate('initial');
      });

      dashscopeWs.on('message', (data, isBinary) => {
        try {
          if (isBinary) return;

          const msg = JSON.parse(data.toString());
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

              const splitSegments = splitLongTranscript(finalText, beginTime, endTime);
              for (const seg of splitSegments) {
                sendFinalSegment(seg, itemId);
              }
              break;
            }

            case 'input_audio_buffer.committed':
              break;

            case 'response.done':
              // DashScope 完成了一轮处理；如果客户端已请求停止，可以安全关闭
              if (stopRequestedByClient && hasCommittedAudioBuffer) {
                scheduleDashscopeClose('response.done after client stop', 300);
              }
              break;

            case 'error': {
              const error = msg.error?.message || msg.message || '识别错误';
              if (isIgnorableCommitError(error)) {
                if (stopRequestedByClient || hasCommittedAudioBuffer) {
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
        sendClientEvent({ event: 'error', error: `DashScope 连接错误: ${error.message}` });
        // DashScope 连接异常，关闭客户端避免 audioQueue 无限增长
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1011, 'DashScope connection error');
        }
      });

      dashscopeWs.on('close', (code, reason) => {
        console.log('[ASR-Proxy] DashScope closed:', code, String(reason || ''));
        isSessionReady = false;

        if (clientWs.readyState === WebSocket.OPEN) {
          sendClientEvent({ event: 'finished', code });
          sendClientEvent({ event: 'closed', code });
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

        if (isSessionReady) {
          sendAudioToDashScope(data);
        } else {
          if (audioQueue.length < AUDIO_QUEUE_MAX_SIZE) {
            audioQueue.push(data);
          } else if (audioQueue.length === AUDIO_QUEUE_MAX_SIZE) {
            // 仅首次触发时警告，避免日志刷屏
            console.warn('[ASR-Proxy] audioQueue reached max size, dropping new chunks until DashScope ready');
            audioQueue.push(null); // 哨兵值，标记已溢出，长度变为 MAX+1 后不再进入此分支
          }
        }
        return;
      }

      try {
        const jsonText = typeof data === 'string' ? data : data.toString('utf8');
        const msg = JSON.parse(jsonText);

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
          if (hint) {
            contextHint = hint.slice(0, 3000);
            console.log('[ASR-Proxy] Received context hint, length:', contextHint.length);
            // 只有在 DashScope 还没 session.updated 之前才重发 session.update；
            // session 已建立则只更新内存变量（DashScope 不允许二次 session.update）。
            if (!isSessionReady) {
              sendSessionUpdate('context-hint received (pre-ready)');
            } else {
              console.log('[ASR-Proxy] Context hint received AFTER session ready - stored for next session only');
            }
          }
          return;
        }

        if (msg.type === 'context-update') {
          const text = typeof msg.recentText === 'string' ? msg.recentText.trim() : '';
          if (text) {
            // Merge client-provided recent text with our tracked texts
            recentFinalTexts.push(text);
            if (recentFinalTexts.length > 30) {
              recentFinalTexts = recentFinalTexts.slice(-20);
            }
          }
          return;
        }

        if (msg.action === 'stop') {
          stopRequestedByClient = true;
          const committed = commitAudioBuffer('client stop');
          // 给 DashScope 足够时间处理缓冲区中的音频（文件转写场景音频一次性发完）
          // 主关闭由 response.done 触发，这里是保底超时
          scheduleDashscopeClose('Client stop', committed ? 15000 : 100);
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

      stopRequestedByClient = true;
      const committed = commitAudioBuffer('client disconnected');
      scheduleDashscopeClose('Client disconnected', committed ? 10000 : 100);
    });

    clientWs.on('error', (error) => {
      console.error('[ASR-Proxy] Client error:', error.message);
    });
  });

  tutorCallWss.on('connection', (clientWs) => {
    console.log('[TutorCall] Client connected');

    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model = process.env.DASHSCOPE_OMNI_REALTIME_MODEL || 'qwen3.5-omni-plus-realtime';
    const transcriptionModel = process.env.DASHSCOPE_OMNI_REALTIME_TRANSCRIPT_MODEL || 'gummy-realtime-v1';
    const defaultVoice = process.env.DASHSCOPE_OMNI_REALTIME_VOICE || 'Ethan';

    if (!apiKey) {
      clientWs.send(JSON.stringify({ event: 'error', error: 'API Key 未配置' }));
      clientWs.close();
      return;
    }

    let dashscopeWs = null;
    let isSessionReady = false;
    let hasSentReady = false;
    let assistantTranscript = '';
    let sessionConfig = {
      instructions: '你是一位自然、耐心、会顺着学生刚说的话继续讲下去的中文老师。',
      voice: defaultVoice,
      enableSearch: false,
    };

    function sendClientEvent(payload) {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(JSON.stringify(payload));
    }

    function buildSessionPayload() {
      return {
        modalities: ['text', 'audio'],
        instructions: sessionConfig.instructions,
        voice: sessionConfig.voice || defaultVoice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: transcriptionModel,
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          silence_duration_ms: 1100,
          prefix_padding_ms: 300,
          create_response: true,
          interrupt_response: true,
        },
      };
    }

    function sendSessionUpdate(reason) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return;

      dashscopeWs.send(JSON.stringify({
        event_id: generateEventId(),
        type: 'session.update',
        session: buildSessionPayload(),
      }));

      if (reason) {
        console.log(`[TutorCall] Session updated (${reason})`);
      }
    }

    function markSessionReady(reason) {
      if (hasSentReady) return;
      hasSentReady = true;
      isSessionReady = true;
      sendClientEvent({ event: 'ready', reason });
    }

    function appendAudioToDashScope(buffer) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return;

      const base64Audio = Buffer.from(buffer).toString('base64');
      if (!base64Audio) return;

      dashscopeWs.send(JSON.stringify({
        event_id: generateEventId(),
        type: 'input_audio_buffer.append',
        audio: base64Audio,
      }));

    }

    try {
      const wsUrl = `${DASHSCOPE_WSS_URL}?model=${encodeURIComponent(model)}`;
      dashscopeWs = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      dashscopeWs.on('open', () => {
        sendSessionUpdate('initial');
      });

      dashscopeWs.on('message', (data, isBinary) => {
        try {
          if (isBinary) return;

          const msg = JSON.parse(data.toString());
          const msgType = msg.type;

          switch (msgType) {
            case 'session.created':
              markSessionReady('session.created');
              break;
            case 'session.updated':
              markSessionReady('session.updated');
              break;
            case 'input_audio_buffer.speech_started':
              sendClientEvent({
                event: 'speech_started',
                audioStartMs: msg.audio_start_ms ?? null,
              });
              break;
            case 'input_audio_buffer.speech_stopped':
              sendClientEvent({
                event: 'speech_stopped',
                audioEndMs: msg.audio_end_ms ?? null,
              });
              break;
            case 'conversation.item.input_audio_transcription.delta': {
              const payload = extractInterimPayload(msg);
              if (payload.text) {
                sendClientEvent({
                  event: 'user_transcript',
                  transcript: payload.text,
                  isFinal: false,
                });
              }
              break;
            }
            case 'conversation.item.input_audio_transcription.completed': {
              const transcript = extractFinalText(msg);
              if (transcript) {
                sendClientEvent({
                  event: 'user_transcript',
                  transcript,
                  isFinal: true,
                });
              }
              break;
            }
            case 'response.created':
              assistantTranscript = '';
              sendClientEvent({ event: 'assistant_response_start' });
              break;
            case 'response.audio_transcript.delta':
              if (typeof msg.delta === 'string' && msg.delta) {
                assistantTranscript += msg.delta;
                sendClientEvent({
                  event: 'assistant_transcript',
                  text: assistantTranscript,
                  isFinal: false,
                });
              }
              break;
            case 'response.audio_transcript.done': {
              const transcript = typeof msg.transcript === 'string' && msg.transcript.trim()
                ? msg.transcript.trim()
                : assistantTranscript.trim();

              if (transcript) {
                assistantTranscript = transcript;
                sendClientEvent({
                  event: 'assistant_transcript',
                  text: transcript,
                  isFinal: true,
                });
              }
              break;
            }
            case 'response.audio.delta':
              if (typeof msg.delta === 'string' && msg.delta) {
                sendClientEvent({
                  event: 'assistant_audio',
                  audio: msg.delta,
                });
              }
              break;
            case 'response.done':
              sendClientEvent({ event: 'assistant_response_end' });
              assistantTranscript = '';
              break;
            case 'error': {
              const error = msg.error?.message || msg.message || '语音通话出错了';
              console.error('[TutorCall] Error:', msg.error || msg);
              sendClientEvent({ event: 'error', error });
              break;
            }
            default:
              break;
          }
        } catch (error) {
          console.error('[TutorCall] Parse error:', error);
        }
      });

      dashscopeWs.on('error', (error) => {
        console.error('[TutorCall] DashScope error:', error.message);
        sendClientEvent({ event: 'error', error: `DashScope 连接错误: ${error.message}` });
      });

      dashscopeWs.on('close', (code, reason) => {
        console.log('[TutorCall] DashScope closed:', code, String(reason || ''));
        isSessionReady = false;

        if (clientWs.readyState === WebSocket.OPEN) {
          sendClientEvent({ event: 'assistant_response_end' });
        }
      });
    } catch (error) {
      console.error('[TutorCall] Failed to connect:', error);
      sendClientEvent({ event: 'error', error: '连接失败' });
      clientWs.close();
      return;
    }

    clientWs.on('message', (data, isBinary) => {
      if (isBinary) {
        if (isSessionReady) {
          appendAudioToDashScope(data);
        }
        return;
      }

      try {
        const message = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));

        if (message.type === 'session-config') {
          sessionConfig = {
            instructions: typeof message.instructions === 'string' && message.instructions.trim()
              ? message.instructions.trim()
              : sessionConfig.instructions,
            voice: typeof message.voice === 'string' && message.voice.trim()
              ? message.voice.trim()
              : defaultVoice,
            enableSearch: Boolean(message.enableSearch),
          };

          if (isSessionReady) {
            sendSessionUpdate('client update');
          }
          return;
        }

        if (message.action === 'cancel') {
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
            dashscopeWs.send(JSON.stringify({
              event_id: generateEventId(),
              type: 'response.cancel',
            }));
          }
          assistantTranscript = '';
          sendClientEvent({ event: 'cancelled' });
          return;
        }

        if (message.action === 'clear') {
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
            dashscopeWs.send(JSON.stringify({
              event_id: generateEventId(),
              type: 'input_audio_buffer.clear',
            }));
          }
        }
      } catch {
        console.warn('[TutorCall] Ignoring malformed client message');
      }
    });

    clientWs.on('close', () => {
      console.log('[TutorCall] Client disconnected');
      if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
        dashscopeWs.close(1000, 'Client disconnected');
      }
    });

    clientWs.on('error', (error) => {
      console.error('[TutorCall] Client error:', error.message);
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket proxy available at ws://${hostname}:${port}/api/asr-stream`);
    console.log(`> Tutor call proxy available at ws://${hostname}:${port}/api/tutor-call`);
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
