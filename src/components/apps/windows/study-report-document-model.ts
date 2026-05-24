import { COPY } from '@/lib/ui/copy';

export interface StudyReportPayload {
  title?: string;
  letterToParent?: string;
  topics?: Array<{ name?: string; difficulty?: string; gist?: string }>;
  confusionAnalysis?: string;
  chatTopics?: string[];
  nextSteps?: string[];
  hasAnchors?: boolean;
}

export interface NormalizedStudyReportTopic {
  name: string;
  difficulty: string;
  gist: string;
}

export interface StudyReportListSection {
  title: string;
  items: string[];
}

export interface NormalizedStudyReportDocument {
  title: string;
  letterToParent: string;
  leadTopic: NormalizedStudyReportTopic | null;
  supportingTopics: NormalizedStudyReportTopic[];
  confusionAnalysis: string;
  sections: StudyReportListSection[];
  topicCount: number;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean);
}

function compactTopicName(value: unknown, fallback: string): string {
  const text = cleanText(value).replace(/\s+/g, ' ');
  if (!text) return fallback;
  if (/^[\x00-\x7F\s.,'"!?;:()\-]+$/.test(text)) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 2) return `${words.slice(0, 2).join(' ')}…`;
    return text.length > 18 ? `${text.slice(0, 17)}…` : text;
  }
  return text.length > 18 ? `${text.slice(0, 17)}…` : text;
}

function normalizeTopics(payload: StudyReportPayload): NormalizedStudyReportTopic[] {
  if (!Array.isArray(payload.topics)) return [];
  return payload.topics
    .map((topic, index) => ({
      name: compactTopicName(topic?.name, `知识点 ${index + 1}`),
      difficulty: cleanText(topic?.difficulty) || '基础',
      gist: cleanText(topic?.gist),
    }))
    .filter((topic) => topic.name || topic.gist);
}

export function normalizeStudyReportDocument(payload: StudyReportPayload): NormalizedStudyReportDocument {
  const topics = normalizeTopics(payload);
  const chatTopics = cleanList(payload.chatTopics);
  const nextSteps = cleanList(payload.nextSteps);

  return {
    title: cleanText(payload.title) || COPY.studyReport.defaultTitle,
    letterToParent: cleanText(payload.letterToParent) || COPY.studyReport.emptyLetter,
    leadTopic: topics[0] ?? null,
    supportingTopics: topics.slice(1),
    confusionAnalysis: cleanText(payload.confusionAnalysis),
    sections: [
      chatTopics.length > 0 ? { title: COPY.studyReport.conversationTitle, items: chatTopics } : null,
      nextSteps.length > 0 ? { title: COPY.studyReport.nextTitle, items: nextSteps } : null,
    ].filter((section): section is StudyReportListSection => section !== null),
    topicCount: topics.length,
  };
}
