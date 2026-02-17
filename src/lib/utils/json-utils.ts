/**
 * JSON 工具函数
 * 
 * 统一管理 JSON 解析、响应处理逻辑
 */

/**
 * 修复 LLM 输出的 JSON 中，字符串值内部未转义的双引号。
 * 
 * LLM 经常在 JSON 字符串值中使用未转义的 " 来包裹术语/公式，例如：
 *   "explanation": "类比于"a≤b 且 b≤a 则 a=b"可推出..."
 *   "content": "定义的"全集 U"，实质是 U-A"
 * 
 * 策略：利用 JSON 结构特征——合法的字符串结束 `"` 后面（跳过空白后）
 * 只可能出现 `:` `,` `}` `]` 或 EOF。但仅靠这一条规则不够（因为内部引号
 * 后面也可能恰好跟着 `,` 等字符）。
 * 
 * 增强策略：
 * 1. 如果 `"` 后面（跳过空白）是 `"` 且再后面是非 `:`，说明当前 `"` 是
 *    结束引号、下一个 `"` 是新字符串的开始（合法 JSON 不会两个字符串相邻不带 `,`）
 * 2. 追踪 JSON 的结构深度（对象/数组嵌套层级和当前期望的 token 类型）
 *    来更准确判断引号的角色
 */
