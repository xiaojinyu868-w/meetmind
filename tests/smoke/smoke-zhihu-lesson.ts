/**
 * 收藏夹开课闭环 smoke（make smoke-zhihu-lesson）——不需要知乎凭证，验证的是 MeetMind 这一侧的整条链。
 *
 * 合成账户 → 直接写 3 条 zhihu-favorite capture（正文完整，跳过 Firecrawl）→ POST /api/zhihu/lesson（挑材料、建 live 线程、材料包落盘）
 * → GET /api/zhihu/lesson/<id> → 「开始上课」并听 SSE：老师开口的内容里必须出现材料里的概念（材料段真的进了 prompt）
 * → GET /api/teach/threads/<id>/record（课的物化）→ POST /api/zhihu/continue（无凭证时返回空组不报错）→ 清理。
 *
 * SMOKE_BASE 指向要验的服务（默认 http://localhost:3106）。SMOKE_BROWSER=chromium 时用 Playwright 带 token 打开
 * /apps/zhihu 与课堂页各截一张图到 SMOKE_SHOT_DIR。SMOKE_SKIP_LLM=1 跳过老师开讲与出题（不花模型钱）。
 * 花费：一轮 live 口播（GLM Flash ≈ ¥0.01）+ 一套测验（≈ ¥0.02）。
 */
import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const base = (process.env.SMOKE_BASE || 'http://localhost:3106').replace(/\/$/, '');
const shotDir = process.env.SMOKE_SHOT_DIR || '/tmp/mm-zhihu-smoke';
const skipLlm = process.env.SMOKE_SKIP_LLM === '1';

const MATERIALS = [
  {
    title: '过拟合到底是什么？为什么模型会「背题」？',
    url: 'https://www.zhihu.com/question/900001/answer/900011',
    author: '合成作者甲',
    votes: 1200,
    body: [
      '过拟合的本质，是模型把训练数据里的噪声也当成规律学了进去。训练集上分数很高，换一批数据就崩，这就是「背题」而不是「学会」。',
      '判断过拟合最直接的办法是看训练误差和验证误差的差距：训练误差一路下降、验证误差却掉头向上，那个拐点就是模型开始背题的地方。',
      '模型容量越大越容易过拟合：参数多、层数深、训练轮数多，都在给它更多记住噪声的余地。所以所有对付过拟合的办法，本质上都是在限制它的记忆力。',
    ].join('\n\n'),
  },
  {
    title: 'L1 和 L2 正则化的区别，一张图讲清楚',
    url: 'https://zhuanlan.zhihu.com/p/900002',
    author: '合成作者乙',
    votes: 860,
    body: [
      '正则化是在损失函数后面加一个惩罚项，惩罚参数太大。L2 惩罚的是参数的平方和，让所有参数都变小但很少变成零；L1 惩罚的是绝对值之和，会把一部分参数直接压成零。',
      '几何上看，L2 的约束区域是一个圆，最优解落在圆上任意一点的概率差不多；L1 的约束区域是一个菱形，最优解很容易落在顶点上，而顶点意味着某个参数正好是零——这就是 L1 会做特征选择的原因。',
      '惩罚强度 λ 太小等于没加，λ 太大会把模型压得太简单变成欠拟合。实践里 λ 用验证集或交叉验证来选，不靠拍脑袋。',
    ].join('\n\n'),
  },
  {
    title: '早停法（Early Stopping）算不算正则化？',
    url: 'https://www.zhihu.com/question/900003/answer/900033',
    author: '合成作者丙',
    votes: 430,
    body: [
      '早停是在验证误差开始上升时停止训练。它没有改损失函数，但效果上限制了参数能走多远，所以很多人把它归为一种隐式正则化。',
      '和 L2 相比，早停几乎不需要调参，代价是要一直盯着验证集；两者经常一起用，并不冲突。',
      '有人反对把早停叫正则化，理由是它依赖训练过程而不是模型本身的约束——这是个定义之争，理解它在做什么比争名字重要。',
    ].join('\n\n'),
  },
];

interface SseEvent { type: string; text?: string; [key: string]: unknown }

