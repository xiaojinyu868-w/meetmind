/**
 * teach-v32-tts-capture.ts —— 讲课声音管线端到端验证（真实后端）。
 *
 * 证据采集（音频内容无法截图，用时序日志 + 状态截图）：
 * - 记录每个 POST /api/teach/tts 的时刻（句子合成节奏 = 按句流出 + 预取）
 * - 轮询喇叭旁 speaking 状态（header 的讲课中指示 + session.speaking）
 * - 中途发问：interrupt 后 tts 请求应停止（老师闭嘴），回答后恢复
 * 截图存 out/teach-v32-tts/。
 * 用法：npx tsx scripts/teach-v32-tts-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3103/teach?mock=0';
const OUT = 'out/teach-v32-tts';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required', // headless 无音频设备，放开自动播放限制
    ],
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  page.on('pageerror', (error) => console.log('PAGE_ERROR:', error.message));

  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const ttsRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/teach/tts')) ttsRequests.push(stamp());
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForResponse(
    (res) => res.url().includes('/api/teach/threads') && res.request().method() === 'GET',
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);
  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const posted = page.waitForResponse(
      (res) => res.url().endsWith('/api/teach/threads') && res.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.click('button:has-text("新开一课")');
    created = await posted.then(() => true).catch(() => false);
  }
  if (!created) throw new Error('新开一课未生效');
  console.log(`${stamp()} lesson started`);

  const speakingTimeline: string[] = [];
  const poll = async () => {
    const state = await page.evaluate(() => ({
      streaming: Boolean([...document.querySelectorAll('header span')].find((el) => el.textContent?.includes('讲课中'))),
      speaking: Boolean(document.querySelector('header button .text-pine')),
      bubbles: document.querySelectorAll('[data-msg-id]').length,
      chars: document.querySelectorAll('.mm-chalk-char').length,
    }));
    speakingTimeline.push(`${stamp()} streaming=${state.streaming} speaking=${state.speaking} bubbles=${state.bubbles} chars=${state.chars} tts=${ttsRequests.length}`);
  };

  // 讲 50s：声音应随句子流出
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(2000);
    await poll();
  }
  await page.screenshot({ path: `${OUT}/01-tts-flowing.png` });
  console.log(`${stamp()} 01 saved, tts requests so far: ${ttsRequests.length}`);

  // 中途发问：interrupt → 老师立刻闭嘴（tts 请求停、speaking 掉）
  const ttsBeforeAsk = ttsRequests.length;
  await page.fill('textarea', '老师停一下，什么是因式分解？');
  await page.keyboard.press('Enter');
  console.log(`${stamp()} question sent, tts so far=${ttsBeforeAsk}`);
  await page.waitForTimeout(3000);
  await poll();
  const ttsRightAfterAsk = ttsRequests.length;
  await page.waitForTimeout(15000);
  await page.screenshot({ path: `${OUT}/02-after-interrupt.png` });
  await poll();
  console.log(`${stamp()} 02 saved, tts right after ask=${ttsRightAfterAsk}（应≈发问前）`);

  console.log('--- timeline ---');
  speakingTimeline.forEach((line) => console.log(line));
  console.log('--- tts request stamps ---');
  ttsRequests.forEach((t, i) => console.log(`#${i + 1} @${t}`));
  console.log('done');
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
