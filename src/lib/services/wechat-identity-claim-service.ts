import prisma from '@/lib/prisma';

export type WechatIdentityClaimStatus =
  | 'created'
  | 'existing'
  | 'owned-by-target'
  | 'owned-by-other';

export interface WechatIdentityClaimInput {
  openId: string;
  targetUserId?: string;
  username: string;
  nickname: string;
  avatar?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface WechatIdentityClaimResult {
  status: WechatIdentityClaimStatus;
  userId: string;
  created: boolean;
}

export interface WechatIdentityClaimStore {
  claim: (input: WechatIdentityClaimInput) => Promise<WechatIdentityClaimResult>;
  findOwner: (openId: string) => Promise<string | null>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'P2002',
  );
}

export function createWechatIdentityClaimService(store: WechatIdentityClaimStore) {
  return {
    async claim(input: WechatIdentityClaimInput): Promise<WechatIdentityClaimResult> {
      try {
        return await store.claim(input);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        const actualOwner = await store.findOwner(input.openId);
        if (!actualOwner) throw error;
        if (input.targetUserId && actualOwner !== input.targetUserId) {
          return { status: 'owned-by-other', userId: actualOwner, created: false };
        }
        return {
          status: input.targetUserId ? 'owned-by-target' : 'existing',
          userId: actualOwner,
          created: false,
        };
      }
    },
  };
}

function providerTokenData(input: WechatIdentityClaimInput) {
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  };
}

export const prismaWechatIdentityClaimStore: WechatIdentityClaimStore = {
  async claim(input) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.authProvider.findUnique({
        where: {
          provider_providerId: {
            provider: 'wechat',
            providerId: input.openId,
          },
        },
        select: { userId: true },
      });

      if (existing) {
        if (input.targetUserId && existing.userId !== input.targetUserId) {
          return { status: 'owned-by-other', userId: existing.userId, created: false };
        }

        await tx.authProvider.update({
          where: {
            provider_providerId: {
              provider: 'wechat',
              providerId: input.openId,
            },
          },
          data: providerTokenData(input),
        });
        return {
          status: input.targetUserId ? 'owned-by-target' : 'existing',
          userId: existing.userId,
          created: false,
        };
      }

      if (input.targetUserId) {
        await tx.authProvider.create({
          data: {
            userId: input.targetUserId,
            provider: 'wechat',
            providerId: input.openId,
            ...providerTokenData(input),
          },
        });
        return { status: 'owned-by-target', userId: input.targetUserId, created: false };
      }

      const user = await tx.user.create({
        data: {
          username: input.username,
          nickname: input.nickname,
          avatar: input.avatar,
          role: 'student',
          status: 'active',
          passwordHash: null,
          salt: null,
        },
        select: { id: true },
      });
      await tx.authProvider.create({
        data: {
          userId: user.id,
          provider: 'wechat',
          providerId: input.openId,
          ...providerTokenData(input),
        },
      });
      return { status: 'created', userId: user.id, created: true };
    });
  },

  async findOwner(openId) {
    const provider = await prisma.authProvider.findUnique({
      where: {
        provider_providerId: {
          provider: 'wechat',
          providerId: openId,
        },
      },
      select: { userId: true },
    });
    return provider?.userId || null;
  },
};

export const wechatIdentityClaimService = createWechatIdentityClaimService(
  prismaWechatIdentityClaimStore,
);
