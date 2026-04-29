/**
 * consult-openclaw-adapter —— 让 OpenClaw runtime 产出 UIMessage stream
 *
 * 设计目标：前端感知不到后端 runtime 差异。无论走 aisdk 还是 openclaw，学生端都用同一个
 * useChat + 同一套 block 渲染。adapter 的职责：
 *
 *   1. 把 UIMessage[] 转成 OpenClaw /v1/chat/completions 能吃的 OpenAI 格式
 *   2. 把 system prompt（含 skill.md + block 使用约定）注入
 *   3. SSE 消费 OpenClaw 回来的 delta，**扫描 ```<blockType> ... ``` fenced 块**，
 *      一旦识别到就生成 UIMessage 的 tool-part（tool-input-available + tool-output-available）
 *   4. 对于非 UI 块（webSearch / searchProgramRequirements / readProfile / writeProfile / fileUpload 的结果回流），
 *      OpenClaw 走 content 文本内联，adapter 把它们按 "后端 tool" 在 UIMessage 里模拟 tool-part，
 *      然后让下一轮用户消息里注入 tool-result 反馈给模型
 *
 * 关键：AG-UI 模式跟 AI SDK tool-calling 是同构的，只是传输层不同。
 * 所以 block 定义、profile schema、web-search 等业务逻辑都不需要改。
 *
 * 当前版本支持：askOptions / showConsultantMove / showAdvisorDiscovery / showServicePlan / showOutreachWorkspace / showDraft / ctaWechat / fileUpload / startVoiceCall 九种 UI 块。
 * webSearch / searchProgramRequirements / readProfile / writeProfile 这些 capability 类工具通过 adapter 在 agent 外侧注入
 * （见 `executeCapabilityFencedCalls`）。
 */

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  type UIMessage,
  type ModelMessage,
} from 'ai';
import { runProgramRequirementSearch, runWebSearch } from './consult-search-service';
import { readProfile as svcReadProfile, writeProfile as svcWriteProfile } from './consult-profile-service';

// ────────────── 配置 ──────────────

const OPENCLAW_BASE_URL = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:19001';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'meetmind-oc-token-dev';
const OPENCLAW_MODEL = process.env.OPENCLAW_MODEL || 'openclaw';

// ────────────── 块类型 ──────────────

/** 前端直接渲染的 UI 块：agent 只写 input，等待用户交互 */
const UI_BLOCK_TYPES = new Set(['askOptions', 'showConsultantMove', 'showAdvisorDiscovery', 'showServicePlan', 'showOutreachWorkspace', 'showDraft', 'ctaWechat', 'fileUpload', 'startVoiceCall']);
/** 后端执行的能力块：agent 写入 args，adapter 立即执行，把 output 塞回下一轮 */
const CAPABILITY_TYPES = new Set(['webSearch', 'searchProgramRequirements', 'readProfile', 'writeProfile']);

// ────────────── system prompt 构造 ──────────────

