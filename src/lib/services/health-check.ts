// 服务健康检查
// 检测外部服务可用性并提供降级提示

const DISCUSSION_API = process.env.NEXT_PUBLIC_DISCUSSION_API || 'http://localhost:4000';
const NOTEBOOK_API = process.env.NEXT_PUBLIC_NOTEBOOK_API || 'http://localhost:5055';
const CHECK_TIMEOUT = 3000;

export interface ServiceStatus {
  discussion: boolean;
  notebook: boolean;
  webSpeech: boolean;
  indexedDB: boolean;
  timestamp: Date;
}

export interface ServiceHealth {
  name: string;
  status: 'available' | 'unavailable' | 'checking';
  latency?: number;
  fallback?: string;
}

/**
 * 检查单个服务
 */
async function checkService(url: string): Promise<{ ok: boolean; latency: number }> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    return { ok: response.ok, latency: Date.now() - start };
  } catch {
    return { ok: false, latency: Date.now() - start };
  }
}

/**
 * 检查所有服务状态
 */
export async function checkServices(): Promise<ServiceStatus> {
  const [discussionResult, notebookResult] = await Promise.all([
    checkService(`${DISCUSSION_API}/sessions/health`),
    checkService(`${NOTEBOOK_API}/health`),
  ]);

  return {
    discussion: discussionResult.ok,
    notebook: notebookResult.ok,
    webSpeech: typeof window !== 'undefined' && 
      ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window),
    indexedDB: typeof window !== 'undefined' && 'indexedDB' in window,
    timestamp: new Date(),
  };
}

/**
 * 获取详细的服务健康信息
 */
export async function getServiceHealth(): Promise<ServiceHealth[]> {
  const services: ServiceHealth[] = [
    { name: 'Discussion 后端', status: 'checking', fallback: 'Web Speech API' },
    { name: 'Open Notebook', status: 'checking', fallback: '本地搜索' },
    { name: 'Web Speech API', status: 'checking' },
    { name: 'IndexedDB', status: 'checking' },
  ];

  // 并行检查
  const [discussionResult, notebookResult] = await Promise.all([
    checkService(`${DISCUSSION_API}/sessions/health`),
    checkService(`${NOTEBOOK_API}/health`),
  ]);

  services[0].status = discussionResult.ok ? 'available' : 'unavailable';
  services[0].latency = discussionResult.latency;

  services[1].status = notebookResult.ok ? 'available' : 'unavailable';
  services[1].latency = notebookResult.latency;

  // 浏览器 API 检查
  if (typeof window !== 'undefined') {
    services[2].status = ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
      ? 'available' : 'unavailable';
    services[3].status = 'indexedDB' in window ? 'available' : 'unavailable';
  }

  return services;
}

/**
 * 获取服务状态摘要文本
 */
export function getStatusSummary(status: ServiceStatus): string {
  const parts: string[] = [];
  
  if (status.discussion) {
    parts.push('通义听悟已连接');
  } else if (status.webSpeech) {
    parts.push('本地识别模式');
  } else {
    parts.push('转录不可用');
  }

  if (status.notebook) {
    parts.push('向量搜索可用');
  }

  return parts.join(' · ');
}

/**
 * 判断是否应该使用降级方案
 */
export function shouldUseFallback(status: ServiceStatus, service: 'transcription' | 'search'): boolean {
  if (service === 'transcription') {
    return !status.discussion && status.webSpeech;
  }
  if (service === 'search') {
    return !status.notebook;
  }
  return false;
}
