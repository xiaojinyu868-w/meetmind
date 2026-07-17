import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: queryRaw,
  },
}));

import { GET } from './route';

describe('GET /api/health', () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('returns a non-cacheable healthy response when the required schema is reachable', async () => {
    queryRaw.mockResolvedValue([{ name: 'User' }]);

    const response = await GET();
    const body = await response.json();
    const [queryParts] = queryRaw.mock.calls[0];

    expect(queryParts.join(' ')).toContain("name = 'User'");
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      status: 'ok',
      service: 'meetmind',
    });
    expect(body.uptimeSeconds).toEqual(expect.any(Number));
    expect(body.checkedAt).toEqual(expect.any(String));
  });

  it('returns 503 when the required application schema is missing', async () => {
    queryRaw.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
  });

  it('returns 503 without exposing database errors when the database is unavailable', async () => {
    queryRaw.mockRejectedValue(new Error('database path and secret details'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      status: 'degraded',
      service: 'meetmind',
    });
    expect(JSON.stringify(body)).not.toContain('database path and secret details');
  });
});
