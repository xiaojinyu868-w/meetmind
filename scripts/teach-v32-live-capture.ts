/**
 * teach-v32-live-capture.ts —— /teach?mock=0 真实后端联调实拍。
 *
 * 验证点（截图存 out/teach-v32-live/）：
 *   01 开课流式生长（真实 Gemini：text-delta + write chip + 画布逐字）
 *   02 打断提问后（interrupt+续讲：回答流出、画布状态不丢）
 *   03 完成态（finish；超时则拍当前态并标注）
 *   04 刷新后历史恢复（事件日志回放：对话 + 画布终态）
 * 注意：Gemini 中转 TTFT 4-30s 是已知延迟，所有等待给足。
 * 用法：npx tsx scripts/teach-v32-live-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3103/teach?mock=0';
const OUT = 'out/teach-v32-live';

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
    if (msg.type() === 'error') console.log('CONSOLE_ERROR:', msg.text().slice(0, 300));
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // 等首屏数据真的回来（空态会先闪现，不能当就绪信号）
  await page.waitForResponse((res) => res.url().includes('/api/teach/threads') && res.request().method() === 'GET', { timeout: 60000 });
  await page.waitForTimeout(1500);

  // 新开一课：以「POST /threads 真的发出」为准重试（dev 重编译窗口可能吞点击）
  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const posted = page.waitForResponse(
      (res) => res.url().endsWith('/api/teach/threads') && res.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.click('button:has-text("新开一课")');
    created = await posted.then(() => true).catch(() => false);
    if (!created) console.log(`click attempt ${attempt + 1} no-op, retrying`);
  }
  if (!created) throw new Error('新开一课点击三次未生效');
  console.log('new lesson clicked, waiting for Gemini TTFT (4-30s 正常)…');

  // 01 开课流式生长：等讲课中 + 首个 chip / 画布字
  await page.waitForSelector('text=讲课中', { timeout: 120000 });
  console.log('streaming started');
  await page.waitForSelector('.mm-chalk-char', { timeout: 120000 }).catch(() => {
    console.log('WARN: 90s 内画布无字');
  });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: `${OUT}/01-live-streaming.png` });
  console.log('01 saved');

  // 02 打断提问：讲课中发送 = interrupt + 附带消息续讲
  await page.fill('textarea', '为什么判别式小于零就没有实根？');
  await page.keyboard.press('Enter');
  console.log('question sent (interrupt+continue), waiting for answer…');
  // 回答特征：user 气泡之后新的 assistant 流出；给 TTFT 余量
  await page.waitForSelector('text=为什么判别式小于零就没有实根？', { timeout: 30000 });
  // 回答特征限定在对话栏（画布板书里也有"实根"字样，会误判）
  const answered = await page
    .waitForSelector('section text=实根', { timeout: 120000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/02-after-interrupt.png` });
  console.log(`02 saved (answer seen: ${answered})`);

  // 03 完成态：等「讲课中」消失（finish / turn-complete 后 streaming=false）
  const t0 = Date.now();
  let finished = false;
  for (;;) {
    const streaming = await page.locator('text=讲课中').count();
    if (!streaming) {
      finished = true;
      break;
    }
    if (Date.now() - t0 > 600000) {
      console.log('WARN: 10 分钟未讲完，拍当前态');
      break;
    }
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/03-finished.png` });
  console.log(`03 saved (finished: ${finished})`);

  // 04 刷新恢复：历史列表第一項 = 刚讲的课，点开回放
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('aside [role="button"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
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
