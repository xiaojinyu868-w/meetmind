import { tool } from 'ai';
import { z } from 'zod';

export const askOptions = tool({
  description:
    '让学生从 2-6 个选项里做选择。用于明确意图（申请方向、语气偏好、目标档次等）。' +
    '学生选择后会作为工具结果回到对话。优先使用此工具而不是让学生打字选 A/B/C。' +
    '如果你准备在正文里写 A）B）C）或让学生“选一档/选一个”，必须改为调用 askOptions。',
  inputSchema: z.object({
    prompt: z.string().describe('给学生看的问题，1 句，不超过 30 字'),
    multi: z.boolean().optional().default(false).describe('是否可多选'),
    choices: z
      .array(
        z.object({
          id: z.string().describe('内部 ID，学生看不到'),
          label: z.string().describe('选项文案'),
          description: z.string().optional().describe('副说明'),
        }),
      )
      .min(2)
      .max(6),
  }),
});

export const showDraft = tool({
  description:
    '向学生展示一段可编辑/可迭代的长文（套磁草稿、CV 点评、项目短名单等）。' +
    '学生看到后可以点按钮重写某一段，或让模型调整某一处。' +
    '同一种长文应被当作活文档：不要反复刷多张中间卡，只有正式更新时才 emit 新版本。',
  inputSchema: z.object({
    kind: z
      .enum([
        'cold-email-draft',
        'cv-diagnosis',
        'program-shortlist',
        'advisor-card',
        'interview-feedback',
        'application-plan',
        'statement-draft',
        'recommendation-plan',
      ])
      .describe('草稿类型，决定前端样式'),
    title: z.string().describe('文档标题'),
    body: z.string().describe('草稿正文，支持 markdown'),
    annotations: z
      .array(
        z.object({
          note: z.string().describe('这一条批注的说明'),
          quote: z.string().describe('批注对应的原文片段'),
        }),
      )
      .optional()
      .describe('对正文某些片段的批注，学生看到会觉得"机构老师真的改过这一稿"'),
    actions: z
      .array(
        z.object({
          id: z.string().describe('操作 ID，点击后回传给模型'),
          label: z.string().describe('按钮文案'),
        }),
      )
      .optional()
      .describe('底部操作按钮，比如「重写第二段」「改得更正式些」'),
  }),
});

export const showConsultantMove = tool({
  description:
    '展示 AI 顾问此刻的判断与下一步动作。用于替代"流程感"：先说明你理解到的真实意图、画像信号和当前卡点，' +
    '再给出一个像真人老师一样的下一步。字段是最小渲染契约；内容、按钮和问法由模型根据学生上下文自行决定。',
  inputSchema: z.object({
    stance: z
      .enum(['diagnose', 'challenge', 'clarify', 'route', 'reassure', 'handoff'])
      .optional()
      .describe('顾问这一刻的姿态，前端只用于轻量标识，不限制内容'),
    title: z.string().describe('一句话判断，不是模块标题。例如"你现在不是缺经历，是缺一条研究主线"'),
    read: z.string().describe('你从用户话里读到的真实意图/焦虑/目标，像真人顾问的复述'),
    evidence: z
      .array(z.string())
      .max(4)
      .optional()
      .describe('支撑这个判断的用户画像、对话事实或来源。没有就省略，不要编。'),
    move: z.string().describe('你建议立刻做的队友式动作。应具体，但不要写成 SOP。'),
    question: z
      .string()
      .optional()
      .describe('如果必须问，只问一个高杠杆问题。能直接行动时不要问。'),
    actions: z
      .array(
        z.object({
          id: z.string().describe('操作 ID，模型自行定义，但要能表达真实下一步'),
          label: z.string().describe('按钮文案，像老师给的下一步，不像后台命令'),
          intent: z
            .enum(['ask', 'search', 'draft', 'upload', 'voice', 'route', 'handoff', 'other'])
            .optional()
            .describe('动作意图，帮助后端把按钮点击路由回 agent loop'),
        }),
      )
      .max(4)
      .optional(),
  }),
});

