/**
 * ui-visual-dom-probe.ts —— 重开 teach 线程，dump assistant 气泡 innerHTML，
 * 核实 CJK 加粗到底渲染成什么（strong? 字面 **?）。
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3003/teach?mock=0';

async function main() {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 950 } })
  ).newPage();
  page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(3000);
  // 选最新「平方差公式」线程（列表第一项）
  await page.click('button:has-text("平方差公式")').catch(() => undefined);
  await page.waitForTimeout(4000);
  const dump = await page.evaluate(() => {
    const root = document.querySelector('[role="log"]');
    if (!root) return { error: 'no log root' };
    const assistants = Array.from(root.querySelectorAll('.is-assistant'));
    return {
      count: assistants.length,
      items: assistants.map((el, i) => ({
        i,
        html: (el as HTMLElement).innerHTML.slice(0, 2000),
        text: (el.textContent ?? '').slice(0, 300),
      })),
    };
  });
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
