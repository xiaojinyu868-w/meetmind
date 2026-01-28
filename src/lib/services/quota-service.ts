/**
 * 用户 API 配额服务
 * 
 * 功能：
 * - 基于用户的 API 调用限额
 * - 支持多种限额类型（按次数、按时间窗口）
 * - 支持不同用户角色不同配额
 * - 支持 IP 限制（防止未登录用户滥用）
 */

import { prisma } from '@/lib/prisma';

// 配额类型
export type QuotaType = 
  | 'transcribe'      // 语音转录
  | 'ai_summary'      // AI 总结
  | 'ai_topics'       // AI 生成主题
  | 'ai_tutor'        // AI 辅导
  | 'ai_chat';        // AI 对话

// 配额配置
interface QuotaConfig {
  // 每日限额
  dailyLimit: number;
  // 每月限额
  monthlyLimit: number;
  // 单次请求大小限制（如音频时长秒数）
  maxSingleSize?: number;
}

// 不同角色的配额配置
const QUOTA_CONFIG: Record<string, Record<QuotaType, QuotaConfig>> = {
  // 访客（未登录）- 极度限制
  guest: {
    transcribe: { dailyLimit: 3, monthlyLimit: 10, maxSingleSize: 60 },      // 每天3次，每次最多1分钟
    ai_summary: { dailyLimit: 3, monthlyLimit: 10 },
    ai_topics: { dailyLimit: 3, monthlyLimit: 10 },
    ai_tutor: { dailyLimit: 5, monthlyLimit: 20 },
    ai_chat: { dailyLimit: 10, monthlyLimit: 50 },
  },
  // 普通用户
  student: {
    transcribe: { dailyLimit: 20, monthlyLimit: 200, maxSingleSize: 3600 },  // 每天20次，每次最多1小时
    ai_summary: { dailyLimit: 30, monthlyLimit: 300 },
    ai_topics: { dailyLimit: 30, monthlyLimit: 300 },
    ai_tutor: { dailyLimit: 50, monthlyLimit: 500 },
    ai_chat: { dailyLimit: 100, monthlyLimit: 1000 },
  },
  // 教师
  teacher: {
    transcribe: { dailyLimit: 50, monthlyLimit: 500, maxSingleSize: 7200 },
    ai_summary: { dailyLimit: 100, monthlyLimit: 1000 },
    ai_topics: { dailyLimit: 100, monthlyLimit: 1000 },
    ai_tutor: { dailyLimit: 200, monthlyLimit: 2000 },
    ai_chat: { dailyLimit: 500, monthlyLimit: 5000 },
  },
  // 管理员 - 不限制
  admin: {
    transcribe: { dailyLimit: -1, monthlyLimit: -1 },
    ai_summary: { dailyLimit: -1, monthlyLimit: -1 },
    ai_topics: { dailyLimit: -1, monthlyLimit: -1 },
    ai_tutor: { dailyLimit: -1, monthlyLimit: -1 },
    ai_chat: { dailyLimit: -1, monthlyLimit: -1 },
  },
};

// IP 限制配置（防止未登录滥用）
const IP_RATE_LIMIT = {
  windowMs: 60 * 1000,  // 1分钟窗口
  maxRequests: 10,      // 最多10次请求
};

// 内存缓存 IP 请求记录
const ipRequestCache = new Map<string, { count: number; resetTime: number }>();

// 内存缓存用户配额（减少数据库查询）
const userQuotaCache = new Map<string, { data: UserQuotaData; expireAt: number }>();
const CACHE_TTL = 60 * 1000; // 缓存1分钟

interface UserQuotaData {
  dailyUsage: Record<QuotaType, number>;
  monthlyUsage: Record<QuotaType, number>;
  dailyResetAt: Date;
  monthlyResetAt: Date;
}

interface QuotaCheckResult {
  allowed: boolean;
  error?: string;
  remaining?: {
    daily: number;
    monthly: number;
  };
  limit?: {
    daily: number;
    monthly: number;
  };
}

