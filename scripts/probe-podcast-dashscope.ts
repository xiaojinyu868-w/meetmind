// 探针：DashScope 双主播播客合成链路（qwen3-tts 逐句 + ffmpeg 拼接 + 持久化）。
// 用法：PATH=/usr/local/bin:$PATH node_modules/.bin/tsx scripts/probe-podcast-dashscope.ts
import 'dotenv/config';
import { generateDashscopePodcast } from '@/lib/services/dashscope-podcast';

async function main() {
  const result = await generateDashscopePodcast([
    { speaker: '主持人A', text: '欢迎来到本期课堂复盘，今天聊第一笔融资怎么搞定。' },
    { speaker: '主持人B', text: '对，重点是先把投资人的关注点摸清楚，再讲你的故事。' },
    { speaker: '主持人A', text: '没错，那我们下次见。' },
  ]);
  console.log('OK', JSON.stringify(result, null, 1));
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
