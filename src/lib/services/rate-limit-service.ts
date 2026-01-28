/**
 * API 速率限制服务（Redis 持久化版本）
 * 
 * 原则：正常使用无限制，防止恶意刷接口
 * 
 * 限制策略：
 * 1. 基于用户ID（登录用户）或 IP（未登录用户）
 * 2. 滑动窗口算法，按分钟/小时/天统计
 * 3. 不同API有不同的限额
 */

import { Redis } from 'ioredis';

// Redis 客户端单例
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[RateLimit] REDIS_URL not configured, using memory storage');
    return null;
  }
  
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    
    redis.on('error', (err) => {
      console.error('[RateLimit] Redis error:', err.message);
    });
    
    redis.on('connect', () => {
      console.log('[RateLimit] Redis connected');
    });
    
    return redis;
  } catch (err) {
    console.error('[RateLimit] Failed to create Redis client:', err);
    return null;
  }
}

// 限额配置（宽松策略：正常使用基本无感，但防刷）
export const RATE_LIMITS = {
  // AI 对话 - 每分钟20次，每小时200次，每天1000次
  chat: {
    perMinute: 20,
    perHour: 200,
    perDay: 1000,
    cost: 'high',
  },
  // AI 辅导 - 每分钟10次，每小时100次，每天500次
  tutor: {
    perMinute: 10,
    perHour: 100,
    perDay: 500,
    cost: 'high',
  },
  // 语音转文字 - 每分钟5次，每小时50次，每天200次
  transcribe: {
    perMinute: 5,
    perHour: 50,
    perDay: 200,
    cost: 'high',
  },
  // 生成摘要 - 每分钟10次，每小时100次，每天500次
  generateSummary: {
    perMinute: 10,
    perHour: 100,
    perDay: 500,
    cost: 'medium',
  },
  // 生成话题 - 每分钟10次，每小时100次，每天500次
  generateTopics: {
    perMinute: 10,
    perHour: 100,
    perDay: 500,
    cost: 'medium',
  },
  // 发送验证码 - 每分钟1次，每小时10次，每天20次
  sendCode: {
    perMinute: 1,
    perHour: 10,
    perDay: 20,
    cost: 'low',
  },
  // 通用API（未分类）- 每分钟60次，每小时600次
  default: {
    perMinute: 60,
    perHour: 600,
    perDay: 3000,
    cost: 'low',
  },
} as const;

export type RateLimitType = keyof typeof RATE_LIMITS;

// 内存缓存（Redis 不可用时的降级方案）
const memoryCache = new Map<string, { count: number; resetAt: number }[]>();

// 清理过期记录的定时器
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanupInterval() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, records] of memoryCache.entries()) {
      const validRecords = records.filter(r => r.resetAt > now);
      if (validRecords.length === 0) {
        memoryCache.delete(key);
      } else {
        memoryCache.set(key, validRecords);
      }
    }
  }, 60000); // 每分钟清理一次
}

interface RateLimitResult {
  allowed: boolean;
  remaining: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  resetIn: {
    minute: number;
    hour: number;
    day: number;
  };
  error?: string;
}

/**
 * 使用 Redis 检查速率限制
 */
