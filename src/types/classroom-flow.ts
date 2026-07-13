export type ClassroomSignalKind =
  | 'definition'
  | 'formula'
  | 'example'
  | 'question'
  | 'contrast'
  | 'conclusion'
  | 'other';

export interface ClassroomMoment {
  id: string;
  title: string;
  summary?: string;
  teachingMove?: string;
  anchorMs: number;
}

export interface ClassroomSignal {
  id: string;
  kind: ClassroomSignalKind;
  text: string;
  reason?: string;
  anchorMs: number;
}

export interface ClassroomFlowState {
  title: string;
  now: ClassroomMoment | null;
  recent: ClassroomMoment[];
  keep: ClassroomSignal[];
  updatedAtMs: number;
}
