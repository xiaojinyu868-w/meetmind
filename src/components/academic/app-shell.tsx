'use client';

/**
 * AppShell: /console /teacher /learn 三端共享的外壳。
 *
 * 三件事：
 *  1. 统一顶栏布局：左品牌 + 中导航 + 右身份菜单
 *  2. 通过身份菜单让用户在"机构主 / 老师 / 学生"三端切换
 *  3. 把登录门拦在外壳里（AcademicAuthGate）
 *
 * 不同端传不同的 role + nav，但视觉完全一致。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { AcademicAuthGate } from './academic-auth-gate';
import { academicFetch } from './academic-client';

export type ShellRole = 'console' | 'learn';

export interface NavItem {
  href: string;
  label: string;
  /** 额外前缀匹配（active 判断），如 /console/scenarios/[id] 也要高亮"场景" */
  matchPrefix?: string;
}

export interface AppShellProps {
  role: ShellRole;
  brand?: string;
  nav: NavItem[];
  maxWidth?: 'default' | 'wide';
  children: ReactNode;
}

const ROLE_LABEL: Record<ShellRole, string> = {
  console: '机构主视角',
  learn: '学生视角',
};

const ROLE_BRAND: Record<ShellRole, string> = {
  console: 'MeetMind · Console',
  learn: 'MeetMind · Learn',
};

interface OrgSummary {
  orgId: string;
  role: 'owner' | 'consultant' | 'teacher' | 'student';
  org: { id: string; name: string };
}

export function AppShell({ role, brand, nav, maxWidth = 'default', children }: AppShellProps) {
  const brandText = brand ?? ROLE_BRAND[role];
  const maxCls = maxWidth === 'wide' ? 'max-w-7xl' : 'max-w-5xl';

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <TopBar role={role} brandText={brandText} nav={nav} maxCls={maxCls} />
      <main className={`mx-auto w-full px-6 py-8 ${maxCls}`}>
        <AcademicAuthGate>{children}</AcademicAuthGate>
      </main>
    </div>
  );
}

function TopBar({
  role,
  brandText,
  nav,
  maxCls,
}: {
  role: ShellRole;
  brandText: string;
  nav: NavItem[];
  maxCls: string;
}) {
  const pathname = usePathname() ?? '';
  return (
    <header className="sticky top-0 z-20 border-b border-divider bg-card">
      <div className={`mx-auto flex h-14 items-center justify-between gap-6 px-6 ${maxCls}`}>
        <a href={homeOf(role)} className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-ink">
          <span className="inline-block h-5 w-5 rounded-sm bg-ink" aria-hidden />
          <span>{brandText}</span>
        </a>
        <nav className="flex flex-1 items-center justify-center gap-1">
          {nav.map((item) => {
            const active =
              pathname === item.href ||
              (item.matchPrefix && pathname.startsWith(item.matchPrefix)) ||
              (item.href !== homeOf(role) && pathname.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-1.5 text-sm transition-colors ${
                  active ? 'bg-hover text-ink' : 'text-ink-secondary hover:bg-hover hover:text-ink'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <IdentityMenu role={role} />
      </div>
    </header>
  );
}

function homeOf(role: ShellRole): string {
  if (role === 'console') return '/console';
  return '/learn';
}

function IdentityMenu({ role }: { role: ShellRole }) {
  const { isAuthenticated, accessToken, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || orgs !== null) return;
    academicFetch<{ orgs: OrgSummary[] }>('/api/console/orgs/me', { accessToken })
      .then((res) => setOrgs(res.orgs))
      .catch(() => setOrgs([]));
  }, [isAuthenticated, accessToken, orgs]);

  if (!isAuthenticated) {
    return <div className="text-xs text-ink-muted">未登录</div>;
  }

  const primary = orgs?.[0];
  const canSwitch = (r: ShellRole) => {
    if (!primary) return r === 'console';
    if (r === 'console') return primary.role === 'owner' || primary.role === 'consultant' || primary.role === 'teacher';
    return true; // learn 所有角色都能进
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded border border-divider bg-card px-2.5 py-1.5 text-xs hover:border-ink"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[10px] font-medium text-card">
          {(user?.nickname || user?.username || '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-[8rem] truncate text-ink">{user?.nickname || user?.username}</span>
        <span className="text-ink-muted">· {ROLE_LABEL[role]}</span>
        <span className="text-ink-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 rounded-lg border border-divider bg-card py-1 text-xs">
          <div className="px-3 py-2 text-ink-muted">
            {primary ? (
              <>
                当前机构：<span className="text-ink">{primary.org.name}</span>
                <div className="mt-0.5">你的角色：{primary.role}</div>
              </>
            ) : (
              <>未绑定任何机构</>
            )}
          </div>
          <div className="my-1 border-t border-divider" />
          <div className="px-3 py-1 text-ink-muted">切换视角</div>
          {(['console', 'learn'] as ShellRole[]).map((r) => {
            const enabled = canSwitch(r);
            const active = r === role;
            return (
              <a
                key={r}
                href={enabled ? homeOf(r) : undefined}
                className={`flex items-center justify-between px-3 py-1.5 ${
                  active ? 'bg-hover text-ink' : enabled ? 'text-ink hover:bg-hover' : 'text-ink-muted cursor-not-allowed'
                }`}
                onClick={(e) => {
                  if (!enabled) e.preventDefault();
                }}
              >
                <span>{ROLE_LABEL[r]}</span>
                {active && <span className="text-ink-muted">当前</span>}
                {!enabled && <span className="text-ink-muted">权限不足</span>}
              </a>
            );
          })}
          <div className="my-1 border-t border-divider" />
          <button
            type="button"
            onClick={async () => {
              await logout();
              window.location.href = homeOf(role);
            }}
            className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-light"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
