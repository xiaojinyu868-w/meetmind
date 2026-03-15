/**
 * 数据分析服务
 * 
 * 提供轻量级的用户行为数据收集和统计功能
 * - 会话管理：创建、更新、结束会话
 * - 页面追踪：记录页面访问和停留时长
 * - 事件追踪：记录用户关键交互行为
 * - 统计查询：新用户数、DAU、时长分布等
 */

import prisma from '@/lib/prisma';

let analyticsStorageEnabled = true;

function isMissingAnalyticsTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code !== 'P2021') return false;

  const meta = (error as { meta?: { modelName?: unknown } }).meta;
  const modelName = typeof meta?.modelName === 'string' ? meta.modelName : '';
  if (!modelName) return true;

  return ['UserAnalytics', 'PageView', 'EventTrack'].includes(modelName);
}

function handleAnalyticsError(scope: string, error: unknown) {
  if (isMissingAnalyticsTableError(error)) {
    if (analyticsStorageEnabled) {
      analyticsStorageEnabled = false;
      console.warn('[Analytics] Analytics tables are missing. Analytics write/query has been disabled for this runtime.');
    }
    return;
  }

  console.error(`[Analytics] Failed to ${scope}:`, error);
}

function canUseAnalyticsStorage() {
  return analyticsStorageEnabled;
}

// ==================== 类型定义 ====================

export interface CreateSessionParams {
  sessionToken: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  entryPage?: string;
  isNewUser?: boolean;
}

export interface UpdateSessionParams {
  sessionToken: string;
  durationMs?: number;
  exitPage?: string;
  endSession?: boolean;
}

export interface PageViewParams {
  sessionToken: string;
  path: string;
  durationMs?: number;
  referrer?: string;
}

export interface EventParams {
  sessionToken: string;
  eventName: string;
  eventCategory?: string;
  eventData?: Record<string, unknown>;
}

export interface StatsQuery {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
}

export interface AnalyticsStats {
  // 用户统计
  totalUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  
  // 活跃度统计
  dauToday: number;
  dauYesterday: number;
  wau: number;
  mau: number;
  
  // 时长统计
  avgSessionDuration: number;
  totalSessionDuration: number;
  
  // 会话统计
  totalSessions: number;
  sessionsToday: number;
  
  // 页面统计
  topPages: Array<{ path: string; views: number }>;
  
  // 事件统计
  topEvents: Array<{ eventName: string; count: number }>;
}

// ==================== 会话管理 ====================

/**
 * 创建新的分析会话
 */
export async function createSession(params: CreateSessionParams) {
  if (!canUseAnalyticsStorage()) return null;
  const { sessionToken, userId, ip, userAgent, entryPage, isNewUser } = params;
  
  try {
    // 检查会话是否已存在
    const session = await prisma.userAnalytics.upsert({
      where: { sessionToken },
      update: {
        userId,
        ip,
        userAgent,
        entryPage,
        isNewUser: isNewUser ?? undefined,
      },
      create: {
        sessionToken,
        userId,
        ip,
        userAgent,
        entryPage,
        isNewUser: isNewUser ?? false,
        startedAt: new Date(),
      }
    });
    
    return session;
  } catch (error) {
    handleAnalyticsError('create session', error);
    return null;
  }
}

/**
 * 更新会话信息（心跳上报）
 */
export async function updateSession(params: UpdateSessionParams) {
  if (!canUseAnalyticsStorage()) return null;
  const { sessionToken, durationMs, exitPage, endSession } = params;
  
  try {
    const updateData: Record<string, unknown> = {};
    
    if (durationMs !== undefined) {
      updateData.durationMs = durationMs;
    }
    
    if (exitPage) {
      updateData.exitPage = exitPage;
    }
    
    if (endSession) {
      updateData.endedAt = new Date();
    }
    
    const session = await prisma.userAnalytics.update({
      where: { sessionToken },
      data: updateData as { durationMs?: number; exitPage?: string; endedAt?: Date }
    });
    
    return session;
  } catch (error) {
    handleAnalyticsError('update session', error);
    return null;
  }
}

/**
 * 根据 sessionToken 获取会话
 */
export async function getSession(sessionToken: string) {
  if (!canUseAnalyticsStorage()) return null;
  try {
    return await prisma.userAnalytics.findUnique({
      where: { sessionToken },
      include: {
        pageViews: true,
        events: true,
      }
    });
  } catch (error) {
    handleAnalyticsError('get session', error);
    return null;
  }
}

// ==================== 页面追踪 ====================

/**
 * 记录页面访问
 */
