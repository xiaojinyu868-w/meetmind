/**
 * 数据库兼容层
 * 
 * 保持向后兼容，所有现有的 `import { ... } from '@/lib/db'` 无需修改
 * 实际实现已迁移到 ./db/ 目录
 */

export * from './db/index';
