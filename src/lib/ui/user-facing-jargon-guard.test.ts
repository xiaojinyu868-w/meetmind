import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const USER_FACING_FILES = [
  'src/lib/capture/collection-context.ts',
  'src/hooks/useCollectionPulse.ts',
  'src/components/mobile/MobileCollectionSheet.tsx',
  'src/components/DesktopSidebar.tsx',
  'src/components/mobile/MobileAIFab.tsx',
  'src/components/mobile/DedaoConfusionCard.tsx',
  'src/components/mobile/ConfusionCard.tsx',
  'src/components/CollectionComposerContextPreview.tsx',
  'src/app/all-notes/page.tsx',
  'src/app/(auth)/settings/page.tsx',
];

const JARGON = [
  '问 AI',
  'AI 对话',
  'AI 助手',
  '完善学习档案，让 AI',
  '默认模型',
  '原声',
  '原话',
  '回声',
  '生成失败',
  '机器修过',
];

describe('user-facing jargon guard', () => {
  it('keeps high-frequency UI copy in student language', () => {
    for (const relativePath of USER_FACING_FILES) {
      const content = readFileSync(join(ROOT, relativePath), 'utf8');
      for (const word of JARGON) {
        expect(content.includes(word), `${relativePath} contains user-facing jargon: ${word}`).toBe(false);
      }
    }
  });
});