export function buildOpenClawSystemPrompt(opts: { skillMarkdown: string; orgSlug: string }): string {
  return [
    `你是 ${opts.orgSlug} 机构的 AI 申请顾问，在 MeetMind consult 平台上驱动一个具体场景。`,
    ``,
    `# 输出协议（严格遵守，违反即为失败）`,
    ``,
    `你的每一次回复由两类内容构成：`,
    `  1. **自然语言**：告诉学生你在做什么、你的想法、失败的解释（1-3 句，简洁）`,
    `  2. **fenced block**：用三反引号包裹的 JSON 指令，触发前端渲染或后端执行`,
    ``,
    `支持 fenced block，严格按以下格式：`,
    ``,
    `## 前端 UI 交互块—— 写完就等学生操作`,
    ``,
    `\`\`\`askOptions`,
    `{"prompt":"问题 1 句","choices":[{"id":"academic","label":"学术严谨"},{"id":"warm","label":"温和自荐"}]}`,
    `\`\`\``,
    ``,
    `\`\`\`showConsultantMove`,
    `{"title":"你现在不是缺经历，是缺一条研究主线","read":"你问 CV，其实是在确认自己有没有机会。","move":"我先帮你把 CV 亮点转成下一步导师联系策略。","actions":[{"id":"find-advisors-from-cv","label":"用这些亮点找导师","intent":"route"}]}`,
    `\`\`\``,
    ``,
    `\`\`\`showServicePlan`,
    `{"phase":"pre-service","title":"Stanford NLP 申请准备方案","consultantRead":"你现在需要把目标导师、CV 亮点和套磁动作串起来。","objective":"先完成导师匹配与第一封邮件策略。","modules":[{"id":"advisor-match","label":"导师匹配","status":"in-progress","value":"先找 3 位方向对齐导师"}],"actions":[{"id":"start-advisor-match","label":"开始匹配导师","intent":"search"}]}`,
    `\`\`\``,
    ``,
    `\`\`\`showDraft`,
    `{"kind":"cold-email-draft","title":"给 Prof X 的套磁草稿 v1","body":"正文 markdown","annotations":[{"note":"此处是...","quote":"..."}],"actions":[{"id":"regen-opening","label":"换开头"}]}`,
    `\`\`\``,
    ``,
    `\`\`\`showOutreachWorkspace`,
    `{"title":"Prof X 外联工作台","advisor":{"name":"Prof X","affiliation":"School","summary":"已查实定位"},"citations":[{"title":"真实来源","url":"https://..."}],"fitMap":[{"studentAnchor":"待补充 CV 项目","advisorSignal":"导师方向","outreachUse":"邮件用法","strength":"unknown"}],"outreachPlan":{"openingHook":"开头钩子","studentProof":"自我证明","ask":"最小请求","risk":"当前风险"},"missingEvidence":["缺 CV 项目"],"actions":[{"id":"upload-cv","label":"上传 CV"}]}`,
    `\`\`\``,
    ``,
    `\`\`\`ctaWechat`,
    `{"headline":"1 句话达成","reason":"具体理由，引用本次对话事实","consultantHint":"机构·张老师"}`,
    `\`\`\``,
    ``,
    `\`\`\`fileUpload`,
    `{"prompt":"上传你的 CV","accept":[".pdf",".docx"],"profileKey":"cv","maxSizeMb":20}`,
    `\`\`\``,
    ``,
    `## 后端能力块（4 种）—— 写完 adapter 立即执行并把结果在下一轮注入给你`,
    ``,
    `\`\`\`webSearch`,
    `{"query":"Graham Neubig CMU recent paper 2025","freshness":"year","maxResults":5}`,
    `\`\`\``,
    ``,
    `\`\`\`searchProgramRequirements`,
    `{"schools":["Stanford University","National University of Singapore"],"field":"NLP","degree":"PhD","intakeYear":2027,"focus":"requirements","maxResults":6}`,
    `\`\`\``,
    ``,
    `\`\`\`readProfile`,
    `{"keys":["cv","target_field","strengths","tone_preference"]}`,
    `\`\`\``,
    ``,
    `\`\`\`writeProfile`,
    `{"patch":{"tone_preference":"academic","target_schools":["CMU"]}}`,
    `\`\`\``,
    ``,
    `# 铁律`,
    ``,
    `1. **每一个 fenced block 必须是合法 JSON**，不得有注释、多余逗号、未引用字符串。`,
    `2. **一次回复最多 2 个 block**：可以 "先 readProfile + 再 webSearch"，不要一口气 5 个。`,
    `3. **不要假装有别的能力**：你没有这里列出来的工具以外的任何能力。不要说"我给你发邮件"。`,
    `4. **第一轮必须做的事**：先输出一段 ≤30 字的自然语言说明你要做什么，然后调一个合适的块。`,
    `5. **能力块结果在下一轮出现**，格式如："[tool-result:webSearch] {..JSON..}"，你要读它再决定下一步。`,
    `6. **前端 UI 块的学生交互在下一轮以 "[block-response:askOptions] {..JSON..}" 形式返回给你。**`,
    `7. **每个会话最多一次 ctaWechat**，且前 3 轮禁用。`,
    `8. **fileUpload 结果**下一轮以 "[tool-result:fileUpload] {fileName,charCount,text}" 回传。`,
    ``,
    `# 当前场景 skill`,
    ``,
    opts.skillMarkdown,
    ``,
    `# 开始对话`,
    `若学生第一句跟场景无关（"你好"），用 2-3 句说你能帮他什么，引导点出目标导师/目标校。`,
  ].join('\n');
}

// ────────────── UIMessage → OpenAI messages ──────────────

