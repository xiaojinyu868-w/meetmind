// TutorToolCard 用到的纯工具函数（拆出去好测，避免 vitest 处理 tsx）

export type TutorToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error';

export interface TutorToolPartLike {
  type: string;
  toolCallId?: string;
  state?: TutorToolState;
  input?: Record<string, unknown>;
  output?: {
    ok?: boolean;
    cards?: unknown[];
    render?: unknown;
    tasks?: unknown[];
    error?: string;
    matches?: unknown[];
    query?: string;
  };
  errorText?: string;
}

const TOOL_PREFIX = 'tool-';

const TOOL_NAMES: Record<string, string> = {
  makeFlashcards: '闪卡',
  makeQuiz: '测验',
  makeMindmap: '思维导图',
  lookupTranscript: '课堂片段',
};

export function readableToolName(type: string): string {
  const toolKey = type.startsWith(TOOL_PREFIX) ? type.slice(TOOL_PREFIX.length) : type;
  return TOOL_NAMES[toolKey] ?? toolKey;
}

export function statusText(
  state: TutorToolState | undefined,
  toolTitle: string,
  error?: string,
): string {
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return `我在给你做${toolTitle}…`;
    case 'output-error':
      return error
        ? `${toolTitle}没做成：${error}`
        : `${toolTitle}暂时没做成，我们用对话讲一下`;
    case 'output-available':
    default:
      return `${toolTitle}准备好了`;
  }
}

export function extractToolParts(parts: unknown[]): TutorToolPartLike[] {
  const out: TutorToolPartLike[] = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    const part = p as { type?: unknown };
    if (typeof part.type === 'string' && part.type.startsWith(TOOL_PREFIX)) {
      out.push(p as TutorToolPartLike);
    }
  }
  return out;
}
