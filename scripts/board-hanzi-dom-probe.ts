/**
 * board-hanzi-dom-probe.ts —— 复刻用户截图场景（demo 脚本第 2 页 checkpoint 暂停），
 *  dump 每个笔顺字 SVG 的 path 数，定位"缺笔画"是数据/动画问题还是绘制问题。
 * 用法：npx tsx scripts/board-hanzi-dom-probe.ts [baseUrl]
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
  await page.goto(`${BASE}/demo-board?pace=60`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 30000 });
  await page.mouse.click(500, 350);

  // 等到第 2 页 checkpoint 面板出现（我会了）
  await page.getByRole('button', { name: '我会了' }).waitFor({ timeout: 180000 });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(() => {
    const out: Array<{ char: string; paths: number; rects: string; html: string }> = [];
    document.querySelectorAll('[data-write-id]').forEach((writeEl) => {
      writeEl.querySelectorAll('div[aria-label]').forEach((host) => {
        const char = host.getAttribute('aria-label') ?? '';
        if (!/[㐀-鿿]/.test(char)) return;
        const svg = host.querySelector('svg');
        const paths = svg ? svg.querySelectorAll('path').length : -1;
        const rects = host.getBoundingClientRect();
        out.push({
          char,
          paths,
          rects: `${Math.round(rects.width)}x${Math.round(rects.height)}`,
          html: host.innerHTML.slice(0, 120),
        });
      });
    });
    return out;
  });
  for (const row of report) console.log(JSON.stringify(row));
  await page.screenshot({ path: 'out/board-hanzi-dom.png' });
  await browser.close();
}

main().catch((error) => {
  console.error('probe 失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
