/**
 * org-asset-service: 机构资产库
 *
 * - 上传文件（document/audio/video/image）到 `storage/orgs/<orgId>/`
 * - 登记外链 URL（url kind）
 * - 状态机：pending → processing → ready / failed
 * - 所有操作都基于 orgId 做行级隔离
 *
 * 后续 P2-2 / P2-3 会用它承接文档拆分与视频理解。
 */

import fs from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';

export type AssetKind = 'document' | 'audio' | 'video' | 'image' | 'url';

const VALID_KINDS: AssetKind[] = ['document', 'audio', 'video', 'image', 'url'];

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');

function assertKind(kind: string): asserts kind is AssetKind {
  if (!VALID_KINDS.includes(kind as AssetKind)) {
    throw new AcademicError('INVALID_INPUT', `不支持的 asset kind: ${kind}`);
  }
}

export interface CreateFileAssetInput {
  orgId: string;
  uploadedBy: string;
  kind: AssetKind;
  title: string;
  /** 原始文件名 */
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface CreateUrlAssetInput {
  orgId: string;
  uploadedBy: string;
  title: string;
  url: string;
  /** 默认视为 video/audio/document 之一，由调用方决定 */
  kind: AssetKind;
}

export const orgAssetService = {
  /** 列出本机构的资产（按 kind 可选过滤） */
  async listByOrg(orgId: string, kind?: AssetKind) {
    return prisma.orgAsset.findMany({
      where: { orgId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(orgId: string, id: string) {
    const row = await prisma.orgAsset.findUnique({ where: { id } });
    if (!row || row.orgId !== orgId) throw new AcademicError('NOT_FOUND', '资产不存在');
    return row;
  },

  /** 创建文件类 asset：落盘 + 建库 */
  async createFile(input: CreateFileAssetInput) {
    assertKind(input.kind);
    if (!input.filename) throw new AcademicError('INVALID_INPUT', '缺少 filename');

    const ext = path.extname(input.filename).toLowerCase() || '';
    // 先在 DB 里 allocate id
    const asset = await prisma.orgAsset.create({
      data: {
        orgId: input.orgId,
        uploadedBy: input.uploadedBy,
        kind: input.kind,
        title: input.title.trim() || input.filename,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.byteLength,
        status: 'pending',
      },
    });

    const dir = path.join(STORAGE_ROOT, 'orgs', input.orgId);
    await fs.mkdir(dir, { recursive: true });
    const relativePath = path.posix.join('orgs', input.orgId, `${asset.id}${ext}`);
    const absPath = path.join(STORAGE_ROOT, relativePath);
    await fs.writeFile(absPath, input.buffer);

    return prisma.orgAsset.update({
      where: { id: asset.id },
      data: { storagePath: relativePath },
    });
  },

  /** 创建 url 类 asset：只登记 */
  async createUrl(input: CreateUrlAssetInput) {
    assertKind(input.kind);
    return prisma.orgAsset.create({
      data: {
        orgId: input.orgId,
        uploadedBy: input.uploadedBy,
        kind: input.kind,
        title: input.title.trim() || input.url,
        sourceUrl: input.url,
        publicUrl: input.url,
        status: 'pending',
      },
    });
  },

  async delete(orgId: string, id: string) {
    const asset = await this.getById(orgId, id);
    if (asset.storagePath) {
      const abs = path.join(STORAGE_ROOT, asset.storagePath);
      await fs.unlink(abs).catch(() => {});
    }
    await prisma.orgAsset.delete({ where: { id } });
  },

  async setStatus(
    orgId: string,
    id: string,
    status: 'pending' | 'processing' | 'ready' | 'failed',
    opts: { processingStage?: string | null; errorMessage?: string | null; metadata?: Record<string, unknown> } = {},
  ) {
    const asset = await this.getById(orgId, id);
    return prisma.orgAsset.update({
      where: { id: asset.id },
      data: {
        status,
        processingStage: opts.processingStage ?? null,
        errorMessage: opts.errorMessage ?? null,
        metadataJson: opts.metadata ? JSON.stringify(opts.metadata) : asset.metadataJson,
      },
    });
  },

  /** 读取文件内容（服务端：处理管线用） */
  async readFileBuffer(orgId: string, id: string): Promise<Buffer> {
    const asset = await this.getById(orgId, id);
    if (!asset.storagePath) throw new AcademicError('NOT_FOUND', '资产不是文件类型');
    const abs = path.join(STORAGE_ROOT, asset.storagePath);
    return fs.readFile(abs);
  },

  /** 读取文本（document 类） */
  async readText(orgId: string, id: string): Promise<string> {
    const buf = await this.readFileBuffer(orgId, id);
    return buf.toString('utf8');
  },

  /** 计算资产的公开访问 URL（需 app 已暴露 /api/academic/assets/:id/stream） */
  publicAccessUrl(assetId: string): string {
    return `/api/academic/assets/${assetId}/stream`;
  },
};

export type OrgAssetService = typeof orgAssetService;
export { STORAGE_ROOT };
