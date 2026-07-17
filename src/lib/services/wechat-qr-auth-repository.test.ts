import { describe, expect, it, vi } from 'vitest';
import { createPrismaWechatQrChallengeRepository } from './wechat-qr-auth-repository';

const dbRecord = {
  id: 'challenge-1',
  scene: 'mm_auth_scene-1',
  mode: 'login',
  browserTokenHash: 'hash',
  targetUserId: null,
  status: 'pending',
  imageUrl: 'https://mp.weixin.qq.com/qr',
  openId: null,
  resultUserId: null,
  error: null,
  expiresAt: new Date('2026-07-17T00:05:00.000Z'),
  scannedAt: null,
  consumedAt: null,
};

function createClient(updateMany = vi.fn(async () => ({ count: 1 }))) {
  return {
    updateMany,
    client: {
      wechatQrAuthChallenge: {
        create: vi.fn(async () => dbRecord),
        findUnique: vi.fn(async () => dbRecord),
        findFirst: vi.fn(async () => null),
        updateMany,
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    },
  };
}

describe('Prisma WeChat QR challenge repository', () => {
  it('claims only a scanned and unexpired challenge for processing', async () => {
    const { client, updateMany } = createClient();
    const repository = createPrismaWechatQrChallengeRepository(client);
    const claimedAt = new Date('2026-07-17T00:01:00.000Z');

    await expect(repository.claimForProcessing('challenge-1', claimedAt)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'challenge-1', status: 'scanned', expiresAt: { gt: claimedAt } },
      data: { status: 'processing' },
    });
  });

  it('marks consumed only from processing without storing session tokens', async () => {
    const { client, updateMany } = createClient();
    const repository = createPrismaWechatQrChallengeRepository(client);
    const consumedAt = new Date('2026-07-17T00:01:00.000Z');

    await expect(repository.markConsumed('challenge-1', 'user-1', consumedAt)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'challenge-1', status: 'processing' },
      data: { status: 'consumed', resultUserId: 'user-1', consumedAt },
    });
  });

  it('expires only pending or scanned challenges', async () => {
    const { client, updateMany } = createClient();
    const repository = createPrismaWechatQrChallengeRepository(client);

    await repository.markExpired('challenge-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'challenge-1', status: { in: ['pending', 'scanned'] } },
      data: { status: 'expired' },
    });
  });
});
