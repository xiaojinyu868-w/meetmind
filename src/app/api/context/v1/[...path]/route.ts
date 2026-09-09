import type { NextRequest } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { handleContextRequest } from '@/lib/services/context/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: NextRequest, context: { params: { path: string[] } }): Promise<Response> {
  // Context polling (job/source reads) must not consume the expensive Tutor
  // budget. Mutating and recall requests are still additionally limited inside
  // the framework-neutral adapter by authenticated user ID.
  const limited = await applyRateLimit(request, request.method === 'POST' ? 'tutor' : 'default');
  return limited ?? handleContextRequest(request, context.params.path);
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
