import { NextRequest, NextResponse } from 'next/server';
import { generateClassroomFlow } from '@/lib/services/classroom-flow-service';
import { createLogger } from '@/lib/logger';
import type { TranscriptSegment } from '@/types';
import type { ClassroomFlowState } from '@/types/classroom-flow';

const log = createLogger('api/classroom/flow');

interface RequestBody {
  newSegments?: TranscriptSegment[];
  elapsedMs?: number;
  lessonTitle?: string;
  priorFlow?: ClassroomFlowState;
  importedHints?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const newSegments = Array.isArray(body.newSegments) ? body.newSegments : [];
    const elapsedMs = typeof body.elapsedMs === 'number' ? Math.max(0, body.elapsedMs) : 0;
    const flow = await generateClassroomFlow({
      newSegments,
      elapsedMs,
      lessonTitle: body.lessonTitle,
      priorFlow: body.priorFlow,
      importedHints: Array.isArray(body.importedHints) ? body.importedHints : undefined,
    });
    return NextResponse.json({ flow });
  } catch (error) {
    log.error('[classroom-flow] request failed', error);
    return NextResponse.json({ error: 'Failed to understand the classroom flow' }, { status: 500 });
  }
}