export async function trackPageView(params: PageViewParams) {
  if (!canUseAnalyticsStorage()) return null;
  const { sessionToken, path, durationMs, referrer } = params;
  
  try {
    // 先获取会话
    const session = await prisma.userAnalytics.findUnique({
      where: { sessionToken }
    });
    
    if (!session) {
      console.warn('[Analytics] Session not found for pageView:', sessionToken);
      return null;
    }
    
    const pageView = await prisma.pageView.create({
      data: {
        analyticsId: session.id,
        path,
        durationMs: durationMs ?? 0,
        referrer,
        visitedAt: new Date(),
      }
    });
    
    return pageView;
  } catch (error) {
    handleAnalyticsError('track pageView', error);
    return null;
  }
}

/**
 * 更新页面停留时长
 */
export async function updatePageViewDuration(pageViewId: string, durationMs: number) {
  if (!canUseAnalyticsStorage()) return null;
  try {
    return await prisma.pageView.update({
      where: { id: pageViewId },
      data: { durationMs }
    });
  } catch (error) {
    handleAnalyticsError('update pageView duration', error);
    return null;
  }
}

// ==================== 事件追踪 ====================

/**
 * 记录用户事件
 */
export async function trackEvent(params: EventParams) {
  if (!canUseAnalyticsStorage()) return null;
  const { sessionToken, eventName, eventCategory, eventData } = params;
  
  try {
    // 先获取会话
    const session = await prisma.userAnalytics.findUnique({
      where: { sessionToken }
    });
    
    if (!session) {
      console.warn('[Analytics] Session not found for event:', sessionToken);
      return null;
    }
    
    const event = await prisma.eventTrack.create({
      data: {
        analyticsId: session.id,
        eventName,
        eventCategory,
        eventData: eventData ? JSON.stringify(eventData) : null,
        createdAt: new Date(),
      }
    });
    
    return event;
  } catch (error) {
    handleAnalyticsError('track event', error);
    return null;
  }
}

/**
 * 批量记录事件
 */
export async function trackEvents(events: EventParams[]) {
  const results = await Promise.allSettled(
    events.map(event => trackEvent(event))
  );
  
  return results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<unknown>).value);
}

// ==================== 统计查询 ====================

/**
 * 获取综合统计数据
 */
export async function getStats(_query?: StatsQuery): Promise<AnalyticsStats> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekAgo = new Date(todayStart);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(todayStart);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  
  try {
    // 并行查询各项统计
    const [
      totalUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      sessionsToday,
      sessionsYesterday,
      sessionsThisWeek,
      sessionsThisMonth,
      totalSessions,
      avgDuration,
      totalDuration,
      topPagesRaw,
      topEventsRaw,
    ] = await Promise.all([
      // 总用户数
      prisma.user.count(),
      
      // 今日新用户
      prisma.user.count({
        where: { createdAt: { gte: todayStart } }
      }),
      
      // 本周新用户
      prisma.user.count({
        where: { createdAt: { gte: weekAgo } }
      }),
      
      // 本月新用户
      prisma.user.count({
        where: { createdAt: { gte: monthAgo } }
      }),
      
      // 今日会话数（DAU）
      prisma.userAnalytics.groupBy({
        by: ['userId'],
        where: {
          startedAt: { gte: todayStart },
          userId: { not: null }
        },
      }),
      
      // 昨日会话数
      prisma.userAnalytics.groupBy({
        by: ['userId'],
        where: {
          startedAt: { gte: yesterdayStart, lt: todayStart },
          userId: { not: null }
        },
      }),
      
      // 本周会话数（WAU）
      prisma.userAnalytics.groupBy({
        by: ['userId'],
        where: {
          startedAt: { gte: weekAgo },
          userId: { not: null }
        },
      }),
      
      // 本月会话数（MAU）
      prisma.userAnalytics.groupBy({
        by: ['userId'],
        where: {
          startedAt: { gte: monthAgo },
          userId: { not: null }
        },
      }),
      
      // 总会话数
      prisma.userAnalytics.count(),
      
      // 平均会话时长
      prisma.userAnalytics.aggregate({
        _avg: { durationMs: true }
      }),
      
      // 总会话时长
      prisma.userAnalytics.aggregate({
        _sum: { durationMs: true }
      }),
      
      // 热门页面
      prisma.pageView.groupBy({
        by: ['path'],
        _count: { path: true },
        orderBy: { _count: { path: 'desc' } },
        take: 10,
      }),
      
      // 热门事件
      prisma.eventTrack.groupBy({
        by: ['eventName'],
        _count: { eventName: true },
        orderBy: { _count: { eventName: 'desc' } },
        take: 10,
      }),
    ]);
    
    return {
      // 用户统计
      totalUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      
      // 活跃度统计
      dauToday: sessionsToday.length,
      dauYesterday: sessionsYesterday.length,
      wau: sessionsThisWeek.length,
      mau: sessionsThisMonth.length,
      
      // 时长统计（转换为秒）
      avgSessionDuration: Math.round((avgDuration._avg.durationMs ?? 0) / 1000),
      totalSessionDuration: Math.round((totalDuration._sum.durationMs ?? 0) / 1000),
      
      // 会话统计
      totalSessions,
      sessionsToday: sessionsToday.length,
      
      // 页面统计
      topPages: topPagesRaw.map(p => ({
        path: p.path,
        views: p._count.path
      })),
      
      // 事件统计
      topEvents: topEventsRaw.map(e => ({
        eventName: e.eventName,
        count: e._count.eventName
      })),
    };
  } catch (error) {
    console.error('[Analytics] Failed to get stats:', error);
    // 返回空统计
    return {
      totalUsers: 0,
      newUsersToday: 0,
      newUsersThisWeek: 0,
      newUsersThisMonth: 0,
      dauToday: 0,
      dauYesterday: 0,
      wau: 0,
      mau: 0,
      avgSessionDuration: 0,
      totalSessionDuration: 0,
      totalSessions: 0,
      sessionsToday: 0,
      topPages: [],
      topEvents: [],
    };
  }
}

