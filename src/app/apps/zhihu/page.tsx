/**
 * /apps/zhihu —— 知乎线第一屏：用知乎登录 → 选一个收藏夹 → 开课。
 * 独立 Application 入口（09-08 新生方案 §2.5 的样板路径），页面只是壳，逻辑在 components/zhihu/ZhihuEntry。
 */
import { ZhihuEntry } from '@/components/zhihu/ZhihuEntry';

export const metadata = {
  title: '从一个收藏夹开始 · MeetMind',
  description: '你在知乎收藏过的，让同学讲给你听。',
};

export default function ZhihuAppPage() {
  return <ZhihuEntry />;
}
