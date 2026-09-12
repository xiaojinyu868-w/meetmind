/**
 * 收藏夹开课的质量门（dry-run 风格，花真实模型钱，不进 CI）：
 * 同一份材料包开 N 节课，只听老师第一轮，量四个数——
 *   1) 引材料：口播里「材料 N」点名次数（讲自材料 vs 泛泛而谈）
 *   2) 命中：材料关键概念出现率（BENCH_KEYWORDS 逗号分隔；不传就用合成包自带的）
 *   3) 分歧：材料之间有不同看法时老师有没有点出来（合成包里 A3 与 A2 对「早停算不算正则化」看法不同）
 *   4) 首字延迟 / 口播长度 / 一轮是否讲完
 * 数字波动 = prompt / 节选 / 材料块格式改动的回归信号。用法：
 *   make bench-zhihu-lesson                          # 合成包 ×3，打到 SMOKE_BASE（默认 3106）
 *   BENCH_PACK=data/teach-materials/<id>.json BENCH_N=2 make bench-zhihu-lesson   # 用一份真实材料包
 * 产物：BENCH_OUT（默认 /tmp/mm-zhihu-bench）/<时间戳>.json，不进仓库。
 */
import { loadEnvConfig } from '@next/env';
import fs from 'node:fs';
import path from 'node:path';

const base = (process.env.SMOKE_BASE || 'http://localhost:3106').replace(/\/$/, '');
const runs = Math.max(1, Math.min(10, Number(process.env.BENCH_N || 3)));
const outDir = process.env.BENCH_OUT || '/tmp/mm-zhihu-bench';

const SYNTHETIC = {
  v: 1 as const,
  source: 'zhihu-favlist',
  title: '机器学习入门（bench 合成）',
  createdAt: new Date().toISOString(),
  items: [
    { ref: 'A1', title: '过拟合到底是什么？为什么模型会「背题」？', author: '合成作者甲', url: 'https://www.zhihu.com/question/900001/answer/900011', meta: '回答 · 赞同 1200', body: 'full' as const, excerpt: '过拟合的本质，是模型把训练数据里的噪声也当成规律学了进去。训练集上分数很高，换一批数据就崩，这就是「背题」而不是「学会」。\n\n判断过拟合最直接的办法是看训练误差和验证误差的差距：训练误差一路下降、验证误差却掉头向上，那个拐点就是模型开始背题的地方。\n\n模型容量越大越容易过拟合：参数多、层数深、训练轮数多，都在给它更多记住噪声的余地。治它有三条路：更多数据、更小的模型、或者给参数加约束——也就是正则化。' },
    { ref: 'A2', title: 'L1 和 L2 正则化的区别，一张图讲清楚', author: '合成作者乙', url: 'https://zhuanlan.zhihu.com/p/900002', meta: '文章 · 赞同 860', body: 'full' as const, excerpt: '正则化是在损失函数后面加一个惩罚项，惩罚参数太大。L2 惩罚的是参数的平方和，让所有参数都变小但很少变成零；L1 惩罚的是绝对值之和，会把一部分参数直接压成零。\n\n几何上看，L2 的约束区域是一个圆；L1 的约束区域是一个菱形，最优解很容易落在顶点上，而顶点意味着某个参数正好是零——这就是 L1 会做特征选择的原因。\n\n严格说，正则化就是显式改损失函数；早停这种不改损失函数的训练技巧不算正则化，只是碰巧也能防过拟合。' },
    { ref: 'A3', title: '早停法（Early Stopping）算不算正则化？', author: '合成作者丙', url: 'https://www.zhihu.com/question/900003/answer/900033', meta: '回答 · 赞同 430', body: 'full' as const, excerpt: '早停是在验证误差开始上升时停止训练。它没有改损失函数，但效果上限制了参数能走多远，所以很多人把它归为一种隐式正则化——我也这么认为，这和「只有改损失函数才算正则化」的看法是相反的。\n\n实践里早停几乎零成本：留一份验证集，每个 epoch 看一次，连续几次不再改善就停。它经常和 L2 一起用。' },
  ],
};
const SYNTHETIC_KEYWORDS = ['过拟合', '正则', '早停', 'L1', 'L2', '验证'];
const DISAGREE_RE = /分歧|不一致|看法(不同|相反)|相反的看法|意见不同|争议|有人认为.*也有人|两种(说法|看法|观点)|不同意|另一种(看法|观点)/;

type SseEvent = { type?: string; text?: string };

