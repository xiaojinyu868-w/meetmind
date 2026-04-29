import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';
import { DELETE as deleteCapture, PATCH as patchCapture, POST as createCapture } from '../../src/app/api/(meetmind-learning)/workspace/captures/route';
import { GET as getCurrentWorkspace } from '../../src/app/api/(meetmind-learning)/workspace/current/route';
import { authService } from '../../src/lib/services/auth-service';
import workspaceService from '../../src/lib/services/workspace-service';

test.describe.configure({ mode: 'serial' });

function buildAuthorizedRequest(url: string, token: string, method: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function createUserAndWorkspace() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await authService.register({
    username: `capture_phase2_${suffix}`,
    nickname: `Capture Phase2 ${suffix}`,
    password: 'Passw0rdA',
    email: `capture_phase2_${suffix}@example.com`,
  });

  expect(result.success).toBeTruthy();
  const accessToken = result.accessToken!;
  const userId = result.user!.id;
  const workspace = await workspaceService.ensureDefaultWorkspace(userId);
  expect(workspace).not.toBeNull();

  return {
    accessToken,
    userId,
    workspaceId: workspace!.id,
  };
}

test.describe('workspace capture phase2 routes', () => {
  test('archived captures can be queried with includeArchived and restored into the active flow', async () => {
    const { accessToken } = await createUserAndWorkspace();
    const sourceKey = `manual:restore-${Date.now()}`;

    const createResponse = await createCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'POST', {
        sourceType: 'manual-note',
        sourceKey,
        role: 'support',
        contentType: 'text',
        title: '这是一条待恢复的收集',
        previewText: '这是一条待恢复的收集',
        normalizedText: '这是一条待恢复的收集',
      })
    );
    expect(createResponse.status).toBe(200);
    const createBody = (await createResponse.json()) as {
      capture?: { id?: string };
    };

    const archiveResponse = await patchCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'PATCH', {
        captureId: createBody.capture?.id,
        action: 'archive',
      })
    );
    expect(archiveResponse.status).toBe(200);

    const activeOnlyResponse = await getCurrentWorkspace(
      buildAuthorizedRequest('http://localhost/api/workspace/current', accessToken, 'GET')
    );
    const activeOnlyBody = (await activeOnlyResponse.json()) as {
      captures?: Array<{ sourceKey?: string }>;
    };
    expect(activeOnlyBody.captures?.some((item) => item.sourceKey === sourceKey)).toBeFalsy();

    const includeArchivedResponse = await getCurrentWorkspace(
      buildAuthorizedRequest('http://localhost/api/workspace/current?includeArchived=1', accessToken, 'GET')
    );
    const includeArchivedBody = (await includeArchivedResponse.json()) as {
      captures?: Array<{ sourceKey?: string; status?: string }>;
    };
    const archivedCapture = includeArchivedBody.captures?.find((item) => item.sourceKey === sourceKey);
    expect(archivedCapture?.status).toBe('archived');

    const restoreResponse = await patchCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'PATCH', {
        captureId: createBody.capture?.id,
        action: 'restore',
      })
    );
    expect(restoreResponse.status).toBe(200);
    const restoreBody = (await restoreResponse.json()) as {
      capture?: { status?: string };
    };
    expect(restoreBody.capture?.status).toBe('active');

    const restoredCurrentResponse = await getCurrentWorkspace(
      buildAuthorizedRequest('http://localhost/api/workspace/current', accessToken, 'GET')
    );
    const restoredCurrentBody = (await restoredCurrentResponse.json()) as {
      captures?: Array<{ sourceKey?: string; status?: string }>;
    };
    const restoredCapture = restoredCurrentBody.captures?.find((item) => item.sourceKey === sourceKey);
    expect(restoredCapture?.status).toBe('active');
  });

  test('supports text editing, transcript correction, and metadata editing through update action', async () => {
    const { accessToken } = await createUserAndWorkspace();

    const textCreateResponse = await createCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'POST', {
        sourceType: 'manual-note',
        sourceKey: `manual:text-edit-${Date.now()}`,
        role: 'support',
        contentType: 'text',
        title: '原来的随手记录',
        previewText: '原来的随手记录',
        normalizedText: '原来的随手记录',
      })
    );
    const textCreateBody = (await textCreateResponse.json()) as {
      capture?: { id?: string; sourceKey?: string };
    };

    const editTextResponse = await patchCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'PATCH', {
        captureId: textCreateBody.capture?.id,
        sourceKey: textCreateBody.capture?.sourceKey,
        action: 'update',
        title: '更新后的文字标题',
        previewText: '更新后的文字正文',
        normalizedText: '更新后的文字正文',
        tutorContext: '更新后的文字正文',
      })
    );
    expect(editTextResponse.status).toBe(200);
    const editTextBody = (await editTextResponse.json()) as {
      capture?: {
        title?: string;
        previewText?: string;
        normalizedText?: string | null;
        tutorContext?: string | null;
      };
    };
    expect(editTextBody.capture?.title).toBe('更新后的文字标题');
    expect(editTextBody.capture?.previewText).toContain('更新后的文字正文');
    expect(editTextBody.capture?.normalizedText).toBe('更新后的文字正文');
    expect(editTextBody.capture?.tutorContext).toBe('更新后的文字正文');

    const audioCreateResponse = await createCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'POST', {
        sourceType: 'manual-audio',
        sourceKey: `manual:transcript-edit-${Date.now()}`,
        role: 'primary',
        contentType: 'audio',
        title: '课堂原声 01',
        previewText: '原始转写片段',
        normalizedText: '原始转写片段',
        tutorContext: '原始转写片段',
      })
    );
    const audioCreateBody = (await audioCreateResponse.json()) as {
      capture?: { id?: string; sourceKey?: string };
    };

    const editTranscriptResponse = await patchCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'PATCH', {
        captureId: audioCreateBody.capture?.id,
        sourceKey: audioCreateBody.capture?.sourceKey,
        action: 'update',
        previewText: '校正后的转写片段',
        normalizedText: '校正后的转写片段',
        tutorContext: '校正后的转写片段',
      })
    );
    expect(editTranscriptResponse.status).toBe(200);
    const editTranscriptBody = (await editTranscriptResponse.json()) as {
      capture?: {
        previewText?: string;
        normalizedText?: string | null;
        tutorContext?: string | null;
      };
    };
    expect(editTranscriptBody.capture?.previewText).toContain('校正后的转写片段');
    expect(editTranscriptBody.capture?.normalizedText).toBe('校正后的转写片段');
    expect(editTranscriptBody.capture?.tutorContext).toBe('校正后的转写片段');

    const documentCreateResponse = await createCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'POST', {
        sourceType: 'manual-document',
        sourceKey: `manual:meta-edit-${Date.now()}`,
        role: 'support',
        contentType: 'document',
        title: '旧讲义标题',
        previewText: '旧讲义备注',
      })
    );
    const documentCreateBody = (await documentCreateResponse.json()) as {
      capture?: { id?: string; sourceKey?: string };
    };

    const editMetaResponse = await patchCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'PATCH', {
        captureId: documentCreateBody.capture?.id,
        sourceKey: documentCreateBody.capture?.sourceKey,
        action: 'update',
        title: '整理后的讲义标题',
        previewText: '这份讲义后来补了更清楚的备注。',
      })
    );
    expect(editMetaResponse.status).toBe(200);
    const editMetaBody = (await editMetaResponse.json()) as {
      capture?: {
        title?: string;
        previewText?: string;
      };
    };
    expect(editMetaBody.capture?.title).toBe('整理后的讲义标题');
    expect(editMetaBody.capture?.previewText).toContain('这份讲义后来补了更清楚的备注。');

    const deleteResponse = await deleteCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'DELETE', {
        captureId: audioCreateBody.capture?.id,
      })
    );
    expect(deleteResponse.status).toBe(200);
  });
});
