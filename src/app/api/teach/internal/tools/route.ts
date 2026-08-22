import { checkTeachInternalToken } from '@/lib/services/teach-codex/internal-auth';
import { listTeachToolDescriptors } from '@/lib/services/teach-codex/board-env';

/**
 * GET /api/teach/internal/tools —— MCP server 拉工具描述（tools/list）。
 *
 * 内部路由：x-teach-internal 共享令牌鉴权。schema 单一事实源是
 * teach-agent/tools.ts（z.toJSONSchema 导出），此处不复制任何定义。
 */

export async function GET(request: Request) {
  if (!checkTeachInternalToken(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json({ tools: listTeachToolDescriptors() });
}
