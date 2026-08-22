/**
 * board-v4-capture.ts —— DEMO 用：v4 字体验收截图（ZCOOL KuaiLe + 柔和滤镜）
 * 用法：npx tsx scripts/board-v4-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3101/demo-board?pace=240';
const OUT = 'out';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.mm-chalk-text', { timeout: 30000 });
  const t0 = Date.now();
  const shots: Array<[number, string]> = [
    [33000, 'board-v4-1a.png'], // 第 1 页写满全景候选（连拍取最优）
    [36000, 'board-v4-1b.png'],
    [39000, 'board-v4-1c.png'],
    [106000, 'board-v4-2.png'], // 第 2 页：中英文/数字混排（Jane Bond / J-A-N-E）
    [276000, 'board-v4-3.png'], // 第 5 页易错点对照全景
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
