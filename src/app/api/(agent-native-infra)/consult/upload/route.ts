/**
 * /api/consult/upload — scenario skill 里 file-upload 块的落地接口。
 *
 * 复用 src/lib/services/document-parser-service.ts（底层走 DashScope qwen-doc-turbo）。
 * 当前实现：解析后直接把纯文本返回。S2 阶段会把 file 也持久化到 OrgAsset。
 *
 * 客户端：multipart/form-data + 字段 "file"；可选 "profileKey" 暗示前端保存到哪个画像字段。
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractTextFromFile } from '@/lib/services/document-parser-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ success: false, error: '请用 multipart/form-data 上传' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json({ success: false, error: '表单解析失败' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: '缺少文件字段 file' }, { status: 400 });
  }
  const profileKey = typeof form.get('profileKey') === 'string' ? (form.get('profileKey') as string) : undefined;

  try {
    const result = await extractTextFromFile(file);
    return NextResponse.json({
      success: true,
      data: {
        fileName: result.fileName,
        extension: result.extension,
        kind: result.kind,
        charCount: result.charCount,
        text: result.text,
        profileKey,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
