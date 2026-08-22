/**
 * board-rhythm-audit.ts —— 讲解节奏诊断（2026-08 节奏打磨）
 *
 * 用 Playwright 播放 /demo-board（静态板书脚本），收集 board:timing 事件，
 * 输出逐段节奏报告：
 * - 估算时长 vs 实际朗读时长（估算偏差）
 * - 段末闸门等待（音等画的次数/时长分布）
 * - 段间静默（segment-end → 下一 segment-start 的真实间隔：TTS 合成 + 无呼吸）
 * - 书写拖尾（segment-end 之后才写完的 write 数）
 * - 声音链降级发生点（机器人音段）
 *
 * 用法：npx tsx scripts/board-rhythm-audit.ts [baseUrl] [maxSeconds]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3101';
const MAX_S = Number(process.argv[3] || 300);

interface TimingEvent {
  at: number;
  type: string;
  page: number;
  segment?: number;
  key?: string;
  estimatedMs?: number;
  chars?: number;
  waitedMs?: number;
}

async function main() {
  const browser = await chromium.launch({
    args: [
      // 防 headless 空闲节流：页面无交互时 rAF 被压到 ~1Hz，书写动画爬行而
      // 音频照跑——测出的"音画错位/书写卡死"是测量 artifact 不是产品行为
      // （2026-08-19 实测：write 全部撞 12s 看门狗强制放行）
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const events: unknown[] = [];
    (window as unknown as { __timings: unknown[] }).__timings = events;
    window.addEventListener('board:timing', (event) => {
      events.push({ at: performance.now(), ...(event as CustomEvent).detail });
    });
  });

  // networkidle 等不到：TTS 预取/重试让网络一直繁忙（428 窗口期必现超时）
  await page.goto(`${BASE}/demo-board`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 30000 });
  // 点一下黑板解除自动播放限制（真人音色链路）
  await page.mouse.click(500, 350);

  const started = Date.now();
  let lastLen = 0;
  let idleRounds = 0;
  while (Date.now() - started < MAX_S * 1000) {
    await page.waitForTimeout(3000);
    const events = (await page.evaluate(() => (window as unknown as { __timings: unknown[] }).__timings)) as TimingEvent[];
    // 播完判定：最后一页最后一个 segment-end 之后 12s 没有新事件
    if (events.length === lastLen) {
      idleRounds += 1;
      if (idleRounds >= 4 && events.some((e) => e.type === 'segment-end')) break;
    } else {
      idleRounds = 0;
      lastLen = events.length;
    }
  }

  const events = (await page.evaluate(() => (window as unknown as { __timings: unknown[] }).__timings)) as TimingEvent[];
  await browser.close();
  writeFileSync('out/audit/rhythm-events.json', JSON.stringify(events, null, 2));

  // ── 分析 ──
  const starts = events.filter((e) => e.type === 'segment-start');
  const ends = events.filter((e) => e.type === 'segment-end');
  const gateWaits = events.filter((e) => e.type === 'gate-wait');
  const gateReleases = events.filter((e) => e.type === 'gate-release');
  const writeDones = events.filter((e) => e.type === 'write-done');
  const fallbacks = events.filter((e) => e.type === 'clock-fallback');

  console.log(`segments: ${starts.length}, gates: ${gateWaits.length}, fallbacks: ${fallbacks.length}`);
  console.log('');

  let totalGateMs = 0;
  const silences: number[] = [];
  console.log('seg | est(s) actual(s) ratio | end→next(s) | gate(ms) | writes-after-end');
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = ends.find(
      (e) => e.at > start.at && e.page === start.page && e.segment === start.segment,
    );
    const next = starts[i + 1];
    const actual = end ? end.at - start.at : NaN;
    const silence = end && next ? next.at - end.at : NaN;
    if (!Number.isNaN(silence)) silences.push(silence);
    const gate = gateReleases.find(
      (e) => end && e.at >= end.at && e.page === start.page && e.segment === start.segment,
    );
    if (gate?.waitedMs) totalGateMs += gate.waitedMs;
    const lagWrites = end
      ? writeDones.filter((e) => e.at > end.at && e.at < (next?.at ?? Infinity) && e.page === start.page).length
      : 0;
    console.log(
      `p${start.page}s${start.segment} | ${((start.estimatedMs ?? 0) / 1000).toFixed(1)} ${(actual / 1000).toFixed(1)} ${(((start.estimatedMs ?? 1) / Math.max(1, actual))).toFixed(2)} | ${Number.isNaN(silence) ? '-' : (silence / 1000).toFixed(1)} | ${gate?.waitedMs ?? '-'} | ${lagWrites}`,
    );
  }

  console.log('');
  const sortedSilence = [...silences].sort((a, b) => a - b);
  const pct = (p: number) => sortedSilence[Math.floor(sortedSilence.length * p)] ?? 0;
  console.log(
    `段间静默(s): n=${silences.length} min=${(Math.min(...silences) / 1000).toFixed(2)} p50=${(pct(0.5) / 1000).toFixed(2)} p90=${(pct(0.9) / 1000).toFixed(2)} max=${(Math.max(...silences) / 1000).toFixed(2)}`,
  );
  console.log(`闸门等待: ${gateWaits.length} 次, 共 ${(totalGateMs / 1000).toFixed(1)}s`);
  console.log(`降级段: ${fallbacks.map((e) => `p${e.page}s${e.segment}`).join(', ') || '无'}`);
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
