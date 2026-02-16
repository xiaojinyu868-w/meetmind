import { expect, test } from '@playwright/test';

test.describe('Source Ingest API', () => {
  test('accepts pasted text JSON and returns transcript segments', async ({ request }) => {
    const response = await request.post('/api/sources/ingest', {
      data: {
        title: '圆锥曲线离心率课堂提示',
        text: `
本节课主题是圆锥曲线离心率。
重点包括：定义统一写法、几何条件转代数条件、参数范围判断。
        `.trim(),
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      success?: boolean;
      kind?: string;
      title?: string;
      segments?: Array<{ text?: string; startMs?: number; endMs?: number }>;
    };

    expect(body.success).toBeTruthy();
    expect(body.kind).toBe('text');
    expect(body.title).toBe('圆锥曲线离心率课堂提示');
    expect(Array.isArray(body.segments)).toBeTruthy();
    expect((body.segments || []).length).toBeGreaterThan(0);
    expect((body.segments || [])[0]?.startMs).toBe(0);
    expect(typeof (body.segments || [])[0]?.text).toBe('string');
  });

  test('accepts txt file upload and returns parsed segments', async ({ request }) => {
    const response = await request.post('/api/sources/ingest', {
      multipart: {
        file: {
          name: 'lesson-notes.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from(
            '离心率是圆锥曲线统一定义下的核心参数。解题时先定定义，再做范围校验。',
            'utf8'
          ),
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      success?: boolean;
      fileType?: string;
      title?: string;
      segments?: Array<{ text?: string }>;
    };

    expect(body.success).toBeTruthy();
    expect(body.fileType).toBe('txt');
    expect(body.title).toBe('lesson-notes');
    expect(Array.isArray(body.segments)).toBeTruthy();
    expect((body.segments || []).length).toBeGreaterThan(0);
  });

  test('returns FILE_UNSUPPORTED for unsupported extension', async ({ request }) => {
    const response = await request.post('/api/sources/ingest', {
      multipart: {
        file: {
          name: 'diagram.exe',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('MZ', 'utf8'),
        },
      },
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { success?: boolean; code?: string };
    expect(body.success).toBeFalsy();
    expect(body.code).toBe('FILE_UNSUPPORTED');
  });

  test('returns EMPTY_TEXT for blank text input', async ({ request }) => {
    const response = await request.post('/api/sources/ingest', {
      data: {
        title: '空白文本',
        text: '   \n  \n',
      },
    });

    expect(response.status()).toBe(422);
    const body = (await response.json()) as { success?: boolean; code?: string };
    expect(body.success).toBeFalsy();
    expect(body.code).toBe('EMPTY_TEXT');
  });

  test('pdf upload always returns JSON response (no HTML crash page)', async ({ request }) => {
    const response = await request.post('/api/sources/ingest', {
      multipart: {
        file: {
          name: 'broken.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8'),
        },
      },
    });

    const contentType = response.headers()['content-type'] || '';
    expect(contentType.toLowerCase()).toContain('application/json');

    const body = (await response.json()) as { success?: boolean; code?: string };
    expect(typeof body.success).toBe('boolean');
    if (!body.success) {
      expect(typeof body.code).toBe('string');
    }
  });
});
