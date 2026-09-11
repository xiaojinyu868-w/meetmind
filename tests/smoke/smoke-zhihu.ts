/**
 * 知乎接入 smoke（make smoke-zhihu）——只读，不碰数据库，不需要起服务。
 *
 * 用 .env 里的 ZHIHU_ACCESS_SECRET 以「本人模式」走一遍真实接口：
 *   站内搜索 → 收藏夹列表 → 第一个收藏夹的内容 → 近期收藏 → 挑一条链接用 Firecrawl 抽正文 → 去杂质。
 * 每步打印字段样例，便于对照 DOMAIN.md 的数据模型核对线上实际形状（文档 2026-07 核验，线上可能已变）。
 *
 * 可选：SMOKE_ZHIHU_URL=<知乎链接> 指定要抽正文的页面；SMOKE_ZHIHU_HOT=1 顺带拉一次热榜（额度 100 次/天，默认不拉）。
 * 额度提醒：搜索 5,000 次/天，本脚本每跑一次消耗搜索 1 次、用户接口 3 次、Firecrawl 1 credit。
 */
import { loadEnvConfig } from '@next/env';

function line(label: string, value: unknown): void {
  console.log(`  ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { getZhihuConfig } = await import('@/lib/config/zhihu.config');
  const config = getZhihuConfig();
  if (!config.accessSecret) {
    console.error('✗ 未配置 ZHIHU_ACCESS_SECRET：到 https://developer.zhihu.com/profile 申请后写进 .env 再跑。');
    process.exit(2);
  }
  const { createZhihuOpenClient, ZhihuApiError } = await import('@/lib/services/zhihu/zhihu-open-client');
  const { cleanZhihuPage } = await import('@/lib/services/zhihu/zhihu-page-clean');
  const { extractWebArticle } = await import('@/lib/services/web-article-extract-service');
  const client = createZhihuOpenClient({ config });

  const failures: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      const detail = error instanceof ZhihuApiError ? `${error.kind} ${error.code ?? ''} ${error.message}` : String((error as Error)?.message ?? error);
      failures.push(`${name}: ${detail}`);
      console.log(`✗ ${name} — ${detail}`);
    }
  };

  let firstUrl: string | null = process.env.SMOKE_ZHIHU_URL?.trim() || null;

  await step('站内搜索 zhihu_search（"过拟合 正则化"）', async () => {
    const result = await client.searchZhihu('过拟合 正则化', { count: 5 });
    line('items', result.items.length);
    for (const item of result.items.slice(0, 3)) {
      line('  ·', `${item.contentType} | 权威 ${item.authorityLevel ?? '?'} | 赞同 ${item.voteUpCount} | ${item.authorName} | ${item.title}`);
      line('    url', item.url);
      line('    精选评论数', item.featuredComments.length);
    }
    if (!firstUrl && result.items[0]) firstUrl = result.items[0].url;
  });

  if (process.env.SMOKE_ZHIHU_HOT === '1') {
    await step('热榜 hot_list（额度 100/天）', async () => {
      const hot = await client.hotList({ limit: 5 });
      line('total', hot.total);
      for (const item of hot.items) line('  ·', `${item.title} | ${item.url} | 摘要 ${item.summary ? '有' : '空'}`);
    });
  }

  let favlistToken: string | null = null;
  await step('收藏夹列表 user/favlists（本人模式）', async () => {
    const favlists = await client.userFavlists({ limit: 50 });
    line('count', favlists.items.length);
    for (const f of favlists.items.slice(0, 5)) line('  ·', `${f.urlToken} | ${f.isPublic ? '公开' : '私密'} | ${f.title}`);
    favlistToken = favlists.items[0]?.urlToken ?? null;
  });

  if (favlistToken) {
    await step(`收藏夹内容 user/favlist_contents（${favlistToken}）`, async () => {
      const contents = await client.favlistContents({ favlistUrlToken: favlistToken!, limit: 5 });
      line('paging', contents.paging);
      for (const item of contents.items) {
        line('  ·', `${item.contentType} | 赞同 ${item.likeCount} | ${item.author?.name ?? '无作者'} | ${item.title}`);
        line('    url', item.url);
        line('    摘要字数', item.summary.length);
      }
      if (!firstUrl && contents.items[0]) firstUrl = contents.items[0].url;
    });
  } else {
    console.log('  （账号没有收藏夹，跳过收藏夹内容）');
  }

  await step('近期收藏 user/collections', async () => {
    const recent = await client.recentCollections({ limit: 5 });
    line('count', recent.items.length);
    for (const item of recent.items.slice(0, 3)) line('  ·', `${item.contentType} | 收藏于 ${new Date(item.favTime * 1000).toISOString().slice(0, 10)} | ${item.title}`);
  });

  if (firstUrl) {
    await step(`Firecrawl 抽正文 + 去杂质（${firstUrl}）`, async () => {
      const article = await extractWebArticle(firstUrl!, 'zhihu', '知乎');
      line('extractMethod', article.extractMethod);
      line('原始字数', article.content.length);
      const cleaned = cleanZhihuPage(article.content, { url: firstUrl!, title: article.title });
      line('kind / confident', `${cleaned.kind} / ${cleaned.confident}`);
      line('title', cleaned.title);
      line('author', cleaned.author);
      line('正文字数', cleaned.body.length);
      line('赞同 / 评论 / 编辑于', `${cleaned.voteUpCount} / ${cleaned.commentCount} / ${cleaned.editedAt}`);
      line('正文开头', cleaned.body.slice(0, 120).replace(/\n/g, ' '));
    });
  } else {
    console.log('  （没有可抽正文的链接：搜索与收藏都为空，可用 SMOKE_ZHIHU_URL 指定）');
  }

  console.log('');
  if (failures.length) {
    console.log(`✗ ${failures.length} 步失败：`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ 知乎接入 smoke 全部通过');
}

main().catch((error) => {
  console.error('✗ smoke 崩了：', error);
  process.exit(1);
});
