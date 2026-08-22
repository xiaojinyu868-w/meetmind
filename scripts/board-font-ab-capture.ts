/**
 * board-font-ab-capture.ts —— DEMO 用：字体决赛 A/B/C 实拍
 * 用法：npx tsx scripts/board-font-ab-capture.ts [kuaile,muyao,honglei,xiaolai]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'out';
const FONTS = (process.argv[2] ?? 'kuaile,muyao,honglei,xiaolai').split(',');
const SHOTS: Array<[number, string]> = [
  [36000, '1'], // 第 1 页写满全景（连拍验证过的时间点）
  [106000, '2'], // 第 2 页中英文/数字混排全景
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const font of FONTS) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 640 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:3101/demo-board?pace=240&font=${font}`, {
      waitUntil: 'networkidle',
      timeout: 90000,
    });
    await page.waitForSelector('.mm-chalk-text', { timeout: 60000 });
    const t0 = Date.now();
    for (const [at, suffix] of SHOTS) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: `${OUT}/font-ab-${font}-${suffix}.png` });
      console.log(`shot font-ab-${font}-${suffix}.png @${at}ms`);
    }
    await ctx.close();
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
