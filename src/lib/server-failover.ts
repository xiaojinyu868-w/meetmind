/**
 * MeetMind 多服务器智能切换
 * 前端自动检测并切换到可用的服务器
 */

// 服务器列表（按优先级排序）
const SERVERS = [
  { name: '主服务器-深圳', url: 'https://meetmind.online' },
  { name: '备服务器-香港', url: 'https://hk.meetmind.online' },  // 需要配置子域名
  // 或者直接用 IP（不推荐，没有 SSL）
  // { name: '备服务器-香港', url: 'http://<香港IP>:3001' },
];

const HEALTH_CHECK_TIMEOUT = 5000; // 5秒超时
const CACHE_DURATION = 60000; // 缓存1分钟

let cachedServer: { url: string; timestamp: number } | null = null;

/**
 * 检查服务器是否可用
 */
async function checkServerHealth(serverUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
    
    const response = await fetch(`${serverUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 获取当前可用的服务器
 */
export async function getAvailableServer(): Promise<string> {
  // 使用缓存
  if (cachedServer && Date.now() - cachedServer.timestamp < CACHE_DURATION) {
    return cachedServer.url;
  }
  
  // 并行检查所有服务器
  const healthChecks = SERVERS.map(async (server) => ({
    server,
    healthy: await checkServerHealth(server.url),
  }));
  
  const results = await Promise.all(healthChecks);
  
  // 返回第一个健康的服务器
  for (const result of results) {
    if (result.healthy) {
      cachedServer = { url: result.server.url, timestamp: Date.now() };
      return result.server.url;
    }
  }
  
  // 所有服务器都不可用，返回默认
  console.warn('[ServerSwitch] 所有服务器不可用，使用默认');
  return SERVERS[0].url;
}

/**
 * 带自动重试的 fetch 封装
 */
export async function fetchWithFailover(
  path: string,
  options?: RequestInit
): Promise<Response> {
  for (const server of SERVERS) {
    try {
      const response = await fetch(`${server.url}${path}`, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok || response.status < 500) {
        return response;
      }
    } catch (error) {
      console.warn(`[Failover] ${server.name} 请求失败:`, error);
      continue;
    }
  }
  
  throw new Error('所有服务器均不可用');
}
