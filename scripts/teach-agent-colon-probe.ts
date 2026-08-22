#!/usr/bin/env npx tsx
/**
 * teach-agent-colon-probe.ts —— DOM 实测「①同除以a：x²…」行的字符包围盒，
 * 定位 a/:/x 重叠根因（placeholder 与终态宽度不一致？负 margin？）。
 * 用法：npx tsx scripts/teach-agent-colon-probe.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3101/demo-board?pace=30&script=board-script-agent.json';

async function main() {
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.mm-chalk-text', { timeout: 30000 });
  await page.waitForTimeout(1500);
  // 开场一次性点播放（此刻还没有「重新播放」，text-is 精确匹配安全）
  await page.locator('button:text-is("播放")').first().click({ timeout: 2000 }).catch(() => undefined);
  // checkpoint 每个只点一次「看解析」（按钮停留数秒，重复点会重放示范扰乱状态机）。
  // 交互完成播放器会自动续播（machine done → advanceFromCheckpoint），不需要点播放。
  const clicker = setInterval(() => {
    page
      .evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === '看解析' && !(b as HTMLElement).dataset.probed,
        );
        if (btn) {
          (btn as HTMLElement).dataset.probed = '1';
          btn.click();
        }
      })
      .catch(() => undefined);
  }, 1500);
  // 等目标行出现（含"同除以"文本的 write 行）
  const found = await page
    .waitForFunction(() => document.body.innerText.includes('同除以'), undefined, { timeout: 480000 })
    .then(() => true)
    .catch(() => false);
  clearInterval(clicker);
  if (!found) {
    const state = await page.evaluate(() => ({
      indicator: document.body.innerText.match(/第\s*\d+\s*\/\s*\d+\s*页/)?.[0] ?? 'unknown',
      buttons: Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim()).filter(Boolean),
      sample: document.body.innerText.slice(0, 400),
    }));
    await page.screenshot({ path: 'out/teach-agent-probe-stuck.png' });
    console.log('STUCK:', JSON.stringify(state, null, 1));
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(3000); // 等该行写完

  const report = await page.evaluate(() => {
    // 找到含"同除以"的行容器
    const lines = Array.from(document.querySelectorAll('.mm-chalk-text'));
    const line = lines.find((el) => el.textContent?.includes('同除以'));
    if (!line) return { error: 'line not found' };
    const tokens = Array.from(line.querySelectorAll('.mm-chalk-char')).map((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: el.textContent,
        x: Math.round(rect.x * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        w: Math.round(rect.width * 10) / 10,
        font: style.fontFamily.slice(0, 20),
        size: style.fontSize,
        ml: style.marginLeft,
      };
    });
    return { lineText: line.textContent, tokens };
  });
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
