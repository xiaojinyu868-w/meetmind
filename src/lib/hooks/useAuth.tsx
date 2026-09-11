/**
 * 用户认证 Hook
 * 
 * 提供登录状态管理、用户信息获取、权限检查等功能
 */

'use client';

import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import { scheduleTokenRefresh } from '@/lib/hooks/token-refresh-scheduler';
import { runLocalWorkspaceMigration } from '@/lib/services/local-workspace-migration';
import type { User, Permission, AuthResponse, LoginRequest, RegisterRequest, LearnerProfile } from '@/types/user';

// ==================== 类型定义 ====================

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  permissions: Permission[];
  accessToken: string | null;
}

interface LoginWithCodeRequest {
  target: string;
  code: string;
  type: 'email' | 'sms';
  rememberMe?: boolean;
}

interface AuthContextValue extends AuthState {
  login: (request: LoginRequest) => Promise<AuthResponse>;
  loginWithCode: (request: LoginWithCodeRequest) => Promise<AuthResponse>;
  register: (request: RegisterRequest) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  updateProfile: (data: Partial<User>) => Promise<boolean>;
  saveLearnerProfile: (profile: LearnerProfile) => Promise<boolean>;
  hasPermission: (permission: Permission) => boolean;
  getWechatAuthUrl: () => Promise<string | null>;
  onboardingCompleted: boolean;
  isCheckingAuth: boolean;
}

// ==================== Context ====================

const AuthContext = createContext<AuthContextValue | null>(null);

// ==================== 本地存储 ====================

const TOKEN_KEY = 'meetmind_access_token';
const LEGACY_TOKEN_KEY = 'auth_token';
const LEGACY_REFRESH_TOKEN_KEY = 'refresh_token';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
}

/** 客户端任意 service 同源调 /api/* 时用来带 auth token（避开 middleware 401） */
export function readStoredAccessToken(): string | null {
  return getStoredToken();
}

function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
  }
}

/** 扫码登录等同源认证流程成功后写入统一 access token。 */
export function writeStoredAccessToken(token: string): void {
  setStoredToken(token);
}

// ==================== Provider ====================

