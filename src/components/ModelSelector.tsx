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
  compact?: boolean;
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
    () => new Set((allowedProviders || []).map((p) => p.trim()).filter(Boolean)),
    [allowedProviders]
  );
  const scopedModels = useMemo(() => {
    if (allowedProviderSet.size === 0) return models;
    return models.filter((m) => allowedProviderSet.has(m.provider));
  }, [allowedProviderSet, models]);

  useEffect(() => {
    fetch('/api/chat')
      .then(res => res.json())
      .then(data => setModels(data.models || []))
      .catch(console.error);
  }, []);

  useEffect(() => {
    const cur = scopedModels.find(m => m.id === value);
    if (cur && onMultimodalChange) onMultimodalChange(cur.supportsMultimodal ?? false);
  }, [value, scopedModels, onMultimodalChange]);

  useEffect(() => {
    if (scopedModels.length === 0) return;
    if (!scopedModels.some((m) => m.id === value)) onChange(scopedModels[0].id);
  }, [onChange, scopedModels, value]);

  const selectedModel = scopedModels.find(m => m.id === value);
  const providerOrder = ['qwen', 'volcengine', 'relay'];
  const activeProviders = providerOrder.filter((p) =>
    scopedModels.some((m) => m.provider === p)
  );

  const getProviderIcon = (p: string) => {
    switch (p) { case 'qwen': return '🔮'; case 'volcengine': return '🌋'; case 'relay': return '🔁'; default: return '🧠'; }
  };
  const getProviderColor = (p: string) => {
    switch (p) { case 'qwen': return 'bg-purple-50 text-purple-700 border-purple-200'; case 'volcengine': return 'bg-orange-50 text-orange-700 border-orange-200'; case 'relay': return 'bg-cyan-50 text-cyan-700 border-cyan-200'; default: return 'bg-gray-50 text-gray-700 border-gray-200'; }
  };
  const getProviderLabel = (p: string) => {
    switch (p) { case 'qwen': return '通义千问'; case 'volcengine': return '火山方舟'; case 'relay': return '中转站'; default: return p; }
  };

  const handleModelChange = (modelId: string) => {
    onChange(modelId);
    const model = scopedModels.find(m => m.id === modelId);
    if (model && onMultimodalChange) onMultimodalChange(model.supportsMultimodal ?? false);
    setIsOpen(false);
  };

  const compactLabel = selectedModel?.name?.split(' ')[0] || '模型';

  // 检测是否小屏（compact 模式视为移动端）
  const isMobileSheet = compact;

  // 模型列表渲染
  const renderModelList = () => (
    <div className={isMobileSheet ? 'pb-[env(safe-area-inset-bottom,0px)]' : ''}>
      {/* 头部 */}
      <div className={`flex items-center justify-between border-b border-gray-100 ${
        isMobileSheet ? 'px-5 py-3.5' : 'px-3 py-2'
      }`}>
        <p className={`font-medium text-gray-700 ${isMobileSheet ? 'text-sm' : 'text-xs text-gray-500'}`}>
          选择 AI 模型
        </p>
        {isMobileSheet && (
          <button
            onClick={() => setIsOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 模型列表 */}
      <div className={isMobileSheet ? 'max-h-[60vh] overflow-y-auto overscroll-contain' : 'max-h-80 overflow-y-auto'}>
        {activeProviders.map(provider => {
          const providerModels = scopedModels.filter(m => m.provider === provider);
          if (providerModels.length === 0) return null;

          return (
            <div key={provider} className={isMobileSheet ? 'px-3 py-2' : 'p-2'}>
              <p className={`text-gray-400 uppercase ${
                isMobileSheet ? 'text-xs px-2 mb-2 font-medium' : 'text-xs px-2 mb-1'
              }`}>
                {getProviderLabel(provider)}
              </p>
              {providerModels.map(model => {
                const isSelected = value === model.id;
                return (
                  <button
                    key={model.id}
                    onClick={() => handleModelChange(model.id)}
                    className={`w-full flex items-start gap-3 rounded-xl text-left transition-colors ${
                      isMobileSheet ? 'px-3 py-3 mb-1' : 'p-2.5 mb-0.5'
                    } ${isSelected
                      ? `${getProviderColor(model.provider)} border`
                      : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className={`shrink-0 leading-none ${
                      isMobileSheet ? 'text-xl mt-0.5' : 'text-lg mt-0.5'
                    }`}>
                      {getProviderIcon(model.provider)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-medium text-gray-800 ${
                          isMobileSheet ? 'text-sm leading-6' : 'text-[13px] leading-5'
                        }`}>
                          {model.name}
                        </span>
                        {model.recommended && (
                          <span className={`bg-[#FDF3C0] text-[#232322] rounded-full whitespace-nowrap ${
                            isMobileSheet ? 'text-[10px] px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5'
                          }`}>
                            推荐
                          </span>
                        )}
                        {model.supportsMultimodal && (
                          <span className={`bg-blue-100 text-blue-600 rounded-full whitespace-nowrap ${
                            isMobileSheet ? 'text-[10px] px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5'
                          }`} title="支持图片上传">
                            多模态
                          </span>
                        )}
                      </div>
                      <p className={`text-gray-500 overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] ${
                        isMobileSheet ? 'mt-1 text-xs leading-relaxed' : 'mt-0.5 text-[11px] leading-[1.35]'
                      }`}>
                        {model.description}
                      </p>
                    </div>
                    {isSelected && (
                      <svg className={`text-current flex-shrink-0 mt-1 ${
                        isMobileSheet ? 'w-5 h-5' : 'w-4 h-4'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={`relative min-w-0 ${className}`}>
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex max-w-full items-center gap-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        <span className={`shrink-0 ${compact ? 'text-sm' : ''}`}>
          {getProviderIcon(selectedModel?.provider || 'deepseek')}
        </span>
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
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 弹出层 */}
      {isOpen && (
        <>
          {/* 遮罩 */}
          <div
            className={`fixed inset-0 z-40 ${isMobileSheet ? 'bg-black/30' : ''}`}
            onClick={() => setIsOpen(false)}
          />

          {isMobileSheet ? (
            /* ===== 移动端：底部弹层 ===== */
            <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl animate-[slideUp_0.25s_ease-out]">
              {/* 顶部拖拽指示条 */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full bg-gray-300" />
              </div>
              {renderModelList()}
            </div>
          ) : (
            /* ===== 桌面端：下拉浮层 ===== */
            <div className="absolute top-full mt-1 left-0 right-auto w-80 max-w-[calc(100vw-1.5rem)] bg-white border border-gray-200 rounded-xl z-50 overflow-hidden">
              {renderModelList()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
