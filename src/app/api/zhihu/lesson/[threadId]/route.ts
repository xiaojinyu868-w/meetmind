/**
 * GET /api/zhihu/lesson/[threadId] —— 这节课的材料包（给课堂页右侧「这节课的材料」与课后出题 / 继续看用）。
 * 只读文件，不查知乎；线程不存在或不是知乎线开的（没有材料包）→ 404。
 */
import { NextRequest, NextResponse } from 'next/server';
import { readLiveMaterials } from '@/lib/services/teach-live/live-materials';
import { getThread } from '@/lib/services/teach-codex/thread-store';
import { requireUser } from '../../zhihu-route-utils';

export async function GET(request: NextRequest, { params }: { params: { threadId: string } }) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const { threadId } = params;
  if (!threadId || !/^[a-zA-Z0-9_-]+$/.test(threadId)) {
    return NextResponse.json({ success: false, error: 'bad_request', message: '线程 id 不合法' }, { status: 400 });
  }
  const [thread, pack] = await Promise.all([getThread(threadId), readLiveMaterials(threadId)]);
  if (!thread || !pack) {
    return NextResponse.json({ success: false, error: 'lesson_not_found', message: '这节课不存在，或不是从收藏夹开的' }, { status: 404 });
  }
  return NextResponse.json({ success: true, thread: { id: thread.id, title: thread.title, topic: thread.topic, engine: thread.engine }, pack });
}