function fixUnescapedQuotesInJsonStrings(raw: string): string {
  // 快速检查：如果直接能解析就不需要修复
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    // 继续修复
  }

  // 用更健壮的方法：逐字符解析，追踪完整的 JSON 状态机
  // 状态：我们需要知道当前是在 key 还是 value 位置
  const result: string[] = [];
  let i = 0;
  const len = raw.length;

  // 辅助：跳过空白
  function skipWs(): void {
    while (i < len && (raw[i] === ' ' || raw[i] === '\t' || raw[i] === '\r' || raw[i] === '\n')) {
      result.push(raw[i]);
      i++;
    }
  }

  // 辅助：解析一个字符串，自动修复内部未转义引号
  function parseString(): void {
    if (i >= len || raw[i] !== '"') return;
    result.push('"'); // 开始引号
    i++;

    while (i < len) {
      const ch = raw[i];

      if (ch === '\\') {
        // 转义序列，原样保留
        result.push(ch);
        i++;
        if (i < len) {
          result.push(raw[i]);
          i++;
        }
        continue;
      }

      if (ch === '"') {
        // 可能是字符串结束，也可能是内部未转义引号
        // 看后面的非空白字符来判断
        let j = i + 1;
        while (j < len && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\r' || raw[j] === '\n')) {
          j++;
        }
        const next = j < len ? raw[j] : '';

        // 合法的字符串结束：后面必须是 JSON 结构字符
        if (next === ':' || next === ',' || next === '}' || next === ']' || next === '') {
          // 额外检查：如果后面是 `,`，再看逗号后面是否跟着 `"`
          // 这是最常见的合法情况（数组元素之间、对象属性之间）
          // 但也可能是 "...的"全集 U"，实质是..." 中 U" 后面的 , 恰好是 JSON 逗号
          // 
          // 判断方法：如果我们在一个字符串值中，而后面的 , 后面跟着的 " 之后
          // 又跟着一个看起来像 JSON key 的模式（"key":），那就认为当前 " 是结束引号
          // 否则认为是内部引号
          if (next === ',' || next === '}' || next === ']') {
            // 验证：往后看更多来确认这是真的结构分隔符
            if (looksLikeStructuralEnd(raw, j, next)) {
              result.push('"'); // 结束引号
              i++;
              return;
            } else {
              // 是内部引号，转义它
              result.push('\\', '"');
              i++;
              continue;
            }
          }
          // next === ':' — 这个引号后面是冒号，肯定是 key 的结束引号（合法）
          // next === '' — EOF
          result.push('"');
          i++;
          return;
        } else {
          // 后面跟着的不是结构字符 → 这是内部的未转义引号
          result.push('\\', '"');
          i++;
          continue;
        }
      }

      // 普通字符
      result.push(ch);
      i++;
    }

    // 字符串没有正常关闭（被截断），补上结束引号
    result.push('"');
  }

  // 辅助：判断位置 j 处的字符 `next` 是否是真正的 JSON 结构分隔符
  // 而非恰好出现在字符串值内容中的字符
  function looksLikeStructuralEnd(s: string, j: number, next: string): boolean {
    if (next === '}' || next === ']') {
      // 后面是闭合括号，几乎肯定是结构符
      return true;
    }

    // next === ','
    // 看逗号后面的内容：
    //   如果是 `"some_key":` 模式（JSON 对象的下一个 key），那当前引号是结束引号
    //   如果是 `"A. xxx"` 模式（数组中的下一个字符串元素），也是合法的
    //   如果看起来不像 JSON 结构，可能是字符串内容中恰好的逗号
    let k = j + 1;
    while (k < s.length && (s[k] === ' ' || s[k] === '\t' || s[k] === '\r' || s[k] === '\n')) {
      k++;
    }

    if (k >= s.length) return true; // EOF after comma

    if (s[k] === '"') {
      // 逗号后面是引号，这在合法 JSON 中很常见
      // 进一步判断：这个引号开始的字符串后面是否跟 `:` (对象 key) 或 `,` `]` (数组元素)
      // 但我们不能无限递归。
      // 
      // 采用简单启发：看这个引号里的内容是否短（< 50 字符内出现 `":` 模式），
      // 如果是，说明它是 JSON key，当前分隔符是合法的。
      // 如果引号里是长文本，说明它是数组元素或值，也是合法的。
      // 
      // 实际上，只要逗号后面跟着 `"xxx":` 或 `"xxx"` 后跟 `,` `]` `}`，
      // 就可以认为当前引号是合法的结束引号。
      //
      // 更简单的方法：检查从 k 开始的一小段是否匹配 JSON key 模式
      const snippet = s.slice(k, k + 80);
      // 匹配 "key": 模式
      if (/^"[^"]{1,40}"\s*:/.test(snippet)) {
        return true; // 后面是 JSON key，当前引号是结束引号
      }
      // 匹配数组元素模式：逗号后面的 "..." 后面跟 , 或 ]
      if (/^"[^"]*"\s*[,\]]/.test(snippet)) {
        return true; // 后面是数组元素
      }
      // 匹配 { 开始的对象（数组中的对象元素）
      return true; // 给予信任：逗号后面跟引号大概率是合法的
    }

    if (s[k] === '{' || s[k] === '[') {
      return true; // 逗号后面跟对象/数组开始
    }

    // 逗号后面跟数字、true/false/null
    if (/[0-9tfn\-]/.test(s[k])) {
      return true;
    }

    // 不确定的情况，保守地认为是内部引号
    return false;
  }

  // 主循环：简化的 JSON 值解析
  function parseValue(): void {
    skipWs();
    if (i >= len) return;
    
    const ch = raw[i];
    if (ch === '"') {
      parseString();
    } else if (ch === '{') {
      parseObject();
    } else if (ch === '[') {
      parseArray();
    } else {
      // 数字、布尔、null 等原始值
      while (i < len && raw[i] !== ',' && raw[i] !== '}' && raw[i] !== ']' && raw[i] !== '\n') {
        result.push(raw[i]);
        i++;
      }
    }
  }

  function parseObject(): void {
    if (i >= len || raw[i] !== '{') return;
    result.push('{');
    i++;
    skipWs();

    if (i < len && raw[i] === '}') {
      result.push('}');
      i++;
      return;
    }

    while (i < len) {
      skipWs();
      if (i >= len) break;
      if (raw[i] === '}') { result.push('}'); i++; return; }

      // key
      parseString();
      skipWs();
      // colon
      if (i < len && raw[i] === ':') { result.push(':'); i++; }
      skipWs();
      // value
      parseValue();
      skipWs();
      if (i < len && raw[i] === ',') { result.push(','); i++; }
      else if (i < len && raw[i] === '}') { result.push('}'); i++; return; }
      else break;
    }
  }

  function parseArray(): void {
    if (i >= len || raw[i] !== '[') return;
    result.push('[');
    i++;
    skipWs();

    if (i < len && raw[i] === ']') {
      result.push(']');
      i++;
      return;
    }

    while (i < len) {
      skipWs();
      if (i >= len) break;
      if (raw[i] === ']') { result.push(']'); i++; return; }

      parseValue();
      skipWs();
      if (i < len && raw[i] === ',') { result.push(','); i++; }
      else if (i < len && raw[i] === ']') { result.push(']'); i++; return; }
      else break;
    }
  }

  // 入口
  skipWs();
  if (i < len) {
    parseValue();
  }

  const fixed = result.join('');
  
  // 验证修复结果
  try {
    JSON.parse(fixed);
    return fixed;
  } catch {
    // 修复不成功，返回原始内容
    return raw;
  }
}

