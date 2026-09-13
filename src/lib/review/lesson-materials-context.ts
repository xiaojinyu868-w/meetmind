/**
 * 复习页的附件层（与来源无关）：一节同学讲的课，材料包里那几篇怎么给复习同桌看。
 *
 * 边界（docs/plans/2026-09-13-material-lessons.md）：
 * - 只放这节课点名的几篇（record.materials），收藏夹 / 收集流里别的不进
 * - 每篇节选已由 record 按 MATERIAL_EXCERPT_CAP 截过，这里再管合计上限，超了从排后的篇目开始只留标题
 * - 之前相关的课只进一行摘要（priorLessons），永远不带转录
 * - 每块带标签（材料 A1 / 之前的课），同桌引用时用标签——"有根"靠这个
 */

import type { LessonRecord } from '@/lib/services/teach-live/lesson-record';

/** 附件层合计预算（字符；≈ 6K token） */
export const LESSON_MATERIALS_CONTEXT_CAP = 9000;

export function coverageLabel(coverage: 'full-text' | 'outline' | 'summary'): string {
  if (coverage === 'full-text') return '老师读了全文';
  if (coverage === 'outline') return '老师读了带目录的骨架';
  return '老师只有摘要';
}

export function formatLessonMaterialsForTutor(record: LessonRecord, cap = LESSON_MATERIALS_CONTEXT_CAP): string {
  const materials = record.materials;
  if (!materials || materials.items.length === 0) return '';
  const lines: string[] = [];
  const unit = materials.mode === 'single' ? '这节课讲的是学生收藏的这一篇' : materials.mode === 'theme' ? `这节课讲的是学生收藏里的一条线（${materials.items.length} 篇）` : `这节课的材料来自学生收藏夹「${materials.title}」（${materials.items.length} 篇）`;
  lines.push(`${unit}。老师口播里说的「材料 1」= 下面的 A1，依此类推。转录里每段话的 [来源] 标的也是这个编号。`);
  if (materials.pickReason) lines.push(`这篇是同学替学生挑的：${materials.pickReason}`);
  let used = lines.join('\n').length;
  for (const item of materials.items) {
    const head = `[材料 ${item.ref}]《${item.title}》${item.author ? ` · ${item.author}` : ''} · ${item.meta} · ${coverageLabel(item.coverage)}${item.mentioned ? '' : '（老师这节课还没讲到它）'}\n原文：${item.url}`;
    const body = item.excerpt.trim();
    const room = cap - used - head.length - 2;
    if (room <= 200 || !body) {
      lines.push(head + (body ? '\n（篇幅所限，这篇只给标题；学生要问细节让 TA 点原文）' : ''));
      used += head.length + 2;
      continue;
    }
    const clipped = body.length > room ? `${body.slice(0, room).trimEnd()}\n……（略）` : body;
    lines.push(`${head}\n${clipped}`);
    used += head.length + clipped.length + 2;
  }
  if (record.priorLessons.length) {
    lines.push(`【之前相关的课】${record.priorLessons.slice(0, 5).map((l) => `《${l.title}》（${l.createdAt.slice(0, 10)}）`).join('、')}——只知道上过，具体讲了什么以这节课的转录为准。`);
  }
  if (materials.skipped.length) {
    lines.push(`【没进这节课的】${materials.skipped.map((s) => `${s.title}（${s.reason}）`).join('；')}`);
  }
  return lines.join('\n\n');
}