/**
 * 把 UIMessage 里的 tool-part 历史压回文本形态，让 OpenClaw 能读懂上下文。
 * 例如用户点了 askOptions 某个 choice，转成 "[block-response:askOptions] {...}"。
 */
function uiMessagesToOpenAIChat(
  messages: UIMessage[],
  system: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  out.push({ role: 'system', content: system });

  for (const m of messages) {
    const parts = Array.isArray(m.parts) ? m.parts : [];
    const chunks: string[] = [];
    for (const p of parts) {
      const ptype = p.type as string;
      if (ptype === 'text') {
        const t = (p as { text?: string }).text ?? '';
        if (t.trim()) chunks.push(t);
      } else if (ptype.startsWith('tool-')) {
        const toolName = ptype.slice('tool-'.length);
        const pp = p as {
          input?: unknown;
          output?: unknown;
          state?: string;
        };
        if (pp.state === 'output-available') {
          if (UI_BLOCK_TYPES.has(toolName)) {
            // 学生对 UI 块的交互结果
            chunks.push(`[block-response:${toolName}] ${JSON.stringify(pp.output ?? {})}`);
          } else if (CAPABILITY_TYPES.has(toolName)) {
            // 能力块的执行结果
            chunks.push(`[tool-result:${toolName}] ${JSON.stringify(pp.output ?? {})}`);
          } else {
            chunks.push(`[tool-result:${toolName}] ${JSON.stringify(pp.output ?? {})}`);
          }
        } else if (pp.state === 'input-available') {
          // assistant 之前调用过的块（回到上下文让它记住）
          chunks.push(`\`\`\`${toolName}\n${JSON.stringify(pp.input ?? {})}\n\`\`\``);
        }
      }
    }
    if (chunks.length === 0) continue;
    out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: chunks.join('\n') });
  }
  return out;
}

// ────────────── OpenClaw SSE 流消费 ──────────────

interface OpenAIChatDelta {
  choices?: Array<{
    delta?: { content?: string; role?: string };
    finish_reason?: string | null;
  }>;
}