/**
 * 修复被截断的 JSON（LLM 提前停止输出）
 * 策略：找到 "questions" 数组中最后一个完整的 `}` 对象，截断后补全 `]}` 
 */
function repairTruncatedJson(content: string): string | null {
  // 找到 "questions" 数组的开始
  const questionsStart = content.indexOf('"questions"');
  if (questionsStart === -1) return null;
  
  const arrayStart = content.indexOf('[', questionsStart);
  if (arrayStart === -1) return null;

  // 从后往前找最后一个看起来像完整 question 对象结尾的 }
  // 完整的 question 对象通常以 } 结尾，后面可能跟 , 或 ]
  let lastCompleteObj = -1;
  let depth = 0;
  let inStr = false;
  
  for (let i = arrayStart + 1; i < content.length; i++) {
    const c = content[i];
    if (c === '\\' && inStr) { i++; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) {
        lastCompleteObj = i;
      }
    }
  }

  if (lastCompleteObj === -1) return null;

  // 截取到最后一个完整对象，补全 ]}
  const prefix = content.slice(0, lastCompleteObj + 1);
  // 找到 "questions" 之前的部分作为外层对象的开头
  return prefix + ']}';
}

/**
 * 解析 AI 响应中的 JSON
 * 支持：直接 JSON、markdown 代码块包裹、混合文本、未转义引号修复、截断修复
 */
export function parseJsonResponse<T>(content: string, debug: boolean = false): T | null {
  const log = debug ? console.log.bind(console) : () => {};
  
  log('[parseJsonResponse] 开始解析，内容长度:', content.length);

  // 预处理：提取实际 JSON 内容
  let raw = content.trim();

  // 移除 markdown 代码块包裹
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    raw = codeBlockMatch[1].trim();
    log('[parseJsonResponse] 移除代码块包裹');
  }

  // 如果内容不以 { 或 [ 开头，尝试提取
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const objStart = raw.indexOf('{');
    if (objStart !== -1) {
      raw = raw.slice(objStart);
      log('[parseJsonResponse] 跳过前导文字');
    }
  }

  // 1. 直接解析
  try {
    const direct = JSON.parse(raw);
    log('[parseJsonResponse] 直接解析成功');
    return direct;
  } catch {
    log('[parseJsonResponse] 直接解析失败，尝试修复');
  }

  // 2. 用结构化解析器修复未转义引号
  const fixed = fixUnescapedQuotesInJsonStrings(raw);
  if (fixed !== raw) {
    try {
      const parsed = JSON.parse(fixed);
      log('[parseJsonResponse] 引号修复后解析成功');
      return parsed;
    } catch {
      log('[parseJsonResponse] 引号修复后仍失败');
    }
  }

  // 3. 截断修复：先修复引号再截断补全
  const fixedForTruncation = fixed !== raw ? fixed : raw;
  const repaired = repairTruncatedJson(fixedForTruncation);
  if (repaired) {
    try {
      const parsed = JSON.parse(repaired);
      log('[parseJsonResponse] 截断修复后解析成功');
      return parsed;
    } catch {
      // 截断修复后可能还有引号问题，再修一次
      const repairedFixed = fixUnescapedQuotesInJsonStrings(repaired);
      try {
        const parsed = JSON.parse(repairedFixed);
        log('[parseJsonResponse] 截断+引号修复后解析成功');
        return parsed;
      } catch {
        log('[parseJsonResponse] 截断修复后解析失败');
      }
    }
  }

  // 4. 对原始内容也尝试截断修复（可能引号修复改变了结构）
  if (raw !== fixedForTruncation) {
    const repaired2 = repairTruncatedJson(raw);
    if (repaired2) {
      const repaired2Fixed = fixUnescapedQuotesInJsonStrings(repaired2);
      try {
        const parsed = JSON.parse(repaired2Fixed);
        log('[parseJsonResponse] 原始截断+引号修复后解析成功');
        return parsed;
      } catch {
        log('[parseJsonResponse] 原始截断修复也失败');
      }
    }
  }

  log('[parseJsonResponse] 所有策略均失败，返回 null');
  return null;
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
