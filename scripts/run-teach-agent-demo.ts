#!/usr/bin/env npx tsx
/**
 * run-teach-agent-demo.ts —— 跑一次 teach-agent 生成一节课，落盘 demo 脚本
 *
 * 产物：
 *   public/demo/board-script-agent.json   （ExplainerRenderPayload 同构，demo 页 ?script=board-script-agent.json 播放）
 *   out/teach-agent-trajectory.json       （AI SDK 原生 messages，续讲/复盘用）
 * 用法：npx tsx scripts/run-teach-agent-demo.ts [课题]
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { streamTeachLesson } from '../src/lib/services/teach-agent/teach-agent-service';

const topic =
  process.argv[2]?.trim() || '高中数学：一元二次方程求根公式与判别式（配方法推导）';

async function main() {
  console.log(`[teach-agent] topic: ${topic}`);
  let donePayload: Record<string, unknown> | null = null;

  for await (const event of streamTeachLesson({ topic })) {
    if (event.type === 'meta') {
      console.log(`[meta] model=${event.model}`);
    } else if (event.type === 'text') {
      process.stdout.write(event.text);
    } else if (event.type === 'tool') {
      console.log(`\n[tool] ${event.tool} ${event.ok ? 'ok' : 'FAIL'}`);
    } else if (event.type === 'image') {
      console.log(`[image] ${event.done}/${event.total}`);
    } else if (event.type === 'error') {
      console.error('[error] failed');
      process.exit(1);
    } else if (event.type === 'done') {
      donePayload = event as unknown as Record<string, unknown>;
    }
  }

  if (!donePayload) {
    console.error('\n[teach-agent] 未收到 done 事件');
    process.exit(1);
  }

  const { messages, ...payload } = donePayload;
  writeFileSync(
    'public/demo/board-script-agent.json',
    JSON.stringify({ ...payload, quoteStats: { total: 0, verified: 0, downgraded: 0 } }, null, 2),
  );
  mkdirSync('out', { recursive: true });
  writeFileSync('out/teach-agent-trajectory.json', JSON.stringify(messages, null, 2));

  const script = payload.script as { pages: unknown[] };
  console.log(
    `\n[done] title=${payload.title} pages=${script.pages.length} steps=${payload.steps} images=${payload.images}`,
  );
  console.log('[done] → public/demo/board-script-agent.json（demo 页 ?script=board-script-agent.json）');
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
