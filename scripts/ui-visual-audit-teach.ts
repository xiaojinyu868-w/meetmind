/**
 * ui-visual-audit-teach.ts —— teach 线对话栏（AI Elements 迁移后）浏览器端视觉审查。
 *
 * 走真实后端（?mock=0），课题从 URL 带。断言：
 *   A. assistant 气泡 CJK 加粗：<strong> 存在且无残留字面 **
 *   B. 对话列表不横向溢出、消息不重叠
 *   C. console 无 error
 * 截图：01 空态/开课 / 02 流式中（Loader 或正文生长）/ 03 markdown 应答 / 04 回到最新
 * 用法：npx tsx scripts/ui-visual-audit-teach.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE =
  'http://localhost:3003/teach?mock=0&topic=' + encodeURIComponent('平方差公式');
const OUT = 'out/audit/ui-visual';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 950 } })
  ).newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`PAGE_ERROR: ${error.message}`));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page
    .waitForResponse(
      (res) => res.url().includes('/api/teach/threads') && res.request().method() === 'GET',
      { timeout: 60000 },
    )
    .catch(() => console.log('WARN: threads GET 未捕获'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/teach-01-landing.png` });
  console.log('01 landing saved');

  // 新开一课（v33：必弹课题对话框，填课题后开始）
  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    await page.click('button:has-text("新开一课")').catch(() => undefined);
    const posted = page.waitForResponse(
      (res) => res.url().endsWith('/api/teach/threads') && res.request().method() === 'POST',
      { timeout: 15000 },
    );
    const topicInput = page.locator('input').last();
    await topicInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
    await topicInput.fill('平方差公式');
    await page.click('button:has-text("开课")').catch(() => undefined);
    created = await posted.then(() => true).catch(() => false);
  }
  if (!created) throw new Error('新开一课点击三次未生效');
  console.log('new lesson created, waiting streaming…');

  // 02 流式生长（等 Loader / 正文出现）
  await page.waitForSelector('text=讲课中', { timeout: 360000 });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: `${OUT}/teach-02-streaming.png` });
  console.log('02 streaming saved');

  // 03 打断追问一条富 markdown（CJK 引号紧贴加粗 + 代码块 + 列表 + 引用块）
  await page.fill(
    'textarea',
    '请用 markdown 演示回答：给我一句「平方差公式」**很重要**的话（加粗紧贴中文引号），再给一个 `inline code`、一个三行列表、一段引用块、一个代码块。',
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(25000);
  await page.screenshot({ path: `${OUT}/teach-03-markdown-reply.png` });
  console.log('03 markdown reply saved');

  // 等本轮 turn 结束（最多 4 分钟）
  const t0 = Date.now();
  for (;;) {
    const streaming = await page.locator('text=讲课中').count();
    if (!streaming) break;
    if (Date.now() - t0 > 240000) {
      console.log('WARN: 4 分钟本轮未讲完，拍当前态');
      break;
    }
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(1500);

  // 04 滚动跟随：上滚出「回到最新」按钮 → 截图 → 点回
  const chatScroll = page.locator('[role="log"]').first();
  await chatScroll.evaluate((el) => {
    const scroller = el.querySelector('div') ?? el;
    (scroller as HTMLElement).scrollTop = 0;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/teach-04-scrolled-up.png` });
  const backBtn = page.locator('button[aria-label*="回到最新"], button[aria-label*="最新"]').first();
  const backBtnVisible = (await backBtn.count()) > 0 && (await backBtn.isVisible());
  console.log('back-to-latest visible after scroll up:', backBtnVisible);
  if (backBtnVisible) {
    await backBtn.click();
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${OUT}/teach-05-turn-complete.png` });
  console.log('04/05 saved');

  // 断言 A/B：只看 assistant 气泡（MessageResponse 渲染区）
  const verdict = await page.evaluate(() => {
    const root = document.querySelector('[role="log"]');
    const responses = root
      ? Array.from(root.querySelectorAll('.is-assistant [class*="streamdown"], .is-assistant .streamdown'))
      : [];
    // streamdown 根类名不可知，退而求其次：is-assistant 容器
    const assistants = root ? Array.from(root.querySelectorAll('.is-assistant')) : [];
    const strongCount = assistants.reduce(
      (n, el) => n + el.querySelectorAll('strong').length,
      0,
    );
    const literalBold = assistants.filter((el) =>
      (el.textContent ?? '').includes('**'),
    ).length;
    const codeBlocks = assistants.reduce(
      (n, el) => n + el.querySelectorAll('pre').length,
      0,
    );
    const lists = assistants.reduce(
      (n, el) => n + el.querySelectorAll('ul,ol').length,
      0,
    );
    const quotes = assistants.reduce(
      (n, el) => n + el.querySelectorAll('blockquote').length,
      0,
    );
    // 横向溢出 / 重叠检查
    const docW = document.documentElement.clientWidth;
    let overflow = 0;
    const rects: Array<{ top: number; bottom: number }> = [];
    for (const el of assistants) {
      const r = el.getBoundingClientRect();
      if (r.right > docW + 1 || r.left < -1) overflow += 1;
      rects.push({ top: r.top, bottom: r.bottom });
    }
    let overlap = 0;
    const visible = rects.filter((r) => r.bottom > 0 && r.top < window.innerHeight);
    for (let i = 1; i < visible.length; i += 1) {
      if (visible[i].top < visible[i - 1].bottom - 1) overlap += 1;
    }
    return {
      responses: responses.length,
      assistantCount: assistants.length,
      strongCount,
      literalBold,
      codeBlocks,
      lists,
      quotes,
      overflow,
      overlap,
    };
  });
  console.log('VERDICT', JSON.stringify(verdict));
  console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 20)));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
