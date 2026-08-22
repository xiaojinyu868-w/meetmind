/**
 * 内部回调鉴权：MCP server → /api/teach/internal/* 的共享令牌。
 *
 * 令牌是 Next 进程启动时生成的随机值，只在拉起 codex 时写进该线程
 * CODEX_HOME 的 config.toml（mcp_servers.teach.env），不落盘到仓库、
 * 不走网络外发。内部路由比对 x-teach-internal 头，不等即 401。
 */

import { randomUUID } from 'node:crypto';

const globalForToken = globalThis as unknown as { __teachInternalToken?: string };

export function getTeachInternalToken(): string {
  if (!globalForToken.__teachInternalToken) {
    globalForToken.__teachInternalToken = randomUUID();
  }
  return globalForToken.__teachInternalToken;
}

export function checkTeachInternalToken(request: Request): boolean {
  return request.headers.get('x-teach-internal') === getTeachInternalToken();
}
