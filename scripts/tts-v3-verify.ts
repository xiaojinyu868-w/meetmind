/** 临时验证：TTS 升级后 demo 全链路（时钟链日志 + 段间缝） */
import { chromium } from 'playwright';

async function main() {
  const url = process.argv[2] ?? 'http://localhost:3101/demo-board';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/board|tts|clock/i.test(text)) logs.push(`[${msg.type()}] ${text}`);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // 播 40s，期间点一下页面触发手势（保证 AudioContext running）
  await page.waitForTimeout(3000);
  await page.mouse.click(720, 450);
  await page.waitForTimeout(37000);
  await page.screenshot({ path: 'out/tts-v3-verify.png' });
  console.log(logs.slice(0, 60).join('\n') || '(无 board 日志)');
  await browser.close();
}

void main();
