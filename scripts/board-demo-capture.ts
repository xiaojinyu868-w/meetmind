/**
 * board-demo-capture.ts —— DEMO 用：截 4 张播放时刻图 + 录播放视频
 * 用法：npx tsx scripts/board-demo-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3101/demo-board?pace=240';
const OUT = 'out';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ── 截图：4 个不同播放时刻（pace=240 匹配串行书写节奏：
  //    p1 书写中 → p1 写满全景 → p3 下划线瞬间 → p4 勾叉全景） ──
  const shotTimes = [15000, 38000, 120000, 200000];
  const ctx1 = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page1 = await ctx1.newPage();
  await page1.goto(BASE, { waitUntil: 'networkidle' });
  await page1.waitForSelector('.mm-chalk-text', { timeout: 30000 });
  const t0 = Date.now();
  for (let i = 0; i < shotTimes.length; i += 1) {
    const wait = shotTimes[i] - (Date.now() - t0);
    if (wait > 0) await page1.waitForTimeout(wait);
    await page1.screenshot({ path: `${OUT}/board-v2-${i + 1}.png` });
    console.log(`shot ${i + 1} @${shotTimes[i]}ms`);
  }
  await ctx1.close();

  // ── 视频：15-25 秒（串行写字、圈点勾画） ──
  const ctx2 = await browser.newContext({
    viewport: { width: 960, height: 640 },
    recordVideo: { dir: OUT, size: { width: 960, height: 640 } },
  });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE, { waitUntil: 'networkidle' });
  await page2.waitForSelector('.mm-chalk-text', { timeout: 30000 });
  await page2.waitForTimeout(20000);
  const video = page2.video();
  await ctx2.close();
  const videoPath = video ? await video.path() : null;
  console.log(`video: ${videoPath}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
