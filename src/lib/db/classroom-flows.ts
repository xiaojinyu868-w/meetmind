import type { ClassroomFlowState } from '@/types/classroom-flow';
import { db } from './schema';

const CLASSROOM_FLOW_KEY_PREFIX = 'classroom_flow_v1:';

function storageKey(sessionId: string): string {
  return `${CLASSROOM_FLOW_KEY_PREFIX}${sessionId}`;
}

function isClassroomFlowState(value: unknown): value is ClassroomFlowState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ClassroomFlowState>;
  return (
    typeof candidate.title === 'string'
    && Array.isArray(candidate.recent)
    && Array.isArray(candidate.keep)
    && typeof candidate.updatedAtMs === 'number'
    && (candidate.now === null || typeof candidate.now === 'object')
  );
}

export async function saveClassroomFlow(
  sessionId: string,
  flow: ClassroomFlowState,
): Promise<void> {
  if (!sessionId || (!flow.now && flow.recent.length === 0 && flow.keep.length === 0)) return;
  await db.preferences.put({ key: storageKey(sessionId), value: flow });
}

export async function getClassroomFlow(sessionId: string): Promise<ClassroomFlowState | null> {
  if (!sessionId) return null;
  const record = await db.preferences.get(storageKey(sessionId));
  return isClassroomFlowState(record?.value) ? record.value : null;
}
