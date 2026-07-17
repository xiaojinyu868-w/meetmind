import prisma from '@/lib/prisma';
import type {
  WechatQrAuthMode,
  WechatQrChallengeRecord,
  WechatQrChallengeRepository,
  WechatQrChallengeStatus,
} from './wechat-qr-auth-service';

type DbChallengeRecord = Omit<WechatQrChallengeRecord, 'mode' | 'status'> & {
  mode: string;
  status: string;
};

type WechatQrChallengePrisma = {
  wechatQrAuthChallenge: {
    create: (args: { data: Record<string, unknown> }) => Promise<DbChallengeRecord>;
    findUnique: (args: { where: Record<string, unknown> }) => Promise<DbChallengeRecord | null>;
    findFirst: (args: { where: Record<string, unknown>; orderBy: Record<string, string> }) => Promise<DbChallengeRecord | null>;
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
  };
};

function parseMode(value: string): WechatQrAuthMode {
  if (value === 'login' || value === 'bind') return value;
  throw new Error(`Invalid WeChat QR auth mode: ${value}`);
}

function parseStatus(value: string): WechatQrChallengeStatus {
  if (
    value === 'pending'
    || value === 'scanned'
    || value === 'processing'
    || value === 'consumed'
    || value === 'failed'
    || value === 'expired'
  ) return value;
  throw new Error(`Invalid WeChat QR auth status: ${value}`);
}

function toChallengeRecord(record: DbChallengeRecord): WechatQrChallengeRecord {
  return {
    ...record,
    mode: parseMode(record.mode),
    status: parseStatus(record.status),
  };
}

export function createPrismaWechatQrChallengeRepository(
  client: WechatQrChallengePrisma,
): WechatQrChallengeRepository {
  return {
    async create(data) {
      const record = await client.wechatQrAuthChallenge.create({ data });
      return toChallengeRecord(record);
    },

    async findById(id) {
      const record = await client.wechatQrAuthChallenge.findUnique({ where: { id } });
      return record ? toChallengeRecord(record) : null;
    },

    async findByScene(scene) {
      const record = await client.wechatQrAuthChallenge.findUnique({ where: { scene } });
      return record ? toChallengeRecord(record) : null;
    },

    async findReusable(input) {
      const record = await client.wechatQrAuthChallenge.findFirst({
        where: {
          browserTokenHash: input.browserTokenHash,
          mode: input.mode,
          targetUserId: input.targetUserId,
          status: 'pending',
          expiresAt: { gt: input.now },
        },
        orderBy: { createdAt: 'desc' },
      });
      return record ? toChallengeRecord(record) : null;
    },

    async markScanned(id, openId, scannedAt) {
      const result = await client.wechatQrAuthChallenge.updateMany({
        where: { id, status: 'pending', expiresAt: { gt: scannedAt } },
        data: { status: 'scanned', openId, scannedAt },
      });
      return result.count === 1;
    },

    async claimForProcessing(id, claimedAt) {
      const result = await client.wechatQrAuthChallenge.updateMany({
        where: { id, status: 'scanned', expiresAt: { gt: claimedAt } },
        data: { status: 'processing' },
      });
      return result.count === 1;
    },

    async markConsumed(id, resultUserId, consumedAt) {
      const result = await client.wechatQrAuthChallenge.updateMany({
        where: { id, status: 'processing' },
        data: { status: 'consumed', resultUserId, consumedAt },
      });
      return result.count === 1;
    },

    async markFailed(id, error) {
      const result = await client.wechatQrAuthChallenge.updateMany({
        where: { id, status: 'processing' },
        data: { status: 'failed', error },
      });
      return result.count === 1;
    },

    async markExpired(id) {
      const result = await client.wechatQrAuthChallenge.updateMany({
        where: { id, status: { in: ['pending', 'scanned'] } },
        data: { status: 'expired' },
      });
      return result.count === 1;
    },

    async deleteStale(before) {
      const result = await client.wechatQrAuthChallenge.deleteMany({
        where: { expiresAt: { lt: before } },
      });
      return result.count;
    },
  };
}

export const prismaWechatQrChallengeRepository = createPrismaWechatQrChallengeRepository(
  prisma as unknown as WechatQrChallengePrisma,
);
