/**
 * board-token-rhythm-probe.ts —— v19 人性化书写节奏验证（一次性诊断）
 *
 * 打开 /demo-board，对第一个 active 的 write 做高频采样（40ms），记录可见
 * token 数随时间的变化，分析：
 * - 字间间隔是否非匀速（方差 > 0，不应是节拍器）
 * - 是否存在 >= 150ms 的抬笔停顿（词间/标点/换气）
 * - 同一 write 的总时长 vs 旧匀速估算
 *
 * 用法：npx tsx scripts/board-token-rhythm-probe.ts [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3101';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demo-board`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 30000 });
  await page.mouse.click(500, 350);

  // 等第一个 write 容器出现
  await page.waitForSelector('[data-write-id]', { timeout: 30000 });

  // 高频采样 20s：每个 write 容器的可见 token 数
  // （字符串形式注入：tsx 会给函数字面量注入 __name helper，浏览器里没有）
  const samples = await page.evaluate(`(() => {
    const visibleCount = (host) => {
      let count = 0;
      host.querySelectorAll('.mm-chalk-char').forEach((el) => {
        if (el.style.visibility !== 'hidden') count += 1;
      });
      host.querySelectorAll('div[aria-label]').forEach(() => { count += 1; });
      return count;
    };
    return new Promise((resolve) => {
      const out = [];
      const startedAt = performance.now();
      const timer = setInterval(() => {
        const writes = {};
        document.querySelectorAll('[data-write-id]').forEach((host) => {
          const id = host.getAttribute('data-write-id') ?? '?';
          writes[id] = visibleCount(host);
        });
        out.push({ t: Math.round(performance.now() - startedAt), writes });
        if (performance.now() - startedAt > 20000) {
          clearInterval(timer);
          resolve(out);
        }
      }, 40);
    });
  })()`) as Array<{ t: number; writes: Record<string, number> }>;
  await browser.close();

  // 分析：取采样期内 token 数增长最多的那个 write（正在写的那个）
  const totals = new Map<string, number>();
  for (const sample of samples) {
    for (const [id, count] of Object.entries(sample.writes)) {
      totals.set(id, Math.max(totals.get(id) ?? 0, count));
    }
  }
  const target = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!target || target[1] < 3) {
    console.log('未捕获到正在书写的 write（token 增长不足）', Object.fromEntries(totals));
    return;
  }
  const [id] = target;

  // 相邻 token 出现的间隔序列
  const appearAt: number[] = [];
  let prev = -1;
  for (const sample of samples) {
    const count = sample.writes[id] ?? 0;
    if (count > prev) {
      for (let i = 0; i < count - prev; i += 1) appearAt.push(sample.t);
      prev = count;
    }
  }
  const gaps = appearAt.slice(1).map((t, i) => t - appearAt[i]);
  const rests = gaps.filter((g) => g >= 150);
  const mean = gaps.reduce((s, g) => s + g, 0) / Math.max(1, gaps.length);
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / Math.max(1, gaps.length);

  console.log(`write ${id}: ${appearAt.length} token 出现时刻(ms): ${appearAt.join(', ')}`);
  console.log(`字间间隔(ms): ${gaps.join(', ')}`);
  console.log(`均值=${mean.toFixed(0)} 标准差=${Math.sqrt(variance).toFixed(0)} >=150ms 停顿=${rests.length} 次 [${rests.join(', ')}]`);
  console.log(variance > 100 ? 'PASS: 间隔非匀速（有抖动与停顿）' : 'FAIL: 间隔过于均匀（仍是节拍器）');
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
