export { buildExecutionContext } from './context-builder';
export { AppPluginRegistry, appPluginRegistry } from './registry';
export {
  WORKSHOP_APP_CATALOG,
  getWorkshopAppByKey,
  isWorkshopAppKey,
  type WorkshopAppCatalogItem,
  type WorkshopAppKey,
} from './app-catalog';
export type {
  AppExecuteRequest,
  AppExecutionContext,
  AppExecutionResult,
  AppPlugin,
  AppPluginManifest,
  AppPluginTools,
  ApplicationGoal,
  InputLayerContext,
  MemoryLayerSnapshot,
  // Context Pack（PRD v1.1 §2）
  ContextPack,
  ContextTier,
  LessonContext,
  PersonalAnnotation,
} from './types';
export {
  buildPackFromExecutionContext,
  buildExecutionContextFromPack,
  buildPackFromSingleSession,
  renderTranscriptWithAnnotations,
  validatePack,
  isAppSupportedAtTier,
} from './context-pack';
