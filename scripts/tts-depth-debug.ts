/** 临时：定位 BoardWrite update-depth 死循环的触发点 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const t0 = Date.now();
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || /board clock|降级/.test(text)) {
      console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s [${msg.type()}] ${text.slice(0, 220)}`);
    }
  });
  await page.goto('http://localhost:3101/demo-board', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.mouse.click(720, 850); // 点控制区外空白，先给手势
  await page.waitForTimeout(25000);
  await browser.close();
}

void main();
