/**
 * org-scenario-service: 机构自定义场景管理
 *
 * - Scenario 是机构在 /console 里定义的数据，不是代码 enum
 * - 支持草稿 / 发布 / 归档三种状态
 * - 发布 = 创建 OrgScenarioVersion 快照；学生端 PracticeSession 会固化到某个 version
 *
 * 字段序列化：所有 JSON 字段在 DB 里是字符串，出库/入库时自动序列化。
 * 详见 specs/academic-service-v0/multi-tenant-contract.md
 */

import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';
import type {
  CheckpointTrigger,
  PersonaSeed,
  ProductKind,
  PromptPatch,
  ScenarioDraftInput,
  ScenarioSnapshot,
  StudentInputField,
} from './scenario-types';

const VALID_PRODUCT_KINDS: ProductKind[] = ['practice', 'review', 'qa', 'mock-interview', 'material-polish'];

function validateDraft(input: ScenarioDraftInput) {
  if (!input.name?.trim()) throw new AcademicError('INVALID_INPUT', '场景名称不能为空');
  if (!VALID_PRODUCT_KINDS.includes(input.productKind)) {
    throw new AcademicError('INVALID_INPUT', `productKind 必须是 ${VALID_PRODUCT_KINDS.join('/')}`);
  }
  if (!input.personaSeed) throw new AcademicError('INVALID_INPUT', '缺少 personaSeed');
  if (!Array.isArray(input.studentInputSchema)) {
    throw new AcademicError('INVALID_INPUT', 'studentInputSchema 必须是数组');
  }
}

