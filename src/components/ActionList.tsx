'use client';

import type { ActionItem } from '@/lib/services/meetmind-service';

interface ActionListProps {
  items: ActionItem[];
  onComplete: (id: string) => void;
  onStartNext?: () => void;
}

export function ActionList({ items, onComplete, onStartNext }: ActionListProps) {
  const completedCount = items.filter((i) => i.completed).length;
  const totalMinutes = items.reduce((sum, i) => sum + i.estimatedMinutes, 0);
  const remainingMinutes = items
    .filter((i) => !i.completed)
    .reduce((sum, i) => sum + i.estimatedMinutes, 0);
  const progressPercent = items.length > 0 ? (completedCount / items.length) * 100 : 0;

  return (
    <div className="h-full flex flex-col">
      {/* 标题 */}
      <div className="p-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <span className="text-lg">📋</span>
          今晚行动清单
        </h2>
        {items.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            约 {totalMinutes} 分钟 · 已完成 {completedCount}/{items.length}
          </p>
        )}
      </div>

      {/* 进度条 */}
      {items.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-gray-500">完成进度</span>
            <span className={`font-medium ${progressPercent === 100 ? 'text-mint-600' : 'text-navy'}`}>
              {Math.round(progressPercent)}%
            </span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out-expo ${
                progressPercent === 100 
                  ? 'bg-mint' 
                  : 'bg-[#FDF3C0]'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {remainingMinutes > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              还需约 <span className="font-medium text-navy">{remainingMinutes}</span> 分钟
            </p>
          )}
        </div>
      )}

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="text-center py-12 animate-fade-in">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <span className="text-3xl">✨</span>
            </div>
            <p className="text-sm text-gray-500 mb-1">暂无行动清单</p>
            <p className="text-xs text-gray-400">选择困惑点后会自动生成</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                data-testid={`action-item-${item.id}`}
                data-completed={item.completed ? 'true' : 'false'}
                className={`action-item animate-slide-up ${item.completed ? 'completed' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <button
                  data-testid={`action-checkbox-${item.id}`}
                  onClick={() => onComplete(item.id)}
                  className="action-checkbox"
                  aria-label={item.completed ? '标记为未完成' : '标记为已完成'}
                >
                  {item.completed && (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <TypeBadge type={item.type} />
                    <span className={`text-sm font-medium transition-all break-words ${
                      item.completed ? 'text-gray-400 line-through' : 'text-navy'
                    }`}>
                      {item.title}
                    </span>
                    <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                      {item.estimatedMinutes}分钟
                    </span>
                  </div>
                  <p className={`text-xs mt-1.5 transition-colors break-words ${
                    item.completed ? 'text-gray-300' : 'text-gray-500'
                  }`}>
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 完成提示 */}
      {items.length > 0 && completedCount === items.length && (
        <div className="p-4 bg-[#D1F4E0]/30 border-t border-[#D1F4E0] animate-scale-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#D1F4E0] rounded-full flex items-center justify-center">
              <span className="text-xl">🎉</span>
            </div>
            <div>
              <p className="font-semibold text-[#232322]">太棒了！</p>
              <p className="text-xs text-[#232322]">今天的任务已全部完成</p>
            </div>
          </div>
        </div>
      )}

      {/* 快捷操作 */}
      {items.length > 0 && completedCount < items.length && (
        <div className="p-4 border-t border-gray-100">
          <button
            data-testid="action-start-next"
            onClick={onStartNext}
            className="w-full btn btn-secondary py-2.5 text-sm"
          >
            开始下一个任务
          </button>
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: ActionItem['type'] }) {
  const config = {
    replay: { label: '回放', className: 'bg-blue-100 text-blue-700' },
    exercise: { label: '练习', className: 'bg-[#D1F4E0] text-[#232322]' },
    review: { label: '复习', className: 'bg-[#FDF3C0] text-[#232322]' },
  };

  const { label, className } = config[type];

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>
      {label}
    </span>
  );
}
