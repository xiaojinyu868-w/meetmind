const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outputDir = '/mnt/meetmind-capture-v1-server-handoff/test_screenshots';
fs.mkdirSync(outputDir, { recursive: true });
const screenshotPath = path.join(outputDir, 'review-desktop-baseline.png');
const textPath = path.join(outputDir, 'review-desktop-baseline.txt');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });

  await page.goto('http://127.0.0.1:3002/app?guest=1', { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByTestId('mode-review-button').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('mode-review-button').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);

  const bodyText = await page.locator('body').innerText();
  const buttonTexts = await page.locator('button').allInnerTexts();
  const testids = await page.locator('[data-testid]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')).filter(Boolean));

  await page.screenshot({ path: screenshotPath, fullPage: true });
  fs.writeFileSync(
    textPath,
    `BUTTONS:\n${buttonTexts.slice(0, 120).join('\n')}\n\nTESTIDS:\n${testids.join('\n')}\n\nBODY:\n${bodyText}`,
    'utf8'
  );

  console.log(JSON.stringify({ screenshotPath, textPath, buttonCount: buttonTexts.length, testidCount: testids.length }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
