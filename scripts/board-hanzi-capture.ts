/**
 * board-hanzi-capture.ts —— 单字渲染验证抓拍（临时诊断）。
 * 播放 ?script=board-script-hanzi.json，等书写全部完成后抓拍笔顺字终态。
 * 用法：npx tsx scripts/board-hanzi-capture.ts [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3101';

async function main() {
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await page.goto(`${BASE}/demo-board?script=board-script-hanzi.json&pace=60`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('header', { timeout: 30000 });
  await page.mouse.click(500, 350);
  // 等两个 write 全部写完（term 长行 + title 笔顺，给足 40s）
  await page.waitForTimeout(40000);
  await page.screenshot({ path: 'out/board-hanzi-check.png' });
  await browser.close();
  console.log('written: out/board-hanzi-check.png');
}

main().catch((error) => {
  console.error('capture 失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
