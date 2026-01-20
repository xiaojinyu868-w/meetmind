/**
 * Prisma 客户端单例
 * 
 * Prisma 7 需要使用 adapter 模式
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';

// SQLite 数据库文件路径
const dbPath = path.resolve(process.cwd(), 'prisma/meetmind.db');

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Prisma 7 adapter 使用 url 参数
  const adapter = new PrismaBetterSqlite3({
    url: `file:${dbPath}`,
  });
  
  // 创建 PrismaClient
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
