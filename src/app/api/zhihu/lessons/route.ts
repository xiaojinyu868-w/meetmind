/**
 * GET /api/zhihu/lessons —— 我从收藏夹开过的课（最近 20 节）：{ lessons:[{threadId,title,topic,materialsTitle,itemCount,createdAt,updatedAt}] }。
 * 归属来自材料包的 ownerUserId（TeachThread 没有归属列）；线程已删的不列。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listLessonsForUser } from '@/lib/services/zhihu/zhihu-lesson-service';
import { requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  try {
    const lessons = await listLessonsForUser(auth.userId);
    return NextResponse.json({ success: true, lessons });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
