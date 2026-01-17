'use client';

import { useState, useEffect } from 'react';

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
}

export function ModelSelector({ value, onChange, onMultimodalChange, className = '', compact = false }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // 获取可用模型列表
    fetch('/api/chat')
      .then(res => res.json())
      .then(data => {
        setModels(data.models || []);
        // 初始化时通知父组件当前模型的多模态支持状态
        const currentModel = (data.models || []).find((m: ModelConfig) => m.id === value);
        if (currentModel && onMultimodalChange) {
          onMultimodalChange(currentModel.supportsMultimodal ?? false);
        }
      })
      .catch(console.error);
  }, []);

  // 当 value 变化时更新多模态状态
  useEffect(() => {
    const currentModel = models.find(m => m.id === value);
    if (currentModel && onMultimodalChange) {
      onMultimodalChange(currentModel.supportsMultimodal ?? false);
    }
  }, [value, models, onMultimodalChange]);

  const selectedModel = models.find(m => m.id === value);

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'qwen': return '🔮';
      case 'gemini': return '✨';
      case 'openai': return '🤖';
      default: return '🧠';
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'qwen': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'gemini': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'openai': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const handleModelChange = (modelId: string) => {
    onChange(modelId);
    const model = models.find(m => m.id === modelId);
    if (model && onMultimodalChange) {
      onMultimodalChange(model.supportsMultimodal ?? false);
    }
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        <span className={compact ? 'text-sm' : ''}>{getProviderIcon(selectedModel?.provider || 'qwen')}</span>
        <span className="font-medium">{compact ? (selectedModel?.name?.split(' ')[0] || '模型') : (selectedModel?.name || '选择模型')}</span>
        {!compact && selectedModel?.supportsMultimodal && (
          <span className="text-xs px-1 py-0.5 bg-blue-100 text-blue-600 rounded" title="支持图片">
            📷
          </span>
        )}
        <svg 
          className={`transition-transform ${compact ? 'w-3 h-3' : 'w-4 h-4'} ${isOpen ? 'rotate-180' : ''}`} 
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
          <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
            <div className="p-2 border-b border-gray-100">
              <p className="text-xs text-gray-500 px-2">选择 AI 模型</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {/* 按提供商分组 */}
              {['qwen', 'gemini', 'openai'].map(provider => {
                const providerModels = models.filter(m => m.provider === provider);
                if (providerModels.length === 0) return null;
                
                return (
                  <div key={provider} className="p-2">
                    <p className="text-xs text-gray-400 px-2 mb-1 uppercase">
                      {provider === 'qwen' ? '通义千问' : provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}
                    </p>
                    {providerModels.map(model => (
                      <button
                        key={model.id}
                        onClick={() => handleModelChange(model.id)}
                        className={`w-full flex items-start gap-3 p-2 rounded-lg text-left transition-colors ${
                          value === model.id 
                            ? getProviderColor(model.provider)
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-lg">{getProviderIcon(model.provider)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{model.name}</span>
                            {model.recommended && (
                              <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
                                推荐
                              </span>
                            )}
                            {model.supportsMultimodal && (
                              <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded" title="支持图片上传">
                                📷 多模态
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{model.description}</p>
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
