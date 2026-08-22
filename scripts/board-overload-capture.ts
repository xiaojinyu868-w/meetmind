/**
 * board-overload-capture.ts —— 超载页布局回归实拍（v24）
 *
 * 播放 /demo-board?script=board-script-overload.json（7 个页级 write 写满上半板
 * + 长英文 checkpoint extras），走到 checkpoint 点两次提示再看解析，
 * 抓拍 extras 全量上板后的板面：验证分区对齐、无碰撞、不压字幕、字幕左缘固定。
 *
 * 用法：npx tsx scripts/board-overload-capture.ts [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3101';

async function main() {
  const browser = await chromium.launch({
    args: [
      // 防 headless 空闲节流（rAF 压到 1Hz 会让书写爬行，测出假错位）
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await page.goto(`${BASE}/demo-board?script=board-script-overload.json&pace=60`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('header', { timeout: 30000 });
  await page.mouse.click(500, 350); // 手势门：解锁音频

  // 等到 checkpoint 面板出现（提问念完 + 2s wait time）
  const hintButton = page.getByRole('button', { name: '给我提示' });
  await hintButton.waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'out/board-overload-1-question.png' });

  // 两级提示上板
  await hintButton.click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: '给我提示' }).click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'out/board-overload-2-hints.png' });

  // 看解析：答案口述 + 示范 write 上板后抓拍
  await page.getByRole('button', { name: '看解析' }).click();
  await page.waitForTimeout(12000);
  await page.screenshot({ path: 'out/board-overload-3-demo.png' });

  await browser.close();
  console.log('written: out/board-overload-1-question.png / 2-hints / 3-demo');
}

main().catch((error) => {
  console.error('capture 失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
