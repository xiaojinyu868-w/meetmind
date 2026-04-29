/**
 * MeetMind Consult — 工具面板（scenario skill 可调用）
 *
 * 设计原则：
 *   - 交互块（UI 块）= 无 execute 的 tool。模型"调用"它，AI SDK 把 tool-call part 流回前端，
 *     前端按 part.type 分派到对应 React 组件。学生的回应作为 tool-result 回到下一轮。
 *   - 能力块（检索/IO）= 有 execute 的 tool。后端实际执行，执行结果进入下一轮上下文。
 *
 * 本文件是平台护城河：模型只能调用这里定义的工具。
 * 新增工具走 `meetmind-scenario-author` 的 dependencies 流程。
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  askOptions,
  ctaWechat,
  fileUpload,
  showConsultantMove,
  showDraft,
  showOutreachWorkspace,
  showServicePlan,
  startVoiceCall,
} from './ui-tools';
import { showAdvisorDiscovery } from './advisor-discovery-tool';

// ─────────────────────────────────────────────────────────────────
// Meta 块：useSkill（progressive disclosure，对齐 OpenClaw/AgentSkills 模式）
// 对话一进来 system prompt 只有 skill 目录（name + description），
// agent 听完学生的话决定用哪个 skill 时，显式调这个工具拿到完整 SKILL.md。
// 能力块（有 execute），返回的 skill body 会被 AI SDK 自动拼到下一轮 model messages。
// ─────────────────────────────────────────────────────────────────

export function makeMetaTools(ctx: { orgId: string; studentKey: string }) {
  const { orgId, studentKey } = ctx;

  const useSkill = tool({
    description:
      '加载一个场景剧本（skill）。收到学生第一句话或决定要换场景时调此工具。' +
      'name 必须来自 system 提供的 skill 目录；返回完整 SKILL.md。' +
      '拿到 skill body 后严格按其中的"剧本"走：它会告诉你先读画像 / 先让学生上传 / 先出草稿等。' +
      '同一 session 内可多次调用此工具切换剧本（例如学生写完套磁想顺便看 CV）。' +
      '不允许虚构 skill name — 不在目录里的会报错。',
    inputSchema: z.object({
      name: z.string().describe('skill 的 name（lowercase-hyphen），必须来自 system 给出的目录'),
      reason: z
        .string()
        .optional()
        .describe('切到这个 skill 的理由（1 句话，学生看不到，用于审计）'),
    }),
    execute: async ({ name }) => {
      // 动态 import 避免把文件系统依赖带进冷路径
      const [{ loadScenarioBody, listScenarios }, { markSessionScenario }] = await Promise.all([
        import('@/lib/services/consult-skill-registry'),
        import('@/lib/services/consult-session-service'),
      ]);
      const catalog = await listScenarios({ orgId });
      const hit = catalog.find((s) => s.name === name);
      if (!hit) {
        return {
          ok: false,
          error: `skill "${name}" 不在目录里。可用 skill：${catalog.map((s) => s.name).join(', ') || '(空)'}`,
        };
      }
      const body = await loadScenarioBody(name, { orgId });
      if (!body) {
        return { ok: false, error: `skill "${name}" 无法加载` };
      }
      // 更新 session 状态
      try {
        await markSessionScenario(orgId, studentKey, name);
      } catch {
        // 记不上不影响本次工具结果
      }
      return {
        ok: true,
        name: hit.name,
        description: hit.description,
        skill: body,
      };
    },
  });

  return { useSkill };
}

// ─────────────────────────────────────────────────────────────────
// 能力块：后端执行（有 execute）
// profile 通过 consult-profile-service 落到 Prisma
// ─────────────────────────────────────────────────────────────────

export function makeProfileTools(ctx: { orgId: string; studentKey: string }) {
  const { orgId, studentKey } = ctx;

  const readProfile = tool({
    description:
      '读取学生画像的特定字段。在问学生任何问题之前都该先读，已有信息就不要重复问。' +
      '支持点路径（例如 "cv.text", "target_schools"）。' +
      '只接受白名单字段（见 student-profile.md）；其它会在 rejected 里返回。',
    inputSchema: z.object({
      keys: z.array(z.string()).min(1).max(12).describe('要读的字段路径'),
    }),
    execute: async ({ keys }) => {
      const { readProfile: svcRead } = await import('@/lib/services/consult-profile-service');
      return svcRead(orgId, studentKey, keys);
    },
  });

  const writeProfile = tool({
    description:
      '把新收集到的信息合并写入学生画像。每轮最多写 1-3 个字段。' +
      '只写你本轮真正验证过的事实，不要推测。' +
      'advisor_candidates 必须带 status：mentioned/exploring/shortlisted/rejected；学生没有明确确认时只能写 mentioned 或 exploring，不要写成锁定目标。' +
      '字段名只能用 student-profile.md 里规定的（target_school / target_field / cv / advisor_candidates / tone_preference / strengths / worries / artifacts 等）。' +
      '不在白名单的字段会被自动挪到 institution_tags。',
    inputSchema: z.object({
      patch: z.record(z.string(), z.unknown()).describe('要合并的键值对'),
    }),
    execute: async ({ patch }) => {
      const { writeProfile: svcWrite } = await import('@/lib/services/consult-profile-service');
      return svcWrite(orgId, studentKey, patch);
    },
  });

  const webSearch = tool({
    description:
      '联网搜索。用于导师最近论文、项目 DDL、招生动态等时效性内容。不要用于固定事实（那些该在 skill references 里）。' +
      '返回结果包含 answer（基于搜索的摘要）+ citations（真实网页，带 title / url / site）。' +
      '导师发现类问题不要把多所学校塞进一个大 query；如果学生要扩展短名单，按学校/实验室/细分方向拆成小查询。' +
      '写草稿时要引用 citations 里的具体 title，不要编造论文名。',
    inputSchema: z.object({
      query: z.string().describe('搜索关键词；导师名请包含学校，如 "Graham Neubig CMU recent paper 2025"'),
      freshness: z.enum(['day', 'week', 'month', 'year']).optional().describe('时间筛选'),
      maxResults: z.number().optional().default(5),
    }),
    execute: async ({ query, freshness, maxResults }) => {
      const { runWebSearch } = await import('@/lib/services/consult-search-service');
      return runWebSearch({ query, freshness, maxResults });
    },
  });

  const searchProgramRequirements = tool({
    description:
      '检索学校/项目的官方申请要求、DDL、材料清单、funding、课程结构和项目事实。' +
      '用于申请定位、项目短名单、冲刺/主申/保底策略。不要用它查导师论文；导师论文用 webSearch。' +
      '优先传 school(s)、field、degree、intakeYear、focus，让系统生成官方检索 query。返回 citations，必须暴露证据缺口。',
    inputSchema: z.object({
      query: z.string().optional().describe('已有明确检索词时填写；否则优先用结构化字段'),
      school: z.string().optional().describe('单个目标学校，例如 "Stanford University"'),
      schools: z.array(z.string()).optional().describe('多个目标学校，最多建议 4 个'),
      program: z.string().optional().describe('项目名，例如 "Computer Science PhD"'),
      field: z.string().optional().describe('方向，例如 "NLP" / "Human-Computer Interaction"'),
      degree: z.string().optional().describe('学位类型，例如 "PhD" / "MS" / "MEng"'),
      intakeYear: z.number().optional().describe('入学年份，例如 2027'),
      region: z.string().optional().describe('地区约束，例如 "US" / "Singapore" / "Hong Kong"'),
      focus: z
        .enum(['requirements', 'deadline', 'funding', 'curriculum', 'faculty'])
        .optional()
        .default('requirements')
        .describe('本次要查的项目事实类型'),
      maxResults: z.number().optional().default(6),
    }),
    execute: async (args) => {
      const { runProgramRequirementSearch } = await import('@/lib/services/consult-search-service');
      return runProgramRequirementSearch(args);
    },
  });

  return { readProfile, writeProfile, webSearch, searchProgramRequirements };
}

export type ConsultTools = ReturnType<typeof makeProfileTools> &
  ReturnType<typeof makeMetaTools> & {
    askOptions: typeof askOptions;
    showConsultantMove: typeof showConsultantMove;
    showAdvisorDiscovery: typeof showAdvisorDiscovery;
    showServicePlan: typeof showServicePlan;
    showDraft: typeof showDraft;
    showOutreachWorkspace: typeof showOutreachWorkspace;
    ctaWechat: typeof ctaWechat;
    fileUpload: typeof fileUpload;
    startVoiceCall: typeof startVoiceCall;
  };

export function makeConsultTools(ctx: { orgId: string; studentKey: string }): ConsultTools {
  return {
    askOptions,
    showConsultantMove,
    showAdvisorDiscovery,
    showServicePlan,
    showDraft,
    showOutreachWorkspace,
    ctaWechat,
    fileUpload,
    startVoiceCall,
    ...makeProfileTools(ctx),
    ...makeMetaTools(ctx),
  };
}
