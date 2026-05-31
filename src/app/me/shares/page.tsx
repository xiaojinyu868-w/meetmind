import type { Metadata } from 'next';
import MyShareList from './MyShareList';

export const metadata: Metadata = {
  title: '我的分享 · MeetMind',
};

/**
 * /me/shares —— 列出我创建的所有 SharedAgent，提供撤销 / 复制链接 / 看落地页（v3.0 闭环管理面）
 */
export default function MySharesPage() {
  return <MyShareList />;
}
