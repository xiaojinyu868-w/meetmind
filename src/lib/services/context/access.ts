import { createHash, randomBytes } from 'node:crypto';
import type { ContextGrant } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';
import type { ContextCapability, ContextGrantRecord, ContextPrincipal } from '@/types/context';
import { ContextError, grantSchema, parseInput } from './validation';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function ownerPrincipal(userId: string): ContextPrincipal {
  return { userId, appId: 'meetmind', owner: true, capabilities: ['read', 'write'], spaceIds: [] };
}

export function requireCapability(principal: ContextPrincipal, capability: ContextCapability): void {
  if (!principal.capabilities.includes(capability)) throw new ContextError('scope_denied', 403);
}

export function requireOwner(principal: ContextPrincipal): void {
  if (!principal.owner) throw new ContextError('owner_required', 403);
}

export function requireSpace(principal: ContextPrincipal, spaceId: string): void {
  if (!principal.owner && !principal.spaceIds.includes(spaceId)) throw new ContextError('scope_denied', 403);
}

/** Called again before publishing a read result: revocation can race a slow backend call. */
export async function assertPrincipalActive(principal: ContextPrincipal): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: principal.userId }, select: { status: true } });
  if (user?.status !== 'active') throw new ContextError('unauthorized', 401);
  if (principal.grantId) {
    const grant = await prisma.contextGrant.findFirst({
      where: { id: principal.grantId, userId: principal.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!grant) throw new ContextError('unauthorized', 401);
  }
}

export async function authenticateContext(authorization: string | null): Promise<ContextPrincipal> {
  const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 8_192) throw new ContextError('unauthorized', 401);
  let principal: ContextPrincipal;
  if (token.startsWith('mmctx_')) {
    const grant = await prisma.contextGrant.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) throw new ContextError('unauthorized', 401);
    principal = {
      userId: grant.userId, appId: grant.appId, grantId: grant.id, owner: false,
      capabilities: JSON.parse(grant.capabilitiesJson), spaceIds: JSON.parse(grant.spaceIdsJson),
    };
  } else {
    if (!process.env.JWT_SECRET?.trim()) throw new ContextError('auth_not_configured', 503);
    const payload = authService.verifyToken(token);
    if (!payload) throw new ContextError('unauthorized', 401);
    principal = ownerPrincipal(payload.sub);
  }
  await assertPrincipalActive(principal);
  return principal;
}

function grantRecord(grant: ContextGrant): ContextGrantRecord {
  return {
    id: grant.id, appId: grant.appId, label: grant.label,
    capabilities: JSON.parse(grant.capabilitiesJson), spaceIds: JSON.parse(grant.spaceIdsJson),
    createdAt: grant.createdAt.toISOString(), expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}

export async function createGrant(principal: ContextPrincipal, input: unknown) {
  requireOwner(principal);
  const data = parseInput(grantSchema, input);
  if (data.appId === 'meetmind') throw new ContextError('reserved_app_id', 400);
  const token = `mmctx_${randomBytes(32).toString('base64url')}`;
  const grant = await prisma.contextGrant.create({ data: {
    userId: principal.userId, appId: data.appId, label: data.label, tokenHash: hashToken(token),
    capabilitiesJson: JSON.stringify([...new Set(data.capabilities)]),
    spaceIdsJson: JSON.stringify([...new Set(data.spaceIds)]),
    expiresAt: new Date(Date.now() + data.expiresInDays * 86_400_000),
  } });
  return { grant: grantRecord(grant), token };
}

export async function listGrants(principal: ContextPrincipal) {
  requireOwner(principal);
  const grants = await prisma.contextGrant.findMany({ where: { userId: principal.userId }, orderBy: { createdAt: 'desc' } });
  return { grants: grants.map(grantRecord) };
}

export async function revokeGrant(principal: ContextPrincipal, id: string): Promise<void> {
  requireOwner(principal);
  const result = await prisma.contextGrant.updateMany({
    where: { id, userId: principal.userId }, data: { revokedAt: new Date() },
  });
  if (!result.count) throw new ContextError('not_found', 404);
}
