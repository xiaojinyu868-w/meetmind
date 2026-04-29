/**
 * coaching-persona-service：把 ScenarioSnapshot + AcademicProfile + CoachingSource.analysis 融合成陪练人格
 *
 * Phase 2 升级：
 *   - 在 scenario.coachingSourceRefs 里指定的 CoachingSource 的 analysisJson
 *     （由 coaching-source-service 生成：老师提问范式 / 反馈范式 / 判断依据 / 招牌表达）
 *     会被注入到 system prompt，让陪练分身真正带上老师的味道。
 *   - scenario.playbookSectionRefs 里指定的片段全量塞入；没有指定时 fallback 到 overview 一条。
 *
 * Phase 3 会把这里的工作替换成 OpenClaw coaching-twin-build workflow，
 * 但接口契约（输入 scenario/profile/studentInput，输出 systemPrompt）不变，是 drop-in 替换。
 */

import type { ScenarioDraftInput } from './scenario-types';
import type { CoachingSourceAnalysis } from './coaching-source-service';

const TONE_DESC: Record<string, string> = {
  gentle: '温和、耐心，允许学生反复表达',
  direct: '直接、简明，不绕弯',
  probing: '追问型，每个答案都会再问一层',
  structured: '结构化，按固定框架展开',
};

const STYLE_DESC: Record<string, string> = {
  socratic: '苏格拉底式启发：少给答案，多问问题',
  mentor: '导师型：既给方法，也给判断',
  interviewer: '面试官：严格、真实、不放水',
  reviewer: '评审人：按维度打分，指出要害',
};

