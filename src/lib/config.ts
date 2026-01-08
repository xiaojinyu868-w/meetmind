/**
 * 配置管理和验证
 */

export interface AppConfig {
  // LLM 配置
  dashscopeApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  
  // 外部服务
  discussionApi: string;
  notebookApi: string;
  
  // 功能开关
  enableTingwu: boolean;
  enableNotebook: boolean;
  
  // 开发模式
  isDev: boolean;
}

/**
 * 获取应用配置
 */
export function getConfig(): AppConfig {
  return {
    // LLM
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    llmModel: process.env.LLM_MODEL || 'qwen3-max',
    llmBaseUrl: process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    
    // 外部服务
    discussionApi: process.env.NEXT_PUBLIC_DISCUSSION_API || 'http://localhost:4000',
    notebookApi: process.env.NEXT_PUBLIC_NOTEBOOK_API || 'http://localhost:5055',
    
    // 功能开关
    enableTingwu: process.env.ENABLE_TINGWU !== 'false',
    enableNotebook: process.env.ENABLE_NOTEBOOK !== 'false',
    
    // 开发模式
    isDev: process.env.NODE_ENV === 'development',
  };
}

/**
 * 验证必要配置
 */
export interface ConfigValidation {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

export function validateConfig(): ConfigValidation {
  const config = getConfig();
  const missing: string[] = [];
  const warnings: string[] = [];

  // 必需配置
  if (!config.dashscopeApiKey) {
    missing.push('DASHSCOPE_API_KEY');
  }

  // 可选配置警告
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    warnings.push('Gemini API Key 未配置，Gemini 模型不可用');
  }

  if (!process.env.OPENAI_API_KEY) {
    warnings.push('OpenAI API Key 未配置，OpenAI 模型不可用');
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * 服务状态
 */
export interface ServiceStatus {
  name: string;
  url: string;
  available: boolean;
  latency?: number;
}

/**
 * 检查服务可用性
 */
export async function checkServiceStatus(
  name: string,
  url: string,
  healthPath: string = '/health'
): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${url}${healthPath}`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    
    return {
      name,
      url,
      available: response.ok,
      latency: Date.now() - startTime,
    };
  } catch {
    return {
      name,
      url,
      available: false,
    };
  }
}

/**
 * 检查所有外部服务
 */
export async function checkAllServices(): Promise<ServiceStatus[]> {
  const config = getConfig();
  
  const checks = await Promise.all([
    checkServiceStatus('Discussion', config.discussionApi),
    checkServiceStatus('Open Notebook', config.notebookApi),
  ]);
  
  return checks;
}

/**
 * 打印配置状态（开发用）
 */
export function printConfigStatus(): void {
  const validation = validateConfig();
  
  console.log('\n=== MeetMind 配置状态 ===');
  
  if (validation.valid) {
    console.log('✅ 核心配置完整');
  } else {
    console.log('❌ 缺少必要配置:');
    validation.missing.forEach(key => console.log(`   - ${key}`));
  }
  
  if (validation.warnings.length > 0) {
    console.log('\n⚠️ 警告:');
    validation.warnings.forEach(w => console.log(`   - ${w}`));
  }
  
  console.log('========================\n');
}
