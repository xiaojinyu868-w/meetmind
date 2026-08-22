/**
 * board-v3-capture.ts —— DEMO 用：v3 验收截图（实测标注/勾叉右肩/翻页硬同步）
 * 用法：npx tsx scripts/board-v3-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3101/demo-board?pace=240';
const OUT = 'out';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ── 视频：第 1 页书写 + 翻页硬同步（gate 等 write 完成才翻） ──
  const ctxVideo = await browser.newContext({
    viewport: { width: 960, height: 640 },
    recordVideo: { dir: OUT, size: { width: 960, height: 640 } },
  });
  const videoPage = await ctxVideo.newPage();
  await videoPage.goto(BASE, { waitUntil: 'networkidle' });
  await videoPage.waitForSelector('.mm-chalk-text', { timeout: 30000 });
  await videoPage.waitForTimeout(52000); // 第 1 页 ~38s 翻页，录到第 2 页开写
  const video = videoPage.video();
  await ctxVideo.close();
  console.log(`video: ${video ? await video.path() : null}`);

  // ── 截图：写满页全景（第 2 页末，含 circle/underline） + 易错点对照页全景（第 5 页，含勾叉右肩） ──
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.mm-chalk-text', { timeout: 30000 });
  const t0 = Date.now();
  const shots: Array<[number, string]> = [
    [104000, 'board-v3-2.png'], // 第 2 页写满全景（~109s 翻页前）
    [272000, 'board-v3-1.png'], // 第 5 页易错点对照全景（finished 后末页保持）
  ];
  for (const [at, name] of shots) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/${name}` });
    console.log(`shot ${name} @${at}ms`);
  }
  await ctx.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