export const showServicePlan = tool({
  description:
    '把一次咨询推进成完整服务方案板。用于承接机构原来的服务前/服务中/服务后产品图景：申请目标、导师匹配、材料生成、模拟面试、评估报告和下一步行动。' +
    '这是 agent-native 的服务中枢，不是固定表单；模型自行决定展示哪些模块和动作。' +
    '默认只放当前最关键的 2-3 个模块，完整路径可以放进 optional details；不要把所有能做的服务一次塞满。',
  inputSchema: z.object({
    phase: z.enum(['pre-service', 'in-service', 'post-service']).describe('当前服务阶段'),
    title: z.string().describe('方案板标题，例如 "Stanford NLP 申请准备方案"'),
    consultantRead: z.string().describe('像真人顾问一样总结：这个学生现在真正卡在哪里'),
    objective: z.string().describe('本轮要推进的明确目标'),
    painPoints: z.array(z.string()).max(5).optional().describe('用户痛点/当前摩擦，不要泛泛而谈'),
    modules: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          status: z.enum(['ready', 'needs-input', 'in-progress', 'done']).optional(),
          value: z.string().describe('这个模块当前给学生的价值或判断'),
          next: z.string().optional().describe('这个模块下一步做什么'),
        }),
      )
      .max(6)
      .optional(),
    advisorMatches: z
      .array(
        z.object({
          name: z.string(),
          affiliation: z.string().optional(),
          fitScore: z.number().min(0).max(100).optional(),
          fitReason: z.string(),
          nextAction: z.string().optional(),
        }),
      )
      .max(5)
      .optional(),
    artifacts: z
      .array(
        z.object({
          kind: z.enum(['cold-email', 'cv', 'research-plan', 'interview-report', 'timeline', 'other']),
          title: z.string(),
          status: z.enum(['draft', 'ready', 'needs-input']).optional(),
          note: z.string().optional(),
        }),
      )
      .max(5)
      .optional(),
    evaluation: z
      .object({
        overallScore: z.number().min(0).max(100).optional(),
        dimensions: z.array(z.object({ label: z.string(), score: z.number().min(0).max(100) })).max(6).optional(),
        strengths: z.array(z.string()).max(4).optional(),
        improvements: z.array(z.string()).max(4).optional(),
      })
      .optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          intent: z.enum(['ask', 'search', 'draft', 'upload', 'voice', 'route', 'handoff', 'other']).optional(),
        }),
      )
      .max(5)
      .optional(),
  }),
});

