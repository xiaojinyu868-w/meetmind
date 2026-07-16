import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transcriptDeleteMany: vi.fn(),
  transcriptCreateMany: vi.fn(),
  artifactDeleteMany: vi.fn(),
  artifactCreateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
  },
}));

import {
  syncWorkspaceCaptureEvidence,
  toLightweightEvidenceMetadata,
} from './workspace-evidence-service';

describe('workspace evidence storage contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      workspaceTranscriptSegment: {
        deleteMany: mocks.transcriptDeleteMany,
        createMany: mocks.transcriptCreateMany,
      },
      workspaceCaptureArtifact: {
        deleteMany: mocks.artifactDeleteMany,
        createMany: mocks.artifactCreateMany,
      },
    }));
  });

  it('列表元数据移除大证据并保留可用索引', () => {
    expect(toLightweightEvidenceMetadata({
      sessionId: 'session-1',
      provider: 'bilibili',
      transcriptSegments: [{ text: '课堂内容' }],
      anchors: [{ timestamp: 1000 }],
      classSummary: { summaryId: 'summary-1' },
      highlightTopics: [],
      notes: [],
    })).toEqual({
      sessionId: 'session-1',
      provider: 'bilibili',
      evidenceAvailable: true,
    });
  });

  it('轻量 metadata 后续更新不会误删已经正规化的证据', async () => {
    await syncWorkspaceCaptureEvidence({
      captureId: 'capture-1',
      metadata: { sessionId: 'session-1', evidenceAvailable: true, provider: 'bilibili' },
      normalizedText: '列表摘要不能覆盖完整分段',
    });

    expect(mocks.transcriptDeleteMany).not.toHaveBeenCalled();
    expect(mocks.artifactDeleteMany).not.toHaveBeenCalled();
  });

  it('显式传入新转录时幂等替换分段', async () => {
    await syncWorkspaceCaptureEvidence({
      captureId: 'capture-1',
      metadata: {
        sessionId: 'session-1',
        evidenceAvailable: true,
        transcriptSegments: [{ id: 'segment-1', text: '新内容', startMs: 20, endMs: 80 }],
      },
    });

    expect(mocks.transcriptDeleteMany).toHaveBeenCalledWith({ where: { captureId: 'capture-1' } });
    expect(mocks.transcriptCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        captureId: 'capture-1',
        sessionId: 'session-1',
        segmentKey: 'segment-1:0',
        text: '新内容',
      })],
    });
  });
});