async function collectTeacherSpeech(threadId: string, timeoutMs: number): Promise<{ speech: string; events: number; completed: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let speech = '';
  let events = 0;
  let completed = false;
  try {
    const response = await fetch(`${base}/api/teach/threads/${threadId}/stream`, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    assert(response.ok && response.body, `stream ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let ev: SseEvent;
        try { ev = JSON.parse(line.slice(5).trim()) as SseEvent; } catch { continue; }
        events++;
        if (ev.type === 'text-delta' && typeof ev.text === 'string') speech += ev.text;
        if (ev.type === 'turn-complete' || ev.type === 'error') {
          completed = ev.type === 'turn-complete';
          controller.abort();
          return { speech, events, completed };
        }
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
  }
  return { speech, events, completed };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { default: prisma } = await import('@/lib/prisma');
  const { authService } = await import('@/lib/services/auth-service');
  const { workspaceContextService } = await import('@/lib/services/workspace-context-service');
  const { captureInputFromCollectionItem, ZHIHU_CAPTURE_SOURCE_TYPE } = await import('@/lib/services/zhihu/zhihu-import-service');
  const { TeachConfig } = await import('@/lib/config/teach.config');

  // SMOKE_ZHIHU_SELF=1：用固定 id（需在 .env 的 ZHIHU_SELF_MODE_USER_IDS 白名单里），截图里能看到真实收藏夹与「你开过的课」
  const userId = process.env.SMOKE_ZHIHU_SELF === '1' ? 'smoke-zhihu-self' : `smoke-zhihu-${Date.now().toString(36)}`;
  let threadId: string | null = null;
  let singleThreadId: string | null = null;
  const pass = (line: string) => console.log(`✓ ${line}`);

  try {
    await prisma.workspaceCapture.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.workspace.deleteMany({ where: { ownerId: userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.user.create({ data: { id: userId, username: userId, nickname: '知乎线合成验收账户' } });
    const session = await authService.createSessionForUserId(userId);
    const token = session.accessToken;
    assert(token, 'fixture_login_failed');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 1) 三条正文完整的知乎收藏（跳过 Firecrawl）
    const captureIds: string[] = [];
    for (const [index, m] of MATERIALS.entries()) {
      const input = captureInputFromCollectionItem(
        userId,
        {
          contentType: m.url.includes('zhuanlan') ? 'article' : 'answer',
          url: m.url,
          createdAt: 1_700_000_000 + index,
          favTime: 1_757_000_000 + index,
          likeCount: m.votes,
          commentCount: 12,
          favoriteCount: 300,
          title: m.title,
          summary: m.body.slice(0, 120),
          favlists: [{ urlToken: '424242', title: '机器学习入门（合成）', url: 'https://www.zhihu.com/collection/424242' }],
          author: { name: m.author, urlToken: `smoke-${index}`, url: `https://www.zhihu.com/people/smoke-${index}`, gender: 0, headline: '' },
        },
        null,
      );
      // 直接写成正文完整（真实链路里这一步由 materialize 完成）
      input.normalizedText = m.body;
      input.previewText = m.body.slice(0, 180);
      (input.metadata.zhihu as { body: string; cleanConfident?: boolean }).body = 'full';
      (input.metadata.zhihu as { cleanConfident?: boolean }).cleanConfident = true;
      const { capture } = await workspaceContextService.upsertCaptureForUser(userId, input);
      captureIds.push(capture.id);
    }
    assert.equal(captureIds.length, 3);
    pass(`写入 3 条 ${ZHIHU_CAPTURE_SOURCE_TYPE} capture（正文完整）`);
    // 共享 SQLite 目前是 delete 日志模式：脚本自己的连接空闲也可能让服务端写操作等锁，HTTP 阶段先断开
    await prisma.$disconnect();

    // 2) 开课
    const lessonRes = await fetch(`${base}/api/zhihu/lesson`, { method: 'POST', headers, body: JSON.stringify({ captureIds }) });
    const lesson = (await lessonRes.json()) as { success?: boolean; thread?: { id: string; title: string; topic: string }; pack?: { title: string; items: Array<{ ref: string; body: string; title: string }> }; error?: string; message?: string };
    assert(lessonRes.ok && lesson.success && lesson.thread && lesson.pack, `lesson 失败 ${lessonRes.status} ${JSON.stringify(lesson)}`);
    threadId = lesson.thread.id;
    assert.equal(lesson.pack.items.length, 3);
    assert(lesson.pack.items.every((i) => i.body === 'full'), '材料应全部为正文完整');
    assert.equal(lesson.pack.items[0].title, MATERIALS[0].title, '按赞同排序，第一篇是最高赞');
    assert.equal(lesson.thread.topic, '机器学习入门（合成）', '课题默认取收藏夹名');
    pass(`POST /api/zhihu/lesson → 线程 ${threadId}，课题「${lesson.thread.topic}」，材料 ${lesson.pack.items.map((i) => i.ref).join(' ')}`);

    const packRes = await fetch(`${base}/api/zhihu/lesson/${threadId}`, { headers });
    const packData = (await packRes.json()) as { success?: boolean; thread?: { engine: string }; pack?: { items: unknown[] } };
    assert(packRes.ok && packData.success && packData.thread?.engine === 'live' && packData.pack?.items.length === 3, `lesson GET 失败 ${JSON.stringify(packData)}`);
    pass('GET /api/zhihu/lesson/<id> → engine=live，材料包 3 篇');
    const materialsFile = path.join(process.cwd(), TeachConfig.materialsDir, `${threadId}.json`);
    assert(fs.existsSync(materialsFile), `材料包文件不存在：${materialsFile}`);

    // 2b) 课的单位 = 一篇：single 模式给老师全文、课题 = 文章标题、材料包记 mode
    const singleRes = await fetch(`${base}/api/zhihu/lesson`, { method: 'POST', headers, body: JSON.stringify({ captureIds: [captureIds[1]], mode: 'single' }) });
    const single = (await singleRes.json()) as { success?: boolean; thread?: { id: string; topic: string }; pack?: { mode?: string; items: Array<{ body: string; excerpt: string; title: string }> } };
    assert(singleRes.ok && single.success && single.thread && single.pack, `single lesson 失败 ${singleRes.status} ${JSON.stringify(single)}`);
    singleThreadId = single.thread.id;
    assert.equal(single.pack.mode, 'single');
    assert.equal(single.pack.items.length, 1);
    assert.equal(single.thread.topic, MATERIALS[1].title, '单篇课的课题是文章标题');
    assert.equal(single.pack.items[0].excerpt, MATERIALS[1].body.replace(/\r\n?/g, '\n').trim(), '单篇课给老师的是全文');
    pass(`POST /api/zhihu/lesson mode=single → 线程 ${singleThreadId}，课题「${single.thread.topic}」，老师拿到全文 ${single.pack.items[0].excerpt.length} 字`);
    pass(`材料包已落盘 ${path.relative(process.cwd(), materialsFile)}`);

    // 3) 老师开讲：材料里的概念必须出现在口播里
    if (!skipLlm) {
      const speechPromise = collectTeacherSpeech(threadId, 90_000);
      await new Promise((r) => setTimeout(r, 300));
      const msgRes = await fetch(`${base}/api/teach/threads/${threadId}/messages`, { method: 'POST', headers, body: JSON.stringify({ text: '开始上课' }) });
      assert(msgRes.ok, `messages ${msgRes.status} ${await msgRes.text()}`);
      const { speech, events, completed } = await speechPromise;
      assert(speech.length > 40, `老师几乎没开口（${speech.length} 字，${events} 个事件）`);
      // 老师开场可能先讲直觉不点术语；「材料 N」被点名引用，或至少两个材料概念出现，都算讲自材料
      const hits = ['过拟合', '正则', '早停', 'L1', 'L2'].filter((k) => speech.includes(k));
      const citesMaterials = /材料\s*[123１２３]/.test(speech);
      assert(citesMaterials || hits.length >= 2, `口播里没有引用材料（命中概念：${hits.join(',') || '无'}）：${speech.slice(0, 200)}`);
      if (citesMaterials) hits.unshift('材料 N 被点名');
      pass(`老师开讲 ${speech.length} 字 / ${events} 个事件 / ${completed ? '一轮讲完' : '截断于超时'}；命中材料概念：${hits.join('、')}`);
      console.log(`  口播开头：${speech.slice(0, 140).replace(/\s+/g, ' ')}…`);
    }

    // 4) 课的物化：讲完的课能拿到 LessonRecord（复习页据此存成"我的一节课"）
    {
      const recRes = await fetch(`${base}/api/teach/threads/${threadId}/record`, { headers });
      const rec = (await recRes.json()) as { success?: boolean; record?: { segments: Array<{ speaker: string; sourceRef?: string }>; materials?: { mode: string; items: Array<{ ref: string; coverage: string; excerpt: string }> } | null; rounds: number; settled: boolean; digest: { pagesTaught: string[] }; stageHref: string } };
      assert(recRes.ok && rec.success && rec.record, `record 失败 ${recRes.status} ${JSON.stringify(rec).slice(0, 200)}`);
      const record = rec.record;
      assert.equal(record.materials?.items.length, 3, 'record 里的材料应是这节课的 3 篇');
      assert(record.materials!.items.every((i) => i.coverage === 'full-text' && i.excerpt.length > 0), '材料应带全文节选');
      assert.equal(record.stageHref, `/apps/zhihu/lesson/${threadId}`);
      if (!skipLlm) {
        assert(record.segments.length > 0 && record.settled && record.rounds >= 1, `讲完的课应有转录段并已结束：段 ${record.segments.length} settled=${record.settled}`);
        assert(record.segments.every((seg) => seg.speaker === 'teacher'), '只有「开始上课」时不该出现学生段');
        pass(`GET /api/teach/threads/<id>/record → ${record.segments.length} 段老师转录 / ${record.rounds} 轮 / 讲了 ${record.digest.pagesTaught.length} 页 / 材料 ${record.materials!.items.map((i) => i.ref).join(' ')} 带节选`);
      } else {
        pass(`GET /api/teach/threads/<id>/record → 材料 ${record.materials!.items.map((i) => i.ref).join(' ')} 带节选（未开讲，无转录段）`);
      }
    }

    // 5) 继续看：知乎搜索额度极小（低额度账号站内 / 全网各 10 次 / 天），默认只在无凭证时跑（空组不报错）；有凭证要跑请 SMOKE_WITH_SEARCH=1
    if (!process.env.ZHIHU_ACCESS_SECRET || process.env.SMOKE_WITH_SEARCH === '1') {
      const contRes = await fetch(`${base}/api/zhihu/continue`, { method: 'POST', headers, body: JSON.stringify({ concepts: ['正则化', '早停'], threadId }) });
      const cont = (await contRes.json()) as { success?: boolean; groups?: Array<{ concept: string; candidates: unknown[] }>; exhausted?: boolean };
      assert(contRes.ok && cont.success && Array.isArray(cont.groups), `continue 失败 ${contRes.status} ${JSON.stringify(cont)}`);
      pass(`POST /api/zhihu/continue → ${cont.groups.length} 组（${process.env.ZHIHU_ACCESS_SECRET ? (cont.exhausted ? '有凭证，今日搜索额度已用完' : '有凭证') : '无凭证，空组符合预期'}）`);
    } else {
      pass('POST /api/zhihu/continue 跳过（省搜索额度；SMOKE_WITH_SEARCH=1 才跑）');
    }

    // 6) 浏览器截图
    if (process.env.SMOKE_BROWSER === 'chromium') {
      const { chromium } = await import('playwright');
      fs.mkdirSync(shotDir, { recursive: true });
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(`${base}/apps/zhihu`);
        await page.evaluate((value) => localStorage.setItem('meetmind_access_token', value), token);
        await page.goto(`${base}/apps/zhihu`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        // 等状态卡出来（dev 首次编译 API 路由要几秒）
        await page.waitForFunction(() => !document.body.innerText.includes('稍等…') && !document.body.innerText.includes('正在看你的收藏夹'), null, { timeout: 60_000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(shotDir, 'zhihu-entry.png'), fullPage: true });
        await page.goto(`${base}/apps/zhihu/lesson/${threadId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); // dev 首次编译舞台页可能 >30s
        await page.waitForTimeout(6000);
        await page.screenshot({ path: path.join(shotDir, 'zhihu-lesson.png') });
        await page.getByRole('button', { name: '材料 · 去复习', exact: true }).click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(shotDir, 'zhihu-lesson-rail.png') });
        await page.getByRole('button', { name: '收起', exact: true }).click();
        // 老师讲完一轮 → 右下长出「考一考」小卡（不花模型钱时不会出现）
        if (!skipLlm) {
          await page.waitForFunction(() => document.body.innerText.includes('讲完这一段了'), null, { timeout: 120_000 }).catch(() => undefined);
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(shotDir, 'zhihu-lesson-next.png') });
        }
        // 复习页：同学讲的课直达 /app?session=teach:<id>（讲过才有转录；没讲过恢复不了，截一张首页也行）
        await page.goto(`${base}/app?session=${encodeURIComponent(`teach:${threadId}`)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForFunction(() => document.body.innerText.includes('同学讲的课') || document.body.innerText.includes('课堂'), null, { timeout: 90_000 }).catch(() => undefined);
        await page.waitForTimeout(2500);
        await page.screenshot({ path: path.join(shotDir, 'zhihu-review.png'), fullPage: false });
        // 手机视口：第一屏与课后页
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${base}/apps/zhihu`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(shotDir, 'zhihu-entry-mobile.png'), fullPage: true });
        await page.goto(`${base}/apps/zhihu/lesson/${threadId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(shotDir, 'zhihu-lesson-mobile.png'), fullPage: false });
        pass(`截图：${shotDir}/zhihu-entry.png · zhihu-lesson.png · zhihu-lesson-rail.png · zhihu-lesson-next.png · zhihu-review.png · zhihu-entry-mobile.png · zhihu-lesson-mobile.png`);
      } finally {
        await browser.close();
      }
    }

    console.log('\n✓ 收藏夹开课闭环 smoke 全部通过');
  } finally {
    // 清理：capture / workspace / 线程（表 + 事件日志 + 材料包）/ 用户
    await prisma.workspaceCapture.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.workspace.deleteMany({ where: { ownerId: userId } }).catch(() => undefined);
    for (const id of [threadId, singleThreadId]) {
      if (!id) continue;
      await prisma.teachThread.delete({ where: { id } }).catch(() => undefined);
      for (const file of [
        path.join(process.cwd(), TeachConfig.eventLogDir, `${id}.jsonl`),
        path.join(process.cwd(), TeachConfig.materialsDir, `${id}.json`),
      ]) {
        fs.rmSync(file, { force: true });
      }
    }
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('✗ smoke 失败：', error);
  process.exit(1);
});