async function checkRateLimitRedis(
  redis: Redis,
  identifier: string,
  apiType: RateLimitType
): Promise<RateLimitResult> {
  const limits = RATE_LIMITS[apiType];
  const now = Date.now();
  
  const keyMinute = `ratelimit:${identifier}:${apiType}:minute`;
  const keyHour = `ratelimit:${identifier}:${apiType}:hour`;
  const keyDay = `ratelimit:${identifier}:${apiType}:day`;
  
  try {
    // 使用 pipeline 批量获取计数
    const pipeline = redis.pipeline();
    pipeline.get(keyMinute);
    pipeline.get(keyHour);
    pipeline.get(keyDay);
    pipeline.ttl(keyMinute);
    pipeline.ttl(keyHour);
    pipeline.ttl(keyDay);
    
    const results = await pipeline.exec();
    if (!results) throw new Error('Pipeline failed');
    
    const minuteCount = parseInt(results[0]?.[1] as string || '0', 10);
    const hourCount = parseInt(results[1]?.[1] as string || '0', 10);
    const dayCount = parseInt(results[2]?.[1] as string || '0', 10);
    const minuteTTL = Math.max(0, results[3]?.[1] as number || 60);
    const hourTTL = Math.max(0, results[4]?.[1] as number || 3600);
    const dayTTL = Math.max(0, results[5]?.[1] as number || 86400);
    
    // 检查是否超限
    if (minuteCount >= limits.perMinute) {
      return {
        allowed: false,
        remaining: {
          perMinute: 0,
          perHour: Math.max(0, limits.perHour - hourCount),
          perDay: Math.max(0, limits.perDay - dayCount),
        },
        resetIn: {
          minute: minuteTTL,
          hour: hourTTL,
          day: dayTTL,
        },
        error: '请求过于频繁，请稍后再试',
      };
    }
    
    if (hourCount >= limits.perHour) {
      return {
        allowed: false,
        remaining: {
          perMinute: 0,
          perHour: 0,
          perDay: Math.max(0, limits.perDay - dayCount),
        },
        resetIn: {
          minute: 0,
          hour: hourTTL,
          day: dayTTL,
        },
        error: '本小时请求次数已达上限，请稍后再试',
      };
    }
    
    if (dayCount >= limits.perDay) {
      return {
        allowed: false,
        remaining: {
          perMinute: 0,
          perHour: 0,
          perDay: 0,
        },
        resetIn: {
          minute: 0,
          hour: 0,
          day: dayTTL,
        },
        error: '今日请求次数已达上限，请明天再试',
      };
    }
    
    // 记录本次调用（原子操作）
    const incrPipeline = redis.pipeline();
    incrPipeline.incr(keyMinute);
    incrPipeline.expire(keyMinute, 60);
    incrPipeline.incr(keyHour);
    incrPipeline.expire(keyHour, 3600);
    incrPipeline.incr(keyDay);
    incrPipeline.expire(keyDay, 86400);
    await incrPipeline.exec();
    
    return {
      allowed: true,
      remaining: {
        perMinute: limits.perMinute - minuteCount - 1,
        perHour: limits.perHour - hourCount - 1,
        perDay: limits.perDay - dayCount - 1,
      },
      resetIn: {
        minute: 60,
        hour: 3600,
        day: 86400,
      },
    };
  } catch (err) {
    console.error('[RateLimit] Redis error, falling back to memory:', err);
    // Redis 出错时降级到内存存储
    return checkRateLimitMemory(identifier, apiType);
  }
}

/**
 * 使用内存检查速率限制（降级方案）
 */
