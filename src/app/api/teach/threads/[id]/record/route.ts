/**
 * GET /api/teach/threads/[id]/record —— 这节 live 课的 LessonRecord（薄路由）。
 *
 * 客户端拿它把课存成一节课（IndexedDB audioSessions + transcripts），进课堂列表、走录音课同一个复习页；
 * 复习页也拿它显示这节课的材料与之前相关课的一行摘要。事件日志是唯一事实源，每次现算，不落快照。
 * 需要登录；材料包写了 ownerUserId 的（收藏夹课）只有本人能拿；没写的（/teach/live 自己开的课，TeachThread 没有归属列）任何登录用户可读——与 events 路由现状一致。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getThread, readThreadEvents } from '@/lib/services/teach-codex/thread-store';
import { readLiveMaterials } from '@/lib/services/teach-live/live-materials';
import { buildLessonRecord } from '@/lib/services/teach-live/lesson-record';
import { getUserIdFromRequest } from '@/lib/utils/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ success: false, error: 'unauthorized', message: '请先登录' }, { status: 401 });
  const thread = await getThread(params.id);
  if (!thread) return NextResponse.json({ success: false, error: 'not_found', message: '课程不存在' }, { status: 404 });
  if (thread.engine !== 'live') return NextResponse.json({ success: false, error: 'not_live', message: '只有 live 课能物化成一节课' }, { status: 400 });
  const pack = await readLiveMaterials(thread.id);
  if (pack?.ownerUserId && pack.ownerUserId !== userId) {
    return NextResponse.json({ success: false, error: 'forbidden', message: '这不是你的课' }, { status: 403 });
  }
  const events = await readThreadEvents(thread.id);
  const record = buildLessonRecord(thread, events, pack);
  return NextResponse.json({ success: true, record }, { headers: { 'Cache-Control': 'no-store' } });
}
