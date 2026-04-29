import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '老师视图 · MeetMind',
};

// /teacher 已合并到 /console；此 layout 仅保留 redirect children 能正常渲染。
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
