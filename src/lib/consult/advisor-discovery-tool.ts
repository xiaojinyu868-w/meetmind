import { tool } from 'ai';
import { z } from 'zod';

const actionIntent = z.enum(['ask', 'search', 'shortlist', 'draft', 'upload', 'voice', 'route', 'other']);

export const showAdvisorDiscovery = tool({
  description:
    '展示导师/方向探索工作台。适用于学生还在摇摆：想找导师、扩展短名单、比较学校/实验室，但还没有确定要联系谁。' +
    '它不是套磁草稿，也不是固定流程；先帮助学生降低不确定性，再由学生选择继续搜、收窄、短名单、写邮件或语音聊。' +
    '默认只展示 2-3 个候选和一个关键问题，其余细节交给展开态。',
  inputSchema: z.object({
    title: z.string().describe('工作台标题，例如 "NLP 导师探索"'),
    read: z.string().describe('一句真人顾问式判断：学生此刻为什么摇摆、真正要收窄什么'),
    mode: z.enum(['explore', 'compare', 'shortlist', 'handoff']).optional().describe('当前探索阶段'),
    question: z.string().optional().describe('如果需要学生补充，只问一个会改变搜索/匹配策略的问题'),
    candidates: z
      .array(
        z.object({
          name: z.string().describe('导师或实验室/方向名'),
          affiliation: z.string().optional(),
          area: z.string().optional().describe('方向标签，短句'),
          status: z.enum(['mentioned', 'exploring', 'shortlisted', 'risky', 'unknown']).optional(),
          fit: z.number().min(0).max(100).optional(),
          confidence: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
          why: z.string().describe('为什么值得看，或为什么暂时不确定'),
          evidence: z.string().optional().describe('支撑判断的来源/用户素材，没查实就说明缺证据'),
          next: z.string().optional().describe('下一步如何验证这个候选'),
        }),
      )
      .max(6)
      .optional(),
    searchPlan: z
      .array(
        z.object({
          label: z.string().describe('检索方向，不是 query 全文'),
          query: z.string().optional().describe('可选，真实要搜的 query'),
          reason: z.string().optional().describe('为什么搜这条'),
        }),
      )
      .max(4)
      .optional(),
    signals: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
        }),
      )
      .max(4)
      .optional()
      .describe('当前决策信号，比如方向、时间线、材料缺口、风险'),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          intent: actionIntent.optional(),
        }),
      )
      .max(4)
      .optional(),
  }),
});
