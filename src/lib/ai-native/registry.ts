import { createPluginTools } from './tools';
import { defaultPlugins } from './plugins';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginManifest } from './types';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown plugin execution error';
}

const SEMANTIC_REJECTIONS = new Set(['CONTENT_NOT_READY']);

function shouldRethrowPluginError(error: unknown): error is Error {
  return error instanceof Error && SEMANTIC_REJECTIONS.has(error.message);
}

export class AppPluginRegistry {
  private readonly plugins = new Map<string, AppPlugin>();

  constructor(plugins: AppPlugin[] = defaultPlugins) {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  register(plugin: AppPlugin): void {
    this.plugins.set(plugin.manifest.id, plugin);
  }

  get(pluginId: string): AppPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  list(): AppPluginManifest[] {
    return Array.from(this.plugins.values()).map((plugin) => plugin.manifest);
  }

  private resolve(context: AppExecutionContext, pluginId?: string): AppPlugin | undefined {
    if (pluginId) {
      return this.get(pluginId);
    }

    for (const plugin of this.plugins.values()) {
      if (plugin.canHandle(context)) {
        return plugin;
      }
    }

    return undefined;
  }

  async execute(context: AppExecutionContext, pluginId?: string): Promise<AppExecutionResult> {
    const plugin = this.resolve(context, pluginId);
    if (!plugin) {
      throw new Error(pluginId ? `Plugin not found: ${pluginId}` : 'No plugin matched this context');
    }

    const tools = createPluginTools();
    try {
      return await plugin.run(context, tools);
    } catch (error) {
      // “材料不值得生成”是可信的产品判断，不是插件崩溃。交给 API 以 422
      // 返回，让前端呈现范围不足状态；禁止包装成一份伪成功的空产物。
      if (shouldRethrowPluginError(error)) throw error;
      return {
        pluginId: plugin.manifest.id,
        version: plugin.manifest.version,
        trace: [`plugin_execution_failed=${getErrorMessage(error)}`],
        cards: [
          {
            id: 'plugin-error',
            type: 'insight',
            title: '插件执行失败',
            body: '当前插件运行异常，请稍后重试或切换其他插件。',
            priority: 'high',
          },
        ],
        tasks: [],
        raw: {
          error: getErrorMessage(error),
        },
      };
    }
  }
}

export const appPluginRegistry = new AppPluginRegistry();
