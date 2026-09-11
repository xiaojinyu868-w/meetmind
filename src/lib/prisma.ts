/**
 * Prisma 客户端单例
 * 
 * Prisma 7 需要使用 adapter 模式
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';

/**
 * SQLite 数据库文件路径：优先 DATABASE_URL（`file:` 绝对路径或相对 cwd 的路径），没有才退回 cwd/prisma/meetmind.db。
 * 2026-09-11：生产改为从专用检出目录 /mnt/meetmind-prod 运行，数据库仍在原目录——各 worktree（生产 / 开发）
 * 通过 .env 里的绝对路径指向同一份库，而不是各自在 cwd 下静默新建一个空库（此前 prisma.ts 根本不读 DATABASE_URL）。
 */
function resolveDbPath(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url && url.startsWith('file:')) {
    const raw = url.slice('file:'.length);
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  return path.resolve(process.cwd(), 'prisma/meetmind.db');
}
const dbPath = resolveDbPath();

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