export const orgScenarioService = {
  async listByOrg(orgId: string, status?: 'draft' | 'published' | 'archived') {
    const rows = await prisma.orgScenario.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map(rowToSnapshot);
  },

  /**
   * 学生端看到的"可开始的场景"：status = published
   */
  async listPublishedForStudent(orgId: string) {
    return this.listByOrg(orgId, 'published');
  },

  async getById(orgId: string, id: string): Promise<ScenarioSnapshot> {
    const row = await prisma.orgScenario.findUnique({ where: { id } });
    if (!row || row.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', '场景不存在');
    }
    return rowToSnapshot(row);
  },

  async create(orgId: string, input: ScenarioDraftInput) {
    validateDraft(input);
    const row = await prisma.orgScenario.create({
      data: {
        orgId,
        name: input.name.trim(),
        description: input.description ?? '',
        productKind: input.productKind,
        studentInputSchema: JSON.stringify(input.studentInputSchema),
        personaSeed: JSON.stringify(input.personaSeed),
        checkpointTriggers: JSON.stringify(input.checkpointTriggers ?? []),
        coachingSourceRefs: JSON.stringify(input.coachingSourceRefs ?? []),
        playbookSectionRefs: JSON.stringify(input.playbookSectionRefs ?? []),
        industryTemplate: input.industryTemplate,
        promptPatch: JSON.stringify(input.promptPatch ?? {}),
        status: 'draft',
      },
    });
    return rowToSnapshot(row);
  },

  async updateDraft(orgId: string, id: string, input: ScenarioDraftInput) {
    validateDraft(input);
    const existing = await prisma.orgScenario.findUnique({ where: { id } });
    if (!existing || existing.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', '场景不存在');
    }
    const row = await prisma.orgScenario.update({
      where: { id },
      data: {
        name: input.name.trim(),
        description: input.description ?? '',
        productKind: input.productKind,
        studentInputSchema: JSON.stringify(input.studentInputSchema),
        personaSeed: JSON.stringify(input.personaSeed),
        checkpointTriggers: JSON.stringify(input.checkpointTriggers ?? []),
        coachingSourceRefs: JSON.stringify(input.coachingSourceRefs ?? []),
        playbookSectionRefs: JSON.stringify(input.playbookSectionRefs ?? []),
        industryTemplate: input.industryTemplate,
        promptPatch: JSON.stringify(input.promptPatch ?? {}),
      },
    });
    return rowToSnapshot(row);
  },

  /**
   * 发布：把当前 draft 固化为 version，并把 status 置为 published。
   * 学生 PracticeSession 始终引用一个 version，发布后改 draft 也不影响进行中的会话。
   */
  async publish(orgId: string, id: string): Promise<{ scenario: ScenarioSnapshot; versionId: string; versionNumber: number }> {
    const existing = await prisma.orgScenario.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!existing || existing.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', '场景不存在');
    }

    const nextVersionNumber = (existing.versions[0]?.versionNumber ?? 0) + 1;
    const snapshotJson = {
      name: existing.name,
      description: existing.description,
      productKind: existing.productKind,
      studentInputSchema: safeJson(existing.studentInputSchema, []),
      personaSeed: safeJson(existing.personaSeed, {}),
      checkpointTriggers: safeJson(existing.checkpointTriggers, []),
      coachingSourceRefs: safeJson(existing.coachingSourceRefs, []),
      playbookSectionRefs: safeJson(existing.playbookSectionRefs, []),
      industryTemplate: existing.industryTemplate,
      promptPatch: safeJson(existing.promptPatch, {}),
    };

    const version = await prisma.orgScenarioVersion.create({
      data: {
        scenarioId: id,
        versionNumber: nextVersionNumber,
        snapshot: JSON.stringify(snapshotJson),
      },
    });

    const updated = await prisma.orgScenario.update({
      where: { id },
      data: {
        status: 'published',
        currentVersionId: version.id,
      },
    });

    return { scenario: rowToSnapshot(updated), versionId: version.id, versionNumber: version.versionNumber };
  },

  async archive(orgId: string, id: string) {
    const existing = await prisma.orgScenario.findUnique({ where: { id } });
    if (!existing || existing.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', '场景不存在');
    }
    const row = await prisma.orgScenario.update({
      where: { id },
      data: { status: 'archived' },
    });
    return rowToSnapshot(row);
  },

  /**
   * 取 published 版本的快照（供学生端练习时固化）
   */
  async getPublishedVersion(orgId: string, scenarioId: string) {
    const scenario = await prisma.orgScenario.findUnique({
      where: { id: scenarioId },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });
    if (!scenario || scenario.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', '场景不存在');
    }
    if (scenario.status !== 'published' || !scenario.currentVersionId) {
      throw new AcademicError('INVALID_INPUT', '场景尚未发布');
    }
    const version = scenario.versions[0];
    if (!version) throw new AcademicError('INVALID_INPUT', '场景尚未发布');
    return {
      scenarioId: scenario.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      snapshot: JSON.parse(version.snapshot) as ScenarioDraftInput,
    };
  },
};

// ------- 辅助函数 -------

function rowToSnapshot(row: {
  id: string;
  orgId: string;
  name: string;
  description: string;
  productKind: string;
  studentInputSchema: string;
  personaSeed: string;
  checkpointTriggers: string;
  coachingSourceRefs: string;
  playbookSectionRefs: string;
  industryTemplate: string;
  promptPatch: string;
  currentVersionId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ScenarioSnapshot {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    productKind: row.productKind as ProductKind,
    studentInputSchema: safeJson<StudentInputField[]>(row.studentInputSchema, []),
    personaSeed: safeJson<PersonaSeed>(row.personaSeed, {
      tone: 'direct',
      style: 'mentor',
      feedbackAxes: [],
      forbiddenZones: [],
    }),
    checkpointTriggers: safeJson<CheckpointTrigger[]>(row.checkpointTriggers, []),
    coachingSourceRefs: safeJson<string[]>(row.coachingSourceRefs, []),
    playbookSectionRefs: safeJson<string[]>(row.playbookSectionRefs, []),
    industryTemplate: row.industryTemplate,
    promptPatch: safeJson<PromptPatch>(row.promptPatch, {}),
    currentVersionId: row.currentVersionId,
    status: row.status as 'draft' | 'published' | 'archived',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type OrgScenarioService = typeof orgScenarioService;
