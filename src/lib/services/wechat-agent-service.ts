import prisma from '@/lib/prisma';
import { chat } from '@/lib/services/llm-service';
import { runWithMeterContext } from '@/lib/services/point-meter';
import { ModelDefaults } from '@/lib/config/app.config';
import { getWechatAccessToken } from '@/lib/services/wechat-media-service';
import type { NormalizedWechatMessage } from '@/lib/services/wechat-mp-service';
import { createLogger } from '@/lib/logger';
import { COPY } from '@/lib/ui/copy';

const log = createLogger('wechat-agent');

/** 每个 openId 每天的 Agent 对话上限（成本护栏；收集流不受此限）。 */
const DAILY_AGENT_TURN_LIMIT = 30;
/** 注入对话的历史轮数。 */
const HISTORY_LIMIT = 12;
/** 注入的最近收集条数。 */
const RECENT_CAPTURE_LIMIT = 6;
/** 微信客服消息单条文本上限（官方 2048 字节，保守按字符截）。 */
const CUSTOMER_TEXT_CHUNK = 600;

export interface WechatAgentTurnInput {
  openId: string;
  userId?: string;
  workspaceId?: string;
  text: string;
  /** 微信 MsgId：公众号 5 秒回执超时会原样重推，用它做幂等去重 */
  messageId?: string;
}

interface AgentHistoryRow {
  role: string;
  text: string;
}

/**
 * 分流判定：绑定用户发来的「纯文字且不是链接」的消息交给 Agent 对话。
 * 链接 / 语音 / 图片 / 视频仍走收集线；未绑定用户维持原收集 + 绑定引导流程。
 */
export function isWechatAgentCandidate(
  normalized: Pick<NormalizedWechatMessage, 'msgType' | 'sourceUrl' | 'reach'>,
  bindingStatus: 'bound' | 'unresolved',
): boolean {
  if (bindingStatus !== 'bound') return false;
  if (normalized.msgType !== 'text') return false;
  if (normalized.sourceUrl) return false;
  return normalized.reach?.channel === 'quick-note';
}

export function buildWechatAgentSystemPrompt(): string {
  return '你是住在用户微信里的「同学」——一个真正听过他的课、看过他收集流的学习伙伴。你读过他最近的课堂和收集，了解他的学习画像。' +
    '说话方式：像微信里熟悉的同学，不像客服——短、口语、直接，一般 1-3 句，深入讨论时最多 5 句。' +
    '纯文本，不用 markdown、不用列表符号、不用标题、不堆 emoji。' +
    '有根：提到他的课堂或收集时要具体（比如「你周二那节计算机网络课」），不空泛；他随口丢来的话你自然接应就好，不要说「已保存」「记下来了」这类回执腔。' +
    '只有下面「关于他」里出现的信息才算数；没有提到他的课堂时，不要虚构他上过的课或老师说过的话。' +
    '他问学习问题时，基于他真实的课堂和收集回答；上下文里没有的就老实说不知道，不要编。' +
    '不催他学习，不指导他该怎么学，除非他明确问。';
}