export const showOutreachWorkspace = tool({
  description:
    '生成一个导师外联工作台，而不是普通文字说明。适用于学生想联系某位导师、需要先看导师档案、匹配点、外联策略和下一步动作时。' +
    '必须基于 webSearch citations 和学生画像/上传材料填充；没有来源的信息放入 missingEvidence，不要编造。' +
    '通常在 webSearch + readProfile 之后、showDraft 之前调用。',
  inputSchema: z.object({
    title: z.string().describe('工作台标题，例如 "Percy Liang 外联工作台"'),
    advisor: z.object({
      name: z.string(),
      affiliation: z.string().optional(),
      role: z.string().optional(),
      lab: z.string().optional(),
      summary: z.string().describe('1-2 句，只写已查实的研究定位'),
    }),
    judgment: z
      .object({
        verdict: z.string().describe('当前策略判断：是否值得联系、是否需要先补证据，1 句'),
        confidence: z.enum(['high', 'medium', 'low', 'unknown']).default('unknown'),
        nextMove: z.string().describe('推荐学生下一步做什么，必须具体到一个动作'),
      })
      .optional()
      .describe('让工作台像 agent 的判断，而不是静态资料卡。'),
    citations: z
      .array(
        z.object({
          index: z.number().optional(),
          title: z.string(),
          url: z.string().optional(),
          site: z.string().optional(),
          note: z.string().optional().describe('这条来源支持了什么判断'),
        }),
      )
      .max(5)
      .optional(),
    fitMap: z
      .array(
        z.object({
          studentAnchor: z.string().describe('学生背景里的具体项目/经历；缺 CV 时写"待补充 CV 项目"'),
          advisorSignal: z.string().describe('导师方向或公开工作信号'),
          outreachUse: z.string().describe('邮件里可以怎么用这一点'),
          strength: z.enum(['strong', 'medium', 'weak', 'unknown']).default('unknown'),
        }),
      )
      .max(4)
      .optional(),
    outreachPlan: z.object({
      openingHook: z.string().describe('开头钩子：引用哪条导师工作或承认待查证'),
      studentProof: z.string().describe('用学生哪段经历证明 fit；缺失就写需要补什么'),
      ask: z.string().describe('最小请求，例如发 research statement / 问 RA / 约 15 分钟'),
      risk: z.string().describe('这封信当前最大的风险'),
    }),
    missingEvidence: z.array(z.string()).max(4).optional().describe('还缺哪些证据，不要藏起来'),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.enum(['search', 'draft', 'upload', 'voice', 'handoff', 'other']).optional(),
          priority: z.enum(['primary', 'secondary']).optional(),
        }),
      )
      .max(4)
      .optional(),
  }),
});

export const ctaWechat = tool({
  description:
    '当学生已经拿到实质性价值（草稿/诊断/短名单），且能说出一个"为什么值得跟真人聊"的具体理由时，surface 留微信卡。' +
    '规则：整个 session 最多调用一次；不得在前 3 轮调用；reason 必须引用本次学生的具体内容（不可泛泛）。',
  inputSchema: z.object({
    headline: z.string().describe('1 句话，说明此刻学生完成了什么'),
    reason: z
      .string()
      .describe(
        '1-2 句，说明为什么值得跟机构的真人顾问聊 15 分钟。必须引用本次对话中学生的具体事实，不得写"提升你的申请"之类通用话术。',
      ),
    consultantHint: z.string().optional().describe('建议对接的顾问简介，如「卿云 · 张老师（CMU 校友）」'),
  }),
});

export const fileUpload = tool({
  description:
    '让学生上传文件（CV / 成绩单 / Research Statement 等），后端会自动解析为文本并通过工具结果回传给你。' +
    '支持 pdf / docx / ppt / pptx / txt / md / csv / json / html。' +
    '如果指定了 profileKey（例如 "cv"），前端会把解析结果自动写入学生画像该字段。',
  inputSchema: z.object({
    prompt: z.string().describe('给学生看的一句话，比如"上传你的 CV"'),
    accept: z.array(z.string()).optional().describe('可接受的扩展名列表，如 [".pdf",".docx"]；不填默认全部支持'),
    profileKey: z.string().optional().describe('如指定，前端会把解析后的 text 自动 writeProfile 到该字段'),
    maxSizeMb: z.number().optional().default(20).describe('大小上限 MB'),
  }),
});

export const startVoiceCall = tool({
  description:
    '当文字已经不够用时，发起一次语音通话。' +
    '典型触发：学生的问题牵涉很多细节、或学生明确说"能语音聊吗"。' +
    '规则：整个 session 最多调一次；在 ctaWechat 之前。',
  inputSchema: z.object({
    reason: z.string().describe('1 句，给学生看的"为什么想语音聊"——必须引用本次对话具体内容'),
    openingLine: z.string().describe('AI 顾问接通后的第一句话。亲切、短，≤30 字'),
    focus: z.array(z.string()).min(1).max(4).describe('本次语音要聊透的 2-3 个点，每条 ≤20 字'),
    voice: z.enum(['Ethan', 'Cherry']).optional().default('Ethan').describe('AI 顾问的声线'),
  }),
});
