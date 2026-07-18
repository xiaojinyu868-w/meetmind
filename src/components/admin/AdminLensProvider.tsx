'use client';

import * as React from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

const ADMIN_LENS_SESSION_KEY = 'meetmind_admin_lens_enabled';

interface AdminLensContextValue {
  isAdmin: boolean;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

const AdminLensContext = React.createContext<AdminLensContextValue | null>(null);

export function AdminLensProvider({ children }: { children: React.ReactNode }) {
  const { user, isCheckingAuth } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [enabled, setEnabledState] = React.useState(false);

  React.useEffect(() => {
    if (isCheckingAuth) return;
    if (!isAdmin) {
      setEnabledState(false);
      try {
        sessionStorage.removeItem(ADMIN_LENS_SESSION_KEY);
      } catch {
        // Storage can be unavailable in private or restricted browser contexts.
      }
      return;
    }

    try {
      setEnabledState(sessionStorage.getItem(ADMIN_LENS_SESSION_KEY) === '1');
    } catch {
      setEnabledState(false);
    }
  }, [isAdmin, isCheckingAuth, user?.id]);

  const setEnabled = React.useCallback((nextEnabled: boolean) => {
    if (!isAdmin) return;
    setEnabledState(nextEnabled);
    try {
      sessionStorage.setItem(ADMIN_LENS_SESSION_KEY, nextEnabled ? '1' : '0');
    } catch {
      // The in-memory state still keeps the current page usable.
    }
  }, [isAdmin]);

  const toggle = React.useCallback(() => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  const value = React.useMemo<AdminLensContextValue>(() => ({
    isAdmin,
    enabled: isAdmin && enabled,
    setEnabled,
    toggle,
  }), [enabled, isAdmin, setEnabled, toggle]);

  return <AdminLensContext.Provider value={value}>{children}</AdminLensContext.Provider>;
}

export function useAdminLens(): AdminLensContextValue {
  const context = React.useContext(AdminLensContext);
  if (!context) throw new Error('useAdminLens must be used within an AdminLensProvider');
  return context;
}