function buildContextSections(input: {
  learnerProfile?: { bio?: { headline: string; detail?: string }; goals?: Array<{ title: string }> } | null;
  recentCaptures: Array<{ title: string | null; previewText: string | null; createdAt: Date }>;
}): string {
  const sections: string[] = [];
  const profile = input.learnerProfile;
  if (profile?.bio?.headline) {
    sections.push(`这个人：${profile.bio.headline}${profile.bio.detail ? `（${profile.bio.detail.slice(0, 120)}）` : ''}`);
  }
  const goals = (profile?.goals ?? []).slice(0, 3).map((goal) => goal.title).filter(Boolean);
  if (goals.length > 0) {
    sections.push(`他正在追的事：${goals.join('、')}`);
  }
  if (input.recentCaptures.length > 0) {
    const lines = input.recentCaptures.map((capture) => {
      const day = capture.createdAt.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      const title = (capture.title || capture.previewText || '一条收集').slice(0, 40);
      return `· ${day} ${title}`;
    });
    sections.push(`他最近收进来的：\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

/** 拼 LLM 消息序列（纯函数，可单测）：system + 历史 + 当前输入。 */
export function buildWechatAgentMessages(input: {
  systemPrompt: string;
  contextSections: string;
  history: AgentHistoryRow[];
  text: string;
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const system = input.contextSections
    ? `${input.systemPrompt}\n\n关于他，你现在知道的：\n${input.contextSections}`
    : input.systemPrompt;
  const history = input.history
    .filter((row) => (row.role === 'user' || row.role === 'assistant') && row.text.trim())
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.text.slice(0, 800),
    }));
  return [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: input.text.slice(0, 1500) },
  ];
}

/** 微信客服消息单条有长度上限，长回复按句号/换行切成多条（纯函数，可单测）。 */
export function splitWechatText(text: string, chunkSize = CUSTOMER_TEXT_CHUNK): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];
  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > chunkSize) {
    let cut = rest.lastIndexOf('\n', chunkSize);
    if (cut < chunkSize * 0.5) cut = rest.lastIndexOf('。', chunkSize);
    if (cut < chunkSize * 0.5) cut = chunkSize;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** 单条客服消息发送（带一次重试；token 过期类错误刷新后最后一次机会） */
async function sendChunk(openId: string, chunk: string, allowRefresh: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await getWechatAccessToken(attempt > 0);
    if (!accessToken) return false;
    try {
      const response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: openId,
            msgtype: 'text',
            text: { content: chunk },
          }),
        },
      );
      const data = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
      if (!data.errcode || data.errcode === 0) return true;
      // token 过期类：清缓存换新 token 最后试一次
      if ((data.errcode === 40001 || data.errcode === 42001) && allowRefresh) {
        await getWechatAccessToken(true);
        continue;
      }
      // 45047=客服消息条数上限 / 48001=接口未授权 / 45015=48h 窗口外：重试无意义
      log.warn('customer push rejected', { errcode: data.errcode, errmsg: data.errmsg });
      return false;
    } catch (error) {
      log.error('customer push failed', error);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  return false;
}

/** 客服消息推送（自动切多条）；视频/播客导入完成通知也复用它。48h 窗口外（45015）静默放弃 */
export async function pushWechatCustomerText(openId: string, text: string): Promise<boolean> {
  const chunks = splitWechatText(text);
  for (const chunk of chunks) {
    const ok = await sendChunk(openId, chunk, true);
    if (!ok) return false;
  }
  return true;
}

/** 护栏计数按「用户消息」算：LLM 失败风暴下成本护栏依然生效 */
async function todayUserTurnCount(openId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return prisma.wechatAgentMessage.count({
    where: { openId, role: 'user', createdAt: { gte: dayStart } },
  });
}

/** 超限提醒一天只发一次（连发 N 条不该收到 N 条提醒） */
async function alreadyRemindedToday(openId: string, reminderText: string): Promise<boolean> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const existing = await prisma.wechatAgentMessage.findFirst({
    where: { openId, role: 'assistant', text: reminderText, createdAt: { gte: dayStart } },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * 一轮微信 Agent 对话：落库用户消息 → 注入画像/近期收集/历史 → LLM → 落库回复 → 客服消息推送。
 * 设计为异步调用（公众号 5 秒回执等不起 LLM），失败只记日志，不回抛。
 */
export async function runWechatAgentTurn(input: WechatAgentTurnInput): Promise<void> {
  const text = input.text.trim();
  if (!input.openId || !text) return;

  try {
    // 幂等：公众号 5 秒回执超时会原样重推，同 MsgId 直接跳过
    if (input.messageId) {
      const duplicate = await prisma.wechatAgentMessage.findFirst({
        where: { messageId: input.messageId },
        select: { id: true },
      });
      if (duplicate) return;
    }

    await prisma.wechatAgentMessage.create({
      data: {
        openId: input.openId,
        userId: input.userId ?? null,
        role: 'user',
        // 收件侧防呆上限：微信单条 2048 字节限制在发件侧，用户粘贴/分段合并的长文
        // 可能更长，20000 字足够覆盖真实场景又防呆（之前 1500 会截断用户长输入）。
        text: text.slice(0, 20000),
        messageId: input.messageId ?? null,
      },
    });

    if ((await todayUserTurnCount(input.openId)) > DAILY_AGENT_TURN_LIMIT) {
      // 超限提醒一天只发一次
      const reminder = COPY.wechatAgent.rateLimited;
      if (!(await alreadyRemindedToday(input.openId, reminder))) {
        const pushed = await pushWechatCustomerText(input.openId, reminder);
        if (pushed) {
          await prisma.wechatAgentMessage.create({
            data: { openId: input.openId, userId: input.userId ?? null, role: 'assistant', text: reminder },
          });
        }
      }
      return;
    }

    const [history, user, recentCaptures] = await Promise.all([
      prisma.wechatAgentMessage.findMany({
        where: { openId: input.openId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        select: { role: true, text: true },
      }),
      input.userId
        ? prisma.user.findUnique({ where: { id: input.userId }, select: { learnerProfileJson: true } })
        : null,
      input.userId
        ? prisma.workspaceCapture.findMany({
            where: { userId: input.userId },
            orderBy: { createdAt: 'desc' },
            take: RECENT_CAPTURE_LIMIT,
            select: { title: true, previewText: true, createdAt: true },
          })
        : [],
    ]);

    let learnerProfile: { bio?: { headline: string; detail?: string }; goals?: Array<{ title: string }> } | null = null;
    if (user?.learnerProfileJson) {
      try {
        learnerProfile = JSON.parse(user.learnerProfileJson) as typeof learnerProfile;
      } catch {
        learnerProfile = null;
      }
    }

    const messages = buildWechatAgentMessages({
      systemPrompt: buildWechatAgentSystemPrompt(),
      contextSections: buildContextSections({ learnerProfile, recentCaptures }),
      history: history.reverse(),
      text,
    });

    const response = await runWithMeterContext(
      {
        feature: 'wechat-agent',
        userId: input.userId ?? `guest_wechat_${input.openId.slice(0, 12)}`,
        refType: 'wechat',
        refId: input.openId,
      },
      () => chat(messages, ModelDefaults.workshop, { temperature: 0.5, maxTokens: 450 }),
    );
    const reply = response.content.replace(/\*\*/g, '').trim();
    if (!reply) throw new Error('WECHAT_AGENT_EMPTY_REPLY');

    // 先推送后落库：用户没收到的回复不进历史——
    // 否则下一轮模型会引用一条用户从未见过的回复（「就像我刚说的…」）
    const pushed = await pushWechatCustomerText(input.openId, reply);
    if (!pushed) {
      log.warn('agent reply generated but push failed', { openId: input.openId.slice(0, 8) });
      return;
    }
    await prisma.wechatAgentMessage.create({
      data: { openId: input.openId, userId: input.userId ?? null, role: 'assistant', text: reply.slice(0, 2000) },
    });
  } catch (error) {
    log.error('wechat agent turn failed', error);
    try {
      await pushWechatCustomerText(input.openId, COPY.wechatAgent.failed);
    } catch {
      // 推送本身失败时不再挣扎，等用户下一条消息
    }
  }
}
