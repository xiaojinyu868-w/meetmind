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
import { createLogger } from '@/lib/logger';
const log = createLogger('rate-limit');


// Redis 客户端单例
let redis: Redis | null = null;
let redisUrlMissingWarned = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (!redisUrlMissingWarned) {
      log.warn('[RateLimit] REDIS_URL not configured, using memory storage');
      redisUrlMissingWarned = true;
    }
    return null;
  }
  
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    
    redis.on('error', (err) => {
      log.error('[RateLimit] Redis error:', err.message);
    });
    
    redis.on('connect', () => {
    });
    
    return redis;
  } catch (err) {
    log.error('[RateLimit] Failed to create Redis client:', err);
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
  // AI 辅导 - 每分钟20次，每小时200次，每天1000次
  tutor: {
    perMinute: 20,
    perHour: 200,
    perDay: 1000,
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
  // 实时翻译 - 课堂 UI 会按短句批量请求，单独成桶，避免污染 tutor 对话限额
  translate: {
    perMinute: 600,
    perHour: 6000,
    perDay: 30000,
    cost: 'medium',
  },
  // 转录增强 - 每分钟15次，每小时150次，每天800次
  transcriptEnhance: {
    perMinute: 15,
    perHour: 150,
    perDay: 800,
    cost: 'medium',
  },
  // 术语提取 - 每分钟5次，每小时30次，每天100次
  extractTerms: {
    perMinute: 5,
    perHour: 30,
    perDay: 100,
    cost: 'medium',
  },
  // AI 全局检索 - 每分钟10次，每小时60次，每天200次
  search: {
    perMinute: 10,
    perHour: 60,
    perDay: 200,
    cost: 'high',
  },
  // 发送验证码 - 每分钟1次，每小时10次，每天20次
  sendCode: {
    perMinute: 1,
    perHour: 10,
    perDay: 20,
    cost: 'low',
  },
  // Workshop 应用执行（闪卡/播客/信息图等） - 每分钟30次，每小时200次
  // 单次调用后端会走大模型，耗时较长；但并发生成多个应用时需要同时通过
  appsExecute: {
    perMinute: 30,
    perHour: 200,
    perDay: 800,
    cost: 'high',
  },
  // 随堂检验（plan + question）：一次课堂会拆成 1 次 plan + 多个 question，单独成桶避免被 default 污染
  classCheck: {
    perMinute: 80,
    perHour: 500,
    perDay: 1600,
    cost: 'medium',
  },
  // 通用API（未分类）- 每分钟120次，每小时1200次
  default: {
    perMinute: 120,
    perHour: 1200,
    perDay: 6000,
    cost: 'low',
  },
} as const;

export type RateLimitType = keyof typeof RATE_LIMITS;

// 内存缓存（Redis 不可用时的降级方案）
// 每条记录带 createdAt 时间戳，用于滑动窗口精确计数
interface MemoryRecord {
  count: number;
  createdAt: number; // Date.now() 毫秒
}
const memoryCache = new Map<string, MemoryRecord[]>();

// 清理过期记录的定时器（超过 25 小时的记录无意义）
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanupInterval() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - 25 * 60 * 60 * 1000;
    for (const [key, records] of memoryCache.entries()) {
      const validRecords = records.filter(r => r.createdAt > cutoff);
      if (validRecords.length === 0) {
        memoryCache.delete(key);
      } else {
        memoryCache.set(key, validRecords);
      }
    }
  }, 120000); // 每 2 分钟清理一次
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
    // TTL 防御：Redis 可能返回 -1（无过期）或 -2（key 不存在），统一 clamp 到 >=1 避免前端误判立即可重试
    const minuteTTL = Math.max(1, results[3]?.[1] as number || 60);
    const hourTTL = Math.max(1, results[4]?.[1] as number || 3600);
    const dayTTL = Math.max(1, results[5]?.[1] as number || 86400);
    
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
    log.error('[RateLimit] Redis error, falling back to memory:', err);
    // Redis 出错时降级到内存存储
    return checkRateLimitMemory(identifier, apiType);
  }
}

/**
 * 使用内存检查速率限制（降级方案）
 * 滑动窗口：按 createdAt 严格过滤各窗口内的记录
 */
