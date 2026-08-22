/**
 * teach-agent-beauty-capture.ts —— 板书美观性审查：加速播放全程连拍
 * 每 2s 截一张；遇到 checkpoint 自动点「看解析」推进；
 * 翻到最后一页且无 checkpoint 待答后收尾。取每页翻页前最后一帧 = 成品态。
 * 用法：npx tsx scripts/teach-agent-beauty-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3101/demo-board?pace=40&script=board-script-agent.json';
const OUT = 'out/teach-agent-beauty';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    // 防节流三件套：headless 后台标签会把 rAF 压到 1Hz，测出假错位/假缺笔画
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.mm-chalk-text', { timeout: 30000 });
  await page.waitForTimeout(1500);
  // headless 通常自动开播；没有就点播放
  const playBtn = page.locator('button:has-text("播放")');
  if (await playBtn.count()) {
    try {
      await playBtn.first().click({ timeout: 2000 });
    } catch {
      /* 已在播 */
    }
  }

  let idx = 0;
  let lastIndicator = '';
  let lastPageSeenAt = 0;
  // 每个 checkpoint 只点一次（轮询期按钮停留数秒，重复点会重放示范、产物叠板）
  let checkpointClicked = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 560000) {
    // checkpoint 待答：点「看解析」让示范上板、流程继续
    if (!checkpointClicked) {
      const reveal = page.locator('button:has-text("看解析")');
      if (await reveal.count()) {
        await page.waitForTimeout(1200);
        await reveal.first().click().catch(() => undefined);
        checkpointClicked = true;
        console.log(`checkpoint -> 看解析 @${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }
    const indicator = await page
      .locator('text=/第\\s*\\d+\\s*\\/\\s*\\d+\\s*页/')
      .first()
      .textContent()
      .catch(() => null);
    if (indicator && indicator !== lastIndicator) {
      lastIndicator = indicator.replace(/\s+/g, ' ');
      lastPageSeenAt = Date.now();
      checkpointClicked = false;
      console.log(`page -> ${lastIndicator} @${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    idx += 1;
    await page.screenshot({ path: `${OUT}/seq-${String(idx).padStart(3, '0')}.png` });
    // 收尾：末页播完（控制条只剩「重新播放」，暂停/播放按钮都不在）；
    // 末页没有翻页事件，不能用"无进展"判断（会腰斩末页后半程）
    const match = lastIndicator.match(/(\d+)\s*\/\s*(\d+)/);
    if (match && match[1] === match[2]) {
      const pauseCount = await page.locator('button:has-text("暂停")').count();
      const resumeCount = await page.locator('button:has-text("播放")').count();
      if (pauseCount === 0 && resumeCount === 0 && Date.now() - lastPageSeenAt > 8000) {
        console.log('final page finished, stopping');
        break;
      }
      if (Date.now() - lastPageSeenAt > 150000) {
        console.log('final page timeout, stopping');
        break;
      }
    }
    await page.waitForTimeout(2000);
  }
  console.log(`done, ${idx} shots, last: ${lastIndicator}`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
