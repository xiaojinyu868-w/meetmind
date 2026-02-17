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

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  onMultimodalChange?: (supportsMultimodal: boolean) => void;
  className?: string;
  compact?: boolean;  // 紧凑模式，用于移动端
  allowedProviders?: string[];
}

export function ModelSelector({
  value,
  onChange,
  onMultimodalChange,
  className = '',
  compact = false,
  allowedProviders,
}: ModelSelectorProps) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const allowedProviderSet = useMemo(
    () => new Set((allowedProviders || []).map((provider) => provider.trim()).filter(Boolean)),
    [allowedProviders]
  );
  const scopedModels = useMemo(() => {
    if (allowedProviderSet.size === 0) return models;
    return models.filter((model) => allowedProviderSet.has(model.provider));
  }, [allowedProviderSet, models]);

  useEffect(() => {
    // 获取可用模型列表
    fetch('/api/chat')
      .then(res => res.json())
      .then(data => {
        setModels(data.models || []);
      })
      .catch(console.error);
  }, []);

  // 当 value 变化时更新多模态状态
  useEffect(() => {
    const currentModel = scopedModels.find(m => m.id === value);
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

  const selectedModel = scopedModels.find(m => m.id === value);
  const providerOrder = ['qwen', 'volcengine', 'relay'];
  const activeProviders = providerOrder.filter((provider) =>
    scopedModels.some((model) => model.provider === provider)
  );

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'qwen': return '🔮';
      case 'volcengine': return '🌋';
      case 'relay': return '🔁';
      default: return '🧠';
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'qwen': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'volcengine': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'relay': return 'bg-cyan-100 text-cyan-700 border-cyan-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'qwen': return '通义千问';
      case 'volcengine': return '火山方舟';
      case 'relay': return '中转站';
      default: return provider;
    }
  };

  const handleModelChange = (modelId: string) => {
    onChange(modelId);
    const model = scopedModels.find(m => m.id === modelId);
    if (model && onMultimodalChange) {
      onMultimodalChange(model.supportsMultimodal ?? false);
    }
    setIsOpen(false);
  };

  const compactLabel = selectedModel?.name?.split(' ')[0] || '模型';

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex max-w-full items-center gap-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        <span className={`shrink-0 ${compact ? 'text-sm' : ''}`}>{getProviderIcon(selectedModel?.provider || 'qwen')}</span>
        <span className={`font-medium min-w-0 truncate ${compact ? 'max-w-[6.5rem]' : 'max-w-[13rem]'}`}>
          {compact ? compactLabel : (selectedModel?.name || '选择模型')}
        </span>
        {!compact && selectedModel?.supportsMultimodal && (
          <span className="shrink-0 text-xs px-1 py-0.5 bg-blue-100 text-blue-600 rounded" title="支持图片">
            📷
          </span>
        )}
        <svg 
          className={`shrink-0 transition-transform ${compact ? 'w-3 h-3' : 'w-4 h-4'} ${isOpen ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)} 
          />
          <div
            className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden ${
              compact
                ? 'right-0 left-auto w-[min(92vw,22rem)]'
                : 'left-0 right-auto w-80 max-w-[calc(100vw-1.5rem)]'
            }`}
          >
            <div className="p-2 border-b border-gray-100">
              <p className="text-xs text-gray-500 px-2">选择 AI 模型</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {/* 按提供商分组（仅显示当前已启用的 provider） */}
              {activeProviders.map(provider => {
                const providerModels = scopedModels.filter(m => m.provider === provider);
                if (providerModels.length === 0) return null;
                
                return (
                  <div key={provider} className="p-2">
                    <p className="text-xs text-gray-400 px-2 mb-1 uppercase">
                      {getProviderLabel(provider)}
                    </p>
                    {providerModels.map(model => (
                      <button
                        key={model.id}
                        onClick={() => handleModelChange(model.id)}
                        className={`w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-colors ${
                          value === model.id 
                            ? getProviderColor(model.provider)
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className="shrink-0 text-lg leading-none mt-0.5">{getProviderIcon(model.provider)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-[13px] leading-5 text-gray-800 break-words">
                              {model.name}
                            </span>
                            {model.recommended && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded whitespace-nowrap">
                                推荐
                              </span>
                            )}
                            {model.supportsMultimodal && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded whitespace-nowrap" title="支持图片上传">
                                📷 多模态
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-[1.35] text-gray-500 overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                            {model.description}
                          </p>
                        </div>
                        {value === model.id && (
                          <svg className="w-4 h-4 text-current flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