function checkRateLimitMemory(
  identifier: string,
  apiType: RateLimitType
): RateLimitResult {
  startCleanupInterval();
  
  const limits = RATE_LIMITS[apiType];
  const now = Date.now();
  
  // 时间窗口截止线（早于此线的记录不计入该窗口）
  const minuteCutoff = now - 60 * 1000;
  const hourCutoff = now - 60 * 60 * 1000;
  const dayCutoff = now - 24 * 60 * 60 * 1000;
  
  const cacheKey = `${identifier}:${apiType}`;
  const records = memoryCache.get(cacheKey) || [];
  
  // 按窗口过滤有效记录
  const recordsInMinute = records.filter(r => r.createdAt > minuteCutoff);
  const recordsInHour = records.filter(r => r.createdAt > hourCutoff);
  const recordsInDay = records.filter(r => r.createdAt > dayCutoff);
  
  // 统计各时间窗口的调用次数
  const minuteCount = recordsInMinute.reduce((sum, r) => sum + r.count, 0);
  const hourCount = recordsInHour.reduce((sum, r) => sum + r.count, 0);
  const dayCount = recordsInDay.reduce((sum, r) => sum + r.count, 0);
  
  // 更新内存缓存（只保留一天内的记录，减少内存）
  memoryCache.set(cacheKey, recordsInDay);
  
  // 辅助：计算最早记录距离现在多久后过期（秒）
  const secUntilOldestExpires = (windowMs: number, windowRecords: MemoryRecord[]): number => {
    if (windowRecords.length === 0) return 1;
    const oldestCreatedAt = Math.min(...windowRecords.map(r => r.createdAt));
    const expiresAt = oldestCreatedAt + windowMs;
    return Math.max(1, Math.ceil((expiresAt - now) / 1000));
  };
  
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
        minute: secUntilOldestExpires(60 * 1000, recordsInMinute),
        hour: secUntilOldestExpires(60 * 60 * 1000, recordsInHour),
        day: secUntilOldestExpires(24 * 60 * 60 * 1000, recordsInDay),
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
        minute: 1,
        hour: secUntilOldestExpires(60 * 60 * 1000, recordsInHour),
        day: secUntilOldestExpires(24 * 60 * 60 * 1000, recordsInDay),
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
        minute: 1,
        hour: 1,
        day: secUntilOldestExpires(24 * 60 * 60 * 1000, recordsInDay),
      },
      error: '今日请求次数已达上限，请明天再试',
    };
  }
  
  // 记录本次调用（带准确时间戳）
  const newRecords = [...recordsInDay, { count: 1, createdAt: now }];
  memoryCache.set(cacheKey, newRecords);
  
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
  
  const result = redisClient
    ? await checkRateLimitRedis(redisClient, identifier, apiType)
    : checkRateLimitMemory(identifier, apiType);

  if (!result.allowed) {
    const limits = RATE_LIMITS[apiType];
    log.warn(
      `[RateLimit] DENY identifier="${identifier}" apiType=${apiType} limits=${limits.perMinute}/min,${limits.perHour}/h,${limits.perDay}/d remaining=${result.remaining.perMinute}/${result.remaining.perHour}/${result.remaining.perDay} resetInSec=${result.resetIn.minute}/${result.resetIn.hour}/${result.resetIn.day} reason="${result.error}"`
    );
  }

  return result;
}

/**
 * 从请求中获取用户标识
 * 优先使用用户ID，否则使用IP
 */
function normalizeIdentifierSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'unknown';
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  const forwarded = request.headers.get('forwarded');

  if (cfConnectingIp?.trim()) return cfConnectingIp.trim();
  if (forwardedFor?.trim()) return forwardedFor.split(',')[0]?.trim() || 'unknown';
  if (realIp?.trim()) return realIp.trim();

  const forwardedMatch = forwarded?.match(/for=(?:"?\[?)([^;\],"]+)/i);
  if (forwardedMatch?.[1]) return forwardedMatch[1].trim();

  return 'unknown';
}

export function getIdentifier(request: Request, userId?: string | null): string {
  if (userId) {
    return `user:${userId}`;
  }

  const ip = normalizeIdentifierSegment(getClientIp(request));
  const isProxyLocalIp = ip === 'unknown' || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

  if (isProxyLocalIp) {
    const userAgent = normalizeIdentifierSegment(request.headers.get('user-agent') || 'anonymous');
    return `ip:${ip}:ua:${userAgent}`;
  }

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
      log.error('[RateLimit] Failed to get usage stats from Redis:', err);
    }
  }
  
  // 降级到内存
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  
  for (const [apiType, limits] of Object.entries(RATE_LIMITS)) {
    const cacheKey = `${identifier}:${apiType}`;
    const records = memoryCache.get(cacheKey) || [];
    const dayCount = records.filter(r => r.createdAt > dayAgo).reduce((sum, r) => sum + r.count, 0);
    
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
      log.error('[RateLimit] Failed to reset rate limit in Redis:', err);
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