export const quotaService = {
  /**
   * 检查 IP 速率限制（针对所有请求）
   */
  checkIpRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const record = ipRequestCache.get(ip);
    
    if (!record || now > record.resetTime) {
      // 新窗口
      ipRequestCache.set(ip, { count: 1, resetTime: now + IP_RATE_LIMIT.windowMs });
      return { allowed: true };
    }
    
    if (record.count >= IP_RATE_LIMIT.maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      return { allowed: false, retryAfter };
    }
    
    record.count++;
    return { allowed: true };
  },

  /**
   * 获取用户配额配置
   */
  getQuotaConfig(role: string, quotaType: QuotaType): QuotaConfig {
    const roleConfig = QUOTA_CONFIG[role] || QUOTA_CONFIG.student;
    return roleConfig[quotaType];
  },

  /**
   * 检查用户配额
   */
  async checkQuota(
    userId: string | null, 
    quotaType: QuotaType, 
    role: string = 'guest',
    ip?: string
  ): Promise<QuotaCheckResult> {
    // 管理员不限制
    if (role === 'admin') {
      return { allowed: true, remaining: { daily: -1, monthly: -1 }, limit: { daily: -1, monthly: -1 } };
    }

    // 未登录用户用 IP 限制
    if (!userId) {
      if (ip) {
        const ipCheck = this.checkIpRateLimit(ip);
        if (!ipCheck.allowed) {
          return { 
            allowed: false, 
            error: `请求过于频繁，请 ${ipCheck.retryAfter} 秒后重试` 
          };
        }
      }
      // 访客使用 IP 作为标识
      userId = `guest_${ip || 'unknown'}`;
      role = 'guest';
    }

    const config = this.getQuotaConfig(role, quotaType);
    
    // -1 表示不限制
    if (config.dailyLimit === -1) {
      return { allowed: true, remaining: { daily: -1, monthly: -1 }, limit: { daily: -1, monthly: -1 } };
    }

    // 获取用户使用记录
    const usage = await this.getUserUsage(userId, quotaType);
    
    // 检查每日限额
    if (usage.daily >= config.dailyLimit) {
      return {
        allowed: false,
        error: `今日 ${this.getQuotaTypeName(quotaType)} 次数已用完（${config.dailyLimit}次/天），明天再来吧`,
        remaining: { daily: 0, monthly: config.monthlyLimit - usage.monthly },
        limit: { daily: config.dailyLimit, monthly: config.monthlyLimit },
      };
    }

    // 检查每月限额
    if (usage.monthly >= config.monthlyLimit) {
      return {
        allowed: false,
        error: `本月 ${this.getQuotaTypeName(quotaType)} 次数已用完（${config.monthlyLimit}次/月）`,
        remaining: { daily: config.dailyLimit - usage.daily, monthly: 0 },
        limit: { daily: config.dailyLimit, monthly: config.monthlyLimit },
      };
    }

    return {
      allowed: true,
      remaining: {
        daily: config.dailyLimit - usage.daily,
        monthly: config.monthlyLimit - usage.monthly,
      },
      limit: { daily: config.dailyLimit, monthly: config.monthlyLimit },
    };
  },

  /**
   * 记录 API 使用
   */
  async recordUsage(
    userId: string | null,
    quotaType: QuotaType,
    ip?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const actualUserId = userId || `guest_${ip || 'unknown'}`;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    try {
      // 使用 upsert 更新或创建记录
      await prisma.apiUsage.upsert({
        where: {
          userId_quotaType_date: {
            userId: actualUserId,
            quotaType,
            date: today,
          },
        },
        update: {
          count: { increment: 1 },
          updatedAt: now,
        },
        create: {
          userId: actualUserId,
          quotaType,
          date: today,
          count: 1,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });

      // 清除缓存
      userQuotaCache.delete(actualUserId);
    } catch (error) {
      console.error('[QuotaService] 记录使用失败:', error);
      // 不抛出错误，避免影响主流程
    }
  },

  /**
   * 获取用户使用情况
   */
  async getUserUsage(userId: string, quotaType: QuotaType): Promise<{ daily: number; monthly: number }> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    try {
      // 查询今日使用
      const dailyUsage = await prisma.apiUsage.findUnique({
        where: {
          userId_quotaType_date: {
            userId,
            quotaType,
            date: today,
          },
        },
        select: { count: true },
      });

      // 查询本月使用
      const monthlyUsage = await prisma.apiUsage.aggregate({
        where: {
          userId,
          quotaType,
          date: { gte: thisMonth },
        },
        _sum: { count: true },
      });

      return {
        daily: dailyUsage?.count || 0,
        monthly: monthlyUsage._sum.count || 0,
      };
    } catch (error) {
      console.error('[QuotaService] 查询使用记录失败:', error);
      return { daily: 0, monthly: 0 };
    }
  },

  /**
   * 获取用户完整配额信息
   */
  async getUserQuotaInfo(userId: string, role: string): Promise<Record<QuotaType, {
    used: { daily: number; monthly: number };
    limit: { daily: number; monthly: number };
    remaining: { daily: number; monthly: number };
  }>> {
    const quotaTypes: QuotaType[] = ['transcribe', 'ai_summary', 'ai_topics', 'ai_tutor', 'ai_chat'];
    const result: Record<string, { used: any; limit: any; remaining: any }> = {};

    for (const quotaType of quotaTypes) {
      const usage = await this.getUserUsage(userId, quotaType);
      const config = this.getQuotaConfig(role, quotaType);

      result[quotaType] = {
        used: usage,
        limit: { daily: config.dailyLimit, monthly: config.monthlyLimit },
        remaining: {
          daily: config.dailyLimit === -1 ? -1 : Math.max(0, config.dailyLimit - usage.daily),
          monthly: config.monthlyLimit === -1 ? -1 : Math.max(0, config.monthlyLimit - usage.monthly),
        },
      };
    }

    return result as any;
  },

  /**
   * 获取配额类型名称
   */
  getQuotaTypeName(quotaType: QuotaType): string {
    const names: Record<QuotaType, string> = {
      transcribe: '语音转录',
      ai_summary: 'AI 总结',
      ai_topics: 'AI 主题生成',
      ai_tutor: 'AI 辅导',
      ai_chat: 'AI 对话',
    };
    return names[quotaType] || quotaType;
  },

  /**
   * 清理过期的 IP 缓存
   */
  cleanupIpCache(): void {
    const now = Date.now();
    for (const [ip, record] of ipRequestCache.entries()) {
      if (now > record.resetTime) {
        ipRequestCache.delete(ip);
      }
    }
  },
};

// 定期清理 IP 缓存
setInterval(() => quotaService.cleanupIpCache(), 60 * 1000);
