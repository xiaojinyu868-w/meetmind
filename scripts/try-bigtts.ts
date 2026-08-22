#!/usr/bin/env npx tsx
/**
 * try-bigtts.ts —— 火山语音合成大模型（bigtts）最小验证
 *
 * 合成一句「同学们好，我们开始上课」，验证：账号是否开通 bigtts、
 * 音色是否可用、with_timestamp=1 的字级时间戳返回结构（打印原始结构）。
 *
 * 用法：npx tsx scripts/try-bigtts.ts
 * 需要 .env 里 VOLCENGINE_PODCAST_APP_ID / VOLCENGINE_PODCAST_ACCESS_TOKEN。
 * 注意：严禁打印 .env 内容；只打印状态码、音频大小、时间戳结构。
 *
 * 2026-08 验证记录：V1（api/v1/tts, cluster=volcano_tts）与 V3
 * （api/v3/tts/unidirectional, X-Api-Resource-Id=volc.service_type.10029）
 * 均返回 [resource_id=volc.service_type.10029] requested resource not granted
 * ——当前账号未开通语音合成大模型，需火山控制台开通后重跑本脚本验证。
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const ENDPOINT = 'https://openspeech.bytedance.com/api/v1/tts';

async function main() {
  const appId = (process.env.VOLCENGINE_PODCAST_APP_ID || '').trim();
  const accessToken = (process.env.VOLCENGINE_PODCAST_ACCESS_TOKEN || '').trim();
  if (!appId || !accessToken) {
    console.error('VOLCENGINE_PODCAST_APP_ID / ACCESS_TOKEN 未配置');
    process.exit(1);
  }

  const voiceType = (process.env.VOLCENGINE_TTS_VOICE_TYPE || 'zh_male_wennuanahu_moon_bigtts').trim();

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer;${accessToken}`,
    },
    body: JSON.stringify({
      app: { appid: appId, token: accessToken, cluster: 'volcano_tts' },
      user: { uid: 'meetmind-board-demo' },
      audio: { voice_type: voiceType, encoding: 'mp3', speed_ratio: 1.0, rate: 24000 },
      request: {
        reqid: randomUUID(),
        text: '同学们好，我们开始上课。今天这节课，我们来看听力填表题。',
        operation: 'query',
        with_timestamp: 1,
      },
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  console.log(`http_status: ${response.status}`);
  console.log(`code: ${String(payload.code)} message: ${String(payload.message)}`);

  if (payload.code !== 3000) {
    console.error('合成失败（见上方 code/message；403/access denied/quota 类错误 = 未开通）');
    process.exit(1);
  }

  const audio = typeof payload.data === 'string' ? Buffer.from(payload.data, 'base64') : null;
  console.log(`audio_bytes: ${audio?.length ?? 0}`);
  if (audio && audio.length > 0) {
    writeFileSync('out/try-bigtts.mp3', audio);
    console.log('written: out/try-bigtts.mp3');
  }

  const addition = payload.addition as Record<string, unknown> | undefined;
  console.log(`addition keys: ${addition ? Object.keys(addition).join(',') : '(none)'}`);
  if (addition?.duration) console.log(`duration_ms: ${String(addition.duration)}`);
  // 时间戳结构：原样打印（截断），供 timings 解析实现参考
  for (const key of ['timestamp', 'timestamps', 'sentences', 'sentence', 'words']) {
    if (addition && key in addition) {
      const raw = JSON.stringify(addition[key]);
      console.log(`addition.${key}: ${raw.slice(0, 600)}${raw.length > 600 ? '…' : ''}`);
    }
  }
}

main().catch((error) => {
  console.error('请求失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
