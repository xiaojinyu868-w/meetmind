import type { TranslationMode } from '@/hooks/useEnToZhTranslation';

export function cycleTranslationMode(current: TranslationMode): TranslationMode {
  if (current === 'off') return 'en-zh';
  if (current === 'en-zh') return 'zh-en';
  return 'off';
}

export function resolveSessionTranslationMode(input: {
  userMode: TranslationMode;
  sessionDefault?: TranslationMode;
  userTouched: boolean;
}): TranslationMode {
  if (!input.userTouched && input.sessionDefault) return input.sessionDefault;
  return input.userMode;
}
