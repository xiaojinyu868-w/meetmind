import type { Metadata } from 'next';
import { AppShell } from '@/components/academic/app-shell';

export const metadata: Metadata = {
  title: '我的陪练 · MeetMind',
};

const NAV = [
  { href: '/learn', label: '我的陪练' },
];

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="learn" nav={NAV} maxWidth="default">
      {children}
    </AppShell>
  );
}