/**
 * 获取指定时间范围内的新用户数
 */
export async function getNewUsersCount(startDate: Date, endDate?: Date) {
  try {
    return await prisma.user.count({
      where: {
        createdAt: {
          gte: startDate,
          ...(endDate && { lte: endDate })
        }
      }
    });
  } catch (error) {
    console.error('[Analytics] Failed to get new users count:', error);
    return 0;
  }
}

/**
 * 获取指定时间范围内的活跃用户数
 */
export async function getActiveUsersCount(startDate: Date, endDate?: Date) {
  try {
    const result = await prisma.userAnalytics.groupBy({
      by: ['userId'],
      where: {
        startedAt: {
          gte: startDate,
          ...(endDate && { lte: endDate })
        },
        userId: { not: null }
      }
    });
    return result.length;
  } catch (error) {
    console.error('[Analytics] Failed to get active users count:', error);
    return 0;
  }
}

/**
 * 获取IP地址分布统计
 */
export async function getIpDistribution(limit = 20) {
  try {
    const result = await prisma.userAnalytics.groupBy({
      by: ['ip'],
      _count: { ip: true },
      where: { ip: { not: null } },
      orderBy: { _count: { ip: 'desc' } },
      take: limit,
    });
    
    return result.map(r => ({
      ip: r.ip,
      count: r._count.ip
    }));
  } catch (error) {
    console.error('[Analytics] Failed to get IP distribution:', error);
    return [];
  }
}

/**
 * 获取每日统计趋势
 */
export async function getDailyTrend(days = 30) {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);
  
  try {
    const sessions = await prisma.userAnalytics.findMany({
      where: {
        startedAt: { gte: startDate }
      },
      select: {
        startedAt: true,
        durationMs: true,
        userId: true,
        isNewUser: true,
      }
    });
    
    // 按日期分组
    const dailyMap = new Map<string, {
      sessions: number;
      duration: number;
      users: Set<string>;
      newUsers: number;
    }>();
    
    sessions.forEach(s => {
      const dateKey = s.startedAt.toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey) || {
        sessions: 0,
        duration: 0,
        users: new Set<string>(),
        newUsers: 0,
      };
      
      existing.sessions += 1;
      existing.duration += s.durationMs;
      if (s.userId) existing.users.add(s.userId);
      if (s.isNewUser) existing.newUsers += 1;
      
      dailyMap.set(dateKey, existing);
    });
    
    // 转换为数组
    const trend = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      sessions: data.sessions,
      activeUsers: data.users.size,
      newUsers: data.newUsers,
      avgDuration: Math.round(data.duration / data.sessions / 1000), // 秒
    }));
    
    // 按日期排序
    trend.sort((a, b) => a.date.localeCompare(b.date));
    
    return trend;
  } catch (error) {
    console.error('[Analytics] Failed to get daily trend:', error);
    return [];
  }
}

// ==================== 导出服务对象 ====================

const analyticsService = {
  // 会话管理
  createSession,
  updateSession,
  getSession,
  
  // 页面追踪
  trackPageView,
  updatePageViewDuration,
  
  // 事件追踪
  trackEvent,
  trackEvents,
  
  // 统计查询
  getStats,
  getNewUsersCount,
  getActiveUsersCount,
  getIpDistribution,
  getDailyTrend,
};

export default analyticsService;
