const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: 'out/audit/journey', size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3101/demo-board?pace=170', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mm-board-page', { timeout: 90000 });

  // 1) 暂停冻结检查：书写中段点暂停，隔 3s 对比板面是否还在变化
  await page.waitForTimeout(20000);
  await page.click('text=暂停');
  const snapA = await page.evaluate(() => document.querySelector('.mm-board-page')?.textContent?.length);
  await page.waitForTimeout(3000);
  const snapB = await page.evaluate(() => document.querySelector('.mm-board-page')?.textContent?.length);
  console.log('PAUSE-FREEZE check: before=', snapA, 'after 3s paused=', snapB, snapA === snapB ? 'FROZEN(ok)' : 'STILL WRITING(bug)');
  await page.screenshot({ path: 'out/audit/journey/p1-paused.png' });
  await page.click('text=播放');
  await page.waitForTimeout(2000);

  // 2) 到 checkpoint：给一个提示，然后看解析
  await page.waitForSelector('text=给我提示', { timeout: 150000 });
  await page.click('text=给我提示');
  await page.waitForTimeout(4000);
  await page.click('text=看解析');
  // 等解析+demo 播完，自动续播
  await page.waitForTimeout(25000);
  await page.screenshot({ path: 'out/audit/journey/p2-after-demo.png' });

  // 3) 一路到结束，看收束态
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(10000);
    const done = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')].map(b => b.textContent);
      return { finished: !buttons.includes('暂停') && !buttons.includes('播放'), buttons };
    });
    if (done.finished) { console.log('FINISHED at iter', i, JSON.stringify(done.buttons)); break; }
  }
  await page.screenshot({ path: 'out/audit/journey/p3-end.png' });
  await ctx.close();
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
