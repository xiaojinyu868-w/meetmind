/**
 * 用户认证 Hook
 * 
 * 提供登录状态管理、用户信息获取、权限检查等功能
 */

'use client';

import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import { db, ANONYMOUS_USER_ID } from '@/lib/db';
import { runMemoryMigration } from '@/lib/services/memory-migration';
import type { User, Permission, AuthResponse, LoginRequest, RegisterRequest, LearnerProfile } from '@/types/user';
import type { LocalWorkspaceMigrationPayload } from '@/lib/services/workspace-context-types';

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

function normalizeText(value: string | null | undefined, limit?: number): string | undefined {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (typeof limit === 'number' && normalized.length > limit) {
    return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
  }
  return normalized;
}

function inferLocalCaptureContentType(session: {
  sourceType?: string;
  mimeType?: string;
  videoUrl?: string;
  videoEmbedUrl?: string;
  videoProvider?: string;
}): string {
  if (session.videoUrl || session.videoEmbedUrl || session.videoProvider) return 'video';
  if (session.sourceType === 'video-link' || session.sourceType === 'video-file') return 'video';
  if (session.mimeType?.startsWith('audio/')) return 'audio';
  if (session.sourceType === 'recording' || session.sourceType === 'upload') return 'audio';
  return 'text';
}

function buildLocalSessionTitle(session: {
  topic?: string;
  subject?: string;
  sourceType?: string;
}): string {
  return (
    normalizeText(session.topic, 80) ||
    normalizeText(session.subject, 80) ||
    (session.sourceType === 'video-link' || session.sourceType === 'video-file'
      ? '导入课堂视频'
      : session.sourceType === 'upload'
        ? '导入课堂音频'
        : '课堂录音')
  );
}

