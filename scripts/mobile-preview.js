// 手机端预览：375×812 iPhone 13 mini 视口下截图主要页面状态
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3101';
const OUT = '/tmp/mobile-preview';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13 Mini'],
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console error]', msg.text().slice(0, 200));
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));

  const log = (label) => console.log(`\n=== ${label} ===`);
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    console.log(`  📸 ${name}.png`);
  };

  // —— 0. 主页跳转登录确认 ——
  log('0. 访问 /app（公共路由）');
  const resp = await page.goto(`${BASE}/app?mobile=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`  HTTP ${resp.status()}`);
  await page.waitForTimeout(3000);
  await shot('00-app-initial');

  // —— 1. 检查页面元素 ——
  log('1. 元素抓取');
  const title = await page.title();
  console.log(`  title: ${title}`);
  const bodyText = (await page.textContent('body')) || '';
  console.log(`  body length: ${bodyText.length}`);
  console.log(`  body sample: ${bodyText.slice(0, 200).replace(/\s+/g, ' ')}`);

  // 查找关键 mobile 组件
  const hasMobileTopBar = await page.locator('[class*="MobileTopBar"], [class*="mobile"]').count();
  console.log(`  mobile-classed elements: ${hasMobileTopBar}`);

  // —— 2. 尝试登录页（?mobile=1 在登录态强制手机端） ——
  log('2. /login?mobile=1');
  await page.goto(`${BASE}/login?mobile=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('02-login');

  // —— 3. demo guest 入口 ——
  log('3. 尝试 guest demo 入口');
  await page.goto(`${BASE}/app?mobile=1&guest=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await shot('03-guest-demo');

  // —— 4. 检查 guest demo 后的实际渲染 ——
  log('4. 截取关键元素');
  // 应用矩阵入口
  const menuBtn = page.locator('button:has-text("菜单"), [aria-label="菜单"]').first();
  if (await menuBtn.count()) {
    await menuBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
    await shot('04-menu-open');
  }

  // —— 5. 看一下 catalog API 返回的应用列表 ——
  log('5. /api/apps/catalog');
  const catResp = await page.request.get(`${BASE}/api/apps/catalog`);
  const cat = await catResp.json();
  console.log(`  apps in catalog: ${cat.apps?.length || 0}`);
  if (cat.apps) {
    cat.apps.forEach((a) => {
      console.log(`    - ${a.key} | tier=${a.primaryTier} | supports=${(a.supportedTiers || []).join(',')}`);
    });
  }

  await browser.close();
  console.log('\n✅ done');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
