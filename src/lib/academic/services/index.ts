/**
 * Academic Services barrel
 *
 * API 路由应该 import 这里，而不是逐个 import 具体文件。
 */

export * from './scenario-types';
export { orgService, type OrgService, type CreateOrgInput } from './org-service';
export {
  orgPlaybookService,
  type OrgPlaybookService,
  type PlaybookSectionKind,
  type CreatePlaybookSectionInput,
  type UpdatePlaybookSectionInput,
} from './org-playbook-service';
export { orgScenarioService, type OrgScenarioService } from './org-scenario-service';
export { defaultScenarioService, type DefaultScenarioService } from './default-scenario-service';
export { orgMemberService, type OrgMemberService, type CreateInviteInput } from './org-member-service';
export {
  orgAssetService,
  type OrgAssetService,
  type AssetKind,
  type CreateFileAssetInput,
  type CreateUrlAssetInput,
} from './org-asset-service';
export { documentExtractService, type DocumentExtractService } from './document-extract-service';
export {
  coachingSourceService,
  type CoachingSourceService,
  type CoachingSourceAnalysis,
} from './coaching-source-service';
export {
  coachingPersonaService,
  type CoachingPersonaService,
  type CoachingPromptBundle,
  type StudentInputPayload,
  type AcademicProfileSummary,
  type BuildSystemPromptInput,
} from './coaching-persona-service';
export {
  practiceSessionService,
  type PracticeSessionService,
  type SessionMessage,
  type StartSessionInput,
  type SendMessageInput,
} from './practice-session-service';
export {
  academicProfileService,
  type AcademicProfileService,
  type UpsertProfileInput,
} from './academic-profile-service';
export { checkpointService, type CheckpointService, type CreateCheckpointInput } from './checkpoint-service';
