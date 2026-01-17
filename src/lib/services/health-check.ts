// 服务健康检查
// 检测浏览器 API 可用性
// 注：Discussion API 和 Notebook API 已不再是核心依赖，项目有完整的本地降级方案

export interface ServiceStatus {
  discussion: boolean;  // 保留接口兼容性，但总是返回 false
  notebook: boolean;    // 保留接口兼容性，但总是返回 false
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
 * 检查所有服务状态
 * 注：外部服务（Discussion/Notebook）已移除检查，使用本地降级方案
 */
export async function checkServices(): Promise<ServiceStatus> {
  return {
    discussion: false,  // 不再检查外部 Discussion API
    notebook: false,    // 不再检查外部 Notebook API，使用本地搜索
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
    { name: 'Web Speech API', status: 'checking' },
    { name: 'IndexedDB', status: 'checking' },
  ];

  // 浏览器 API 检查
  if (typeof window !== 'undefined') {
    services[0].status = ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
      ? 'available' : 'unavailable';
    services[1].status = 'indexedDB' in window ? 'available' : 'unavailable';
  }

  return services;
}

/**
 * 获取服务状态摘要文本
 */
export function getStatusSummary(status: ServiceStatus): string {
  const parts: string[] = [];
  
  if (status.webSpeech) {
    parts.push('语音识别可用');
  } else {
    parts.push('语音识别不可用');
  }

  if (status.indexedDB) {
    parts.push('本地存储可用');
  }

  return parts.join(' · ');
}

/**
 * 判断是否应该使用降级方案
 * 注：现在总是使用本地方案
 */
export function shouldUseFallback(status: ServiceStatus, service: 'transcription' | 'search'): boolean {
  if (service === 'transcription') {
    return status.webSpeech;  // 使用 Web Speech API
  }
  if (service === 'search') {
    return true;  // 总是使用本地搜索
  }
  return false;
}
