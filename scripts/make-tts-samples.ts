#!/usr/bin/env npx tsx
/**
 * make-tts-samples.ts —— DEMO 用：demo json 前 3 段 narration 真实合成
 *
 * 产物：out/tts-sample-1~3.mp3；打印每段时长与 timings 条数。
 * 用法：npx tsx scripts/make-tts-samples.ts
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { synthesizeBoardNarration } from '../src/lib/services/board-tts-service';

async function main() {
  const payload = JSON.parse(readFileSync('public/demo/board-script.json', 'utf8')) as {
    script: { pages: Array<{ segments: Array<{ type: string; narrationDisplay?: string; narration: string }> }> };
  };

  const narrations: string[] = [];
  for (const page of payload.script.pages) {
    for (const segment of page.segments) {
      if (narrations.length >= 3) break;
      narrations.push(segment.narrationDisplay ?? segment.narration);
    }
    if (narrations.length >= 3) break;
  }

  for (let i = 0; i < narrations.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await synthesizeBoardNarration(narrations[i]);
    if (!result) {
      console.error(`seg ${i + 1}: 合成失败（null）`);
      process.exit(1);
    }
    const outPath = `out/tts-sample-${i + 1}.mp3`;
    writeFileSync(outPath, result.audio);
    const lastTiming = result.timings[result.timings.length - 1];
    console.log(
      `seg ${i + 1}: ${narrations[i].slice(0, 24)}… | bytes=${result.audio.length} timings=${result.timings.length} lastEndMs=${lastTiming?.endMs ?? '-'} → ${outPath}`,
    );
  }
}

main().catch((error) => {
  console.error('失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
