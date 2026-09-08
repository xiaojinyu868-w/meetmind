import { z } from 'zod';

export class ContextError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = 'ContextError';
  }
}

const spaceId = z.string().trim().regex(/^[\w.:-]{1,120}$/);
const source = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.string().trim().max(60).optional(),
  externalId: z.string().trim().max(200).optional(),
  locator: z.string().max(500).optional(),
}).strict();

export const eventSchema = z.object({
  schemaVersion: z.literal(1),
  clientEventId: z.string().trim().min(1).max(200),
  type: z.string().trim().regex(/^[\w.:-]{1,100}$/),
  content: z.string().trim().min(1).max(40_000),
  spaceId: spaceId.default('personal'),
  source: source.optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
    .refine((value) => JSON.stringify(value).length <= 8_000, 'metadata_too_large'),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

export const prepareSchema = z.object({
  task: z.object({ intent: z.string().trim().min(1).max(4_000) }).strict(),
  scope: z.object({ spaceIds: z.array(spaceId).min(1).max(24).optional() }).strict().optional(),
  budget: z.object({ maxTokens: z.number().int().min(128).max(8_000).optional() }).strict().optional(),
  afterEventId: z.string().uuid().optional(),
}).strict();

export const grantSchema = z.object({
  appId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,59}$/),
  label: z.string().trim().min(1).max(100),
  capabilities: z.array(z.enum(['read', 'write'])).min(1).max(2),
  spaceIds: z.array(spaceId).min(1).max(24),
  expiresInDays: z.number().int().min(1).max(90).default(7),
}).strict();

export const actionSchema = z.object({
  action: z.enum(['pause', 'resume', 'forget']),
}).strict();

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ContextError('invalid_input', 400);
  return parsed.data;
}