function checkRateLimitMemory(
  identifier: string,
  apiType: RateLimitType
): RateLimitResult {
  startCleanupInterval();
  
  const limits = RATE_LIMITS[apiType];
  const now = Date.now();
  
  // 时间窗口
  const minuteAgo = now - 60 * 1000;
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  
  const cacheKey = `${identifier}:${apiType}`;
  const records = memoryCache.get(cacheKey) || [];
  
  // 清理过期记录
  const validRecords = records.filter(r => r.resetAt > dayAgo);
  
  // 统计各时间窗口的调用次数
  const minuteCount = validRecords.filter(r => r.resetAt > minuteAgo).reduce((sum, r) => sum + r.count, 0);
  const hourCount = validRecords.filter(r => r.resetAt > hourAgo).reduce((sum, r) => sum + r.count, 0);
  const dayCount = validRecords.reduce((sum, r) => sum + r.count, 0);
  
  // 检查是否超限
  if (minuteCount >= limits.perMinute) {
    return {
      allowed: false,
      remaining: {
        perMinute: 0,
        perHour: Math.max(0, limits.perHour - hourCount),
        perDay: Math.max(0, limits.perDay - dayCount),
      },
      resetIn: {
        minute: 60 - Math.floor((now - minuteAgo) / 1000),
        hour: 3600 - Math.floor((now - hourAgo) / 1000),
        day: 86400 - Math.floor((now - dayAgo) / 1000),
      },
      error: '请求过于频繁，请稍后再试',
    };
  }
  
  if (hourCount >= limits.perHour) {
    return {
      allowed: false,
      remaining: {
        perMinute: 0,
        perHour: 0,
        perDay: Math.max(0, limits.perDay - dayCount),
      },
      resetIn: {
        minute: 0,
        hour: 3600 - Math.floor((now - hourAgo) / 1000),
        day: 86400 - Math.floor((now - dayAgo) / 1000),
      },
      error: '本小时请求次数已达上限，请稍后再试',
    };
  }
  
  if (dayCount >= limits.perDay) {
    return {
      allowed: false,
      remaining: {
        perMinute: 0,
        perHour: 0,
        perDay: 0,
      },
      resetIn: {
        minute: 0,
        hour: 0,
        day: 86400 - Math.floor((now - dayAgo) / 1000),
      },
      error: '今日请求次数已达上限，请明天再试',
    };
  }
  
  // 记录本次调用
  validRecords.push({ count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
  memoryCache.set(cacheKey, validRecords);
  
  return {
    allowed: true,
    remaining: {
      perMinute: limits.perMinute - minuteCount - 1,
      perHour: limits.perHour - hourCount - 1,
      perDay: limits.perDay - dayCount - 1,
    },
    resetIn: {
      minute: 60,
      hour: 3600,
      day: 86400,
    },
  };
}

/**
 * 检查并记录 API 调用
 * @param identifier 用户ID 或 IP 地址
 * @param apiType API 类型
 * @returns 是否允许调用
 */
export async function checkRateLimit(
  identifier: string,
  apiType: RateLimitType = 'default'
): Promise<RateLimitResult> {
  const redisClient = getRedis();
  
  if (redisClient) {
    return checkRateLimitRedis(redisClient, identifier, apiType);
  }
  
  return checkRateLimitMemory(identifier, apiType);
}

/**
 * 从请求中获取用户标识
 * 优先使用用户ID，否则使用IP
 */
export function getIdentifier(request: Request, userId?: string | null): string {
  if (userId) {
    return `user:${userId}`;
  }
  
  // 获取 IP 地址
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown';
  
  return `ip:${ip}`;
}

/**
 * 获取用户的 API 使用统计
 */
export async function getUsageStats(identifier: string): Promise<Record<RateLimitType, { used: number; limit: number }>> {
  const stats: Record<string, { used: number; limit: number }> = {};
  const redisClient = getRedis();
  
  if (redisClient) {
    try {
      const pipeline = redisClient.pipeline();
      for (const apiType of Object.keys(RATE_LIMITS)) {
        pipeline.get(`ratelimit:${identifier}:${apiType}:day`);
      }
      
      const results = await pipeline.exec();
      const apiTypes = Object.keys(RATE_LIMITS);
      
      for (let i = 0; i < apiTypes.length; i++) {
        const apiType = apiTypes[i] as RateLimitType;
        const count = parseInt(results?.[i]?.[1] as string || '0', 10);
        stats[apiType] = {
          used: count,
          limit: RATE_LIMITS[apiType].perDay,
        };
      }
      
      return stats as Record<RateLimitType, { used: number; limit: number }>;
    } catch (err) {
      console.error('[RateLimit] Failed to get usage stats from Redis:', err);
    }
  }
  
  // 降级到内存
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  
  for (const [apiType, limits] of Object.entries(RATE_LIMITS)) {
    const cacheKey = `${identifier}:${apiType}`;
    const records = memoryCache.get(cacheKey) || [];
    const dayCount = records.filter(r => r.resetAt > dayAgo).reduce((sum, r) => sum + r.count, 0);
    
    stats[apiType] = {
      used: dayCount,
      limit: limits.perDay,
    };
  }
  
  return stats as Record<RateLimitType, { used: number; limit: number }>;
}

/**
 * 重置用户的速率限制（管理员功能）
 */
export async function resetRateLimit(identifier: string, apiType?: RateLimitType): Promise<void> {
  const redisClient = getRedis();
  
  if (redisClient) {
    try {
      if (apiType) {
        await redisClient.del(
          `ratelimit:${identifier}:${apiType}:minute`,
          `ratelimit:${identifier}:${apiType}:hour`,
          `ratelimit:${identifier}:${apiType}:day`
        );
      } else {
        // 删除该用户所有的限制记录
        const keys = await redisClient.keys(`ratelimit:${identifier}:*`);
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      }
      return;
    } catch (err) {
      console.error('[RateLimit] Failed to reset rate limit in Redis:', err);
    }
  }
  
  // 降级到内存
  if (apiType) {
    memoryCache.delete(`${identifier}:${apiType}`);
  } else {
    for (const key of memoryCache.keys()) {
      if (key.startsWith(identifier)) {
        memoryCache.delete(key);
      }
    }
  }
}

/**
 * 创建速率限制中间件响应
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: result.error,
      remaining: result.remaining,
      resetIn: result.resetIn,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining-Minute': String(result.remaining.perMinute),
        'X-RateLimit-Remaining-Hour': String(result.remaining.perHour),
        'X-RateLimit-Remaining-Day': String(result.remaining.perDay),
        'Retry-After': String(Math.min(result.resetIn.minute, 60)),
      },
    }
  );
}
