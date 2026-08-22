/**
 * 板书全链路量化体检 v2（临时诊断脚本）。
 * 流程：手势 → 全程播放 → checkpoint 点「我会了」→ 播完 → 板演画两笔 →
 * 「写完了」→ 等批改（勾叉 + 点评）→ 截图。全程记录时钟链日志与耗时。
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

  page.on('console', (msg) => {
    const text = msg.text();
    if (/board|tts|clock|ink/i.test(text) || msg.type() === 'error') {
      console.log(`${stamp()} [${msg.type()}] ${text.slice(0, 2000)}`);
    }
  });

  await page.goto('http://localhost:3101/demo-board', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.mouse.click(700, 300);
  console.log(`${stamp()} [audit] gesture clicked`);

  const deadline = Date.now() + 300_000;
  let checkpointDone = false;
  let inkDrawn = false;
  let gradingClicked = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);

    // checkpoint 等待态：点「我会了」
    if (!checkpointDone) {
      const know = page.locator('text=我会了').first();
      if ((await know.count()) > 0 && (await know.isVisible().catch(() => false))) {
        console.log(`${stamp()} [audit] checkpoint → 我会了`);
        await know.click();
        checkpointDone = true;
        continue;
      }
    }

    // 播完后：板演 → 画两笔 → 写完了
    const inkStart = page.locator('button:has-text("板演")').first();
    if (
      checkpointDone &&
      !inkDrawn &&
      (await inkStart.count()) > 0 &&
      (await inkStart.isVisible().catch(() => false))
    ) {
      console.log(`${stamp()} [audit] → 板演模式`);
      await inkStart.click();
      await page.waitForTimeout(500);
      await page.mouse.move(500, 330);
      await page.mouse.down();
      await page.mouse.move(560, 370, { steps: 8 });
      await page.mouse.move(620, 330, { steps: 8 });
      await page.mouse.up();
      await page.mouse.move(600, 400);
      await page.mouse.down();
      await page.mouse.move(660, 440, { steps: 8 });
      await page.mouse.up();
      inkDrawn = true;
      console.log(`${stamp()} [audit] drew 2 strokes`);
      continue;
    }

    if (inkDrawn && !gradingClicked) {
      const done = page.locator('button:has-text("写完了")').first();
      if ((await done.count()) > 0 && (await done.isVisible().catch(() => false))) {
        console.log(`${stamp()} [audit] → 写完了（等批改）`);
        await done.click();
        gradingClicked = true;
        continue;
      }
    }

    if (gradingClicked) {
      // 批改点评念完后就算验收通过，再等 15s 收尾
      await page.waitForTimeout(15000);
      break;
    }
  }
  await page.screenshot({ path: 'out/board-audit-final.png' });
  console.log(`${stamp()} [audit] done, screenshot out/board-audit-final.png`);
  await browser.close();
}

void main();
