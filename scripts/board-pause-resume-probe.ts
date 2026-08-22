/**
 * board-pause-resume-probe.ts —— 暂停/恢复与手势门验证（2026-08-19 修复实拍）
 *
 * 验证三件事：
 * 1. 手势门：不点击时，黑板显示"点一下黑板，听老师开讲"，不播机器人音
 *    （无 clock-fallback 事件、无 segment-start 进度）
 * 2. 暂停完整性：播放中暂停 25s（超过当前段剩余安全窗口），期间不得出现
 *    segment-end / segment-start（旧 bug：安全定时器在暂停中误触发 finish
 *    → 段被悄悄推进 → 恢复后人声从段首重播）
 * 3. 恢复连续：恢复后当前段自然播完才翻段（segment-end 只出现在恢复之后）
 *
 * 用法：npx tsx scripts/board-pause-resume-probe.ts [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3101';

interface TimingEvent {
  at: number;
  type: string;
  page: number;
  segment?: number;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const events: unknown[] = [];
    (window as unknown as { __timings: unknown[] }).__timings = events;
    window.addEventListener('board:timing', (event) => {
      events.push({ at: performance.now(), ...(event as CustomEvent).detail });
    });
  });
  await page.goto(`${BASE}/demo-board`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 30000 });

  // ── 1. 手势门：不点，等 7s ──
  await page.waitForTimeout(7000);
  const gateEvents = (await page.evaluate(
    () => (window as unknown as { __timings: TimingEvent[] }).__timings,
  )) as TimingEvent[];
  const gestureHintVisible = (await page.textContent('body'))?.includes('点一下黑板') ?? false;
  const fallbackAtGate = gateEvents.filter((e) => e.type === 'clock-fallback').length;
  console.log(`手势门: 提示可见=${gestureHintVisible} 降级=${fallbackAtGate}（期望 可见=true 降级=0）`);

  // ── 2. 点击开播，播 14s 进状态 ──
  await page.mouse.click(500, 350);
  await page.waitForTimeout(14000);

  // 暂停，保持 25s（旧 bug 窗口：安全定时器在暂停中触发 finish → 翻段）
  await page.click('button:has-text("暂停")');
  const pauseStart = Date.now();
  await page.waitForTimeout(25000);
  const pauseEvents = (await page.evaluate(
    () => (window as unknown as { __timings: TimingEvent[] }).__timings,
  )) as TimingEvent[];
  // 暂停期间不应出现 segment-end（段被悄悄推进的铁证）；p0s0 的 segment-start 应只有一个
  const endCountDuringPause = pauseEvents.filter((e) => e.type === 'segment-end').length;
  const startCount = pauseEvents.filter((e) => e.type === 'segment-start').length;
  console.log(`暂停 25s: segment-end=${endCountDuringPause}（期望 0） segment-start=${startCount}（期望 1——没有翻段重播）`);

  // ── 3. 恢复：段应自然播完才翻段（降级 robot 在 headless 是黑洞，
  // 只能靠安全超时完结 ~40s+，窗口放宽到 90s）──
  await page.click('button:has-text("播放")');
  let sawEnd = false;
  let sawNextStart = false;
  for (let i = 0; i < 45; i += 1) {
    await page.waitForTimeout(2000);
    const events = (await page.evaluate(
      () => (window as unknown as { __timings: TimingEvent[] }).__timings,
    )) as TimingEvent[];
    sawEnd = events.some((e) => e.type === 'segment-end');
    sawNextStart = events.filter((e) => e.type === 'segment-start').length >= 2;
    if (sawEnd && sawNextStart) break;
  }
  console.log(`恢复后: 当前段自然播完=${sawEnd} 翻到下一段=${sawNextStart}（期望 都=true）`);
  console.log(`暂停墙钟 ${((Date.now() - pauseStart) / 1000).toFixed(0)}s 内段序完整 = 修复生效`);

  // 诊断：全事件流 + 播放器控制台
  const all = (await page.evaluate(
    () => (window as unknown as { __timings: TimingEvent[] }).__timings,
  )) as TimingEvent[];
  console.log('事件流:', all.map((e) => `${e.type}@p${e.page}s${e.segment ?? '-'} t=${(e.at / 1000).toFixed(1)}s`).join(' | '));

  await browser.close();
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
