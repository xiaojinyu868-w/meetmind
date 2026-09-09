/**
 * 口袋闭环 smoke（make smoke-pocket）：合成账户 → POST /api/workspace/clip（ChatGPT 形状的 HTML）
 * → GET /api/workspace/pocket 里能读到（Markdown 含 TeX / 代码块、来源 ChatGPT）→ DELETE 撤销 → 清掉合成账户。
 *
 * SMOKE_BASE 指向要验的服务（默认 http://localhost:3101，即 make dev）。
 * SMOKE_BROWSER=chromium 时再用 Playwright 带 token 打开 /companion 截两张图（空态 / 有内容）到 SMOKE_SHOT_DIR。
 * 不碰真实用户：账户 id 带 smoke-pocket- 前缀，结束时按 id 删除其 capture 与 user。
 */
import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const base = (process.env.SMOKE_BASE || 'http://localhost:3101').replace(/\/$/, '');
const shotDir = process.env.SMOKE_SHOT_DIR || '/tmp/mm-pocket-smoke';

const CHATGPT_HTML = `<div class="markdown prose"><p>条件概率的定义是 <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">P(A∣B)=P(B)P(A∩B)</span></span>，注意分母是 <strong>P(B)</strong>。</p>
<pre><div class="toolbar"><div>python</div><button>复制代码</button></div><code class="language-python">def bayes(pa, pb, pba):
    return pba * pa / pb
</code></pre>
<ul><li><strong>先验</strong> P(A)</li><li>似然 P(B|A)</li></ul></div>`;

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { default: prisma } = await import('@/lib/prisma');
  const { authService } = await import('@/lib/services/auth-service');
  const userId = `smoke-pocket-${Date.now().toString(36)}`;
  const results: string[] = [];
  const pass = (line: string) => { results.push(`✓ ${line}`); console.log(`✓ ${line}`); };

  try {
    await prisma.user.create({ data: { id: userId, username: userId, nickname: '口袋合成验收账户' } });
    const session = await authService.createSessionForUserId(userId);
    const token = session.accessToken;
    assert(token, 'fixture_login_failed');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 1) 剪藏
    const clipRes = await fetch(`${base}/api/workspace/clip`, {
      method: 'POST', headers,
      body: JSON.stringify({
        text: '条件概率的定义是 P(A|B)=P(A∩B)/P(B)，注意分母是 P(B)。',
        html: CHATGPT_HTML,
        source: { app: 'Google Chrome', windowTitle: '贝叶斯 - ChatGPT - Google Chrome', url: 'https://chatgpt.com/c/smoke', pageTitle: '贝叶斯 - ChatGPT' },
        occurredAt: new Date().toISOString(),
        clientId: `smoke-${Date.now().toString(36)}`,
      }),
    });
    const clip = await clipRes.json() as { success?: boolean; capture?: { id: string; title: string; sourceLabel: string; hasMath: boolean } };
    assert(clipRes.ok && clip.success && clip.capture, `clip 失败 ${clipRes.status} ${JSON.stringify(clip)}`);
    assert.equal(clip.capture.sourceLabel, 'ChatGPT');
    assert.equal(clip.capture.hasMath, true);
    pass(`POST /api/workspace/clip → 「${clip.capture.title}」 来源 ${clip.capture.sourceLabel}，含公式`);

    // 同一网址第二条不能覆盖第一条
    const clip2Res = await fetch(`${base}/api/workspace/clip`, {
      method: 'POST', headers,
      body: JSON.stringify({ text: '第二条：似然是 P(B|A)。', source: { url: 'https://chatgpt.com/c/smoke', app: 'Google Chrome' }, clientId: `smoke2-${Date.now().toString(36)}` }),
    });
    assert(clip2Res.ok, 'clip2 失败');

    // 2) 口袋流
    const pocketRes = await fetch(`${base}/api/workspace/pocket?limit=10`, { headers });
    const pocket = await pocketRes.json() as { success?: boolean; items?: Array<{ id: string; normalizedText: string | null; pocket: { sourceLabel?: string; groupKey?: string } | null }> };
    assert(pocketRes.ok && pocket.success && pocket.items, 'pocket 读取失败');
    assert.equal(pocket.items.length, 2, `同一网址两条应各自成条，实际 ${pocket.items.length}`);
    const first = pocket.items.find((item) => item.id === clip.capture!.id);
    assert(first, '剪藏没出现在口袋流里');
    assert(first.normalizedText?.includes('$P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}$'), 'Markdown 里没有 TeX');
    assert(first.normalizedText?.includes('```python'), 'Markdown 里没有代码块');
    assert(!first.normalizedText?.includes('复制代码'), 'UI 渣没清掉');
    assert.equal(pocket.items[0].pocket?.groupKey, pocket.items[1].pocket?.groupKey, '同一网址 30 分钟内应同组');
    pass('GET /api/workspace/pocket → 两条各自成条、同组；Markdown 含 TeX 与 python 围栏、无「复制代码」');

    // 3) 浏览器截图（可选）
    if (process.env.SMOKE_BROWSER) {
      const { chromium } = await import('playwright');
      fs.mkdirSync(shotDir, { recursive: true });
      const browser = await chromium.launch();
      const context = await browser.newContext({ viewport: { width: 400, height: 640 }, locale: 'zh-CN' });
      const page = await context.newPage();
      await page.goto(`${base}/companion`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((value) => localStorage.setItem('meetmind_access_token', value), token);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(shotDir, 'pocket-with-items.png') });
      pass(`截图 ${path.join(shotDir, 'pocket-with-items.png')}`);
      await browser.close();
    }

    // 4) 撤销
    const delRes = await fetch(`${base}/api/workspace/captures`, { method: 'DELETE', headers, body: JSON.stringify({ captureId: clip.capture.id }) });
    assert(delRes.ok, '撤销失败');
    const afterRes = await fetch(`${base}/api/workspace/pocket?limit=10`, { headers });
    const after = await afterRes.json() as { items?: Array<{ id: string }> };
    assert(!(after.items || []).some((item) => item.id === clip.capture!.id), '撤销后仍在流里');
    pass('DELETE 撤销 → 口袋流里消失');

    if (process.env.SMOKE_BROWSER) {
      const { chromium } = await import('playwright');
      await fetch(`${base}/api/workspace/captures`, { method: 'DELETE', headers, body: JSON.stringify({ captureId: (after.items || [])[0]?.id }) }).catch(() => undefined);
      const browser = await chromium.launch();
      const page = await (await browser.newContext({ viewport: { width: 400, height: 640 }, locale: 'zh-CN' })).newPage();
      await page.goto(`${base}/companion`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((value) => localStorage.setItem('meetmind_access_token', value), token);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(shotDir, 'pocket-empty.png') });
      pass(`截图 ${path.join(shotDir, 'pocket-empty.png')}`);
      await browser.close();
    }
    console.log(`\n口袋 smoke ${results.length}/${results.length} 通过`);
  } finally {
    // 清掉合成账户的一切
    await prisma.workspaceCapture.deleteMany({ where: { userId } }).catch(() => undefined);
    const workspaces = await prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } }).catch(() => []);
    for (const workspace of workspaces) {
      await prisma.workspaceCapture.deleteMany({ where: { workspaceId: workspace.id } }).catch(() => undefined);
      await prisma.workspaceEcho.deleteMany({ where: { workspaceId: workspace.id } }).catch(() => undefined);
    }
    await prisma.workspace.deleteMany({ where: { ownerId: userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('✗ 口袋 smoke 失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
