const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
void _unusedNormalize;
void longestCommonSubstringRatio;

const DASHSCOPE_WSS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

let eventCounter = 0;
function generateEventId() {
  return `event_${Date.now()}_${eventCounter++}`;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
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
  const speakerAsrWss = new WebSocketServer({ noServer: true });
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

    if (pathname === '/api/asr-stream-speaker') {
      speakerAsrWss.handleUpgrade(request, socket, head, (ws) => {
        speakerAsrWss.emit('connection', ws, request);
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

  // ============================================================
  // 腾讯云实时说话人分离 WebSocket 代理
  // /api/asr-stream-speaker
  //
  // 与 /api/asr-stream（DashScope）的区别：
  //   - 用腾讯云 16k_zh_en_speaker 引擎，同时做 ASR + 声纹聚类
  //   - 返回 speaker_id（0-9），支持最多 10 个说话人分离
  //   - 把腾讯云的返回格式翻译成与 DashScope 代理兼容的格式
  //     （{event:'ready'}, {event:'result', sentence:{...}}, {event:'interim', ...}）
  //   - 前端 DashScopeASRClient 不用改，只需要换 WS URL
  // ============================================================

  function buildTencentASRSignature(params) {
    const appId = process.env.TENCENT_ASR_APP_ID;
    const secretId = process.env.TENCENT_ASR_SECRET_ID;
    const secretKey = process.env.TENCENT_ASR_SECRET_KEY;

    if (!appId || !secretId || !secretKey) {
      throw new Error('腾讯云 ASR 密钥未配置');
    }

    // 腾讯云签名要求：参数按字典序排序，拼接签名原文（不含 wss://）
    // 参数值不做 URL 编码——签名原文用原始值
    const sortedParams = Object.keys(params)
      .filter((k) => k !== 'signature')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');

    const signStr = `asr.cloud.tencent.com/asr/v2/${appId}?${sortedParams}`;
    const signature = crypto
      .createHmac('sha1', secretKey)
      .update(signStr)
      .digest('base64');

    console.log('[Speaker-ASR-Proxy] Sign str:', signStr.substring(0, 120) + '...');
    console.log('[Speaker-ASR-Proxy] Signature:', signature);

    return { signature, appId, secretId };
  }

  function buildTencentASRUrl(voiceId, options) {
    const appId = process.env.TENCENT_ASR_APP_ID;
    const secretId = process.env.TENCENT_ASR_SECRET_ID;

    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 86400; // 1 天有效期
    const nonce = Math.floor(Math.random() * 1000000000);

    const params = {
      secretid: secretId,
      timestamp,
      expired,
      nonce,
      engine_model_type: options.engineModelType || '16k_zh_en_speaker',
      voice_id: voiceId,
      voice_format: 1, // PCM
      needvad: 1,
      convert_num_mode: 1,
      filter_dirty: 0,
      filter_modal: 0,
      filter_punc: 0,
      speaker_diarization: 1, // 显式开启话者分离
      sentence_strategy: 0,   // 0=语义单句
    };

    // 热词
    if (options.hotwordList) {
      params.hotword_list = options.hotwordList;
    }

    const { signature } = buildTencentASRSignature(params);
    const encodedSig = encodeURIComponent(signature);

    const queryStr = Object.keys(params)
      .filter((k) => k !== 'signature')
      .sort()
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');

    return `wss://asr.cloud.tencent.com/asr/v2/${appId}?${queryStr}&signature=${encodedSig}`;
  }

  speakerAsrWss.on('connection', (clientWs) => {
    console.log('[Speaker-ASR-Proxy] Client connected');

    const appId = process.env.TENCENT_ASR_APP_ID;
    const secretId = process.env.TENCENT_ASR_SECRET_ID;
    const secretKey = process.env.TENCENT_ASR_SECRET_KEY;

    if (!appId || !secretId || !secretKey) {
      clientWs.send(JSON.stringify({ event: 'error', error: '腾讯云 ASR 密钥未配置，请在 .env 中设置 TENCENT_ASR_APP_ID / TENCENT_ASR_SECRET_ID / TENCENT_ASR_SECRET_KEY' }));
      clientWs.close();
      return;
    }

    let tencentWs = null;
    let isReady = false;
    let stopRequested = false;
    let sentenceIndex = 0;
    let lastFinalSegment = null;
    const finalizedTencentSentenceIds = new Set();
    const dedupSimilarity = clampNumber(
      parseFloat(process.env.ASR_DEDUP_SIMILARITY || '0.95'),
      0.7, 1, 0.95
    );
    const dedupGapMs = clampNumber(
      parseInt(process.env.ASR_DEDUP_GAP_MS || '1500', 10),
      200, 10000, 1500
    );
    const audioQueue = [];
    const AUDIO_QUEUE_MAX_SIZE = 500;
    let isFlushingAudioQueue = false;
    let voiceId = '';

    // 从客户端接收 context-hint（热词）
    let hotwordList = '';

    function sendClientEvent(payload) {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(JSON.stringify(payload));
    }

    function flushAudioQueue() {
      if (isFlushingAudioQueue) return;
      if (audioQueue.length === 0) return;
      isFlushingAudioQueue = true;
      flushNextAudioBatch();
    }

    function flushNextAudioBatch() {
      if (!isFlushingAudioQueue) return;
      if (!tencentWs || tencentWs.readyState !== WebSocket.OPEN) {
        isFlushingAudioQueue = false;
        return;
      }
      const batchSize = Math.min(60, audioQueue.length);
      for (let i = 0; i < batchSize; i++) {
        const data = audioQueue.shift();
        if (data) tencentWs.send(data);
      }
      if (audioQueue.length === 0) {
        isFlushingAudioQueue = false;
        return;
      }
      setTimeout(flushNextAudioBatch, 100);
    }

    // 接收客户端文本消息（context-hint / stop）
    clientWs.on('message', (data, isBinary) => {
      if (isBinary) {
        // 二进制音频数据
        if (
          isReady
          && !isFlushingAudioQueue
          && audioQueue.length === 0
          && tencentWs
          && tencentWs.readyState === WebSocket.OPEN
        ) {
          tencentWs.send(data);
        } else {
          if (audioQueue.length < AUDIO_QUEUE_MAX_SIZE) {
            audioQueue.push(data);
          } else if (audioQueue.length === AUDIO_QUEUE_MAX_SIZE) {
            console.warn('[Speaker-ASR-Proxy] audioQueue reached max size, dropping new chunks until ready');
            audioQueue.push(null);
          }
          if (isReady) flushAudioQueue();
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

        if (msg.type === 'context-hint') {
          const hint = typeof msg.contextHint === 'string' ? msg.contextHint.trim() : '';
          if (hint) {
            // 腾讯云热词格式：词1|权重1,词2|权重2
            const words = hint.split(/[\n,，;；]/).map((w) => w.trim()).filter(Boolean);
            if (words.length > 0) {
              hotwordList = words.map((w) => `${w}|10`).join(',');
              console.log('[Speaker-ASR-Proxy] Hotwords:', words.length, 'words');
            }
          }

          // 如果还没连接腾讯云，现在连接
          if (!tencentWs && !stopRequested) {
            voiceId = crypto.randomUUID();
            const wsUrl = buildTencentASRUrl(voiceId, { hotwordList });

            tencentWs = new WebSocket(wsUrl);

            tencentWs.on('open', () => {
              console.log('[Speaker-ASR-Proxy] Tencent cloud connected, voice_id:', voiceId);
            });

            tencentWs.on('message', (tData) => {
              console.log('[Speaker-ASR-Proxy] Raw message:', tData.toString().substring(0, 200));
              try {
                const tMsg = JSON.parse(tData.toString());

                if (tMsg.code !== 0) {
                  console.error('[Speaker-ASR-Proxy] Error:', tMsg.code, tMsg.message);
                  // 资源包耗尽 / 鉴权失败等不可恢复错误——通知客户端停止重连
                  const nonRetriable = /4004|4005|4002|4003|欠费|耗尽|鉴权|未开通/.test(tMsg.message || '');
                  if (nonRetriable) {
                    sendClientEvent({ event: 'auth_failed', error: `腾讯云：${tMsg.message}` });
                  } else {
                    sendClientEvent({ event: 'error', error: tMsg.message || `腾讯云错误 ${tMsg.code}` });
                  }
                  return;
                }

                // 流结束标志：final=1 表示整段音频识别已结束
                if (tMsg.final === 1) {
                  console.log('[Speaker-ASR-Proxy] Final');
                  sendClientEvent({ event: 'finished' });
                  sendClientEvent({ event: 'closed' });
                  return;
                }

                // 实时说话人分离接口的结果在 tMsg.sentences.sentence_list[]
                // 完整结构：{code:0, voice_id, message_id, sentences: { sentence_list: [{ sentence, sentence_type, sentence_id, speaker_id, start_time, end_time }] }}
                // 握手成功响应里没有 sentences 字段，借此区分"握手成功"和"识别结果"
                const sentencesObj = tMsg.sentences;
                if (!sentencesObj || typeof sentencesObj !== 'object') {
                  if (!isReady) {
                    isReady = true;
                    console.log('[Speaker-ASR-Proxy] Ready, voice_id:', voiceId);
                    sendClientEvent({ event: 'ready' });
                    flushAudioQueue();
                  }
                  return;
                }

                // 官方协议明确要求遍历 sentence_list；一次回调可能携带多条句子。
                // final 结果按腾讯 sentence_id 去重，interim 则允许同一 id 持续修订。
                const sentenceList = sentencesObj.sentence_list;
                if (!Array.isArray(sentenceList) || sentenceList.length === 0) return;
                for (const sentence of sentenceList) {

                  // sentence_type: 0=不确定, 1=确定(稳态)
                  // speaker_id: -1=未识别, 0-9=具体说话人
                  const isFinal = sentence.sentence_type === 1;
                  const rawSpeakerId = sentence.speaker_id;
                  if (isFinal) {
                    console.log(`[Speaker-ASR-Proxy] Final: "${(sentence.sentence||'').substring(0,40)}" speaker_id=${rawSpeakerId} type=${sentence.sentence_type}`);
                  }
                  const speakerId =
                    typeof rawSpeakerId === 'number' && rawSpeakerId >= 0 && rawSpeakerId <= 9
                      ? String(rawSpeakerId)
                      : undefined;
                  const text = sentence.sentence || '';
                  if (!text) continue;

                  // 腾讯云返回的时间戳单位是毫秒（自流开始计），保持毫秒透传给前端
                  const beginTime = Number(sentence.start_time) || 0;
                  const endTime = Number(sentence.end_time) || 0;
                  const itemId = String(sentence.sentence_id ?? sentenceIndex);

                  if (isFinal) {
                    const finalKey = String(sentence.sentence_id ?? `${beginTime}:${endTime}:${text}`);
                    if (finalizedTencentSentenceIds.has(finalKey)) continue;
                    finalizedTencentSentenceIds.add(finalKey);
                    // 幻觉过滤——跟 DashScope 代理一致
                    const durationMs = Math.max(0, endTime - beginTime);
                    if (isLikelyHallucination(text, durationMs)) {
                      console.log(`[Speaker-ASR-Proxy] Dropped hallucination: "${text.substring(0, 40)}" (duration=${durationMs}ms)`);
                      continue;
                    }

                    // 长文本切分——跟 DashScope 代理一致
                    const splitSegments = splitLongTranscript(text, beginTime, endTime);
                    for (const seg of splitSegments) {
                      // 去重——跟 DashScope 代理一致
                      let replaces;
                      const nextFinal = {
                        id: `seg-${sentenceIndex}`,
                        text: seg.text,
                        beginTime: seg.beginTime,
                        endTime: seg.endTime,
                      };
                      if (lastFinalSegment && shouldDedupSegment(lastFinalSegment, nextFinal, dedupSimilarity, dedupGapMs)) {
                        replaces = [lastFinalSegment.id];
                      }

                      sendClientEvent({
                        event: 'result',
                        provisional: false,
                        replaces,
                        sentence: {
                          id: `seg-${sentenceIndex++}`,
                          text: seg.text,
                          beginTime: seg.beginTime,
                          endTime: seg.endTime,
                          isFinal: true,
                          confidence: 0.95,
                          itemId,
                        },
                        speakerId,
                      });
                      lastFinalSegment = nextFinal;
                    }
                  } else {
                    // 中间结果
                    sendClientEvent({
                      event: 'interim',
                      itemId,
                      text,
                      provisional: true,
                      beginTime,
                      endTime,
                      speakerId,
                    });
                  }
                }
              } catch (e) {
                console.error('[Speaker-ASR-Proxy] Parse error:', e);
              }
            });

            tencentWs.on('unexpected-response', (req, res) => {
              console.error('[Speaker-ASR-Proxy] Unexpected HTTP response:', res.statusCode, res.statusMessage);
              let body = '';
              res.on('data', (chunk) => { body += chunk; });
              res.on('end', () => {
                console.error('[Speaker-ASR-Proxy] Response body:', body.substring(0, 500));
              });
              sendClientEvent({ event: 'error', error: `腾讯云握手失败: HTTP ${res.statusCode} ${res.statusMessage}` });
            });

            tencentWs.on('error', (error) => {
              console.error('[Speaker-ASR-Proxy] Tencent error:', error.message);
              const authFailed = /4002|4003|鉴权|未开通/.test(error.message || '');
              if (authFailed) {
                sendClientEvent({ event: 'auth_failed', error: `腾讯云鉴权失败：${error.message}` });
                clientWs.close(4401, 'Tencent auth failed');
              } else {
                sendClientEvent({ event: 'error', error: `腾讯云连接错误: ${error.message}` });
              }
            });

            tencentWs.on('close', (code, reason) => {
              console.log('[Speaker-ASR-Proxy] Tencent closed:', code, String(reason || ''));
              isReady = false;
              if (clientWs.readyState === WebSocket.OPEN) {
                sendClientEvent({ event: 'finished' });
                sendClientEvent({ event: 'closed', code });
                if (code !== 1000 && !stopRequested) {
                  clientWs.close(1000, 'Tencent disconnected');
                }
              }
            });
          }
          return;
        }

        if (msg.action === 'stop') {
          stopRequested = true;
          if (tencentWs && tencentWs.readyState === WebSocket.OPEN) {
            tencentWs.send(JSON.stringify({ type: 'end' }));
          }
          setTimeout(() => {
            if (tencentWs && tencentWs.readyState === WebSocket.OPEN) {
              tencentWs.close(1000, 'Client stop');
            }
          }, 2000);
        }
      } catch {
        // ignore
      }
    });

    clientWs.on('close', () => {
      console.log('[Speaker-ASR-Proxy] Client disconnected');
      stopRequested = true;
      if (tencentWs && tencentWs.readyState === WebSocket.OPEN) {
        tencentWs.send(JSON.stringify({ type: 'end' }));
        setTimeout(() => {
          if (tencentWs && tencentWs.readyState === WebSocket.OPEN) {
            tencentWs.close(1000, 'Client disconnected');
          }
        }, 1000);
      }
    });

    clientWs.on('error', (error) => {
      console.error('[Speaker-ASR-Proxy] Client error:', error.message);
    });
  });

  asrWss.on('connection', (clientWs) => {
    console.log('[ASR-Proxy] Client connected');

    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model = process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen3-asr-flash-realtime-2026-02-10';
    const sampleRate = parseInt(process.env.DASHSCOPE_ASR_WS_SR || '16000', 10);
    const turnSilenceMs = clampNumber(
      parseInt(process.env.DASHSCOPE_ASR_WS_VAD_SILENCE_MS || '1000', 10),
      200,
      3000,
      1000
    );
    const turnVadThreshold = clampNumber(
      parseFloat(process.env.DASHSCOPE_ASR_WS_VAD_THRESHOLD || '0.30'),
      0.05,
      0.95,
      0.30
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

      // Qwen ASR 当前使用 server_vad。官方协议明确规定：VAD 模式下
      // input_audio_buffer.commit 被禁用；录音结束必须发送 session.finish，
      // 服务端才会把最后一段尚未遇到足够静音的语音完整定稿。
      // 旧实现发送 commit，错误又被静默吞掉，正是“只识别第一句话/结尾吞字”的根因。
      if (isFlushingAudioQueue || audioQueue.length > 0) return false;

      try {
        dashscopeWs.send(JSON.stringify(buildQwenAsrFinishEvent(generateEventId())));
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
    }

    try {
      const wsUrl = `${DASHSCOPE_WSS_URL}?model=${encodeURIComponent(model)}`;
      dashscopeWs = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
          } else if (audioQueue.length === AUDIO_QUEUE_MAX_SIZE) {
            // 仅首次触发时警告，避免日志刷屏
            console.warn('[ASR-Proxy] audioQueue reached max size, dropping new chunks until DashScope ready');
            audioQueue.push(null); // 哨兵值，标记已溢出，长度变为 MAX+1 后不再进入此分支
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
          // session 已建立则只更新内存变量（DashScope 不允许二次 session.update）。
          if ((hint || languageModeChanged) && !isSessionReady && !initialSessionUpdateSent) {
            sendSessionUpdate('context-hint received (pre-ready)');
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

    // 抗噪 / 抗打断三件套：
    //   1) turn_detection.type='semantic_vad'  让模型基于"对话语义意图"判断这是不是真要说话
    //      （能区分"附和声 / 咳嗽 / 别人说话"和"用户真在跟你说"）。旧 server_vad 只看音量，
    //      在嘈杂环境下被打断频繁。环境变量 DASHSCOPE_OMNI_TURN_DETECTION 可强制回退 server_vad。
    //   2) silence_duration_ms 调大到 1500ms，给附和声 / 短暂背景音留缓冲。
    //   3) input_audio_noise_reduction.type='near_field' 在桌面/手机贴麦场景下做服务端降噪。
    //      远场（教室、会议室）用 'far_field'；走环境变量切换。
    const turnDetectionType = process.env.DASHSCOPE_OMNI_TURN_DETECTION || 'semantic_vad';
    const noiseReductionType = process.env.DASHSCOPE_OMNI_NOISE_REDUCTION || 'near_field';
    const silenceDurationMs = Number(process.env.DASHSCOPE_OMNI_SILENCE_DURATION_MS || 1500);
    const vadThreshold = Number(process.env.DASHSCOPE_OMNI_VAD_THRESHOLD || 0.5);

    function buildSessionPayload() {
      const turnDetection = {
        type: turnDetectionType,
        threshold: vadThreshold,
        silence_duration_ms: silenceDurationMs,
        prefix_padding_ms: 500,
        create_response: true,
        interrupt_response: true,
      };
      const payload = {
        modalities: ['text', 'audio'],
        instructions: sessionConfig.instructions,
        voice: sessionConfig.voice || defaultVoice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: transcriptionModel,
        },
        turn_detection: turnDetection,
      };
      // 服务端噪音抑制：'off' 关闭；'near_field' 适合桌面 / 手机贴麦；'far_field' 适合远场。
      if (noiseReductionType && noiseReductionType !== 'off') {
        payload.input_audio_noise_reduction = { type: noiseReductionType };
      }
      return payload;
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
        // M13-fix: 401/403 透传 auth_failed，让前端不要无脑重连
        const authFailed = /401|403|InvalidApiKey|Unauthorized|access denied/i.test(error.message || '');
        if (authFailed) {
          sendClientEvent({ event: 'auth_failed', error: `语音服务密钥失效或无权限：${error.message}` });
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(4401, 'DashScope auth failed');
          }
        } else {
          sendClientEvent({ event: 'error', error: `DashScope 连接错误: ${error.message}` });
        }
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
