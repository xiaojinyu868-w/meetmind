/**
 * /apps/zhihu/lesson/[threadId]/review —— 课后：左材料有根、中测验 / 闪卡、右继续看。
 */
import { ZhihuReview } from '@/components/zhihu/ZhihuReview';

export default function ZhihuReviewPage({ params }: { params: { threadId: string } }) {
  return <ZhihuReview threadId={params.threadId} />;
}