async function listenFirstTurn(threadId: string, timeoutMs: number): Promise<{ speech: string; firstDeltaMs: number | null; completed: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  let speech = '';
  let firstDeltaMs: number | null = null;
  let completed = false;
  try {
    const response = await fetch(`${base}/api/teach/threads/${threadId}/stream`, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
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
        try {
          ev = JSON.parse(line.slice(5).trim()) as SseEvent;
        } catch {
          continue;
        }
        if (ev.type === 'text-delta' && typeof ev.text === 'string') {
          if (firstDeltaMs === null) firstDeltaMs = Date.now() - started;
          speech += ev.text;
        }
        if (ev.type === 'turn-complete' || ev.type === 'error') {
          completed = ev.type === 'turn-complete';
          controller.abort();
          return { speech, firstDeltaMs, completed };
        }
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
  }
  return { speech, firstDeltaMs, completed };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { default: prisma } = await import('@/lib/prisma');
  const { authService } = await import('@/lib/services/auth-service');
  const { createThread } = await import('@/lib/services/teach-codex/thread-store');
  const { writeLiveMaterials } = await import('@/lib/services/teach-live/live-materials');
  const { resolveTeachLiveProvider } = await import('@/lib/config/teach.config');
  const { TeachConfig } = await import('@/lib/config/teach.config');

  const pack = process.env.BENCH_PACK ? (JSON.parse(fs.readFileSync(process.env.BENCH_PACK, 'utf8')) as typeof SYNTHETIC) : SYNTHETIC;
  const keywords = process.env.BENCH_KEYWORDS ? process.env.BENCH_KEYWORDS.split(',').map((k) => k.trim()).filter(Boolean) : process.env.BENCH_PACK ? [] : SYNTHETIC_KEYWORDS;
  const userId = `bench-zhihu-${Date.now().toString(36)}`;
  await prisma.user.create({ data: { id: userId, username: userId, nickname: '知乎线 bench 账户' } });
  const token = (await authService.createSessionForUserId(userId)).accessToken;
  if (!token) throw new Error('no token');

  const results: Array<Record<string, unknown>> = [];
  const threadIds: string[] = [];
  try {
    for (let i = 0; i < runs; i += 1) {
      const thread = await createThread({ topic: pack.title, model: resolveTeachLiveProvider().model, engine: 'live' });
      const threadId = thread.id;
      threadIds.push(threadId);
      await writeLiveMaterials(threadId, { ...pack, ownerUserId: userId });
      await prisma.$disconnect();
      const listening = listenFirstTurn(threadId, 120_000);
      await new Promise((r) => setTimeout(r, 600));
      const post = await fetch(`${base}/api/teach/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: '开始上课' }),
      });
      if (!post.ok) throw new Error(`post message ${post.status}`);
      const { speech, firstDeltaMs, completed } = await listening;
      const cites = (speech.match(/材料\s*[0-9１-９一二三四五六七八]/g) ?? []).length;
      const hits = keywords.filter((k) => speech.includes(k));
      const row = {
        run: i + 1,
        threadId,
        chars: speech.length,
        completed,
        firstDeltaMs,
        cites,
        keywordHit: keywords.length ? `${hits.length}/${keywords.length}` : 'n/a',
        missing: keywords.filter((k) => !speech.includes(k)),
        disagreementNamed: DISAGREE_RE.test(speech),
        opening: speech.slice(0, 90).replace(/\s+/g, ' '),
      };
      results.push(row);
      console.log(`#${row.run} ${row.chars} 字 · 首字 ${row.firstDeltaMs ?? '-'}ms · 引材料 ${row.cites} 次 · 命中 ${row.keywordHit} · 分歧点名 ${row.disagreementNamed ? '是' : '否'} · ${completed ? '讲完' : '未讲完'}`);
      console.log(`   ${row.opening}…`);
    }
    const avg = (key: 'chars' | 'cites') => (results.reduce((s, r) => s + Number(r[key] ?? 0), 0) / results.length).toFixed(1);
    const summary = {
      base,
      pack: pack.title,
      runs: results.length,
      avgChars: avg('chars'),
      avgCites: avg('cites'),
      disagreementNamedRate: `${results.filter((r) => r.disagreementNamed).length}/${results.length}`,
      completedRate: `${results.filter((r) => r.completed).length}/${results.length}`,
      at: new Date().toISOString(),
    };
    console.log('\n汇总', JSON.stringify(summary));
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ summary, results }, null, 2));
    console.log(`写入 ${file}`);
  } finally {
    const { default: prisma2 } = await import('@/lib/prisma');
    for (const id of threadIds) {
      await prisma2.teachThread.delete({ where: { id } }).catch(() => undefined);
      fs.rmSync(path.join(process.cwd(), TeachConfig.eventLogDir, `${id}.jsonl`), { force: true });
      fs.rmSync(path.join(process.cwd(), TeachConfig.materialsDir, `${id}.json`), { force: true });
    }
    await prisma2.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma2.$disconnect();
  }
}

main().catch((error) => {
  console.error('bench 失败：', error);
  process.exit(1);
});