async function* streamOpenClawDeltas(
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch(`${OPENCLAW_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${OPENCLAW_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENCLAW_MODEL,
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenClaw gateway HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload) as OpenAIChatDelta;
        const d = j.choices?.[0]?.delta?.content;
        if (d) yield d;
      } catch {
        // 部分流块坏掉是正常的，忽略
      }
    }
  }
}

// ────────────── fenced block 解析 ──────────────

interface ParsedBlock {
  type: string;
  rawJson: string;
  parsed?: Record<string, unknown>;
}

/** 增量扫描器：持续 feed content，吐出完成的 fenced block 和"剩余的纯文本" */
class FencedBlockScanner {
  private buf = '';
  // fenced 正则：```<type>\n<body>\n```
  private static readonly FENCE_RE = /```([a-zA-Z_][a-zA-Z0-9_-]*)\n([\s\S]*?)\n```/;

  feed(chunk: string): { textBefore: string; blocks: ParsedBlock[]; remainingText: string } {
    this.buf += chunk;
    const blocks: ParsedBlock[] = [];
    let textBefore = '';
    while (true) {
      const m = this.buf.match(FencedBlockScanner.FENCE_RE);
      if (!m) break;
      const idx = m.index ?? 0;
      textBefore += this.buf.slice(0, idx);
      const [, btype, body] = m;
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(body);
      } catch {
        // JSON 坏掉：当作普通文本保留，不 emit 块
        textBefore += this.buf.slice(idx, idx + m[0].length);
        this.buf = this.buf.slice(idx + m[0].length);
        continue;
      }
      blocks.push({ type: btype, rawJson: body, parsed });
      this.buf = this.buf.slice(idx + m[0].length);
    }
    return { textBefore, blocks, remainingText: '' };
  }

  /** 结束时调用：把剩余文本（不含未闭合的 fence）吐出 */
  flush(): string {
    const remaining = this.buf;
    this.buf = '';
    return remaining;
  }
}

// ────────────── 能力块执行 ──────────────

interface CapabilityCtx {
  orgId: string;
  studentKey: string;
}

async function executeCapability(
  block: ParsedBlock,
  ctx: CapabilityCtx,
): Promise<Record<string, unknown>> {
  const input = block.parsed ?? {};
  try {
    if (block.type === 'webSearch') {
      return (await runWebSearch({
        query: String(input.query ?? ''),
        freshness: input.freshness as 'day' | 'week' | 'month' | 'year' | undefined,
        maxResults: typeof input.maxResults === 'number' ? input.maxResults : 5,
      })) as unknown as Record<string, unknown>;
    }
    if (block.type === 'searchProgramRequirements') {
      return (await runProgramRequirementSearch({
        query: typeof input.query === 'string' ? input.query : undefined,
        school: typeof input.school === 'string' ? input.school : undefined,
        schools: Array.isArray(input.schools) ? (input.schools as string[]) : undefined,
        program: typeof input.program === 'string' ? input.program : undefined,
        field: typeof input.field === 'string' ? input.field : undefined,
        degree: typeof input.degree === 'string' ? input.degree : undefined,
        intakeYear: typeof input.intakeYear === 'number' ? input.intakeYear : undefined,
        region: typeof input.region === 'string' ? input.region : undefined,
        focus: input.focus as 'requirements' | 'deadline' | 'funding' | 'curriculum' | 'faculty' | undefined,
        maxResults: typeof input.maxResults === 'number' ? input.maxResults : 6,
      })) as unknown as Record<string, unknown>;
    }
    if (block.type === 'readProfile') {
      const keys = Array.isArray(input.keys) ? (input.keys as string[]) : [];
      return (await svcReadProfile(ctx.orgId, ctx.studentKey, keys)) as unknown as Record<string, unknown>;
    }
    if (block.type === 'writeProfile') {
      const patch = (input.patch ?? {}) as Record<string, unknown>;
      return (await svcWriteProfile(ctx.orgId, ctx.studentKey, patch)) as unknown as Record<string, unknown>;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, error: `unknown capability: ${block.type}` };
}

// ────────────── 主入口：跑 OpenClaw 一步 agent loop ──────────────

export interface OpenClawRuntimeArgs {
  messages: UIMessage[];
  system: string;
  ctx: CapabilityCtx;
  /** 每次 turn 内最多允许几个能力块自动串调；超过视为死循环 */
  maxCapabilitySteps?: number;
  /** 本 turn 全部 message 产出完毕后回调，用于归档到 ConsultSession */
  onFinishArchive?: (messages: UIMessage[]) => void | Promise<void>;
}

/**
 * 执行一轮（可能内部跑多步能力块）。
 * 返回一个 UIMessage stream Response，可以直接 return 给 Next.js route handler。
 */
export function streamOpenClawAgent(args: OpenClawRuntimeArgs): Response {
  const maxCapSteps = args.maxCapabilitySteps ?? 4;

  const stream = createUIMessageStream({
    originalMessages: args.messages,
    onFinish: async ({ messages: finalMessages }) => {
      if (!args.onFinishArchive) return;
      try {
        await args.onFinishArchive(finalMessages as UIMessage[]);
      } catch (e) {
        console.error('[openclaw-adapter] archive hook failed:', e);
      }
    },
    execute: async ({ writer }) => {
      // 组装第一轮 chat messages
      let chatMessages = uiMessagesToOpenAIChat(args.messages, args.system);

      // 为了在前端构成一个 "assistant message"，我们给它分配固定的 messageId 和 textId
      const messageId = `oc-msg-${crypto.randomUUID()}`;
      const textPartId = `oc-text-${crypto.randomUUID()}`;

      writer.write({ type: 'start', messageId });
      writer.write({ type: 'start-step' });
      writer.write({ type: 'text-start', id: textPartId });

      let textEnded = false;
      const endTextIfNeeded = () => {
        if (!textEnded) {
          writer.write({ type: 'text-end', id: textPartId });
          textEnded = true;
        }
      };

      let capSteps = 0;
      let stopLoop = false;

      // 内层 loop：每次用 chatMessages 调 OpenClaw，解析块；如果是能力块，执行完把结果塞到 chatMessages 继续下一步
      const controller = new AbortController();

      while (!stopLoop) {
        const scanner = new FencedBlockScanner();
        const assistantAccum: string[] = []; // 本次调用 OpenClaw 产出的所有原始 content
        const pendingCapabilityBlocks: ParsedBlock[] = [];
        const emittedUiBlocks: Array<{
          block: ParsedBlock;
          toolCallId: string;
        }> = [];

        try {
          for await (const delta of streamOpenClawDeltas(chatMessages, controller.signal)) {
            assistantAccum.push(delta);
            const { textBefore, blocks } = scanner.feed(delta);
            if (textBefore) {
              writer.write({ type: 'text-delta', id: textPartId, delta: textBefore });
            }
            for (const b of blocks) {
              if (UI_BLOCK_TYPES.has(b.type)) {
                // UI 块：按 AI SDK tool-part 协议 emit
                const toolCallId = `oc-${b.type}-${crypto.randomUUID()}`;
                writer.write({
                  type: 'tool-input-available',
                  toolCallId,
                  toolName: b.type,
                  input: b.parsed ?? {},
                });
                emittedUiBlocks.push({ block: b, toolCallId });
              } else if (CAPABILITY_TYPES.has(b.type)) {
                // 能力块：先在前端显示"工具状态徽标"，然后执行
                const toolCallId = `oc-${b.type}-${crypto.randomUUID()}`;
                writer.write({
                  type: 'tool-input-available',
                  toolCallId,
                  toolName: b.type,
                  input: b.parsed ?? {},
                });
                pendingCapabilityBlocks.push(b);
                // 先占着 toolCallId，等下面执行完再写 output
                (b as unknown as { _toolCallId: string })._toolCallId = toolCallId;
              } else {
                // 未知块类型：当普通文本流过
                writer.write({
                  type: 'text-delta',
                  id: textPartId,
                  delta: `\n\`\`\`${b.type}\n${b.rawJson}\n\`\`\`\n`,
                });
              }
            }
          }
          const trailing = scanner.flush();
          if (trailing) {
            writer.write({ type: 'text-delta', id: textPartId, delta: trailing });
          }
        } catch (e) {
          writer.write({
            type: 'error',
            errorText: e instanceof Error ? e.message : String(e),
          });
          endTextIfNeeded();
          writer.write({ type: 'finish-step' });
          writer.write({ type: 'finish' });
          return;
        }

        // 如果有 UI 块 emit 了：这一轮就结束，等学生交互（由下一次 HTTP 请求触发新 turn）
        if (emittedUiBlocks.length > 0) {
          // UI 块本身没有 output（等用户交互），但 AI SDK v6 的 stream 允许 tool-input-available 后
          // 不接 tool-output-available，前端会保持 input-available 状态等 addToolResult。这是我们要的。
          stopLoop = true;
          break;
        }

        // 全是能力块：后端执行完，结果塞到 chatMessages 让下一步继续
        if (pendingCapabilityBlocks.length > 0) {
          capSteps += pendingCapabilityBlocks.length;
          if (capSteps > maxCapSteps) {
            writer.write({
              type: 'text-delta',
              id: textPartId,
              delta: `\n\n（达到能力调用上限 ${maxCapSteps}，本轮暂停。请继续对话。）`,
            });
            stopLoop = true;
            break;
          }
          // 把 assistant 这一轮输出（包括能力块原文）加进下一轮上下文
          chatMessages = [
            ...chatMessages,
            { role: 'assistant', content: assistantAccum.join('') },
          ];
          // 并行执行能力块
          const results = await Promise.all(
            pendingCapabilityBlocks.map((b) => executeCapability(b, args.ctx)),
          );
          for (let i = 0; i < pendingCapabilityBlocks.length; i++) {
            const b = pendingCapabilityBlocks[i];
            const tcid = (b as unknown as { _toolCallId: string })._toolCallId;
            writer.write({
              type: 'tool-output-available',
              toolCallId: tcid,
              output: results[i],
            });
            // 给下一步 OpenClaw 调用注入 tool-result
            chatMessages.push({
              role: 'user',
              content: `[tool-result:${b.type}] ${JSON.stringify(results[i])}`,
            });
          }
          // 继续下一步 while 循环，不结束
          continue;
        }

        // 没 UI 也没能力块：agent 已经输出完自然语言，结束
        stopLoop = true;
      }

      endTextIfNeeded();
      writer.write({ type: 'finish-step' });
      writer.write({ type: 'finish' });
    },
  });

  return createUIMessageStreamResponse({
    stream,
  });
}

// ────────────── 辅助：转 ModelMessages 供 aisdk runtime 复用（导出） ──────────────

export async function toModelMessagesCompat(messages: UIMessage[]): Promise<ModelMessage[]> {
  return convertToModelMessages(messages);
}
