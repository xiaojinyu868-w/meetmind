/**
 * document-extract-service: 把 OrgAsset(document) 自动拆成 OrgPlaybookSection[]
 *
 * 流程：
 *   1) 读 asset bytes
 *   2) 按 mime 选择解析器：pdf-parse / mammoth(docx) / 文本直读(txt/md)
 *   3) 调 qwen3.5-plus 做结构化拆分，输出 JSON 数组：[{title, sectionKind, body, tags[]}, ...]
 *   4) 批量写入 OrgPlaybookSection，指回源 asset（sourceAssetId）
 *
 * 错误处理：任何阶段失败把 asset status 改 failed，带 errorMessage。
 */

import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';
import { orgAssetService } from './org-asset-service';
import { chat } from '@/lib/services/llm-service';
import { DOCUMENT_EXTRACT_MODEL } from '../models';

interface ExtractedSection {
  title: string;
  sectionKind: 'overview' | 'sop' | 'rubric' | 'script' | 'sample' | 'case';
  body: string;
  tags?: string[];
}

const SYSTEM_PROMPT = `你是一位教育机构的知识管理专家。用户会给你一段机构的 playbook/SOP/案例/话术原文。

请把原文拆成若干个"可独立使用的知识片段"，每个片段必须形成一个自包含的语义单元（能单独被 AI 陪练分身引用）。

对每个片段输出 4 个字段：
- title：不超过 20 字的标题
- sectionKind：必须是以下之一：overview（总览/理念）、sop（流程/步骤）、rubric（评分/判断标准）、script（话术/模板）、sample（优秀样本/范文）、case（案例）
- body：片段的 markdown 原文（可直接被 AI 引用的完整段落，不要只给摘要）
- tags：2-5 个中文关键词

严格输出 JSON，形如：
{"sections": [{"title":"...","sectionKind":"sop","body":"...","tags":["..."]}]}

注意：
- 不要丢失原文关键信息，body 应该保留原话
- 不要编造原文没有的内容
- 总览类片段（机构理念、核心判断）归为 overview
- 具体步骤或流程归为 sop
- 反馈标准或评分表归为 rubric
- 具体话术模板归为 script
- 具体优秀范文归为 sample
- 真实学员案例归为 case`;

export const documentExtractService = {
  /**
   * 从 asset 抽取纯文本
   */
  async assetToText(orgId: string, assetId: string): Promise<string> {
    const asset = await orgAssetService.getById(orgId, assetId);
    if (asset.kind !== 'document') {
      throw new AcademicError('INVALID_INPUT', '该资产不是 document 类型');
    }
    const buf = await orgAssetService.readFileBuffer(orgId, assetId);
    const mime = (asset.mimeType || '').toLowerCase();
    const filename = (asset.filename || '').toLowerCase();

    if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse');
      const res = await pdfParse(buf);
      return String(res?.text || '');
    }
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filename.endsWith('.docx')
    ) {
      const mammoth = await import('mammoth');
      const res = await mammoth.extractRawText({ buffer: buf });
      return String(res.value || '');
    }
    // markdown / txt / 其它文本
    return buf.toString('utf8');
  },

  /**
   * 用 LLM 把纯文本拆成片段数组
   */
  async splitWithLLM(text: string): Promise<ExtractedSection[]> {
    if (!text.trim()) return [];
    // 截断保护：过长时只送前 60k 字符（qwen3.5-plus 支持 1M token，这里是兜底）
    const input = text.length > 60000 ? text.slice(0, 60000) : text;

    const resp = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      DOCUMENT_EXTRACT_MODEL,
      { temperature: 0.2, responseFormat: 'json_object', maxTokens: 6000 },
    );

    let parsed: { sections?: unknown };
    try {
      parsed = JSON.parse(resp.content);
    } catch {
      throw new AcademicError('INTERNAL', 'LLM 返回非 JSON');
    }
    const raw = Array.isArray(parsed?.sections) ? (parsed.sections as unknown[]) : [];
    return raw
      .map((r) => {
        const row = r as Record<string, unknown>;
        const kind = String(row.sectionKind || 'overview').toLowerCase();
        const validKinds: ExtractedSection['sectionKind'][] = ['overview', 'sop', 'rubric', 'script', 'sample', 'case'];
        return {
          title: String(row.title || '').trim() || '未命名片段',
          sectionKind: (validKinds.includes(kind as ExtractedSection['sectionKind']) ? kind : 'overview') as ExtractedSection['sectionKind'],
          body: String(row.body || '').trim(),
          tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t)) : [],
        };
      })
      .filter((s) => s.body.length >= 10);
  },

  /**
   * 端到端：asset → playbook sections（写 DB）
   */
  async processAsset(orgId: string, assetId: string): Promise<{ count: number; sections: { id: string; title: string }[] }> {
    const asset = await orgAssetService.getById(orgId, assetId);
    await orgAssetService.setStatus(orgId, assetId, 'processing', { processingStage: '解析文档中…' });
    try {
      const text = await this.assetToText(orgId, assetId);
      if (!text.trim()) {
        throw new AcademicError('INVALID_INPUT', '文档内容为空');
      }
      await orgAssetService.setStatus(orgId, assetId, 'processing', { processingStage: '调用 LLM 拆分…' });
      const sections = await this.splitWithLLM(text);

      if (sections.length === 0) {
        throw new AcademicError('INTERNAL', 'LLM 未返回任何片段');
      }

      // 批量写入
      const created = await Promise.all(
        sections.map((s, i) =>
          prisma.orgPlaybookSection.create({
            data: {
              orgId,
              title: s.title,
              sectionKind: s.sectionKind,
              body: s.body,
              tags: JSON.stringify(s.tags || []),
              sourceAssetId: assetId,
              orderInSource: i,
            },
          }),
        ),
      );

      await orgAssetService.setStatus(orgId, assetId, 'ready', {
        processingStage: `已拆分为 ${created.length} 个片段`,
        metadata: { sectionCount: created.length },
      });

      return { count: created.length, sections: created.map((r) => ({ id: r.id, title: r.title })) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      await orgAssetService.setStatus(orgId, assetId, 'failed', {
        processingStage: '文档拆分失败',
        errorMessage: msg,
      });
      throw e;
    }
  },
};

export type DocumentExtractService = typeof documentExtractService;
