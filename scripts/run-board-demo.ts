#!/usr/bin/env npx tsx
/**
 * run-board-demo.ts —— explainer 插件（板书精讲）本地演示
 *
 * 直接用 DEMO_SEGMENTS 走一遍 plugin：LLM 生成板书脚本（BoardScript），
 * 服务端清洗坏动作 + 逐字校验老师原话引用，产物写到 public/demo/board-script.json。
 *
 * 用法：
 *   npx tsx scripts/run-board-demo.ts
 *
 * 需要 .env 里有可用的 DEEPSEEK_API_KEY（模型 DeepSeek-V4-Flash）。
 * 注意：严禁打印 .env 内容；只打印 quoteStats、页/段/动作统计与输出路径。
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppPluginRegistry } from '@/lib/ai-native/registry';
import type { AppExecutionContext } from '@/lib/ai-native/types';
import type { ExplainerRenderPayload } from '@/lib/ai-native/plugins/explainer.plugin';
import { DEMO_ANCHORS, DEMO_SEGMENTS, DEMO_SESSION_ID } from '@/fixtures/demo-data';

const MODEL_ID = process.env.BOARD_EXPLAINER_MODEL?.trim() || 'kimi/kimi-k3';

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY 未配置，无法运行 demo。');
    process.exit(1);
  }

  const context: AppExecutionContext = {
    goal: {
      intent: '把这节课在黑板上边写边讲讲透：板书精讲、老师原话',
      expectedOutput: 'cards',
      appKey: 'explainer',
    },
    input: {
      sessionId: DEMO_SESSION_ID,
      dataSource: 'demo',
      transcript: DEMO_SEGMENTS,
      anchors: DEMO_ANCHORS,
      metadata: { subject: '英语', teacher: 'Demo Teacher' },
    },
    memory: {},
    model: MODEL_ID,
  };

  const registry = new AppPluginRegistry();
  const result = await registry.execute(context, 'explainer');

  console.log('trace:');
  for (const line of result.trace) console.log(`  ${line}`);

  const payload = result.render?.payload as ExplainerRenderPayload | undefined;

  if (!payload?.script) {
    console.error('没有生成板书脚本（llm=fallback）。');
    process.exit(1);
  }

  const outDir = join(process.cwd(), 'public', 'demo');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'board-script.json');
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  const { script, quoteStats } = payload;
  const segmentCount = script.pages.reduce((sum, page) => sum + page.segments.length, 0);
  let actionCount = 0;
  let checkpointCount = 0;
  let cueCount = 0;
  for (const page of script.pages) {
    for (const segment of page.segments) {
      if (segment.type === 'checkpoint') {
        checkpointCount += 1;
        actionCount += segment.demoActions.length;
      } else {
        actionCount += segment.actions.length;
      }
      cueCount += segment.cues?.length ?? 0;
    }
  }

  console.log(`title: ${script.title}`);
  console.log(`quoteStats: ${JSON.stringify(quoteStats)}`);
  console.log(
    `pages: ${script.pages.length}, segments: ${segmentCount}, actions: ${actionCount}, checkpoints: ${checkpointCount}, cues: ${cueCount}`,
  );
  console.log(`written: ${outPath}`);
}

main().catch((error) => {
  console.error('demo 运行失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
