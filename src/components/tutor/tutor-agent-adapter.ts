import type { ConversationHistory } from '@/types/conversation';
import type { LearnerProfile } from '@/types/user';
import type { Segment } from './tutor-types';
import { formatTimestampLong } from '@/lib/utils/time-utils';

interface BreakpointLike {
  timestamp?: number | null;
}

export interface TutorAgentReviewContext {
  fullTranscript?: string;
  currentTimestampSec?: number;
  supportMaterials?: Array<{ title: string; content: string }>;
  learnerProfile?: string;
}

export function formatLearnerProfileForTutorAgent(profile?: LearnerProfile | null): string | undefined {
  if (!profile) return undefined;

  const lines: string[] = ['【这个学生】'];

  // M11.5：bio 优先 —— 这是「聊聊你想要的」首次会面对话沉淀的最精炼画像，
  // 比硬编码 stage/major/year 字段更准确反映"他是谁、什么状态"。
  // bio 存在时直接用 bio 作为头部，旧结构化字段作为补充背景。
  if (profile.bio?.headline?.trim()) {
    lines.push(profile.bio.headline.trim());
    if (profile.bio.detail?.trim()) {
      lines.push(profile.bio.detail.trim());
    }
    lines.push('');
  }

  // 结构化字段（旧 LearnerProfile，保留兼容）
  if (profile.stage === 'k12') {
    lines.push(`- ${profile.gradeLevel || '中小学生'}`);
    if (profile.textbookEdition) lines.push(`- 教材：${profile.textbookEdition}`);
    if (profile.weakSubjects?.length) lines.push(`- 觉得吃力的科目：${profile.weakSubjects.join('、')}`);
  } else if (profile.stage === 'university') {
    lines.push(`- 大学生 · ${profile.year || '年级未知'} · ${profile.major || '未知专业'}`);
    if (profile.currentCourses?.length) lines.push(`- 这学期在上：${profile.currentCourses.join('、')}`);
  } else if (profile.stage === 'graduate') {
    lines.push(`- 研究生 · ${profile.field || '未知方向'}`);
    if (profile.advisor) lines.push(`- 导师：${profile.advisor}`);
    if (profile.researchTopic) lines.push(`- 课题：${profile.researchTopic}`);
  } else if (profile.stage === 'working') {
    lines.push(`- 在职学习 · ${profile.industry || '未知行业'}`);
    if (profile.learningGoal) lines.push(`- 学习目标：${profile.learningGoal}`);
  }

  if (profile.goal) lines.push(`- 最近的目标：${profile.goal}`);
  if (profile.otherInterests) lines.push(`- 同时也在学：${profile.otherInterests}`);

  // M11.5：goals[] —— 「聊聊你想要的」对话沉淀的具体目标
  // 只取 active 状态的，最多 5 条；按 updatedAt 降序
  const activeGoals = (profile.goals ?? [])
    .filter((g) => !g.status || g.status === 'active')
    .slice()
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 5);
  if (activeGoals.length > 0) {
    lines.push('');
    lines.push('- 他正在追的事：');
    activeGoals.forEach((g) => {
      lines.push(`  · ${g.title}${g.summary ? `（${g.summary.slice(0, 60)}）` : ''}`);
    });
  }

  lines.push('');
  lines.push('这只是背景，不是规则。当前课堂/材料和用户这一句话仍然是主上下文。');

  return lines.join('\n');
}

function compactContextText(value: string | null | undefined, maxLength = 80): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function formatRecentLearningActivityForTutorAgent(
  conversations: Array<Pick<ConversationHistory, 'conversationId' | 'title' | 'lastMessage' | 'messageCount'>>,
  currentConversationId?: string | null,
): string | undefined {
  const lines = conversations
    .filter((conversation) => conversation.conversationId !== currentConversationId)
    .map((conversation) => {
      const title = compactContextText(conversation.title, 48);
      const lastMessage = compactContextText(conversation.lastMessage, 72);
      const suffix = lastMessage ? `；最近一句：${lastMessage}` : '';
      return title ? `- ${title}${suffix}` : '';
    })
    .filter(Boolean)
    .slice(0, 4);

  if (lines.length === 0) return undefined;

  return [
    '【这节课近期对话痕迹】',
    ...lines,
    '',
    '这只是学习现场线索，不是规则。当前用户这一句话、课堂内容和可用工具仍然是主上下文。',
  ].join('\n');
}

export function resolveTutorAgentLaunchText({
  launchQuestion,
}: {
  launchQuestion?: string | null;
  launchDisplayText?: string | null;
}): string | null {
  const text = launchQuestion?.trim();
  return text || null;
}

export function buildTutorAgentReviewContext({
  segments,
  currentTimeSec,
  breakpoint,
  supportContextText,
  preferSupportContext,
  learnerProfile,
}: {
  segments: Segment[];
  currentTimeSec?: number;
  breakpoint?: BreakpointLike | null;
  supportContextText?: string | null;
  preferSupportContext?: boolean;
  learnerProfile?: string | null;
}): TutorAgentReviewContext {
  // 不在这里预截断：prompt 层 capFullTranscript 有播放点锚定的智能窗口
  // （按行首时间戳定位，前 60% / 后 40%）；adapter 若先砍尾部，超长内容的
  // 早段在到达 prompt 层前就丢了，锚定窗口永远不生效。
  // 每段带 [MM:SS] / [HH:MM:SS] 真实开始时刻——这是「每句话都能指回原件」的
  // 产品承诺：没有真实时间戳，模型只能幻觉出聚在开头几分钟的假时间。
  const fullTranscript = segments
    .map((s) => `[${formatTimestampLong(s.startMs)}] ${s.text}`)
    .join('\n');

  const breakpointSec = typeof breakpoint?.timestamp === 'number' && breakpoint.timestamp > 0
    ? Math.floor(breakpoint.timestamp / 1000)
    : undefined;
  const currentTimestampSec = typeof currentTimeSec === 'number' && currentTimeSec > 0
    ? currentTimeSec
    : breakpointSec;

  const supportText = supportContextText?.trim();
  const supportMaterials = supportText
    ? [{ title: preferSupportContext ? '当前选中的内容' : '补充资料', content: supportText }]
    : undefined;

  const normalizedLearnerProfile = learnerProfile?.trim();

  return {
    fullTranscript: fullTranscript || undefined,
    currentTimestampSec,
    supportMaterials,
    learnerProfile: normalizedLearnerProfile || undefined,
  };
}
