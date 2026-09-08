/** Framework-neutral Context v1 contract. Education data stays in content/metadata. */
export type ContextCapability = 'read' | 'write';
export type ContextDeliveryStatus = 'queued' | 'submitted' | 'completed' | 'retrying' | 'failed';
export type ContextVisibility = 'active' | 'paused' | 'forgotten';

export interface ContextPrincipal {
  userId: string;
  appId: string;
  grantId?: string;
  capabilities: ContextCapability[];
  spaceIds: string[];
  owner: boolean;
}

export interface ContextSource {
  title: string;
  kind?: string;
  externalId?: string;
  locator?: string;
}

export interface ContextEventInput {
  schemaVersion: 1;
  clientEventId: string;
  type: string;
  content: string;
  spaceId?: string;
  source?: ContextSource;
  metadata?: Record<string, unknown>;
  occurredAt: string;
}

export interface ContextEventReceipt {
  eventId: string;
  jobId: string;
  status: ContextDeliveryStatus;
  duplicate: boolean;
}

export interface ContextEventRecord {
  id: string;
  appId: string;
  spaceId: string;
  type: string;
  content: string | null;
  source?: ContextSource;
  metadata: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
  visibility: ContextVisibility;
  status: ContextDeliveryStatus;
  cleanupPending: boolean;
}

export interface ContextPrepareInput {
  task: { intent: string };
  scope?: { spaceIds?: string[] };
  budget?: { maxTokens?: number };
  afterEventId?: string;
}

export interface ContextMemory {
  id: string;
  text: string;
  kind: string;
  sourceEventIds: string[];
  observedAt?: string;
}

export interface UserContextBundle {
  schemaVersion: 1;
  memories: ContextMemory[];
  observations: ContextEventRecord[];
  sources: Array<Pick<ContextEventRecord, 'id' | 'appId' | 'spaceId' | 'source' | 'occurredAt'>>;
  text: string;
  contextVersion: string;
  pendingEventIds: string[];
  degraded: boolean;
  reason?: string;
}

export interface ContextGrantInput {
  appId: string;
  label: string;
  capabilities: ContextCapability[];
  spaceIds: string[];
  expiresInDays?: number;
}

export interface ContextGrantRecord {
  id: string;
  appId: string;
  label: string;
  capabilities: ContextCapability[];
  spaceIds: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
