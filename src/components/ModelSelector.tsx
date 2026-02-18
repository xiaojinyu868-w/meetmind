'use client';

import { useEffect, useMemo, useState } from 'react';

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  description: string;
  recommended?: boolean;
  supportsMultimodal?: boolean;
}

type MobilePresentation = 'auto-sheet' | 'popover';

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  onMultimodalChange?: (supportsMultimodal: boolean) => void;
  className?: string;
  compact?: boolean;
  allowedProviders?: string[];
  mobilePresentation?: MobilePresentation;
}

let modelCatalogCache: ModelConfig[] | null = null;
let modelCatalogPromise: Promise<ModelConfig[]> | null = null;

async function fetchModelCatalog(): Promise<ModelConfig[]> {
  const response = await fetch('/api/chat', { cache: 'no-store' });
  const data = (await response.json().catch(() => ({}))) as { models?: ModelConfig[] };
  return Array.isArray(data.models) ? data.models : [];
}

function loadModelCatalog(): Promise<ModelConfig[]> {
  if (modelCatalogCache) {
    return Promise.resolve(modelCatalogCache);
  }
  if (!modelCatalogPromise) {
    modelCatalogPromise = fetchModelCatalog()
      .then((models) => {
        modelCatalogCache = models;
        return models;
      })
      .finally(() => {
        modelCatalogPromise = null;
      });
  }
  return modelCatalogPromise;
}

export function ModelSelector({
  value,
  onChange,
  onMultimodalChange,
  className = '',
  compact = false,
  allowedProviders,
  mobilePresentation = 'auto-sheet',
}: ModelSelectorProps) {
  const [models, setModels] = useState<ModelConfig[]>(() => modelCatalogCache ?? []);
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const allowedProviderSet = useMemo(
    () => new Set((allowedProviders || []).map((provider) => provider.trim()).filter(Boolean)),
    [allowedProviders]
  );

  const scopedModels = useMemo(() => {
    if (allowedProviderSet.size === 0) return models;
    return models.filter((model) => allowedProviderSet.has(model.provider));
  }, [allowedProviderSet, models]);

  const useBottomSheet = compact && mobilePresentation === 'auto-sheet' && isMobileViewport;

  useEffect(() => {
    let active = true;
    void loadModelCatalog()
      .then((nextModels) => {
        if (!active) return;
        setModels(nextModels);
      })
      .catch((error) => {
        console.error('[ModelSelector] Failed to load models:', error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobileViewport(media.matches);
    update();
    const listener = () => update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
    media.addListener(listener);
    return () => media.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen]);

  useEffect(() => {
    const currentModel = scopedModels.find((model) => model.id === value);
    if (currentModel && onMultimodalChange) {
      onMultimodalChange(currentModel.supportsMultimodal ?? false);
    }
  }, [value, scopedModels, onMultimodalChange]);

  useEffect(() => {
    if (scopedModels.length === 0) return;
    if (!scopedModels.some((model) => model.id === value)) {
      onChange(scopedModels[0].id);
    }
  }, [onChange, scopedModels, value]);

  const selectedModel = scopedModels.find((model) => model.id === value);
  const providerOrder = ['qwen', 'volcengine', 'relay'];
  const activeProviders = providerOrder.filter((provider) =>
    scopedModels.some((model) => model.provider === provider)
  );

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'qwen':
        return '🔮';
      case 'volcengine':
        return '🌋';
      case 'relay':
        return '🔁';
      default:
        return '🧠';
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'qwen':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'volcengine':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'relay':
        return 'bg-cyan-100 text-cyan-700 border-cyan-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'qwen':
        return '通义千问';
      case 'volcengine':
        return '火山方舟';
      case 'relay':
        return '中转服务';
      default:
        return provider;
    }
  };

  const handleModelChange = (modelId: string) => {
    onChange(modelId);
    const model = scopedModels.find((item) => item.id === modelId);
    if (model && onMultimodalChange) {
      onMultimodalChange(model.supportsMultimodal ?? false);
    }
    setIsOpen(false);
  };

  const compactLabel = selectedModel?.name?.split(' ').slice(0, 2).join(' ') || '选择模型';

  const renderModelList = (isSheet: boolean) => (
    <div className={isSheet ? 'max-h-[68vh] overflow-y-auto pb-2' : 'max-h-80 overflow-y-auto'}>
      {activeProviders.map((provider) => {
        const providerModels = scopedModels.filter((model) => model.provider === provider);
        if (providerModels.length === 0) return null;

        return (
          <div key={provider} className={isSheet ? 'px-3 py-2' : 'p-2'}>
            <p className="mb-1 px-2 text-[11px] uppercase tracking-wide text-gray-400">
              {getProviderLabel(provider)}
            </p>
            {providerModels.map((model) => (
              <button
                key={model.id}
                onClick={() => handleModelChange(model.id)}
                className={`w-full rounded-lg p-2.5 text-left transition-colors ${
                  value === model.id ? getProviderColor(model.provider) : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 text-lg leading-none">
                    {getProviderIcon(model.provider)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold leading-5 text-gray-800 [word-break:break-word]">
                        {model.name}
                      </span>
                      {model.recommended && (
                        <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                          推荐
                        </span>
                      )}
                      {model.supportsMultimodal && (
                        <span
                          className="whitespace-nowrap rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-600"
                          title="支持图片输入"
                        >
                          📷 多模态
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 overflow-hidden text-[11px] leading-[1.45] text-gray-500 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                      {model.description}
                    </p>
                  </div>
                  {value === model.id && (
                    <svg className="h-4 w-4 shrink-0 text-current" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        data-testid="model-selector-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-white transition-colors hover:bg-gray-50 ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        <span className={`shrink-0 ${compact ? 'text-sm' : ''}`}>
          {getProviderIcon(selectedModel?.provider || 'qwen')}
        </span>
        <span className={`min-w-0 truncate font-medium ${compact ? 'max-w-[7.5rem]' : 'max-w-[13rem]'}`}>
          {compact ? compactLabel : selectedModel?.name || '选择模型'}
        </span>
        {!compact && selectedModel?.supportsMultimodal && (
          <span className="shrink-0 rounded bg-blue-100 px-1 py-0.5 text-xs text-blue-600" title="支持图片输入">
            📷
          </span>
        )}
        <svg
          className={`shrink-0 transition-transform ${compact ? 'h-3 w-3' : 'h-4 w-4'} ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          {useBottomSheet ? (
            <div
              data-testid="model-selector-panel"
              className="fixed inset-x-3 bottom-3 z-20 max-h-[74vh] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-medium text-gray-700">选择 AI 模型</p>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                >
                  关闭
                </button>
              </div>
              {renderModelList(true)}
            </div>
          ) : (
            <div
              data-testid="model-selector-panel"
              className={`absolute top-full z-20 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg ${
                compact
                  ? 'right-0 left-auto w-[min(92vw,22rem)]'
                  : 'left-0 right-auto w-80 max-w-[calc(100vw-1.5rem)]'
              }`}
            >
              <div className="border-b border-gray-100 p-2">
                <p className="px-2 text-xs text-gray-500">选择 AI 模型</p>
              </div>
              {renderModelList(false)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
