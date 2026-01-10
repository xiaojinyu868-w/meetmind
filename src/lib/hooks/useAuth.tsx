/**
 * 用户认证 Hook
 * 
 * 提供登录状态管理、用户信息获取、权限检查等功能
 */

'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import type { User, Permission, AuthResponse, LoginRequest, RegisterRequest } from '@/types/user';

// ==================== 类型定义 ====================

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  permissions: Permission[];
  accessToken: string | null;
}

interface AuthContextValue extends AuthState {
  login: (request: LoginRequest) => Promise<AuthResponse>;
  register: (request: RegisterRequest) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  updateProfile: (data: Partial<User>) => Promise<boolean>;
  hasPermission: (permission: Permission) => boolean;
  getWechatAuthUrl: () => Promise<string | null>;
}

// ==================== Context ====================

const AuthContext = createContext<AuthContextValue | null>(null);

// ==================== 本地存储 ====================

const TOKEN_KEY = 'meetmind_access_token';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// ==================== Provider ====================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    permissions: [],
    accessToken: null,
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

  // 初始化 - 检查登录状态
  useEffect(() => {
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
          if (success) return;
        }
      }
      
      const token = getStoredToken();
      
      if (!token) {
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }
      
      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.user) {
            setState({
              user: data.user,
              isLoading: false,
              isAuthenticated: true,
              permissions: data.permissions || [],
              accessToken: token,
            });
            return;
          }
        }
        
        // 令牌无效，尝试刷新
        const refreshed = await refreshTokenInternal();
        if (!refreshed) {
          setStoredToken(null);
        }
      } catch (error) {
        console.error('初始化认证失败:', error);
        setStoredToken(null);
      }
      
      setState(prev => ({ ...prev, isLoading: false }));
    };
    
    initAuth();
  }, []);

  // 刷新令牌
  const refreshTokenInternal = async (): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
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
  };

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
    } catch (error) {
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
    } catch (error) {
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
    setState({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      permissions: [],
      accessToken: null,
    });
  }, []);

  // 刷新令牌
  const refreshToken = useCallback(async (): Promise<boolean> => {
    return refreshTokenInternal();
  }, []);

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

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    refreshToken,
    updateProfile,
    hasPermission,
    getWechatAuthUrl,
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
