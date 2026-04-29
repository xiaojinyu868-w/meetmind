/**
 * default-scenario-service：把「一段已分析的老师视频」自动落成一个可以直接给学生用的 published 场景
 *
 * V0 MVP 只聚焦「视频→语音陪练→反馈」，机构主不需要配 tone/style/feedbackAxes，
 * 所以我们在 coaching-source-service.analyze 成功时直接调用这里，用视频分析结果
 * 反推出 personaSeed、studentInputSchema，建（或更新）一个默认场景，状态置 published。
 *
 * 这段服务是幂等的：
 *   - 机构只会有一个 default 场景（identified by industryTemplate === '__default_voice__'）
 *   - 重复 analyze 只会重新发布 version
 */

import prisma from '@/lib/prisma';
import { orgScenarioService } from './org-scenario-service';
import type {
  PersonaSeed,
  PersonaTone,
  PersonaStyle,
  ScenarioDraftInput,
} from './scenario-types';
import type { CoachingSourceAnalysis } from './coaching-source-service';

const DEFAULT_MARKER = '__default_voice__';

function inferPersonaSeed(analysis: CoachingSourceAnalysis): PersonaSeed {
  // tone / style 能从 analysis.teacherStyle 里拿就直接拿，兜底 direct+mentor
  const tone = (analysis.teacherStyle?.tone || 'direct') as PersonaTone;
  const style = (analysis.teacherStyle?.style || 'mentor') as PersonaStyle;
  // 反馈维度从 judgmentCues 前若干条归一化
  const feedbackAxes = (analysis.judgmentCues || []).slice(0, 5);
  const forbiddenZones = (analysis.forbiddenZones || []).slice(0, 5);
  return {
    tone,
    style,
    feedbackAxes: feedbackAxes.length > 0 ? feedbackAxes : ['回答的具体性', '动机真实度', '逻辑连贯'],
    forbiddenZones,
  };
}

export const defaultScenarioService = {
  MARKER: DEFAULT_MARKER,

  async findDefault(orgId: string) {
    // 用 industryTemplate 作为 marker 避免引入新字段
    const row = await prisma.orgScenario.findFirst({
      where: { orgId, industryTemplate: DEFAULT_MARKER },
      orderBy: { createdAt: 'asc' },
    });
    return row;
  },

  /**
   * 根据一段已分析完成的老师视频，确保有一个默认 published 场景可以给学生练
   */
  async ensure(orgId: string, sourceId: string, analysis: CoachingSourceAnalysis, sourceTitle: string) {
    const existing = await this.findDefault(orgId);
    const personaSeed = inferPersonaSeed(analysis);

    const name = '跟老师聊一轮';
    const description = analysis.teacherStyle?.voiceSummary
      ? analysis.teacherStyle.voiceSummary
      : '开麦就能跟 AI 陪练聊一轮，像真正的老师 1v1。';

    const draft: ScenarioDraftInput = {
      name,
      description,
      productKind: 'mock-interview',
      studentInputSchema: [
        { key: 'goal', label: '今天最想练什么', kind: 'textarea', required: false, placeholder: '不填也行，直接开始也可以' },
      ],
      personaSeed,
      checkpointTriggers: [],
      coachingSourceRefs: [sourceId],
      playbookSectionRefs: [],
      industryTemplate: DEFAULT_MARKER,
      promptPatch: {
        systemAppendix: '',
        userKickoff: '老师你好，我们开始吧。',
        reviewerRubric: '',
      },
    };

    if (!existing) {
      const created = await orgScenarioService.create(orgId, draft);
      await orgScenarioService.publish(orgId, created.id);
      return created.id;
    }

    // 已存在：把最新的 source 合并进去，重新发布
    const mergedRefs = Array.from(new Set([...(safeArray(existing.coachingSourceRefs)), sourceId]));
    const merged: ScenarioDraftInput = { ...draft, coachingSourceRefs: mergedRefs };
    await orgScenarioService.updateDraft(orgId, existing.id, merged);
    await orgScenarioService.publish(orgId, existing.id);
    return existing.id;
  },
};

function safeArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export type DefaultScenarioService = typeof defaultScenarioService;
