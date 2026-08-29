/**
 * ui-visual-dom-probe2.ts —— teach 线程 DOM 细查：
 * strong/em/code/blockquote 标签计数与文本、字面 ** 或 == 残留（排除 pre/code）。
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
  await page.click('button:has-text("平方差公式")').catch(() => undefined);
  await page.waitForTimeout(4000);
  const dump = await page.evaluate(() => {
    const root = document.querySelector('[role="log"]');
    if (!root) return { error: 'no log root' };
    const assistants = Array.from(root.querySelectorAll('.is-assistant'));
    const tags = { strong: 0, em: 0, code: 0, pre: 0, blockquote: 0, ul: 0, ol: 0, mark: 0 };
    const strongTexts: string[] = [];
    for (const el of assistants) {
      for (const k of Object.keys(tags) as Array<keyof typeof tags>) {
        tags[k] += el.querySelectorAll(k).length;
      }
      el.querySelectorAll('strong').forEach((s) => strongTexts.push(s.textContent ?? ''));
    }
    // 字面 ** 或 == 残留（排除 pre/code 内的文本）
    const residual: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = (node as Text).parentElement;
      if (parent && !parent.closest('pre,code')) {
        const t = node.textContent ?? '';
        if (t.includes('**') || t.includes('==')) residual.push(t.slice(0, 120));
      }
      node = walker.nextNode();
    }
    return { tags, strongTexts, residual };
  });
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
