/**
 * 自定义 Next.js 服务器
 * 支持 WebSocket 代理到百炼 ASR (qwen3-asr-flash-realtime)
 * 
 * 正确的协议：
 * - Endpoint: /api-ws/v1/realtime?model=qwen3-asr-flash-realtime
 * - session.update 使用 input_audio_transcription（不是 transcription_params）
 * - 音频必须通过 input_audio_buffer.append 事件发送（Base64 编码）
 */

// 先尝试加载 .env.local，如果不存在则加载 .env
const fs = require('fs');
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
} else {
  require('dotenv').config({ path: '.env' });
}

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer, WebSocket } = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3001', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 百炼 WebSocket 地址
const DASHSCOPE_WSS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

// 生成事件 ID
let eventCounter = 0;
function generateEventId() {
  return `event_${Date.now()}_${eventCounter++}`;
}


console.log('[Server] Starting app.prepare()...');

app.prepare().then(() => {
  console.log('[Server] app.prepare() completed');
  
  try {
    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('Error occurred handling', req.url, err);
        res.statusCode = 500;
        res.end('internal server error');
      }
    });
    console.log('[Server] HTTP server created');

    // 创建 WebSocket 服务器（仅用于 ASR）
    const wss = new WebSocketServer({ noServer: true });
    console.log('[Server] WebSocket server created');

    // 获取 Next.js 的 upgrade handler
    const nextUpgradeHandler = app.getUpgradeHandler();
    console.log('[Server] Got upgrade handler');

  // 标记为已完成 WS 设置，防止 Next.js 再次自动注册 upgrade 监听
  if ('didWebSocketSetup' in app) {
    app.didWebSocketSetup = true;
  }
  if (app.options) {
    app.options.httpServer = server;
  }

  // 处理 WebSocket 升级请求
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '', true);
    console.log('[Server] Upgrade request received:', pathname, 'from:', request.headers['x-real-ip'] || request.socket.remoteAddress);

    if (pathname === '/api/asr-stream') {
      // ASR WebSocket 请求由我们处理
      console.log('[Server] Handling ASR WebSocket upgrade');
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('[Server] ASR WebSocket upgrade completed');
        wss.emit('connection', ws, request);
      });
      return;
    }

    // 其他 WebSocket 请求（如 Next.js HMR）交给 Next.js 处理
    try {
      nextUpgradeHandler(request, socket, head);
    } catch (err) {
      console.error('Error delegating upgrade to Next.js:', err);
      socket.destroy();
    }
  });



  // 处理 WebSocket 连接
  wss.on('connection', (clientWs, request) => {
    console.log('[ASR-Proxy] Client connected');

    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model = process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen3-asr-flash-realtime';
    const sampleRate = parseInt(process.env.DASHSCOPE_ASR_WS_SR || '16000', 10);

    if (!apiKey) {
      clientWs.send(JSON.stringify({ event: 'error', error: 'API Key 未配置' }));
      clientWs.close();
      return;
    }

    let dashscopeWs = null;
    let isSessionReady = false;
    const audioQueue = [];
    let sentenceIndex = 0;
    let sessionStartTime = Date.now();  // 立即初始化，用于计算相对时间戳
    let lastSentenceEndTime = 0;  // 跟踪上一个句子的结束时间

    // VAD 状态（前端检测的语音起止时间）
    let currentSpeechStartMs = null;  // 当前语音段的开始时间
    let lastSpeechEndMs = 0;          // 上一个语音段的结束时间
    const vadTimestampQueue = [];     // 备用队列模式（保留兼容）


    // 连接到百炼 WebSocket
    try {
      const wsUrl = `${DASHSCOPE_WSS_URL}?model=${encodeURIComponent(model)}`;
      
      console.log('[ASR-Proxy] Connecting to:', wsUrl);
      
      dashscopeWs = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      dashscopeWs.on('open', () => {
        console.log('[ASR-Proxy] Connected to DashScope');
        
        // 发送正确格式的 session.update
        const sessionConfig = {
          event_id: generateEventId(),
          type: 'session.update',
          session: {
            input_audio_format: 'pcm',
            sample_rate: sampleRate,
            input_audio_transcription: {
              language: 'zh',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.2,
              silence_duration_ms: 800,
            },
          },
        };
        
        console.log('[ASR-Proxy] Sending session.update:', JSON.stringify(sessionConfig));
        dashscopeWs.send(JSON.stringify(sessionConfig));
      });

      dashscopeWs.on('message', (data, isBinary) => {
        try {
          if (isBinary) {
            console.log('[ASR-Proxy] Received binary (unexpected)');
            return;
          }
          
          const msg = JSON.parse(data.toString());
          const msgType = msg.type;
          
          console.log('[ASR-Proxy] Event:', msgType);

          switch (msgType) {
            case 'session.created':
              console.log('[ASR-Proxy] Session created');
              break;

            case 'session.updated':
              // Session 配置完成，可以开始发送音频
              console.log('[ASR-Proxy] Session updated, ready to receive audio');
              isSessionReady = true;
              sessionStartTime = Date.now();  // 记录开始时间
              clientWs.send(JSON.stringify({ event: 'ready' }));
              
              // 发送队列中的音频
              flushAudioQueue();
              break;


            case 'input_audio_buffer.speech_started':
              console.log('[ASR-Proxy] Speech started');
              break;

            case 'input_audio_buffer.speech_stopped':
              console.log('[ASR-Proxy] Speech stopped');
              break;

            case 'conversation.item.input_audio_transcription.completed':
              // 转录完成 - 尝试多种可能的结构
              let finalText = '';
              let beginTime = 0;
              let endTime = 0;
              
              // 打印完整消息结构以便调试
              console.log('[ASR-Proxy] Completed msg:', JSON.stringify(msg));
              
              if (msg.item?.content?.[0]?.text) {
                finalText = msg.item.content[0].text;
              } else if (msg.transcript) {
                finalText = msg.transcript;
              } else if (msg.text) {
                finalText = msg.text;
              }
              
              // 时间戳优先级：
              // 1. 前端 VAD 事件模式（实时跟踪语音开始/结束）
              // 2. VAD 队列模式（兼容旧方式）
              // 3. 百炼返回的时间戳
              // 4. 服务端经过时间（fallback）
              
              const now = Date.now();
              const currentElapsedMs = now - sessionStartTime;
              
              // 调试：打印当前 VAD 状态
              console.log('[ASR-Proxy] VAD state - speechStart:', currentSpeechStartMs, 'speechEnd:', lastSpeechEndMs, 'queueSize:', vadTimestampQueue.length);
              
              if (currentSpeechStartMs !== null) {
                // 使用 VAD 事件模式的时间戳
                beginTime = currentSpeechStartMs;
                // 结束时间使用：已知的语音结束时间 或 当前时间
                endTime = lastSpeechEndMs > currentSpeechStartMs ? lastSpeechEndMs : currentElapsedMs;
                lastSentenceEndTime = endTime;
                console.log('[ASR-Proxy] Using VAD event timestamp:', beginTime, '-', endTime);
                
                // 重置当前语音段开始时间，为下一段做准备
                currentSpeechStartMs = null;
              } else {
                // 尝试队列模式
                const vadTimestamp = vadTimestampQueue.shift();
                if (vadTimestamp) {
                  beginTime = vadTimestamp.startMs;
                  endTime = vadTimestamp.endMs;
                  lastSentenceEndTime = endTime;
                  console.log('[ASR-Proxy] Using VAD queue timestamp:', beginTime, '-', endTime, 'remaining:', vadTimestampQueue.length);
                } else {
                  // 回退：尝试提取百炼返回的时间戳
                  const possibleBeginFields = ['begin_time', 'start_time', 'beginTime', 'startTime', 'audio_start_ms'];
                  const possibleEndFields = ['end_time', 'endTime', 'audio_end_ms'];
                  
                  let serverBeginTime = null;
                  let serverEndTime = null;
                  
                  for (const field of possibleBeginFields) {
                    if (msg[field] !== undefined) {
                      serverBeginTime = msg[field];
                      console.log('[ASR-Proxy] Found beginTime in msg.' + field + ':', serverBeginTime);
                      break;
                    }
                    if (msg.item?.[field] !== undefined) {
                      serverBeginTime = msg.item[field];
                      console.log('[ASR-Proxy] Found beginTime in msg.item.' + field + ':', serverBeginTime);
                      break;
                    }
                  }
                  
                  for (const field of possibleEndFields) {
                    if (msg[field] !== undefined) {
                      serverEndTime = msg[field];
                      console.log('[ASR-Proxy] Found endTime in msg.' + field + ':', serverEndTime);
                      break;
                    }
                    if (msg.item?.[field] !== undefined) {
                      serverEndTime = msg.item[field];
                      console.log('[ASR-Proxy] Found endTime in msg.item.' + field + ':', serverEndTime);
                      break;
                    }
                  }
                  
                  if (serverBeginTime !== null && serverEndTime !== null) {
                    beginTime = serverBeginTime;
                    endTime = serverEndTime;
                    lastSentenceEndTime = endTime;
                    console.log('[ASR-Proxy] Using server timestamp (fallback 1):', beginTime, '-', endTime);
                  } else {
                    // 最后回退：使用客户端录音经过时间
                    beginTime = lastSentenceEndTime;
                    endTime = currentElapsedMs;
                    lastSentenceEndTime = currentElapsedMs;
                    console.log('[ASR-Proxy] Using client elapsed time (fallback 2):', beginTime, '-', endTime);
                  }
                }
              }
              
              if (finalText) {
                console.log('[ASR-Proxy] Final Transcript:', finalText, 'time:', beginTime, '-', endTime);
                clientWs.send(JSON.stringify({
                  event: 'result',
                  sentence: {
                    id: `seg-${sentenceIndex++}`,
                    text: finalText,
                    beginTime: beginTime,
                    endTime: endTime,
                    isFinal: true,
                  },
                }));
              } else {
                console.log('[ASR-Proxy] Completed but no text found:', JSON.stringify(msg).substring(0, 300));
              }
              break;

            case 'conversation.item.input_audio_transcription.text':
              // 增量转录文本（实时显示）
              const interimText = msg.text || msg.delta || '';
              if (interimText) {
                console.log('[ASR-Proxy] Interim:', interimText);
                clientWs.send(JSON.stringify({
                  event: 'interim',
                  text: interimText,
                }));
              }
              break;

            case 'conversation.item.input_audio_transcription.delta':
              // 增量转录结果（备用）
              if (msg.delta) {
                clientWs.send(JSON.stringify({
                  event: 'interim',
                  text: msg.delta,
                }));
              }
              break;

            case 'error':
              const error = msg.error?.message || msg.message || '识别错误';
              console.error('[ASR-Proxy] Error:', msg.error || msg);
              clientWs.send(JSON.stringify({ event: 'error', error }));
              break;

            case 'response.done':
              console.log('[ASR-Proxy] Response done');
              break;

            default:
              if (msgType) {
                console.log('[ASR-Proxy] Unhandled event:', msgType);
              }
          }
        } catch (e) {
          console.error('[ASR-Proxy] Parse error:', e);
        }
      });

      dashscopeWs.on('error', (error) => {
        console.error('[ASR-Proxy] DashScope error:', error.message);
        clientWs.send(JSON.stringify({ event: 'error', error: 'DashScope 连接错误: ' + error.message }));
      });

      dashscopeWs.on('close', (code, reason) => {
        console.log('[ASR-Proxy] DashScope closed:', code, reason.toString());
        isSessionReady = false;
        if (clientWs.readyState === WebSocket.OPEN) {
          // 先发送 finished 事件，通知前端 ASR 会话已完成
          clientWs.send(JSON.stringify({ event: 'finished', code }));
          // 再发送 closed 事件
          clientWs.send(JSON.stringify({ event: 'closed', code }));
        }
      });


    } catch (error) {
      console.error('[ASR-Proxy] Failed to connect:', error);
      clientWs.send(JSON.stringify({ event: 'error', error: '连接失败' }));
      clientWs.close();
      return;
    }

    // 发送音频到百炼（使用 input_audio_buffer.append 事件，Base64 编码）
    function sendAudioToDashScope(pcmData) {
      if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) return;
      
      // 将 PCM 数据转为 Base64
      const base64Audio = Buffer.from(pcmData).toString('base64');
      
      // 使用 input_audio_buffer.append 事件发送
      const appendEvent = {
        event_id: generateEventId(),
        type: 'input_audio_buffer.append',
        audio: base64Audio,
      };
      
      dashscopeWs.send(JSON.stringify(appendEvent));
    }

    // 发送队列中的音频
    function flushAudioQueue() {
      while (audioQueue.length > 0) {
        const audioData = audioQueue.shift();
        sendAudioToDashScope(audioData);
      }
    }

    // 处理客户端消息
    clientWs.on('message', (data, isBinary) => {
      const dataLen = data.length || data.byteLength || 0;
      
      // 调试日志：打印消息类型
      if (dataLen < 200) {
        console.log('[ASR-Proxy] Received msg, isBinary:', isBinary, 'len:', dataLen, 'preview:', data.toString('utf8').substring(0, 100));
      }
      
      // 优先使用 ws 库的 isBinary 标志
      // 如果明确是二进制，直接处理为音频
      if (isBinary) {
        if (isSessionReady) {
          sendAudioToDashScope(data);
        } else {
          audioQueue.push(data);
        }
        return;
      }
      
      // 非二进制消息，尝试解析为 JSON
      try {
        const jsonText = typeof data === 'string' ? data : data.toString('utf8');
        const msg = JSON.parse(jsonText);
        
        // 处理 VAD 事件消息（新的事件驱动模式）
        if (msg.type === 'vad-event') {
          if (msg.event === 'start') {
            currentSpeechStartMs = msg.timestampMs;
            console.log('[ASR-Proxy] VAD speech start:', currentSpeechStartMs, 'ms');
          } else if (msg.event === 'end') {
            lastSpeechEndMs = msg.timestampMs;
            console.log('[ASR-Proxy] VAD speech end:', lastSpeechEndMs, 'ms');
          }
          return;
        }
        
        // 处理 VAD 时间戳消息（保留队列模式兼容）
        if (msg.type === 'vad-timestamp') {
          vadTimestampQueue.push({
            startMs: msg.startMs,
            endMs: msg.endMs
          });
          console.log('[ASR-Proxy] VAD timestamp queued:', msg.startMs, '-', msg.endMs, 'queue size:', vadTimestampQueue.length);
          return;
        }
        
        if (msg.action === 'stop') {
          console.log('[ASR-Proxy] Stop requested');
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
            const commitEvent = {
              event_id: generateEventId(),
              type: 'input_audio_buffer.commit',
            };
            dashscopeWs.send(JSON.stringify(commitEvent));
            console.log('[ASR-Proxy] Audio buffer committed');
            
            setTimeout(() => {
              if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
                dashscopeWs.close(1000, 'Client stop');
              }
            }, 2000);
          }
        }
      } catch (e) {
        // JSON 解析失败，可能是二进制音频数据被误判为文本
        // 尝试作为音频处理
        if (isSessionReady) {
          sendAudioToDashScope(data);
        } else {
          audioQueue.push(data);
        }
      }
    });

    clientWs.on('close', () => {
      console.log('[ASR-Proxy] Client disconnected');
      if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
        try {
          const commitEvent = {
            event_id: generateEventId(),
            type: 'input_audio_buffer.commit',
          };
          dashscopeWs.send(JSON.stringify(commitEvent));
        } catch (e) {}
        setTimeout(() => {
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
            dashscopeWs.close(1000, 'Client disconnected');
          }
        }, 1000);
      }
    });


    clientWs.on('error', (error) => {
      console.error('[ASR-Proxy] Client error:', error.message);
    });
  });

  console.log('[Server] About to call server.listen on port', port);
  
  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket proxy available at ws://${hostname}:${port}/api/asr-stream`);
  });
  
  server.on('error', (err) => {
    console.error('[Server] Server error:', err);
  });
  
  } catch (setupError) {
    console.error('[Server] Setup error:', setupError);
    process.exit(1);
  }
}).catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
