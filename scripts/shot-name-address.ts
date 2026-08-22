/**
 * shot-name-address.ts —— 实拍板书 "name and address" 连写问题（临时诊断）
 * pace=60 快进，翻到第 3 页（index 2）附近连拍，定位空格渲染。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3101';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demo-board?pace=60`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mm-chalk-text', { timeout: 60000 });
  await page.mouse.click(500, 350);

  // pace=60 下前两页约 60-90s，之后每 4s 一拍直到抓到 "name and address"；
  // 途中遇 checkpoint 等待态点「我会了」放行
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(4000);
    await page.evaluate(() => {
      for (const button of document.querySelectorAll('button')) {
        if (button.textContent?.includes('我会了')) (button as HTMLButtonElement).click();
      }
    });
    const found = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-write-id]');
      for (const node of nodes) {
        if ((node.textContent ?? '').replace(/\s/g, '').includes('nameandaddress')) return true;
      }
      return false;
    });
    if (found) {
      await page.screenshot({ path: 'out/audit/name-address.png' });
      console.log(`captured at shot ${i}`);
      break;
    }
  }
  await browser.close();
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
