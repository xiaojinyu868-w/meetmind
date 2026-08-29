/**
 * ui-visual-audit-fenshen.ts —— 分身线（请一个分身）浏览器端视觉审查。
 *
 * 路径：/app?entry=demo → 试听课音频拖到底触发课后卡 → FenshenEntryChip
 * → FenshenShelf（分身架）→ 孔子（ready）→ FenshenChatPanel 实发一条消息，
 * 验证 SSE 流式渲染（CJK markdown / user 气泡 / Loader / 回到最新）。
 *
 * 截图：01 课后卡 chip / 02 分身架 / 03 孔子对话空态 / 04 流式中 / 05 回复完成
 * 用法：npx tsx scripts/ui-visual-audit-fenshen.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3003/app?guest=1&entry=demo';
const OUT = 'out/audit/ui-visual';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 950 } })
  ).newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`PAGE_ERROR: ${error.message}`));
  page.on('response', (res) => {
    if (res.url().includes('/api/fenshen/')) {
      console.log(`NET ${res.request().method()} ${res.url()} → ${res.status()}`);
    }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForTimeout(6000);

  // 试听音频拖到底 → ended → 课后卡（FenshenEntryChip 所在卡片）
  const chip = page.locator('button:has-text("请一个分身")').first();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await chip.count()) > 0) break;
    const advanced = (await page.evaluate(`(async () => {
      const audios = Array.from(document.querySelectorAll('audio'));
      let moved = false;
      for (const audio of audios) {
        if (!(audio.duration && Number.isFinite(audio.duration))) {
          audio.preload = 'auto';
          audio.load();
          continue;
        }
        if (audio.paused) await audio.play().catch(() => undefined);
        audio.currentTime = Math.max(0, audio.duration - 0.2);
        moved = true;
      }
      return { moved, count: audios.length };
    })()`)) as { moved: boolean; count: number };
    if ((!advanced.moved || advanced.count === 0) && attempt % 5 === 4) {
      const state = await page.evaluate(`document.body.innerText.slice(0, 200)`);
      console.log(
        `WARN: attempt ${attempt + 1} audio count=${advanced.count} moved=${advanced.moved}; body:`,
        JSON.stringify(state),
      );
    }
    // 有 audio 但还没拿到 metadata 时，点「播放」按钮走真实手势路径（只点一次）
    if (advanced.count > 0 && !advanced.moved && attempt === 2) {
      await page.click('button:has-text("播放")').catch(() => undefined);
    }
    await page.waitForTimeout(3000);
  }
  if ((await chip.count()) === 0) {
    await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-00-no-chip.png` });
    throw new Error('未找到「请一个分身」入口 chip');
  }
  await chip.scrollIntoViewIfNeeded();
  await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-01-after-class-chip.png` });
  console.log('01 chip visible');

  // 02 分身架（等列表加载出孔子卡片，dev 冷编译可能较慢）
  await chip.click();
  await page.waitForSelector('text=分身架', { timeout: 10000 });
  const confuciusCard = page
    .locator('[role="dialog"] button', { hasText: '孔子' })
    .first();
  const cardVisible = await confuciusCard
    .waitFor({ state: 'visible', timeout: 360000 })
    .then(() => true)
    .catch(() => false);
  if (!cardVisible) {
    await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-02-shelf-stuck.png` });
    const dialogText = await page.evaluate(
      `document.querySelector('[role="dialog"]')?.innerText?.slice(0, 300) ?? 'no dialog'`,
    );
    console.log('ERROR: 分身架 360s 未出现孔子卡片; dialog:', JSON.stringify(dialogText));
    console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 20)));
    throw new Error('分身架列表未加载');
  }
  await page.waitForTimeout(800);
  await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-02-shelf.png` });
  console.log('02 shelf saved');

  // 03 孔子卡片 → 对话面板
  await confuciusCard.click();
  const inChat = await page
    .waitForSelector('text=返回分身架', { timeout: 180000 })
    .then(() => true)
    .catch(() => false);
  if (!inChat) {
    await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-03-click-failed.png` });
    const body = await page.evaluate(`document.body.innerText.slice(0, 400)`);
    console.log('ERROR: 点击孔子卡片后未进入对话面板; body:', JSON.stringify(body));
    console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 20)));
    throw new Error('孔子卡片点击无效');
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-03-chat-empty.png` });
  console.log('03 chat panel saved');

  // 04 发一条消息实测流式回复（诱导 markdown：加粗紧贴引号 + 列表）
  const input = page.locator('input[placeholder*="聊聊"]').first();
  await input.waitFor({ state: 'visible', timeout: 30000 });
  await input.fill(
    '夫子，请用 markdown 答：一句「学而时习之」**不亦说乎**（加粗紧贴引号），外加一个三行列表。',
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-04-streaming.png` });
  console.log('04 streaming saved');

  // 等 assistant 节点出现（POST ack + turn 起步 + 首个 delta；冷编译下给足 240s），
  // 再进入稳定判定——空等会把「只有 user 气泡」误判成完成
  const assistantAppeared = await page
    .waitForSelector('[role="log"] .is-assistant', { timeout: 240000 })
    .then(() => true)
    .catch(() => false);
  if (!assistantAppeared) {
    await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-05-no-reply.png` });
    console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 20)));
    throw new Error('240s 内 assistant 回复未出现');
  }

  // 等回复完成（文本长度 3 次采样不变，最多 180s）
  const t0 = Date.now();
  let lastLen = -1;
  let stable = 0;
  for (;;) {
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[role="log"] .is-assistant');
      return Array.from(nodes).reduce((n, el) => n + (el.textContent?.length ?? 0), 0);
    });
    if (text === lastLen) stable += 1;
    else stable = 0;
    lastLen = text;
    if (stable >= 3) break;
    if (Date.now() - t0 > 180000) {
      console.log('WARN: 180s 回复未稳定，拍当前态');
      break;
    }
  }
  await page.waitForTimeout(800);
  await page.screenshot({ timeout: 120000, path: `${OUT}/fenshen-05-reply-complete.png` });
  console.log('05 reply complete saved');

  // 断言：CJK 加粗 / 列表 / 溢出 / 重叠 / user 气泡色
  const verdict = await page.evaluate(() => {
    const root = document.querySelector('[role="log"]');
    const assistants = root ? Array.from(root.querySelectorAll('.is-assistant')) : [];
    const users = root ? Array.from(root.querySelectorAll('.is-user')) : [];
    const strongCount = assistants.reduce(
      (n, el) => n + el.querySelectorAll('strong').length,
      0,
    );
    const literalBold = assistants.filter((el) =>
      (el.textContent ?? '').includes('**'),
    ).length;
    const lists = assistants.reduce(
      (n, el) => n + el.querySelectorAll('ul,ol').length,
      0,
    );
    const docW = document.documentElement.clientWidth;
    let overflow = 0;
    const rects: Array<{ top: number; bottom: number }> = [];
    for (const el of [...assistants, ...users]) {
      const r = el.getBoundingClientRect();
      if (r.right > docW + 1 || r.left < -1) overflow += 1;
      rects.push({ top: r.top, bottom: r.bottom });
    }
    let overlap = 0;
    const visible = rects
      .filter((r) => r.bottom > 0 && r.top < window.innerHeight)
      .sort((a, b) => a.top - b.top);
    for (let i = 1; i < visible.length; i += 1) {
      if (visible[i].top < visible[i - 1].bottom - 1) overlap += 1;
    }
    // user 气泡 vermilion-mist 背景（非透明）
    let userBg = '';
    const userContent = users[0]?.querySelector('div');
    if (userContent) userBg = getComputedStyle(userContent).backgroundColor;
    return {
      assistantCount: assistants.length,
      userCount: users.length,
      strongCount,
      literalBold,
      lists,
      overflow,
      overlap,
      userBg,
    };
  });
  console.log('VERDICT', JSON.stringify(verdict));
  console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 20)));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
