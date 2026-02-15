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
} from './types';
