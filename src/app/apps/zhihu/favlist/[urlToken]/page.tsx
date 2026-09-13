/**
 * /apps/zhihu/favlist/[urlToken] —— 一个收藏夹：同学读过之后分成几条线，每篇一个「讲这篇」。
 */
import { ZhihuFavlist } from '@/components/zhihu/ZhihuFavlist';

export default function ZhihuFavlistPage({ params }: { params: { urlToken: string } }) {
  return <ZhihuFavlist urlToken={params.urlToken} />;
}
