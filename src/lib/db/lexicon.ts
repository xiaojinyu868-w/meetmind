import { db, type TranscriptEditDiff, type TranscriptLexiconEntry } from './schema';

export type TranscriptScope = 'classroom' | 'meeting' | 'global';

export interface LexiconUpsertInput {
  term: string;
  canonical: string;
  aliases?: string[];
  scope?: TranscriptScope;
  status?: TranscriptLexiconEntry['status'];
  source?: TranscriptLexiconEntry['source'];
  hitCount?: number;
}

export interface EditDiffInput {
  originalText: string;
  correctedText: string;
  scope?: TranscriptScope;
  promotionThreshold?: number;
}

const DEFAULT_SCOPE: TranscriptScope = 'classroom';
const DEFAULT_PROMOTION_THRESHOLD = 3;

const DEFAULT_SEED_TERMS: Array<LexiconUpsertInput> = [
  {
    term: 'suggest qustions',
    canonical: 'suggest questions',
    aliases: ['suggest question'],
    scope: 'global',
    status: 'active',
    source: 'seed',
  },
  {
    term: 'qwen',
    canonical: 'Qwen',
    aliases: ['千问'],
    scope: 'global',
    status: 'active',
    source: 'seed',
  },
  {
    term: 'llm',
    canonical: 'LLM',
    aliases: ['大模型'],
    scope: 'global',
    status: 'active',
    source: 'seed',
  },
];

function normalizeValue(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeKey(value: string): string {
  return normalizeValue(value)
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()【】\[\]-]/g, '');
}

function dedupeAliases(term: string, canonical: string, aliases?: string[]): string[] {
  const all = [term, ...(aliases || [])]
    .map((item) => normalizeValue(item))
    .filter(Boolean)
    .filter((item) => item !== canonical);

  return Array.from(new Set(all));
}

export async function seedTranscriptLexicon(seedTerms: LexiconUpsertInput[] = DEFAULT_SEED_TERMS): Promise<number> {
  let inserted = 0;
  for (const term of seedTerms) {
    const result = await upsertTranscriptLexiconEntry(term);
    if (result.created) inserted += 1;
  }
  return inserted;
}

export async function getTranscriptLexicon(scope: TranscriptScope = DEFAULT_SCOPE): Promise<TranscriptLexiconEntry[]> {
  const entries = await db.transcriptLexicon.toArray();
  return entries
    .filter((item) => item.status === 'active')
    .filter((item) => item.scope === scope || item.scope === 'global')
    .sort((a, b) => b.hitCount - a.hitCount);
}

export async function upsertTranscriptLexiconEntry(input: LexiconUpsertInput): Promise<{ entry: TranscriptLexiconEntry; created: boolean }> {
  const now = new Date();
  const scope = input.scope || DEFAULT_SCOPE;
  const term = normalizeValue(input.term);
  const canonical = normalizeValue(input.canonical);

  if (!term || !canonical) {
    throw new Error('term/canonical is required');
  }

  const existing = await db.transcriptLexicon
    .where('[scope+term]')
    .equals([scope, term])
    .first();

  const aliases = dedupeAliases(term, canonical, input.aliases);
  const nextStatus = input.status || existing?.status || 'pending';
  const nextSource = input.source || existing?.source || 'auto';
  const nextHitCount = Math.max(input.hitCount ?? 1, existing?.hitCount ?? 0);

  if (existing?.id) {
    const mergedAliases = Array.from(new Set([...(existing.aliases || []), ...aliases]));
    const promoted = nextStatus === 'active' && existing.status !== 'active';

    await db.transcriptLexicon.update(existing.id, {
      canonical,
      aliases: mergedAliases,
      status: nextStatus,
      source: nextSource,
      hitCount: nextHitCount,
      promotedAt: promoted ? now : existing.promotedAt,
      updatedAt: now,
    });

    return {
      created: false,
      entry: {
        ...existing,
        canonical,
        aliases: mergedAliases,
        status: nextStatus,
        source: nextSource,
        hitCount: nextHitCount,
        promotedAt: promoted ? now : existing.promotedAt,
        updatedAt: now,
      },
    };
  }

  const newEntry: TranscriptLexiconEntry = {
    term,
    canonical,
    aliases,
    scope,
    status: nextStatus,
    source: nextSource,
    hitCount: nextHitCount,
    promotedAt: nextStatus === 'active' ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const id = await db.transcriptLexicon.add(newEntry);
  return {
    created: true,
    entry: { ...newEntry, id },
  };
}

function shouldTrackDiff(originalText: string, correctedText: string): boolean {
  if (!originalText || !correctedText) return false;
  if (originalText === correctedText) return false;

  const originNorm = normalizeValue(originalText);
  const correctedNorm = normalizeValue(correctedText);

  if (!originNorm || !correctedNorm || originNorm === correctedNorm) return false;
  if (originNorm.length > 24 || correctedNorm.length > 24) return false;
  if (/[。！？!?]/.test(originNorm + correctedNorm)) return false;
  return true;
}

export async function recordTranscriptEditDiff(input: EditDiffInput): Promise<{ promoted: boolean; diff?: TranscriptEditDiff }> {
  const scope = input.scope || DEFAULT_SCOPE;
  const promotionThreshold = Math.max(2, input.promotionThreshold || DEFAULT_PROMOTION_THRESHOLD);
  const originalText = normalizeValue(input.originalText);
  const correctedText = normalizeValue(input.correctedText);

  if (!shouldTrackDiff(originalText, correctedText)) {
    return { promoted: false };
  }

  const now = new Date();
  const originalKey = normalizeKey(originalText);
  const correctedKey = normalizeKey(correctedText);

  const existing = await db.transcriptEditDiffs
    .where('[scope+originalText+correctedText]')
    .equals([scope, originalKey, correctedKey])
    .first();

  const nextHitCount = (existing?.hitCount || 0) + 1;
  const promoted = nextHitCount >= promotionThreshold;

  let diff: TranscriptEditDiff;
  if (existing?.id) {
    await db.transcriptEditDiffs.update(existing.id, {
      hitCount: nextHitCount,
      promoted: existing.promoted || promoted,
      updatedAt: now,
    });

    diff = {
      ...existing,
      hitCount: nextHitCount,
      promoted: existing.promoted || promoted,
      updatedAt: now,
    };
  } else {
    const base: TranscriptEditDiff = {
      originalText: originalKey,
      correctedText: correctedKey,
      scope,
      hitCount: nextHitCount,
      promoted,
      createdAt: now,
      updatedAt: now,
    };

    const id = await db.transcriptEditDiffs.add(base);
    diff = { ...base, id };
  }

  await upsertTranscriptLexiconEntry({
    term: originalText,
    canonical: correctedText,
    aliases: [originalText],
    scope,
    status: promoted ? 'active' : 'pending',
    source: 'auto',
    hitCount: nextHitCount,
  });

  return { promoted, diff };
}

export async function getTranscriptEditDiffs(scope: TranscriptScope = DEFAULT_SCOPE): Promise<TranscriptEditDiff[]> {
  const rows = await db.transcriptEditDiffs
    .where('scope')
    .equals(scope)
    .toArray();

  return rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}