export interface AcademicProfileSummary {
  displayName?: string | null;
  stage?: string | null;
  goals?: Record<string, unknown> | null;
  background?: Record<string, unknown> | null;
  materials?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface StudentInputPayload {
  [key: string]: string;
}

export interface BuildSystemPromptInput {
  scenario: ScenarioDraftInput;
  /** 机构名，用于 persona 的"来自 XXX 机构" */
  orgName: string;
  /** 学生画像摘要，可为空 */
  profile?: AcademicProfileSummary | null;
  /** 学生开始场景时填写的 studentInputSchema 对应值 */
  studentInput?: StudentInputPayload;
  /** 机构 playbook 的相关片段（V0 直接拼文本，Phase 3 让 OpenClaw 做检索） */
  playbookExcerpts?: string[];
  /** 关联的老师视频画像（若有），会显著影响 persona 的实际表达 */
  coachingSources?: Array<{
    title: string;
    analysis: CoachingSourceAnalysis;
  }>;
}

export interface CoachingPromptBundle {
  systemPrompt: string;
  kickoffMessage: string | null;
  metadata: {
    tone: string;
    style: string;
    productKind: string;
    feedbackAxes: string[];
    forbiddenZones: string[];
  };
}

export const coachingPersonaService = {
  buildSystemPrompt(input: BuildSystemPromptInput): CoachingPromptBundle {
    const { scenario, orgName, profile, studentInput, playbookExcerpts } = input;
    const { personaSeed, promptPatch, checkpointTriggers, description } = scenario;

    const toneDesc = TONE_DESC[personaSeed.tone] ?? personaSeed.tone;
    const styleDesc = STYLE_DESC[personaSeed.style] ?? personaSeed.style;

    const parts: string[] = [];

    parts.push(`你是 ${orgName} 的一位专属 AI 陪练分身，负责"${scenario.name}"这个场景。`);
    parts.push(`场景说明：${description || '无'}`);
    parts.push('');
    parts.push(`## 你的人格设定`);
    parts.push(`- 风格：${styleDesc}`);
    parts.push(`- 语气：${toneDesc}`);
    parts.push(`- 反馈维度：${personaSeed.feedbackAxes.join('、') || '（未指定）'}`);

    if (personaSeed.forbiddenZones.length > 0) {
      parts.push('');
      parts.push(`## 你的禁区（不得越界）`);
      for (const zone of personaSeed.forbiddenZones) {
        parts.push(`- ${zone}`);
      }
    }

    if (checkpointTriggers && checkpointTriggers.length > 0) {
      parts.push('');
      parts.push(`## 什么时候停下来、提示学生"我要把这段给老师看"`);
      for (const trig of checkpointTriggers) {
        const label = trig.description || trig.kind;
        parts.push(`- ${label}`);
      }
    }

    if (profile) {
      parts.push('');
      parts.push(`## 你现在对话的学生`);
      if (profile.displayName) parts.push(`- 昵称：${profile.displayName}`);
      if (profile.stage) parts.push(`- 阶段：${profile.stage}`);
      if (profile.goals && Object.keys(profile.goals).length > 0) {
        parts.push(`- 目标：${JSON.stringify(profile.goals)}`);
      }
      if (profile.background && Object.keys(profile.background).length > 0) {
        parts.push(`- 背景：${JSON.stringify(profile.background)}`);
      }
      if (profile.notes) parts.push(`- 其它笔记：${profile.notes}`);
    }

    if (studentInput && Object.keys(studentInput).length > 0) {
      parts.push('');
      parts.push(`## 学生在开始前填写的信息`);
      for (const field of scenario.studentInputSchema) {
        const value = studentInput[field.key];
        if (value && value.trim()) {
          parts.push(`- ${field.label}：${value.trim()}`);
        }
      }
    }

    if (playbookExcerpts && playbookExcerpts.length > 0) {
      parts.push('');
      parts.push(`## 机构经验参考（请参照机构的判断标准）`);
      for (const ex of playbookExcerpts) {
        parts.push(`---`);
        parts.push(ex.trim());
      }
      parts.push(`---`);
    }

    // === Phase 2：把老师画像注入 ===
    if (input.coachingSources && input.coachingSources.length > 0) {
      parts.push('');
      parts.push(`## 你要模仿的老师（来源：${input.coachingSources.length} 段真实辅导视频分析）`);
      for (const src of input.coachingSources) {
        const a = src.analysis;
        parts.push(`### 老师视频：《${src.title}》`);
        if (a.teacherStyle?.voiceSummary) {
          parts.push(`整体风格：${a.teacherStyle.voiceSummary}`);
        }
        if (a.teacherStyle?.signatureOpening) {
          parts.push(`常用开场：${a.teacherStyle.signatureOpening}`);
        }
        if (a.questionPatterns?.length) {
          parts.push(`提问范式（请在对话里参照这些方式）：`);
          for (const q of a.questionPatterns) parts.push(`- ${q}`);
        }
        if (a.feedbackPatterns?.length) {
          parts.push(`反馈范式：`);
          for (const q of a.feedbackPatterns) parts.push(`- ${q}`);
        }
        if (a.judgmentCues?.length) {
          parts.push(`判断依据：`);
          for (const q of a.judgmentCues) parts.push(`- ${q}`);
        }
        if (a.signaturePhrases?.length) {
          parts.push(`招牌表达（请在合适时机自然使用）：${a.signaturePhrases.join(' / ')}`);
        }
        if (a.forbiddenZones?.length) {
          parts.push(`老师自己的边界：`);
          for (const q of a.forbiddenZones) parts.push(`- ${q}`);
        }
      }
    }

    if (promptPatch?.systemAppendix?.trim()) {
      parts.push('');
      parts.push(`## 机构专属补充`);
      parts.push(promptPatch.systemAppendix.trim());
    }

    if (promptPatch?.reviewerRubric?.trim()) {
      parts.push('');
      parts.push(`## 评分量表（做反馈时参照）`);
      parts.push(promptPatch.reviewerRubric.trim());
    }

    parts.push('');
    parts.push(`## 最后`);
    parts.push(`- 每次回应保持简洁；不要一次扔太多信息。`);
    parts.push(`- 如果学生在同一个点上反复卡住，请明确告诉他"这段我先记下，会给老师看"，而不是继续猜。`);

    return {
      systemPrompt: parts.join('\n'),
      kickoffMessage: promptPatch?.userKickoff?.trim() || null,
      metadata: {
        tone: personaSeed.tone,
        style: personaSeed.style,
        productKind: scenario.productKind,
        feedbackAxes: personaSeed.feedbackAxes,
        forbiddenZones: personaSeed.forbiddenZones,
      },
    };
  },
};

export type CoachingPersonaService = typeof coachingPersonaService;
