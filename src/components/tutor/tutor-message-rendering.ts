import { extractOpenAppMarker } from '@/lib/utils/open-app-marker';

export type TutorMessageRenderRole = 'user' | 'assistant' | 'system' | 'data';

export interface TutorMessageRenderPlan {
  renderer: 'plain' | 'markdown';
  content: string;
}

export function resolveTutorMessageRenderPlan(input: {
  role: TutorMessageRenderRole | string;
  text: string;
}): TutorMessageRenderPlan {
  const cleaned = extractOpenAppMarker(input.text || '').cleaned.trim();
  return {
    renderer: input.role === 'assistant' ? 'markdown' : 'plain',
    content: cleaned,
  };
}
