import type { UIMessage } from 'ai';

export type AssistantTurnSummary = {
  label: string;
  title: string;
  detail?: string;
};

type PartLike = {
  type?: unknown;
  input?: unknown;
  text?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstSentence(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const stop = compact.search(/[。！？\n]/);
  return (stop >= 0 ? compact.slice(0, stop + 1) : compact).slice(0, 72);
}

function toolSummary(type: string, input: Record<string, unknown> | undefined): AssistantTurnSummary | null {
  switch (type) {
    case 'tool-showConsultantMove':
      return {
        label: '顾问判断',
        title: textValue(input?.title) ?? '判断了一次真实问题',
        detail: textValue(input?.move) ?? textValue(input?.read),
      };
    case 'tool-showAdvisorDiscovery':
      return {
        label: '导师探索',
        title: textValue(input?.title) ?? '探索了一组导师/方向',
        detail: textValue(input?.read),
      };
    case 'tool-showServicePlan':
      return {
        label: '申请方案',
        title: textValue(input?.title) ?? '组织了一套申请方案',
        detail: textValue(input?.objective) ?? textValue(input?.consultantRead),
      };
    case 'tool-showOutreachWorkspace':
      return {
        label: '外联工作台',
        title: textValue(input?.title) ?? '准备了一张外联工作台',
      };
    case 'tool-showDraft':
      return {
        label: textValue(input?.kind) === 'cv-diagnosis' ? 'CV 活文档' : '交付草稿',
        title: textValue(input?.title) ?? '生成了一份交付物',
      };
    case 'tool-askOptions':
      return {
        label: '关键选择',
        title: textValue(input?.prompt) ?? '问了一个选择题',
      };
    case 'tool-startVoiceCall':
      return {
        label: '语音接力',
        title: textValue(input?.reason) ?? '发起了一次语音沟通',
      };
    default:
      return null;
  }
}

export function summarizeAssistantTurn(message: UIMessage): AssistantTurnSummary {
  const textParts: string[] = [];

  for (let i = (message.parts ?? []).length - 1; i >= 0; i -= 1) {
    const part = message.parts?.[i] as PartLike | undefined;
    if (!part) continue;
    if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
      const summary = toolSummary(part.type, asRecord(part.input));
      if (summary) return summary;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      textParts.unshift(part.text);
    }
  }

  const text = textParts.join('').trim();
  if (text) {
    return { label: '文字回复', title: firstSentence(text) };
  }

  return { label: '上一轮', title: '完成了一次上下文处理' };
}
