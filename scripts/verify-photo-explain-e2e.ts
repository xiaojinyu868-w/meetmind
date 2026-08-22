/**
 * verify-photo-explain-e2e.ts —— 拍题开讲 demo 页端到端实测（临时脚本）
 *
 * 打开 /demo-board → 点「拍题开讲」上传样例题图 → 等板书脚本生成并渲染 →
 * 连拍 3 张（生成完成首屏 / 播放中 / 播放中段），收集 console 错误。
 *
 * 用法：npx tsx scripts/verify-photo-explain-e2e.ts [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = 'out/audit';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 } });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 200)}`));

  await page.goto(`${BASE}/demo-board`, { waitUntil: 'networkidle' });

  // 上传样例题图（隐藏 file input 直接 setInputFiles）
  await page.setInputFiles('input[type="file"]', 'out/audit/sample-problem-1.png');
  console.log('uploaded, waiting for generation…');

  // 等待态首拍（应显示「老师正在看题…」粉笔字等待板，而不是旧课继续播）
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/photo-explain-0-waiting.png` });

  // 等生成完成：payload 替换后 BlackboardPlayer 重新渲染（标题变化/粉笔字出现）
  // 生成全程 30-120s，放宽到 240s
  await page.waitForSelector('.mm-chalk-text', { timeout: 240000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/photo-explain-1-start.png` });
  console.log('generated & playing');

  await page.waitForTimeout(20000);
  await page.screenshot({ path: `${OUT}/photo-explain-2-mid.png` });

  await page.waitForTimeout(30000);
  await page.screenshot({ path: `${OUT}/photo-explain-3-later.png` });

  const title = await page.textContent('header h1');
  console.log(`board title: ${title}`);
  console.log(`console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 8).forEach((line) => console.log(`  ${line}`));

  await browser.close();
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
