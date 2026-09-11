import { beforeEach, describe, expect, it, vi } from 'vitest';

// 假 IndexedDB：只要 toArray() 与 markSessionsMigrated 的形状，签名写回直接改内存里的行
type Row = Record<string, unknown> & { sessionId: string };
const tables: Record<string, Row[]> = {
  audioSessions: [],
  transcripts: [],
  anchors: [],
  classSummaries: [],
  highlightTopics: [],
  notes: [],
  conversationHistory: [],
};
const markSessionsMigrated = vi.fn(async (entries: Array<{ sessionId: string; signature: string }>) => {
  for (const entry of entries) {
    const row = tables.audioSessions.find((item) => item.sessionId === entry.sessionId);
    if (row) {
      row.migrationSignature = entry.signature;
      if (!row.syncState) row.syncState = 'synced';
    }
  }
});

vi.mock('@/lib/db', () => ({
  ANONYMOUS_USER_ID: 'anonymous',
  markSessionsMigrated: (entries: Array<{ sessionId: string; signature: string }>) => markSessionsMigrated(entries),
  db: new Proxy({}, {
    get: (_target, table: string) => ({ toArray: async () => tables[table] ?? [] }),
  }),
}));
vi.mock('@/lib/services/memory-migration', () => ({ runMemoryMigration: async () => undefined }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }));

import {
  buildMigrationSignature,
  hashSignatureInput,
  needsMigration,
  runLocalWorkspaceMigration,
} from './local-workspace-migration';

function session(overrides: Partial<Row> & { sessionId: string }): Row {
  const now = new Date('2026-09-11T02:00:00Z');
  return {
    userId: 'anonymous',
    status: 'completed',
    duration: 60_000,
    sourceType: 'recording',
    mimeType: 'audio/webm',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function transcript(sessionId: string, index: number): Row {
  return { sessionId, text: `第 ${index} 句`, startMs: index * 1000, endMs: index * 1000 + 900, isFinal: true, confidence: 0.9 };
}

const evidence = {
  transcripts: { count: 3, lastEndMs: 2900, textLength: 12 },
  anchors: { count: 0, lastUpdatedAt: 0 },
  summaryUpdatedAt: 0,
  highlights: { count: 0, lastUpdatedAt: 0 },
  notes: { count: 0, lastUpdatedAt: 0 },
  conversations: { count: 0, lastUpdatedAt: 0 },
};

describe('migration signature', () => {
  it('同样的证据同样的签名；任何会进 payload 的东西变了签名就变', () => {
    const base = session({ sessionId: 's1' });
    const a = buildMigrationSignature('u1', base as never, evidence);
    expect(a).toBe(buildMigrationSignature('u1', base as never, evidence));
    expect(buildMigrationSignature('u2', base as never, evidence)).not.toBe(a);
    expect(buildMigrationSignature('u1', base as never, { ...evidence, notes: { count: 1, lastUpdatedAt: 5 } })).not.toBe(a);
    expect(buildMigrationSignature('u1', { ...base, topic: '改了名' } as never, evidence)).not.toBe(a);
    expect(buildMigrationSignature('u1', { ...base, updatedAt: new Date(0) } as never, evidence)).toBe(a);
  });

  it('哈希短且稳定', () => {
    expect(hashSignatureInput('abc')).toBe(hashSignatureInput('abc'));
    expect(hashSignatureInput('abc')).not.toBe(hashSignatureInput('abd'));
    expect(hashSignatureInput('x').length).toBeLessThanOrEqual(7);
  });

  it('正在录的课不推；从没推过或签名变了才推', () => {
    expect(needsMigration({ status: 'recording', migrationSignature: undefined }, 'sig')).toBe(false);
    expect(needsMigration({ status: 'completed', migrationSignature: undefined }, 'sig')).toBe(true);
    expect(needsMigration({ status: 'completed', migrationSignature: 'sig' }, 'sig')).toBe(false);
    expect(needsMigration({ status: 'completed', migrationSignature: 'old' }, 'sig')).toBe(true);
  });
});

describe('runLocalWorkspaceMigration', () => {
  beforeEach(() => {
    markSessionsMigrated.mockClear();
    tables.audioSessions = [
      session({ sessionId: 'new-1' }),
      session({ sessionId: 'other-user', userId: 'someone-else' }),
      session({ sessionId: 'in-progress', status: 'recording' }),
      session({ sessionId: 'empty-shell', duration: 0 }),
    ];
    tables.transcripts = [
      transcript('new-1', 0), transcript('new-1', 1),
      transcript('in-progress', 0),
      transcript('other-user', 0),
    ];
    tables.anchors = [];
    tables.classSummaries = [];
    tables.highlightTopics = [];
    tables.notes = [];
    tables.conversationHistory = [];
  });

  it('第一次只推有内容、不在录、属于本用户的课；成功后写回签名，第二次零请求', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const first = await runLocalWorkspaceMigration({ userId: 'u1', accessToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { sessions: Array<{ sessionId: string }> };
    expect(body.sessions.map((item) => item.sessionId)).toEqual(['new-1']);
    expect(first).toMatchObject({ candidates: 3, pushed: 1, skipped: 2, failed: 0 });
    expect(markSessionsMigrated).toHaveBeenCalledTimes(1);
    expect(tables.audioSessions[0].migrationSignature).toBeTruthy();
    expect(tables.audioSessions[0].syncState).toBe('synced');

    fetchImpl.mockClear();
    const second = await runLocalWorkspaceMigration({ userId: 'u1', accessToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(second).toMatchObject({ pushed: 0, failed: 0 });
  });

  it('课后加了笔记 → 签名变了 → 只有这节课再推一次', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    await runLocalWorkspaceMigration({ userId: 'u1', accessToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    fetchImpl.mockClear();

    tables.notes = [{ sessionId: 'new-1', noteId: 'n1', text: '课后补的笔记', source: 'manual', createdAt: new Date(), updatedAt: new Date() }];
    const result = await runLocalWorkspaceMigration({ userId: 'u1', accessToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.pushed).toBe(1);
  });

  it('推送失败不标记，下次仍会推；413 拆成 5 节一批', async () => {
    tables.audioSessions = Array.from({ length: 7 }, (_, index) => session({ sessionId: `s${index}` }));
    tables.transcripts = tables.audioSessions.map((row) => transcript(row.sessionId, 0));
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      const count = (JSON.parse(init.body as string) as { sessions: unknown[] }).sessions.length;
      if (count > 5) return new Response('', { status: 413 });
      // 第二个小批（2 节）模拟网络失败
      if (count === 2) return new Response('', { status: 500 });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    const result = await runLocalWorkspaceMigration({ userId: 'u1', accessToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(calls).toBe(3); // 7 节一批 → 413 → 5 + 2
    expect(result).toMatchObject({ pushed: 5, failed: 2 });
    expect(tables.audioSessions.filter((row) => row.migrationSignature).length).toBe(5);
  });
});