export function AuthProvider({ children }: { children: ReactNode }) {
  // 性能优化：isLoading 默认 false，不阻塞 UI 渲染
  // 登录页会自行处理已登录用户的跳转
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    permissions: [],
    accessToken: null,
  });
  const localWorkspaceMigrationRef = useRef<string | null>(null);
  
  // Performance: Synchronously check token presence to avoid unnecessary async work.
  // If no token and no wechat session param, mark auth check complete immediately.
  const [isCheckingAuth, setIsCheckingAuth] = useState(() => {
    if (typeof window === 'undefined') return true;
    const hasSession = new URLSearchParams(window.location.search).has('session');
    const hasToken = !!getStoredToken();
    return hasSession || hasToken;
  });

  // 处理微信登录回调的临时会话
  const handleWechatSession = async (sessionToken: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/wechat/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken }),
      });
      
      if (!response.ok) return false;
      
      const data = await response.json();
      
      if (data.success && data.accessToken) {
        setStoredToken(data.accessToken);
        
        // 获取用户信息
        const userResponse = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${data.accessToken}` },
        });
        
        if (userResponse.ok) {
          const userData = await userResponse.json();
          if (userData.success && userData.user) {
            setState({
              user: userData.user,
              isLoading: false,
              isAuthenticated: true,
              permissions: userData.permissions || [],
              accessToken: data.accessToken,
            });
            return true;
          }
        }
      }
      
      return false;
    } catch {
      return false;
    }
  };

  // 初始化 - 检查登录状态（非阻塞）
  // Performance: Skip entirely when isCheckingAuth was already set to false synchronously.
  useEffect(() => {
    if (!isCheckingAuth) return; // No token & no session → nothing to check

    const initAuth = async () => {
      // 检查 URL 中是否有微信登录的临时会话 token
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionToken = urlParams.get('session');
        
        if (sessionToken) {
          // 清除 URL 参数
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('session');
          window.history.replaceState({}, '', newUrl.toString());
          
          // 交换临时会话获取 accessToken
          const success = await handleWechatSession(sessionToken);
          if (success) {
            setIsCheckingAuth(false);
            return;
          }
        }
      }
      
      const token = getStoredToken();
      
      if (!token) {
        setIsCheckingAuth(false);
        return;
      }
      
      // 只有服务端明确说"这个令牌不行"（401 / 403）才清 token；断网、请求被导航打断、部署瞬间的 5xx
      // 都不是令牌的问题——此前 catch 里一律 setStoredToken(null)，用户断网时打开页面就被登出（2026-09-10 修）。
      const fetchMe = () => fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
        try {
          const candidate = await fetchMe();
          // 5xx：服务端在重载 / 出错，等一下再试一次，不当作令牌失效
          if (candidate.status >= 500 && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }
          response = candidate;
        } catch (error) {
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }
          console.warn('初始化认证：网络不可用，保留令牌下次再试', error);
        }
      }

      if (response?.ok) {
        try {
          const data = await response.json();
          if (data.success && data.user) {
            setState({
              user: data.user,
              isLoading: false,
              isAuthenticated: true,
              permissions: data.permissions || [],
              accessToken: token,
            });
            setIsCheckingAuth(false);
            return;
          }
        } catch (error) {
          console.warn('初始化认证：响应无法解析，保留令牌', error);
        }
      }

      if (response && (response.status === 401 || response.status === 403)) {
        // 令牌无效或过期：先刷新；刷新也被明确拒绝才清掉
        const refreshed = await refreshTokenInternal();
        if (!refreshed) setStoredToken(null);
      }
      // 其余情况（断网 / 5xx / 非法响应）：token 留在本地，这一次以未登录态渲染，下次加载再试
      
      setIsCheckingAuth(false);
    };
    
    initAuth();
  }, [isCheckingAuth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!state.isAuthenticated || !state.accessToken || !state.user?.id) return;

    const userId = state.user.id;
    const accessToken = state.accessToken;
    const migrationKey = userId;
    if (localWorkspaceMigrationRef.current === migrationKey) return;
    localWorkspaceMigrationRef.current = migrationKey;

    let cancelled = false;

    // 本机课堂历史 → 账号：只推证据签名变过的课（抽到 local-workspace-migration service，2026-09-11）。
    // 此前每次页面加载全量重推全部 audioSessions；现在推成功的课记签名，下次加载没变化就零请求。
    void runLocalWorkspaceMigration({ userId, accessToken, isCancelled: () => cancelled })
      .then((result) => {
        if (cancelled) return;
        // 有失败的批（网络 / 5xx）：允许下次登录态就绪时重试；全部成功或无需推送则本次会话不再跑
        if (result.failed > 0) {
          localWorkspaceMigrationRef.current = null;
        }
      })
      .catch(() => {
        if (!cancelled) {
          localWorkspaceMigrationRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.accessToken, state.isAuthenticated, state.user?.id]);

  // 刷新令牌
  const refreshTokenInternal = useCallback(async (): Promise<boolean> => {
    try {
      const legacyRefreshToken = typeof window === 'undefined'
        ? null
        : localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY);

      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: legacyRefreshToken ? { 'Content-Type': 'application/json' } : undefined,
        body: legacyRefreshToken ? JSON.stringify({ refreshToken: legacyRefreshToken }) : undefined,
      });

      if (!response.ok) return false;

      const data: AuthResponse = await response.json();

      if (data.success && data.accessToken && data.user) {
        setStoredToken(data.accessToken);
        setState({
          user: data.user,
          isLoading: false,
          isAuthenticated: true,
          permissions: [], // 从新令牌解析
          accessToken: data.accessToken,
        });
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }, []);

  // 访问令牌主动续期：按 JWT exp 提前 5 分钟刷新（此前只在页面初始化时 refresh，
  // 会话中途过期后积分/会员接口 401、tutor 把付费用户当免费档——"付了费 Pro 不可用"）。
  // 刷新成功后 accessToken 变更，本 effect 自动按新 token 重排下次调度。
  useEffect(() => {
    if (!state.isAuthenticated || !state.accessToken) return;
    return scheduleTokenRefresh(state.accessToken, refreshTokenInternal);
  }, [state.isAuthenticated, state.accessToken, refreshTokenInternal]);

  // 登录
  const login = useCallback(async (request: LoginRequest): Promise<AuthResponse> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        credentials: 'include',
      });
      
      const data: AuthResponse = await response.json();
      
      if (data.success && data.accessToken && data.user) {
        setStoredToken(data.accessToken);
        setState({
          user: data.user,
          isLoading: false,
          isAuthenticated: true,
          permissions: [],
          accessToken: data.accessToken,
        });
      }
      
      return data;
    } catch {
      return { success: false, error: '网络错误' };
    }
  }, []);

  // 验证码登录
  const loginWithCode = useCallback(async (request: LoginWithCodeRequest): Promise<AuthResponse> => {
    try {
      const response = await fetch('/api/auth/login-with-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        credentials: 'include',
      });
      
      const data: AuthResponse = await response.json();
      
      if (data.success && data.accessToken && data.user) {
        setStoredToken(data.accessToken);
        setState({
          user: data.user,
          isLoading: false,
          isAuthenticated: true,
          permissions: [],
          accessToken: data.accessToken,
        });
      }
      
      return data;
    } catch {
      return { success: false, error: '网络错误' };
    }
  }, []);

  // 注册
  const register = useCallback(async (request: RegisterRequest): Promise<AuthResponse> => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        credentials: 'include',
      });
      
      const data: AuthResponse = await response.json();
      
      if (data.success && data.accessToken && data.user) {
        setStoredToken(data.accessToken);
        setState({
          user: data.user,
          isLoading: false,
          isAuthenticated: true,
          permissions: [],
          accessToken: data.accessToken,
        });
      }
      
      return data;
    } catch {
      return { success: false, error: '网络错误' };
    }
  }, []);

  // 登出
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // 忽略错误
    }
    
    setStoredToken(null);
    localWorkspaceMigrationRef.current = null;
    setState({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      permissions: [],
      accessToken: null,
    });
  }, []);

  // 刷新令牌（直接暴露内部实现，本身已是 useCallback 稳定引用）
  const refreshToken = refreshTokenInternal;

  // 更新资料
  const updateProfile = useCallback(async (data: Partial<User>): Promise<boolean> => {
    if (!state.accessToken) return false;
    
    try {
      const response = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (result.success && result.user) {
        setState(prev => ({ ...prev, user: result.user }));
        return true;
      }
      
      return false;
    } catch {
      return false;
    }
  }, [state.accessToken]);

  // 检查权限
  const hasPermission = useCallback((permission: Permission): boolean => {
    return state.permissions.includes(permission);
  }, [state.permissions]);

  // 获取微信授权 URL
  const getWechatAuthUrl = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/auth/wechat');
      const data = await response.json();
      return data.success ? data.authUrl : null;
    } catch {
      return null;
    }
  }, []);

  // 保存学习者画像
  const saveLearnerProfile = useCallback(async (profile: LearnerProfile): Promise<boolean> => {
    if (!state.accessToken) return false;

    try {
      const response = await fetch('/api/auth/learner-profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify(profile),
      });

      const result = await response.json();

      if (result.success && result.user) {
        setState(prev => ({ ...prev, user: result.user }));
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }, [state.accessToken]);

  const onboardingCompleted = !!state.user?.onboardingCompletedAt;

  const value: AuthContextValue = {
    ...state,
    login,
    loginWithCode,
    register,
    logout,
    refreshToken,
    updateProfile,
    saveLearnerProfile,
    hasPermission,
    getWechatAuthUrl,
    onboardingCompleted,
    isCheckingAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ==================== Hook ====================

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default useAuth;
