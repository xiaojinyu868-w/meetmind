#!/usr/bin/env node
/**
 * 将服务端文件的 console.error/warn 迁移到 createLogger
 * 
 * 策略：
 * 1. 如果文件已有 createLogger import → 跳过 import 添加
 * 2. 如果文件没有 → 添加 import + 创建 log 实例
 * 3. 替换 console.error(...) → log.error('error', ...)
 * 4. 替换 console.warn(...) → log.warn('warning', ...)
 * 5. 跳过 logger.ts 本身
 */

const fs = require('fs');
const path = require('path');

// 收集目标文件
function findFiles(dir, pattern) {
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...findFiles(fullPath, pattern));
    } else if (item.name.match(pattern)) {
      results.push(fullPath);
    }
  }
  return results;
}

// 从文件路径推导 logger tag 名
function deriveTag(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  // route.ts → 用父目录名
  if (base === 'route') {
    const parts = filePath.split(path.sep);
    // 找 api/ 后面的部分
    const apiIdx = parts.indexOf('api');
    if (apiIdx >= 0) {
      return parts.slice(apiIdx + 1, -1).join('/');
    }
    return parts[parts.length - 2];
  }
  // xxx-service.ts → xxx
  return base.replace(/-service$/, '').replace(/\.ts$/, '');
}

// 计算从文件到 logger.ts 的相对 import 路径
function computeLoggerImport(filePath) {
  // 在 Next.js 项目中，统一用 @/lib/logger
  return `import { createLogger } from '@/lib/logger';`;
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // 跳过 logger.ts 本身
  if (filePath.includes('logger.ts')) return { file: filePath, skipped: 'is logger itself' };
  
  // 检查是否有 console.error 或 console.warn
  const hasConsoleError = /console\.error\s*\(/.test(content);
  const hasConsoleWarn = /console\.warn\s*\(/.test(content);
  
  if (!hasConsoleError && !hasConsoleWarn) {
    return { file: filePath, skipped: 'no console.error/warn' };
  }
  
  const tag = deriveTag(filePath);
  const hasLoggerImport = /import\s+\{[^}]*createLogger[^}]*\}\s+from/.test(content);
  const hasLogInstance = /const\s+log\s*=\s*createLogger/.test(content);
  
  let changes = 0;
  
  // 添加 import 和 log 实例（如果没有的话）
  if (!hasLoggerImport) {
    const importLine = computeLoggerImport(filePath);
    const logLine = `const log = createLogger('${tag}');`;
    
    // 找最后一个 import 语句的位置
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^import\s/) || lines[i].match(/^}\s*from\s/)) {
        lastImportIdx = i;
      }
    }
    
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, importLine, logLine, '');
      content = lines.join('\n');
      changes++;
    }
  } else if (!hasLogInstance) {
    // 有 import 但没有 log 实例
    const logLine = `const log = createLogger('${tag}');`;
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^import\s/) || lines[i].match(/^}\s*from\s/)) {
        lastImportIdx = i;
      }
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, logLine, '');
      content = lines.join('\n');
      changes++;
    }
  }
  
  // 替换 console.error(...) → log.error(...)
  // 需要处理多行情况，用简单的括号匹配
  const errorCount = (content.match(/console\.error\s*\(/g) || []).length;
  const warnCount = (content.match(/console\.warn\s*\(/g) || []).length;
  
  content = content.replace(/console\.error\s*\(/g, 'log.error(');
  content = content.replace(/console\.warn\s*\(/g, 'log.warn(');
  
  changes += errorCount + warnCount;
  
  fs.writeFileSync(filePath, content, 'utf8');
  
  return {
    file: path.relative(process.cwd(), filePath),
    tag,
    errorCount,
    warnCount,
    importAdded: !hasLoggerImport,
    changes,
  };
}

// 主流程
const srcDir = path.join(__dirname, '..', 'src');
const serviceFiles = findFiles(path.join(srcDir, 'lib', 'services'), /\.ts$/);
const apiFiles = findFiles(path.join(srcDir, 'app', 'api'), /\.ts$/);

const allFiles = [...serviceFiles, ...apiFiles];
const results = [];

for (const file of allFiles) {
  const result = processFile(file);
  results.push(result);
}

// 报告
const processed = results.filter(r => !r.skipped);
const skipped = results.filter(r => r.skipped);

console.log(`\n=== console.error/warn → logger 迁移完成 ===`);
console.log(`处理: ${processed.length} 个文件`);
console.log(`跳过: ${skipped.length} 个文件`);
console.log(`\n已处理文件:`);
for (const r of processed) {
  console.log(`  ${r.file} [${r.tag}] error:${r.errorCount} warn:${r.warnCount}${r.importAdded ? ' +import' : ''}`);
}

const totalErrors = processed.reduce((sum, r) => sum + (r.errorCount || 0), 0);
const totalWarns = processed.reduce((sum, r) => sum + (r.warnCount || 0), 0);
console.log(`\n总计替换: ${totalErrors} error + ${totalWarns} warn = ${totalErrors + totalWarns} 处`);
