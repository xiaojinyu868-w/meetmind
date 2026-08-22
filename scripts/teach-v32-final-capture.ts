/**
 * teach-v32-final-capture.ts —— 交付前验收实拍（真实后端，topic=平方差公式）。
 *
 * 断言：
 *   A. 气泡里 $...$ 渲染成 KaTeX（section .katex 节点 > 0）
 *   B. 画布无 raw 反斜杠命令（main 文本不含 \frac \Delta \quad \sqrt）
 *   C. chip 只有合法标签（✏️板书 / ⭕圈注 / 🖍️下划线 等，无碎文本气泡 chip 化）
 * 截图：01 流式生长 / 02 打断追问后 / 03 完成态（turn 结束）/ 04 刷新恢复
 * 用法：npx tsx scripts/teach-v32-final-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3103/teach?mock=0&topic=' + encodeURIComponent('平方差公式');
const OUT = 'out/teach-v32-final';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  page.on('pageerror', (error) => console.log('PAGE_ERROR:', error.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForResponse(
    (res) => res.url().includes('/api/teach/threads') && res.request().method() === 'GET',
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);

  // 新开一课（点击被吞则重试，以 POST /threads 发出为准）
  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const posted = page.waitForResponse(
      (res) => res.url().endsWith('/api/teach/threads') && res.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.click('button:has-text("新开一课")');
    created = await posted.then(() => true).catch(() => false);
  }
  if (!created) throw new Error('新开一课点击三次未生效');
  console.log('new lesson (topic=平方差公式), waiting TTFT…');

  // 01 流式生长
  await page.waitForSelector('text=讲课中', { timeout: 120000 });
  await page.waitForSelector('.mm-chalk-char', { timeout: 120000 });
  await page.waitForTimeout(20000);
  await page.screenshot({ path: `${OUT}/01-live-streaming.png` });
  console.log('01 saved');

  // 02 打断追问（刻意诱导 $...$ 回答）
  await page.fill('textarea', '能用 $a^2-b^2$ 的形式再写一遍公式吗？');
  await page.keyboard.press('Enter');
  // 等回答流出（打断后新 turn）
  await page.waitForTimeout(30000);
  await page.screenshot({ path: `${OUT}/02-after-interrupt.png` });
  console.log('02 saved');

  // 03 等本轮讲完
  const t0 = Date.now();
  for (;;) {
    const streaming = await page.locator('text=讲课中').count();
    if (!streaming) break;
    if (Date.now() - t0 > 300000) {
      console.log('WARN: 5 分钟本轮未讲完，拍当前态');
      break;
    }
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/03-turn-complete.png` });
  console.log('03 saved');

  // 断言 A/B/C（A 只看 assistant 气泡——用户提问里的 $ 是原样回显，不算未渲染）
  const verdict = await page.evaluate(() => {
    const chat = document.querySelector('section');
    const board = document.querySelector('main');
    const boardText = board?.textContent ?? '';
    const assistantBubbles = [...(chat?.querySelectorAll('[data-msg-id]') ?? [])].filter(
      (el) => !el.className.includes('bg-ink'),
    );
    const assistantText = assistantBubbles.map((el) => el.textContent ?? '').join('');
    const rawBackslash = /\\(frac|Delta|quad|sqrt|times|pm|leq|geq|cdot|text)/.test(boardText);
    const chipLabels = [...document.querySelectorAll('section span')]
      .filter((el) => el.className.includes('rounded-full'))
      .map((el) => el.textContent ?? '');
    return {
      A_katexInChat: (chat?.querySelectorAll('.katex').length ?? 0) > 0,
      A_rawDollarInAssistant: assistantText.includes('$'),
      B_rawBackslashOnBoard: rawBackslash,
      C_chips: [...new Set(chipLabels)],
    };
  });
  console.log('VERDICT', JSON.stringify(verdict, null, 1));

  // 04 刷新恢复
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('aside [role="button"]', { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/04-restored.png` });
  const restored = await page.evaluate(() => ({
    bubbles: document.querySelectorAll('[data-msg-id]').length,
    chars: document.querySelectorAll('.mm-chalk-char').length,
  }));
  console.log(`04 saved (restored bubbles=${restored.bubbles} boardChars=${restored.chars})`);

  console.log('done');
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