async function buildLocalWorkspaceMigrationPayload(userId: string): Promise<LocalWorkspaceMigrationPayload | null> {
  await runMemoryMigration();

  const [allSessions, allTranscripts, allAnchors, allSummaries, allHighlights, allNotes, allConversations] = await Promise.all([
    db.audioSessions.toArray(),
    db.transcripts.toArray(),
    db.anchors.toArray(),
    db.classSummaries.toArray(),
    db.highlightTopics.toArray(),
    db.notes.toArray(),
    db.conversationHistory.toArray(),
  ]);

  const sessions = allSessions
    .filter((item) => !item.userId || item.userId === ANONYMOUS_USER_ID || item.userId === userId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  if (sessions.length === 0) {
    return null;
  }

  const sessionIds = new Set(sessions.map((item) => item.sessionId));
  const transcriptBySession = new Map<string, typeof allTranscripts>();
  const anchorBySession = new Map<string, typeof allAnchors>();
  const summaryBySession = new Map<string, (typeof allSummaries)[number]>();
  const highlightBySession = new Map<string, typeof allHighlights>();
  const noteBySession = new Map<string, typeof allNotes>();
  const conversationBySession = new Map<string, typeof allConversations>();

  for (const transcript of allTranscripts) {
    if (!sessionIds.has(transcript.sessionId)) continue;
    const bucket = transcriptBySession.get(transcript.sessionId) || [];
    bucket.push(transcript);
    transcriptBySession.set(transcript.sessionId, bucket);
  }

  for (const anchor of allAnchors) {
    if (!sessionIds.has(anchor.sessionId)) continue;
    const bucket = anchorBySession.get(anchor.sessionId) || [];
    bucket.push(anchor);
    anchorBySession.set(anchor.sessionId, bucket);
  }

  for (const summary of allSummaries) {
    if (!sessionIds.has(summary.sessionId)) continue;
    summaryBySession.set(summary.sessionId, summary);
  }

  for (const highlight of allHighlights) {
    if (!sessionIds.has(highlight.sessionId)) continue;
    const bucket = highlightBySession.get(highlight.sessionId) || [];
    bucket.push(highlight);
    highlightBySession.set(highlight.sessionId, bucket);
  }

  for (const note of allNotes) {
    if (!sessionIds.has(note.sessionId)) continue;
    if (note.studentId && note.studentId !== ANONYMOUS_USER_ID && note.studentId !== userId) continue;
    const bucket = noteBySession.get(note.sessionId) || [];
    bucket.push(note);
    noteBySession.set(note.sessionId, bucket);
  }

  for (const conversation of allConversations) {
    if (!conversation.sessionId || !sessionIds.has(conversation.sessionId)) continue;
    if (conversation.userId && conversation.userId !== ANONYMOUS_USER_ID && conversation.userId !== userId) continue;
    const bucket = conversationBySession.get(conversation.sessionId) || [];
    bucket.push(conversation);
    conversationBySession.set(conversation.sessionId, bucket);
  }

  const migratedSessions = sessions
    .map((session) => {
      const transcripts = (transcriptBySession.get(session.sessionId) || []).sort((a, b) => a.startMs - b.startMs);
      const anchors = (anchorBySession.get(session.sessionId) || []).sort((a, b) => a.timestamp - b.timestamp);
      const summary = summaryBySession.get(session.sessionId);
      const highlights = (highlightBySession.get(session.sessionId) || []).sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
      const notes = (noteBySession.get(session.sessionId) || []).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const conversations = (conversationBySession.get(session.sessionId) || []).sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );

      const transcriptText = normalizeText(
        transcripts
          .map((item) => item.text)
          .filter(Boolean)
          .join(' '),
        8000,
      );
      const highlightText = normalizeText(
        highlights
          .map((item) => [item.title, item.description, item.quote?.text].filter(Boolean).join('：'))
          .filter(Boolean)
          .join('；'),
        2000,
      );
      const noteText = normalizeText(notes.map((item) => item.text).filter(Boolean).join('；'), 2000);
      const anchorText = normalizeText(
        anchors
          .map((item) => item.note || item.aiExplanation)
          .filter(Boolean)
          .join('；'),
        1200,
      );
      const conversationText = normalizeText(
        conversations
          .map((item) => item.lastMessage || item.title)
          .filter(Boolean)
          .join('；'),
        1000,
      );

      const summaryTakeaways = summary?.takeaways
        ?.map((item) => `${item.label}：${item.insight}`)
        .filter(Boolean)
        .join('；');
      const summaryStructure = summary?.structure?.filter(Boolean).join('、');
      const summaryDifficulty = summary?.keyDifficulties?.filter(Boolean).join('；');

      const tutorContext = normalizeText(
        [
          summary?.overview ? `课堂概览：${summary.overview}` : '',
          summaryTakeaways ? `关键收获：${summaryTakeaways}` : '',
          summaryDifficulty ? `主要难点：${summaryDifficulty}` : '',
          summaryStructure ? `课堂结构：${summaryStructure}` : '',
          highlightText ? `精选片段：${highlightText}` : '',
          anchorText ? `困惑锚点：${anchorText}` : '',
          noteText ? `我的笔记：${noteText}` : '',
          conversationText ? `同学对话：${conversationText}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        12000,
      );

      const previewText =
        normalizeText(summary?.overview, 220) ||
        noteText ||
        highlightText ||
        transcriptText ||
        anchorText;

      const title = buildLocalSessionTitle(session);

      if (!previewText && !tutorContext && !transcriptText && !session.mediaUrl && !session.videoUrl) {
        return null;
      }

      return {
        sessionId: session.sessionId,
        title,
        contentType: inferLocalCaptureContentType(session),
        role: 'primary',
        previewText,
        normalizedText: transcriptText,
        tutorContext,
        sourceUrl: session.videoUrl || undefined,
        mediaUrl: session.mediaUrl || session.videoEmbedUrl || undefined,
        occurredAt: session.createdAt.toISOString(),
        metadata: {
          sourceType: session.sourceType || 'recording',
          mimeType: session.mimeType,
          duration: session.duration,
          topic: session.topic,
          subject: session.subject,
          transcriptCount: transcripts.length,
          anchorCount: anchors.length,
          highlightCount: highlights.length,
          noteCount: notes.length,
          conversationCount: conversations.length,
          importSourceMode: session.importSourceMode,
          thumbnailUrl: session.thumbnailUrl,
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (migratedSessions.length === 0) {
    return null;
  }

  return {
    sessions: migratedSessions,
  };
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
            setIsCheckingAuth(false);
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

    void (async () => {
      try {
        const payload = await buildLocalWorkspaceMigrationPayload(userId);
        if (!payload || payload.sessions.length === 0) {
          return;
        }

        // 分批推送：避免单次 payload 过大导致 nginx/Node 拒绝（服务端上限 8MB / 50 sessions）
        // 这里按 session 数切片，每批 20，体积一般稳在 2-4MB 内
        const BATCH_SIZE = 20;
        const sessions = payload.sessions;
        let success = true;

        for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = sessions.slice(i, i + BATCH_SIZE);
          try {
            const response = await fetch('/api/workspace/local-migration', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ sessions: batch }),
            });

            if (!response.ok) {
              success = false;
              // 413（payload 过大）说明单批仍然太大，进一步降级到每批 5
              if (response.status === 413 && BATCH_SIZE > 5) {
                for (let j = 0; j < batch.length; j += 5) {
                  if (cancelled) break;
                  const smaller = batch.slice(j, j + 5);
                  try {
                    await fetch('/api/workspace/local-migration', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                      },
                      body: JSON.stringify({ sessions: smaller }),
                    });
                  } catch {
                    // 单批降级也失败，记下后继续，不阻断整体
                  }
                }
              }
              // 其他错误不中断，继续下一批
            }
          } catch {
            success = false;
            // 网络错误或进程重启造成的中断，继续下一批，下次登录会重试
          }
        }

        if (!success && !cancelled) {
          // 整体没全部成功，下次登录允许重试
          localWorkspaceMigrationRef.current = null;
        }
      } catch {
        if (!cancelled) {
          localWorkspaceMigrationRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.accessToken, state.isAuthenticated, state.user?.id]);

  // 刷新令牌
  const refreshTokenInternal = async (): Promise<boolean> => {
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
