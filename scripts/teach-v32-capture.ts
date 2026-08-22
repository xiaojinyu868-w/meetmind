/**
 * teach-v32-capture.ts —— /teach 页（v32 备课本 + Agent 对话栏）实拍。
 *
 * 验证点（截图存 out/teach-v32/）：
 *   01 初始态（备课中）  02 流式生长中间态（文字逐段 + chip）
 *   03 checkpoint 提问挂起  04 作答后「你的答案」上墙 + 续播
 *   05 划线选中浮层（引用提问按钮）  06 引用块进输入框
 *   07 完成态（整课播完）  08 历史列表（新开一课后列表两项）
 * 用法：npx tsx scripts/teach-v32-capture.ts [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3103/teach?pace=30';
const OUT = 'out/teach-v32';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => console.log('PAGE_ERROR:', error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE_ERROR:', msg.text().slice(0, 200));
  });

  // 干净起点：清空 mock 历史
  await page.goto('http://localhost:3103/teach', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 01 初始态（备课中：首个动作上板前）
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/01-initial.png` });

  // 02 流式生长中间态：等第一个 write 开始 + chip 出现
  await page.waitForSelector('.mm-chalk-char', { timeout: 30000 });
  await page.waitForSelector('text=✏️', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/02-streaming.png` });

  // 03 checkpoint 挂起：等 ask chip（❓ 提问）出现
  await page.waitForSelector('text=❓', { timeout: 300000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/03-checkpoint.png` });

  // 04 学生作答：输入框答 42 → 「你的答案：42」写上 checkpoint 页 + 解析流出
  await page.fill('textarea', '42');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=你的答案', { timeout: 90000 });
  // 趁还没翻页拍上墙瞬间（解析念完会 flip 到下一页）
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-answer-on-board.png` });

  // 05 划线选中浮层：选画布上的文本 → 「引用提问」浮钮
  await page.waitForTimeout(4000);
  const selected = await page.evaluate(() => {
    const host = document.querySelector('[data-write-id] .mm-chalk-char');
    if (!host || !host.firstChild) return null;
    const range = document.createRange();
    // 选当前页第一个 write 块的前几个字（跨 span 选区）
    const block = host.closest('.mm-chalk-text');
    if (!block) return null;
    range.selectNodeContents(block);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // mouseup 监听挂在画布容器（useTextSelection）：从块内冒泡上去
    block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return block.textContent?.slice(0, 20) ?? null;
  });
  console.log('selected text:', selected);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-selection-popover.png` });

  // 06 引用进输入框：点「引用提问」→ quote chip 出现在 composer 顶部
  const quoteBtn = page.locator('button:has-text("引用提问")');
  if (await quoteBtn.count()) {
    await quoteBtn.first().click();
    await page.waitForTimeout(400);
  } else {
    console.log('WARN: 引用提问按钮未出现');
  }
  await page.screenshot({ path: `${OUT}/06-quote-in-composer.png` });

  // 带引用发一条提问（验证 quote 随消息上屏）
  await page.fill('textarea', '这一步为什么这样做？');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  // 07 完成态：等 finish（讲课中指示消失 + 不再 streaming）
  const t0 = Date.now();
  for (;;) {
    const streaming = await page.locator('text=讲课中').count();
    if (!streaming) break;
    if (Date.now() - t0 > 300000) {
      console.log('WARN: 等待完成超时');
      break;
    }
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/07-finished.png` });

  // 08 历史列表：再开一课（列表变两项 + 新课开流）
  await page.click('button:has-text("新开一课")');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/08-thread-list.png` });

  // 08b 回到第一课：恢复画布终态 + 对话记录
  const items = page.locator('aside [role="button"]');
  const count = await items.count();
  console.log(`threads in list: ${count}`);
  if (count >= 2) {
    await items.nth(1).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/08b-restored.png` });
  }

  console.log('done');
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
