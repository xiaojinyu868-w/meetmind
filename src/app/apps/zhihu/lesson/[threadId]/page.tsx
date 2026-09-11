/**
 * /apps/zhihu/lesson/[threadId] —— 收藏夹开出来的那节课（teach-live 舞台 + 材料 / 考一考 / 继续看侧栏）。
 */
import { ZhihuLesson } from '@/components/zhihu/ZhihuLesson';

export default function ZhihuLessonPage({ params }: { params: { threadId: string } }) {
  return <ZhihuLesson threadId={params.threadId} />;
}
