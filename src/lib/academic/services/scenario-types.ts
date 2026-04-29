/**
 * Academic Service: Scenario 相关的共享类型
 *
 * 这些是**产品层**的类型，跟 Prisma row 解耦，方便前后端共用。
 * 序列化到 DB 时走 JSON 字段；反序列化后走这些类型。
 */

export type ProductKind = 'practice' | 'review' | 'qa' | 'mock-interview' | 'material-polish';

export type PersonaTone = 'gentle' | 'direct' | 'probing' | 'structured';
export type PersonaStyle = 'socratic' | 'mentor' | 'interviewer' | 'reviewer';

export interface PersonaSeed {
  tone: PersonaTone;
  style: PersonaStyle;
  feedbackAxes: string[];
  forbiddenZones: string[];
}

export type StudentInputFieldKind = 'text' | 'textarea' | 'url';

export interface StudentInputField {
  key: string;
  label: string;
  kind: StudentInputFieldKind;
  required: boolean;
  placeholder?: string;
}

export interface CheckpointTrigger {
  kind: 'stuck-twice' | 'keyword' | 'risk-category' | 'deadline';
  value?: string;
  description?: string;
}

export interface PromptPatch {
  systemAppendix?: string;
  userKickoff?: string;
  reviewerRubric?: string;
}

export interface RecommendedScenarioSeed {
  name: string;
  description: string;
  productKind: ProductKind;
  personaSeed: PersonaSeed;
  studentInputSchema: StudentInputField[];
}

export interface ScenarioDraftInput {
  name: string;
  description: string;
  productKind: ProductKind;
  studentInputSchema: StudentInputField[];
  personaSeed: PersonaSeed;
  checkpointTriggers: CheckpointTrigger[];
  coachingSourceRefs: string[];
  playbookSectionRefs: string[];
  industryTemplate: string;
  promptPatch: PromptPatch;
}

export interface ScenarioSnapshot extends ScenarioDraftInput {
  id: string;
  orgId: string;
  status: 'draft' | 'published' | 'archived';
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function emptyPromptPatch(): PromptPatch {
  return { systemAppendix: '', userKickoff: '', reviewerRubric: '' };
}

export function defaultPersonaSeed(): PersonaSeed {
  return {
    tone: 'direct',
    style: 'mentor',
    feedbackAxes: ['结构', '逻辑', '表达'],
    forbiddenZones: [],
  };
}
