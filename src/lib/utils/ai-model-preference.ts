export const AI_MODEL_PREFERENCE_KEY = 'settings_model_preference';
export const AI_MODEL_AUTO_VALUE = 'auto';

export function resolveAiModelPreference(
  preference: string | null | undefined,
  defaultModel: string,
): string {
  const trimmed = preference?.trim();
  if (!trimmed || trimmed === AI_MODEL_AUTO_VALUE) return defaultModel;
  return trimmed;
}

export function resolveExplicitAiModelPreference(
  preference: string | null | undefined,
): string | undefined {
  const trimmed = preference?.trim();
  if (!trimmed || trimmed === AI_MODEL_AUTO_VALUE) return undefined;
  return trimmed;
}
