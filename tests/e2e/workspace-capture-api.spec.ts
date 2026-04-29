import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';
import { DELETE as deleteCapture, PATCH as patchCapture, POST as createCapture } from '../../src/app/api/(meetmind-learning)/workspace/captures/route';
import { GET as getCurrentWorkspace } from '../../src/app/api/(meetmind-learning)/workspace/current/route';
import prisma from '../../src/lib/prisma';
import { authService } from '../../src/lib/services/auth-service';
import workspaceContextService from '../../src/lib/services/workspace-context-service';
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
    username: `capture_${suffix}`,
    nickname: `Capture ${suffix}`,
    password: 'Passw0rdA',
    email: `capture_${suffix}@example.com`,
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

test.describe('workspace capture lifecycle route', () => {
  test('archive removes a capture from current workspace context', async () => {
    const { accessToken } = await createUserAndWorkspace();
    const sourceKey = `manual:archive-${Date.now()}`;

    const createResponse = await createCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'POST', {
        sourceType: 'manual-note',
        sourceKey,
        role: 'support',
        contentType: 'text',
        title: '这是一条要归档的收集',
        previewText: '这是一条要归档的收集',
        normalizedText: '这是一条要归档的收集',
      })
    );

    expect(createResponse.status).toBe(200);
    const createBody = (await createResponse.json()) as {
      success?: boolean;
      capture?: { id?: string; status?: string };
    };
    expect(createBody.success).toBeTruthy();
    expect(createBody.capture?.status).toBe('active');

    const archiveResponse = await patchCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'PATCH', {
        captureId: createBody.capture?.id,
        action: 'archive',
      })
    );

    expect(archiveResponse.status).toBe(200);
    const archiveBody = (await archiveResponse.json()) as {
      success?: boolean;
      capture?: { status?: string };
    };
    expect(archiveBody.success).toBeTruthy();
    expect(archiveBody.capture?.status).toBe('archived');

    const currentResponse = await getCurrentWorkspace(
      buildAuthorizedRequest('http://localhost/api/workspace/current', accessToken, 'GET')
    );
    expect(currentResponse.status).toBe(200);
    const currentBody = (await currentResponse.json()) as {
      success?: boolean;
      captures?: Array<{ sourceKey?: string }>;
    };

    expect(currentBody.success).toBeTruthy();
    expect(currentBody.captures?.some((item) => item.sourceKey === sourceKey)).toBeFalsy();
  });

  test('hard delete retires related daily echo and prevents same sourceKey from resurfacing', async () => {
    const { accessToken, userId, workspaceId } = await createUserAndWorkspace();
    const sourceKey = `manual:delete-${Date.now()}`;

    const capture = await prisma.workspaceCapture.create({
      data: {
        workspaceId,
        userId,
        sourceType: 'manual-note',
        sourceKey,
        role: 'primary',
        contentType: 'text',
        title: '要彻底删除的灵感',
        previewText: '要彻底删除的灵感',
        normalizedText: '要彻底删除的灵感',
        tutorContext: '要彻底删除的灵感',
      },
    });

    const echo = await prisma.workspaceEcho.create({
      data: {
        workspaceId,
        sourceKey: `daily:${workspaceId}:2099-01-01`,
        kind: 'daily_return_reason',
        generatedDateKey: '2099-01-01',
        title: '旧回声',
        body: '这条回声还引用着那条灵感。',
        status: 'active',
        metadataJson: JSON.stringify({
          memory: {
            sourceCaptureCount: 1,
            todayCaptureCount: 1,
            recentCaptureCount: 0,
            sourceCaptureIds: [capture.id],
            sourceKeys: [capture.sourceKey],
          },
        }),
      },
    });

    const deleteResponse = await deleteCapture(
      buildAuthorizedRequest('http://localhost/api/workspace/captures', accessToken, 'DELETE', {
        captureId: capture.id,
      })
    );

    expect(deleteResponse.status).toBe(200);
    const deleteBody = (await deleteResponse.json()) as {
      success?: boolean;
      capture?: { status?: string };
      retiredEchoIds?: string[];
    };
    expect(deleteBody.success).toBeTruthy();
    expect(deleteBody.capture?.status).toBe('deleted');
    expect(deleteBody.retiredEchoIds).toContain(echo.id);

    const currentResponse = await getCurrentWorkspace(
      buildAuthorizedRequest('http://localhost/api/workspace/current', accessToken, 'GET')
    );
    const currentBody = (await currentResponse.json()) as {
      success?: boolean;
      captures?: Array<{ sourceKey?: string }>;
      echoes?: Array<{ id?: string }>;
    };
    expect(currentBody.success).toBeTruthy();
    expect(currentBody.captures?.some((item) => item.sourceKey === sourceKey)).toBeFalsy();
    expect(currentBody.echoes?.some((item) => item.id === echo.id)).toBeFalsy();

    const upsertResult = await workspaceContextService.upsertCaptureForUser(userId, {
      sourceType: 'manual-note',
      sourceKey,
      role: 'primary',
      contentType: 'text',
      title: '同一条 sourceKey 又被重新写入',
      previewText: '同一条 sourceKey 又被重新写入',
      normalizedText: '同一条 sourceKey 又被重新写入',
    });

    expect(upsertResult.capture.status).toBe('deleted');

    const afterUpsertContext = await workspaceContextService.getCurrentWorkspaceContext(userId);
    expect(afterUpsertContext.captures.some((item) => item.sourceKey === sourceKey)).toBeFalsy();
  });
});
