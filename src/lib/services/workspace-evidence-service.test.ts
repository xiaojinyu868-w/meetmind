import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transcriptCount: vi.fn(),
  transcriptDeleteMany: vi.fn(),
  transcriptCreateMany: vi.fn(),
  artifactDeleteMany: vi.fn(),
  artifactCreateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
    workspaceTranscriptSegment: {
      count: mocks.transcriptCount,
    },
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
    // 默认表里还没有分段
    mocks.transcriptCount.mockResolvedValue(0);
  });

  it('列表元数据移除大证据并保留可用索引', () => {
    expect(toLightweightEvidenceMetadata({
      sessionId: 'session-1',
      capturedAtMs: 122_000,
      provider: 'bilibili',
      transcriptSegments: [{ text: '课堂内容' }],
      anchors: [{ timestamp: 1000 }],
      classSummary: { summaryId: 'summary-1' },
      highlightTopics: [],
      notes: [],
    })).toEqual({
      sessionId: 'session-1',
      capturedAtMs: 122_000,
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

  it('护栏：normalizedText 兜底单段永不覆盖表里已有的真实分段', async () => {
    // 真实案例：客户端轻量回刷把 100 分钟播客的 752 段删成 1 条整段兜底
    mocks.transcriptCount.mockResolvedValue(752);
    await syncWorkspaceCaptureEvidence({
      captureId: 'capture-1',
      metadata: { sessionId: 'session-1', from: 'transcript-ingest' },
      normalizedText: '只有摘要片段',
    });

    expect(mocks.transcriptDeleteMany).not.toHaveBeenCalled();
    expect(mocks.transcriptCreateMany).not.toHaveBeenCalled();
  });

  it('护栏：更少的显式分段不允许回退更完整的既有分段', async () => {
    mocks.transcriptCount.mockResolvedValue(752);
    await syncWorkspaceCaptureEvidence({
      captureId: 'capture-1',
      metadata: {
        sessionId: 'session-1',
        transcriptSegments: [{ id: 's1', text: '客户端 500 段快照', startMs: 0, endMs: 80 }],
      },
    });

    expect(mocks.transcriptDeleteMany).not.toHaveBeenCalled();
  });

  it('护栏：更完整的重导入分段允许覆盖（补全场景）', async () => {
    mocks.transcriptCount.mockResolvedValue(2);
    await syncWorkspaceCaptureEvidence({
      captureId: 'capture-1',
      metadata: {
        sessionId: 'session-1',
        transcriptSegments: [
          { id: 's1', text: '第一段', startMs: 0, endMs: 80 },
          { id: 's2', text: '第二段', startMs: 80, endMs: 160 },
          { id: 's3', text: '第三段', startMs: 160, endMs: 240 },
        ],
      },
    });

    expect(mocks.transcriptDeleteMany).toHaveBeenCalledWith({ where: { captureId: 'capture-1' } });
    expect(mocks.transcriptCreateMany).toHaveBeenCalled();
  });
});
