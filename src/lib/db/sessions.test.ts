import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./schema', () => ({
  db: {
    audioSessions: {
      where: vi.fn(),
    },
  },
}));

import { db } from './schema';
import { updateSessionStatus } from './sessions';

describe('updateSessionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores corrupted non-string session ids before touching IndexedDB indexes', async () => {
    const where = vi.mocked(db.audioSessions.where);
    where.mockImplementation(() => {
      throw Object.assign(new Error('Failed to execute bound on IDBKeyRange'), { name: 'DataError' });
    });

    await expect(
      updateSessionStatus({ bad: 'session-id' } as unknown as string, 'completed'),
    ).resolves.toBeUndefined();

    expect(where).not.toHaveBeenCalled();
  });

  it('updates valid non-empty session ids', async () => {
    const modify = vi.fn().mockResolvedValue(1);
    const equals = vi.fn(() => ({ modify }));
    vi.mocked(db.audioSessions.where).mockReturnValue({ equals } as never);

    await updateSessionStatus('session-1', 'completed');

    expect(db.audioSessions.where).toHaveBeenCalledWith('sessionId');
    expect(equals).toHaveBeenCalledWith('session-1');
    expect(modify).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });
});
