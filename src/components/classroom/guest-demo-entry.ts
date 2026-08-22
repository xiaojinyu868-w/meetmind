import { DEMO_SESSION_ID } from '@/fixtures/demo-data';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export const GUEST_DEMO_APP_KEY: WorkshopAppKey = 'flashcards';
export const GUEST_DEMO_LESSON_TITLE = "Australia's Moving Experience · IELTS 听力练习";

/**
 * 试听入口是"一次性"的：从 landing 带 entry=demo 进入后，一旦用户看完试听进入复习页、
 * 或主动点课堂/收集 tab 离开试听现场，就把入口标记为已消费（sessionStorage）。
 * 否则 URL 上的 entry=demo 会让每次切回课堂 tab 都重新灌入试听课——用户被困在示例课里。
 * 刷新仍在同 tab 内保持已消费；新 tab 从 landing 重新进入则是一次新旅程。
 */
const DEMO_ENTRY_CONSUMED_KEY = 'mm-demo-entry-consumed';

export function isDemoEntryConsumed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(DEMO_ENTRY_CONSUMED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markDemoEntryConsumed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DEMO_ENTRY_CONSUMED_KEY, '1');
  } catch { /* storage 不可用时静默 */ }
}

export function resolveGuestDemoEntry({
  isGuestFastEntry,
  entry,
}: {
  isGuestFastEntry: boolean;
  entry: string | null;
}): {
  autoLoadDemo: boolean;
  autoOpenAppKey?: WorkshopAppKey;
} {
  if (!isGuestFastEntry || entry !== 'demo' || isDemoEntryConsumed()) {
    return { autoLoadDemo: false, autoOpenAppKey: undefined };
  }

  return {
    autoLoadDemo: true,
    autoOpenAppKey: undefined,
  };
}

export function isGuestDemoFlashcardsResult(result: AppExecutionResult | null | undefined): boolean {
  return Boolean(
    result &&
      result.pluginId === 'flashcards-lab' &&
      result.version === 'guest-demo-v1' &&
      result.model === 'fixture' &&
      result.render?.mode === 'flashcards' &&
      result.trace.includes('guest_demo=static_flashcards') &&
      result.trace.includes(`session=${DEMO_SESSION_ID}`) &&
      result.raw?.generatedAt === 'guest-demo-fixture',
  );
}

export function buildGuestDemoFlashcardsResult(): AppExecutionResult {
  const cards = [
    {
      id: 'guest-demo-card-1',
      title: '闪卡 1',
      front: '“up in the air” 在这段对话里表达什么状态？',
      back: '表示事情还没有确定、心里没底。Jane 要搬去美国，但还没把搬家安排理清楚，所以说自己 “so up in the air”。',
      hint: '不要按字面理解成“在空中”。',
    },
    {
      id: 'guest-demo-card-2',
      title: '闪卡 2',
      front: 'Jane Bond 为什么联系 Australia’s Moving Experience？',
      back: '她下个月要搬去美国，正在为搬家做准备，但组织安排上很混乱，所以找搬家公司寻求帮助。',
      hint: '抓住 relocating 和 getting organised。',
    },
    {
      id: 'guest-demo-card-3',
      title: '闪卡 3',
      front: '听力开始前，旁白提醒学生要注意什么？',
      back: '要边听边答题，因为录音不会播放第二遍。这个提示决定了做题策略：先看题，再抓关键词。',
      hint: '关键词是 not hear the recording a second time。',
    },
  ];

  return {
    pluginId: 'flashcards-lab',
    version: 'guest-demo-v1',
    model: 'fixture',
    trace: ['guest_demo=static_flashcards', `session=${DEMO_SESSION_ID}`],
    cards: cards.map((card, index) => ({
      id: card.id,
      type: 'flashcard',
      title: card.title,
      body: card.front,
      priority: index === 0 ? 'high' : 'medium',
      citations: [
        {
          startMs: index === 0 ? 6000 : index === 1 ? 72000 : 42000,
          endMs: index === 0 ? 11000 : index === 1 ? 80000 : 50000,
          snippet: card.back,
        },
      ],
      actions: [],
      meta: {
        cardKind: 'flashcard',
        front: card.front,
        back: card.back,
        hint: card.hint,
        difficulty: index === 0 ? 'core' : index === 1 ? 'challenge' : 'transfer',
      },
    })),
    tasks: [],
    render: {
      mode: 'flashcards',
      title: '试听课闪卡',
      description: '先回忆，再翻面看答案。',
      payload: { cards },
    },
    raw: {
      generatedAt: 'guest-demo-fixture',
    },
  };
}
