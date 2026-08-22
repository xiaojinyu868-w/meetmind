/**
 * teach-v32-sync-capture.ts —— 声画联动 + 标注跟随 修复验证。
 *
 * Phase A（真实模式，声画联动）：开课轮询 {streaming, speaking, chars, tts}——
 *   修复后的证据：speaking=false 时画布 chars 恒为 0；speaking=true 后 chars 才增长。
 * Phase B（mock，标注跟随）：agent 脚本 page1 有 circle(w13) + underline(w19)，
 *   之后还有更多 write/换栏——记录"圈 svg 与 w13 的相对偏移"在两个时间点的值，
 *   内容生长/收缩后偏移应保持（圈跟着目标走）。
 * 截图存 out/teach-v32-sync/。用法：npx tsx scripts/teach-v32-sync-capture.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'out/teach-v32-sync';

async function phaseA(browser: import('playwright').Browser) {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  let ttsCount = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/teach/tts')) ttsCount += 1;
  });

  await page.goto('http://localhost:3105/teach?mock=0', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForResponse(
    (res) => res.url().includes('/api/teach/threads') && res.request().method() === 'GET',
    { timeout: 60000 },
  );
  await page.waitForTimeout(3000);
  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const posted = page.waitForResponse(
      (res) => res.url().endsWith('/api/teach/threads') && res.request().method() === 'POST',
      { timeout: 12000 },
    );
    const postedSafe = posted.then(() => true, () => false);
    // dev 首编译窗口里 Playwright 的点按偶发不触发 React 委托监听（hydration 竞态），
    // 合成 bubbling click 必达根监听——这里只关心"新开一课"语义真实发生
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('新开一课'));
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    created = await postedSafe;
    if (!created) console.log(`click attempt ${attempt + 1} failed, retrying`);
  }
  if (!created) throw new Error('新开一课未生效');
  console.log(`${stamp()} lesson started`);

  let shot1 = false;
  let shot2 = false;
  let shot3 = false;
  let maxCharsBeforeSpeaking = 0;
  for (let i = 0; i < 75; i += 1) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({
      streaming: Boolean([...document.querySelectorAll('header span')].find((el) => el.textContent?.includes('讲课中'))),
      speaking: Boolean(document.querySelector('header button .text-pine')),
      chars: document.querySelectorAll('.mm-chalk-char').length,
    }));
    if (!s.speaking) maxCharsBeforeSpeaking = Math.max(maxCharsBeforeSpeaking, s.chars);
    if (i % 5 === 0 || (s.speaking && !shot1)) {
      console.log(`${stamp()} streaming=${s.streaming} speaking=${s.speaking} chars=${s.chars} tts=${ttsCount}`);
    }
    if (s.speaking && !shot1) {
      await page.screenshot({ path: `${OUT}/A1-speaking-early-board.png` });
      shot1 = true;
      console.log(`${stamp()} A1 saved (speaking 刚开始，画布应刚起步) chars=${s.chars}`);
    }
    if (s.speaking && s.chars > 20 && !shot2) {
      await page.screenshot({ path: `${OUT}/A2-mid.png` });
      shot2 = true;
    }
    if (s.speaking && s.chars > 60 && !shot3) {
      await page.screenshot({ path: `${OUT}/A3-later.png` });
      shot3 = true;
    }
    if (shot3 && !s.streaming) break;
  }
  console.log(`VERDICT-A: 未出声阶段画布最大字数 = ${maxCharsBeforeSpeaking}（应为 0）`);
  await page.close();
}

interface CircleProbe {
  circleCx: number;
  circleCy: number;
  targetCx: number;
  targetCy: number;
  dx: number;
  dy: number;
}

async function probeCircle(page: import('playwright').Page): Promise<CircleProbe | null> {
  return page.evaluate(() => {
    const target = document.querySelector('[data-write-id="w13"]');
    if (!target) return null;
    const t = target.getBoundingClientRect();
    // 标注层里找圈：bbox 最大的 svg 笔画（排除 0 宽高的滤镜定义）
    let circle: DOMRect | null = null;
    document.querySelectorAll('[data-board-inner] svg').forEach((svg) => {
      const box = svg.getBoundingClientRect();
      if (box.width > 30 && box.height > 20) circle = box;
    });
    if (!circle) return null;
    const c = circle as DOMRect;
    return {
      circleCx: c.x + c.width / 2,
      circleCy: c.y + c.height / 2,
      targetCx: t.x + t.width / 2,
      targetCy: t.y + t.height / 2,
      dx: c.x + c.width / 2 - (t.x + t.width / 2),
      dy: c.y + c.height / 2 - (t.y + t.height / 2),
    };
  });
}

async function phaseB(browser: import('playwright').Browser) {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
  await page.goto('http://localhost:3105/teach?mock=1&pace=25', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // 点击新开一课 = 手势激活（gating 生效的 mock 路径）；合成 click 防 dev 编译窗口吞点按
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('新开一课'));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

  // 等 page1 的 circle(w13) 出现（⭕ chip 或标注 svg）
  await page.waitForSelector('[data-write-id="w13"]', { timeout: 180000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-board-inner] svg')].some((svg) => {
      const box = svg.getBoundingClientRect();
      return box.width > 30 && box.height > 20;
    }),
    { timeout: 180000 },
  );
  await page.waitForTimeout(800);
  const probeA = await probeCircle(page);
  await page.screenshot({ path: `${OUT}/B1-circle-fresh.png` });
  console.log('B1 saved', JSON.stringify(probeA));

  // 继续讲：w13 之后还有 8 个动作 + underline(w19)——内容生长/收缩后重测
  await page.waitForTimeout(45000);
  const probeB = await probeCircle(page);
  await page.screenshot({ path: `${OUT}/B2-circle-after-growth.png` });
  console.log('B2 saved', JSON.stringify(probeB));

  if (probeA && probeB) {
    const drift = Math.hypot(probeB.dx - probeA.dx, probeB.dy - probeA.dy);
    const moved = Math.hypot(probeB.targetCx - probeA.targetCx, probeB.targetCy - probeA.targetCy);
    console.log(`VERDICT-B: 目标位移=${moved.toFixed(1)}px 圈与目标相对漂移=${drift.toFixed(1)}px（漂移应 < 8px）`);
  } else {
    console.log('VERDICT-B: 探针没拿到（probeA/B 有 null）');
  }
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  await phaseA(browser);
  await phaseB(browser);
  console.log('done');
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
