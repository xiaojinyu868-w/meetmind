/**
 * 用户偏好 (Preference) 数据库操作
 * Owner: 基建模块开发者
 */

import { db } from './schema';

/** 获取用户偏好 */
export async function getPreference<T>(key: string, defaultValue: T): Promise<T> {
  const pref = await db.preferences.get(key);
  return pref?.value ?? defaultValue;
}

/** 设置用户偏好 */
export async function setPreference<T>(key: string, value: T): Promise<void> {
  await db.preferences.put({ key, value });
}

/** 删除用户偏好 */
export async function deletePreference(key: string): Promise<void> {
  await db.preferences.delete(key);
}

/** 清除所有引导和页面状态（用于调试/重置） */
export async function resetAppState(): Promise<void> {
  await db.preferences.delete('onboarding_state');
  await db.preferences.delete('app_last_state');
  await db.preferences.delete('tutor_last_state');
}
