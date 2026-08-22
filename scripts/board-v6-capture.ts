/**
 * board-v6-capture.ts —— DEMO 用：v3 交互式板书家教验收
 * checkpoint 交互态 / hint 两级 / ref 脉冲 / 学生板演 + cue 播放视频
 * 用法：npx tsx scripts/board-v6-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3101/demo-board?pace=240';
const OUT = 'out';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ── 视频：开头 18s（cue 词级触发的书写） ──
  const ctxVideo = await browser.newContext({
    viewport: { width: 960, height: 640 },
    recordVideo: { dir: OUT, size: { width: 960, height: 640 } },
  });
  const videoPage = await ctxVideo.newPage();
  await videoPage.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  await videoPage.waitForSelector('.mm-chalk-text', { timeout: 60000 });
  await videoPage.waitForTimeout(18000);
  const video = videoPage.video();
  await ctxVideo.close();
  console.log(`video: ${video ? await video.path() : null}`);

  // ── 交互截图 ──
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForSelector('.mm-chalk-text', { timeout: 60000 });

  // v6-1：checkpoint 交互态（等待「我会了」按钮出现）
  await page.waitForSelector('text=我会了', { timeout: 240000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/board-v6-1.png` });
  console.log('shot board-v6-1 (checkpoint 交互态)');

  // v6-2：点两次「给我提示」，两级 hint 上板后
  await page.click('text=给我提示');
  await page.waitForTimeout(3500);
  await page.click('text=给我提示');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/board-v6-2.png` });
  console.log('shot board-v6-2 (两级 hint)');

  // v6-3：点「看解析」，等 ref 插播出现（.mm-ref-interlude）
  await page.click('text=看解析');
  await page.waitForSelector('.mm-ref-interlude', { timeout: 240000 });
  await page.waitForTimeout(700); // 脉冲中段
  await page.screenshot({ path: `${OUT}/board-v6-3.png` });
  console.log('shot board-v6-3 (ref 脉冲)');

  // v6-4：板演——开「板演」，画两笔蓝色笔画
  await page.waitForSelector('.mm-ref-interlude', { state: 'detached', timeout: 30000 }).catch(() => {});
  await page.click('text=板演');
  await page.waitForTimeout(500);
  const board = await page.locator('.mm-board-page').boundingBox();
  if (board) {
    await page.mouse.move(board.x + 520, board.y + 180);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(board.x + 520 + i * 12, board.y + 180 + Math.sin(i / 2) * 22);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.mouse.move(board.x + 560, board.y + 290);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(board.x + 560 + i * 9, board.y + 290 + i * 4);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/board-v6-4.png` });
  console.log('shot board-v6-4 (板演)');

  await ctx.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
