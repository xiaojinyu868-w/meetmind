/**
 * make-sample-problem-image.ts —— 生成"学生拍的作业照片"样例（DEMO/实测用）
 *
 * 用 Playwright 渲染 HTML：印刷体题目（Noto Sans SC）+ 手写体学生尝试
 * （HongleiBanShu 蓝墨水），截图到 out/audit/。供拍题开讲链路与 VLM A/B 实测。
 *
 * 用法：npx tsx scripts/make-sample-problem-image.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('out', 'audit');
const FONT_DIR = join(process.cwd(), 'public', 'demo', 'fonts');

const PAGE_CSS = `
  @font-face { font-family: 'Honglei'; src: url('file://${FONT_DIR}/HongleiBanShu.ttf'); }
  @font-face { font-family: 'NotoSC'; src: url('file:///root/.fonts/NotoSansSC-Regular.otf'); }
  body { margin: 0; background: #f7f4ec; }
  .sheet {
    width: 900px; padding: 48px 56px; box-sizing: border-box;
    background:
      repeating-linear-gradient(#f7f4ec 0 39px, #dfe8f0 39px 40px);
    transform: rotate(-0.4deg);
  }
  .printed { font-family: 'NotoSC'; font-size: 22px; line-height: 40px; color: #222; }
  .ink { font-family: 'Honglei'; font-size: 26px; line-height: 44px; color: #2a4bd7; margin-top: 20px; }
`;

/** 样例 1：一元二次方程应用题 + 学生写了一半的尝试（蓝笔） */
const SAMPLE_1 = `<div class="sheet">
  <div class="printed">
    <b>22.</b> 某商店经销一种成本为每件 20 元的商品。经调查发现，若按每件 30 元销售，每天可售出 100 件；销售单价每上涨 1 元，每天销量减少 5 件。设销售单价为 x 元（x ≥ 30），每天的销售利润为 y 元。<br/>
    （1）求 y 与 x 之间的函数关系式；<br/>
    （2）销售单价定为多少元时，每天的销售利润最大？最大利润是多少？
  </div>
  <div class="ink">
    解：设涨价后每件 x 元<br/>
    y = (x − 20)(100 − 5x)
  </div>
</div>`;

/** 样例 2：二次函数图象题（印刷题 + 简单坐标系图） */
const SAMPLE_2 = `<div class="sheet">
  <div class="printed">
    <b>9.</b> 如图，抛物线 y = ax² + bx + c 经过 A(−1, 0)、B(3, 0) 两点，与 y 轴交于点 C(0, 3)。<br/>
    （1）求该抛物线的解析式；<br/>
    （2）写出当 y &gt; 0 时 x 的取值范围。
  </div>
  <svg width="360" height="260" style="margin: 12px 0 0 60px" viewBox="0 0 360 260">
    <line x1="30" y1="130" x2="340" y2="130" stroke="#333" stroke-width="1.5" marker-end="url(#arr)"/>
    <line x1="180" y1="20" x2="180" y2="240" stroke="#333" stroke-width="1.5"/>
    <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#333"/></marker></defs>
    <path d="M 60 130 Q 180 310 300 130" fill="none" stroke="#333" stroke-width="2" transform="scale(1,-1) translate(0,-260)"/>
    <text x="52" y="148" font-size="15" font-family="NotoSC">A</text>
    <text x="296" y="148" font-size="15" font-family="NotoSC">B</text>
    <text x="188" y="52" font-size="15" font-family="NotoSC">C</text>
    <text x="330" y="122" font-size="15" font-family="NotoSC">x</text>
    <text x="190" y="30" font-size="15" font-family="NotoSC">y</text>
    <text x="168" y="148" font-size="15" font-family="NotoSC">O</text>
  </svg>
</div>`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });

  const samples = [
    { name: 'sample-problem-1.png', html: SAMPLE_1 },
    { name: 'sample-problem-2.png', html: SAMPLE_2 },
  ];
  for (const sample of samples) {
    await page.setContent(`<html><head><style>${PAGE_CSS}</style></head><body>${sample.html}</body></html>`, {
      waitUntil: 'load',
    });
    await page.waitForTimeout(600); // 等字体
    const sheet = await page.$('.sheet');
    await sheet?.screenshot({ path: join(OUT, sample.name) });
    console.log(`written: ${join(OUT, sample.name)}`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
