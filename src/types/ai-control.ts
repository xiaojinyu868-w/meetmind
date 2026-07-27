export type TutorAiControlMode =
  | 'in-class'
  | 'review'
  | 'shared'
  | 'goal'
  | 'word'
  | 'global';

export type UnderstandingAiControlMode = 'intent' | 'memory';
export type AppAiControlMode = 'flashcards' | 'quiz' | 'mindmap' | 'cheatsheet' | 'infographic' | 'audio-overview' | 'teach-back';

export type AiControlKey =
  | `tutor:${TutorAiControlMode}`
  | `understanding:${UnderstandingAiControlMode}`
  | `app:${AppAiControlMode}`;

export interface AiPromptOverride {
  enabled: boolean;
  additionalInstructions: string;
  modelId?: string;
  note?: string;
}

export interface AiControlContextInput {
  key: string;
  label: string;
  description: string;
  limit?: string;
  sensitive?: boolean;
}

export interface AiControlDefinition {
  key: AiControlKey;
  group: 'Tutor' | '理解层' | '应用';
  mode: TutorAiControlMode | UnderstandingAiControlMode | AppAiControlMode;
  label: string;
  description: string;
  entryPoints: string[];
  contextInputs: AiControlContextInput[];
  lockedContracts: string[];
  sampleContext: Record<string, unknown>;
  sampleOptions?: Record<string, unknown>;
}

export interface AiControlRevisionSummary {
  id: string;
  controlKey: AiControlKey;
  version: number;
  status: 'draft' | 'published' | 'archived';
  override: AiPromptOverride;
  createdById?: string;
  createdAt: string;
  publishedAt?: string;
}

export interface AiControlItem extends AiControlDefinition {
  activeRevision?: AiControlRevisionSummary;
  draftRevision?: AiControlRevisionSummary;
  recentRevisions: AiControlRevisionSummary[];
}

export interface AiPromptContextSummary {
  path: string;
  label: string;
  valueType: string;
  size: number;
  preview: string;
}

export interface AiPromptPreview {
  controlKey: AiControlKey;
  promptVersion: string;
  defaultPrompt: string;
  additionalInstructions: string;
  lockedContract: string;
  finalPrompt: string;
  contextSummary: AiPromptContextSummary[];
  modelId?: string;
  characterCount: number;
}

export interface AiControlTrialResult {
  text: string;
  modelId: string;
  durationMs: number;
}

export interface AiControlComparison {
  controlKey: AiControlKey;
  promptVersion: string;
  query: string;
  online: AiControlTrialResult;
  candidate: AiControlTrialResult;
}
