/**
 * teach-v32-quote-probe.ts —— 定向验证：历史消息里 user 引用块的渲染形态。
 * 预置 localStorage 快照 → 打开线程 → 截右栏对话区。
 * 用法：npx tsx scripts/teach-v32-quote-probe.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'out/teach-v32';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  await page.goto('http://localhost:3103/teach', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(() => {
    window.localStorage.clear();
    const id = 'mock-quote-probe';
    window.localStorage.setItem(
      'teach:v1:threads',
      JSON.stringify([{ id, title: '一元二次方程：求根公式与判别式', createdAt: Date.now() }]),
    );
    window.localStorage.setItem(
      `teach:v1:thread:${id}`,
      JSON.stringify({
        messages: [
          { id: 'm1', role: 'assistant', text: '这节课我们把求根公式推出来。', chips: [{ id: 'c1', name: 'write' }] },
          {
            id: 'm2',
            role: 'user',
            text: '这一步为什么这样做？',
            chips: [],
            quote: '五、本课总结：求根公式由配方法对一般式推出，判别式决定根的个数',
          },
          { id: 'm3', role: 'assistant', text: '你划的「五、本课总结」——它正好接着黑板上刚写的那一步。', chips: [] },
        ],
        pages: [
          {
            segments: [
              {
                type: 'narration',
                narration: '',
                actions: [
                  { type: 'write', text: '一元二次方程：求根公式与判别式', role: 'title' },
                  { type: 'write', text: '五、本课总结', role: 'term' },
                ],
              },
            ],
          },
        ],
        pageIndex: 0,
        cursor: 0,
        pendingCheckpoint: false,
        done: true,
      }),
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=这一步为什么这样做？', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/09-quote-bubble.png` });
  console.log('done');
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
