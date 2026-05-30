/**
 * /share/[token]/page.tsx — SharedAgent 公开落地页（v3.0）
 *
 * 路由：/share/{token}
 *
 * 入口：分享者把链接发到班级群后，任何人点开都进这里。
 * - 匿名可读 / 可对话
 * - 登录后才能领取到自己的 workspace
 *
 * 详细结构在 SharedAgentLanding 里。这层只做 next 路由壳。
 */

import type { Metadata } from 'next';
import { SharedAgentLanding } from './SharedAgentLanding';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'MeetMind · 一份课堂分享',
  description: '一位同学听完这节课后递给你的内容——可以直接读，也可以问问题。',
};

interface SharedPageProps {
  params: Promise<{ token: string }>;
}

export default async function Page({ params }: SharedPageProps) {
  const { token } = await params;
  return <SharedAgentLanding token={token} />;
}
