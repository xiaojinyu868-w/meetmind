/**
 * JSON 工具函数
 * 
 * 统一管理 JSON 解析、响应处理逻辑
 */

/**
 * 解析 AI 响应中的 JSON
 * 支持：直接 JSON、markdown 代码块包裹、混合文本
 */
export function parseJsonResponse<T>(content: string, debug: boolean = false): T | null {
  const log = debug ? console.log.bind(console) : () => {};
  
  log('[parseJsonResponse] 开始解析，内容长度:', content.length);
  
  try {
    // 1. 尝试直接解析
    const direct = JSON.parse(content);
    log('[parseJsonResponse] 直接解析成功');
    return direct;
  } catch {
    log('[parseJsonResponse] 直接解析失败，尝试清理');
    
    let cleanContent = content;
    
    // 2. 尝试移除 markdown 代码块 ```json ... ``` 或 ``` ... ```
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      cleanContent = codeBlockMatch[1].trim();
      log('[parseJsonResponse] 移除代码块后:', cleanContent.slice(0, 200));
      
      try {
        const parsed = JSON.parse(cleanContent);
        log('[parseJsonResponse] 移除代码块后解析成功');
        return parsed;
      } catch {
        log('[parseJsonResponse] 移除代码块后解析失败');
      }
    }
    
    // 3. 尝试提取 JSON 对象 {...}
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        log('[parseJsonResponse] 提取对象后解析成功');
        return parsed;
      } catch {
        log('[parseJsonResponse] 提取对象后解析失败');
      }
    }
    
    // 4. 尝试提取 JSON 数组 [...]
    const arrayMatch = content.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        log('[parseJsonResponse] 提取数组后解析成功');
        return parsed;
      } catch {
        log('[parseJsonResponse] 提取数组后解析失败');
      }
    }
    
    log('[parseJsonResponse] 无法提取 JSON，返回 null');
    return null;
  }
}

/**
 * 安全的 JSON 字符串化
 * 处理循环引用和特殊类型
 */
export function safeStringify(obj: unknown, indent?: number): string {
  const seen = new WeakSet();
  
  return JSON.stringify(obj, (key, value) => {
    // 处理 BigInt
    if (typeof value === 'bigint') {
      return value.toString();
    }
    
    // 处理循环引用
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    
    // 处理函数
    if (typeof value === 'function') {
      return '[Function]';
    }
    
    return value;
  }, indent);
}

/**
 * 深度克隆 JSON 兼容对象
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 检查字符串是否为有效 JSON
 */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * 合并 JSON 对象（浅合并）
 */
export function mergeJson<T extends object>(target: T, ...sources: Partial<T>[]): T {
  return Object.assign({}, target, ...sources);
}
