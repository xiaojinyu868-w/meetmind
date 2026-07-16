import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { getWorkspaceCaptureEvidenceForUser } from '@/lib/services/workspace-evidence-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('workspace/captures/evidence');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ captureId: string }> },
) {
  try {
    const auth = getAuthPayload(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const { captureId } = await context.params;
    const evidence = await getWorkspaceCaptureEvidenceForUser(auth.sub, captureId);
    if (!evidence) {
      return NextResponse.json({ success: false, error: '未找到课堂证据' }, { status: 404 });
    }

    return NextResponse.json({ success: true, evidence });
  } catch (error) {
    log.error('read workspace capture evidence failed:', error);
    return NextResponse.json({ success: false, error: '读取课堂证据失败' }, { status: 500 });
  }
}
