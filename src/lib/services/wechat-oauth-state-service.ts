import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';

const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const STALE_STATE_RETENTION_MS = 24 * 60 * 60 * 1000;

export const wechatOauthStateService = {
  async create(linkToken?: string): Promise<string> {
    const now = new Date();
    await prisma.wechatOauthState.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - STALE_STATE_RETENTION_MS) } },
    });
    const state = randomBytes(24).toString('base64url');
    await prisma.wechatOauthState.create({
      data: {
        state,
        linkToken: linkToken || null,
        expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
      },
    });
    return state;
  },

  async consume(state: string): Promise<{ linkToken: string | null } | null> {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const record = await tx.wechatOauthState.findUnique({ where: { state } });
      if (!record || record.consumedAt || record.expiresAt.getTime() <= now.getTime()) return null;
      const claimed = await tx.wechatOauthState.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      return claimed.count === 1 ? { linkToken: record.linkToken } : null;
    });
  },
};

export default wechatOauthStateService;
