/**
 * 一节 live 课的「材料包」：学生自己带来的材料（知乎收藏夹、以后可以是论文 / 讲义 / 网页），
 * 老师从这些材料出发讲，而不是另讲一套。
 *
 * 落盘 `data/teach-materials/<threadId>.json`（与事件日志同一模式：文件即事实，不改 schema），
 * `ensureSession` 建会话时读一次拼进 system prompt 的「材料」段——和 learnerJson 的「关于这位学生」段并列。
 * 这里只管存取与格式化；怎么从收藏夹挑材料、抽正文是来源方（services/zhihu/zhihu-lesson-service）的事。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { TeachConfig } from '@/lib/config/teach.config';
import { createLogger } from '@/lib/logger';

const log = createLogger('teach-live-materials');

export interface LiveMaterialItem {
  /** 引用 id：A1、A2…（老师板书里写 [A1]，口播里说「材料 1」） */
  ref: string;
  title: string;
  author: string | null;
  url: string;
  /** 一行元信息，来源方自己拼（赞同 / 评论 / 收藏时间 / 权威等级……），不做结构化承诺 */
  meta: string;
  /** 正文状态：full = 全文节选；summary = 只有摘要（老师只能当线索，不能替它编细节） */
  body: 'full' | 'summary';
  excerpt: string;
  /** 来源方的内部 id（知乎线 = WorkspaceCapture.id），课后出题 / 补货用 */
  sourceId?: string;
}

export interface LiveMaterialPack {
  v: 1;
  /** 来源类型，给日志与前端展示 */
  source: string;
  /** 这组材料的名字（收藏夹名） */
  title: string;
  items: LiveMaterialItem[];
  /** 没进材料包的条目（视频 / 想法 / 抽不到正文），前端如实展示 */
  skipped?: Array<{ sourceId?: string; title: string; reason: string }>;
  /** 开课的 MeetMind 用户；TeachThread 没有归属列，材料包就是这节课属于谁的唯一记录 */
  ownerUserId?: string;
  /** 同一组材料之前上过的课（标题 / 课题），给老师一句"别从头讲同一段"；由开课方（如 zhihu-lesson-service）填 */
  priorLessons?: Array<{ threadId: string; title: string; createdAt: string }>;
  createdAt: string;
}

/** 扫一遍材料包目录（小文件、小规模；上百节课以内够用，再大就该进表） */
export async function listLiveMaterials(filter: (pack: LiveMaterialPack) => boolean): Promise<Array<{ threadId: string; pack: LiveMaterialPack }>> {
  const dir = path.join(process.cwd(), TeachConfig.materialsDir);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') log.warn('materials dir read failed', { message: (error as Error)?.message });
    return [];
  }
  const out: Array<{ threadId: string; pack: LiveMaterialPack }> = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const threadId = name.slice(0, -'.json'.length);
    const pack = await readLiveMaterials(threadId);
    if (pack && filter(pack)) out.push({ threadId, pack });
  }
  return out;
}

function materialsPath(threadId: string): string {
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(process.cwd(), TeachConfig.materialsDir, `${safe}.json`);
}

export async function writeLiveMaterials(threadId: string, pack: LiveMaterialPack): Promise<void> {
  const file = materialsPath(threadId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(pack), 'utf8');
}

export async function readLiveMaterials(threadId: string): Promise<LiveMaterialPack | null> {
  try {
    const raw = await fs.readFile(materialsPath(threadId), 'utf8');
    const parsed = JSON.parse(raw) as LiveMaterialPack;
    return parsed?.v === 1 && Array.isArray(parsed.items) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('materials read failed', { threadId, message: (error as Error)?.message });
    }
    return null;
  }
}

/** 拼进 system prompt 的「材料」段；没有材料返回空串（prompt 一字不加） */
export function formatLiveMaterialsBlock(pack: LiveMaterialPack | null): string {
  if (!pack || pack.items.length === 0) return '';
  const lines: string[] = [];
  lines.push(`# 这节课的材料（学生自己收藏的 ${pack.items.length} 篇，来自「${pack.title}」，按参考价值排序）`);
  lines.push('学生收藏它们是因为想学会它们讲的东西，所以这节课从这些材料出发讲，不另讲一套。');
  lines.push('- 材料之间观点不一致的地方要点名对比：「材料 1 说……，材料 3 却认为……」，说清分歧在哪、你怎么判断（赞同数和作者身份是线索，不是定论）。');
  lines.push('- 口播里引用材料说「材料 1」这样能念的话；板书 / 要点里可以写 [A1]。');
  lines.push('- 标了「只有摘要」的材料只能当线索，不要替它编细节；材料没覆盖但学生需要的基础可以补，但要说一句「这段不在你收藏里」。');
  lines.push('- 课题标题（scene title）从材料的共同主题里起，不要照抄某一篇的标题。');
  if (pack.priorLessons?.length) {
    const recent = pack.priorLessons.slice(0, 5).map((lesson) => `《${lesson.title}》`).join('、');
    lines.push(`- 这位学生用这组材料已经上过 ${pack.priorLessons.length} 节：${recent}。这次不要从头讲同一段——先问一句上次讲到哪、哪里没懂，或者换一篇材料 / 往深处走。`);
  }
  lines.push('');
  for (const item of pack.items) {
    const author = item.author ? ` · ${item.author}` : '';
    const state = item.body === 'full' ? '正文节选' : '只有摘要';
    lines.push(`[${item.ref}] 《${item.title}》${author} · ${item.meta} · ${state}`);
    lines.push(item.excerpt.trim());
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export async function readLiveMaterialsBlock(threadId: string): Promise<string> {
  return formatLiveMaterialsBlock(await readLiveMaterials(threadId));
}
