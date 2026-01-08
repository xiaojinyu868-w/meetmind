'use client';

import type { ActionItem } from '@/lib/services/meetmind-service';

interface ActionListProps {
  items: ActionItem[];
  onComplete: (id: string) => void;
}

export function ActionList({ items, onComplete }: ActionListProps) {
  const completedCount = items.filter((i) => i.completed).length;
  const totalMinutes = items.reduce((sum, i) => sum + i.estimatedMinutes, 0);
  const remainingMinutes = items
    .filter((i) => !i.completed)
    .reduce((sum, i) => sum + i.estimatedMinutes, 0);

  return (
    <div className="h-full flex flex-col">
      {/* 标题 */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <span>📋</span> 今晚行动清单
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          约 {totalMinutes} 分钟 · 已完成 {completedCount}/{items.length}
        </p>
      </div>

      {/* 进度条 */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>完成进度</span>
          <span>{Math.round((completedCount / items.length) * 100) || 0}%</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${(completedCount / items.length) * 100 || 0}%` }}
          />
        </div>
        {remainingMinutes > 0 && (
          <p className="text-xs text-gray-400 mt-1">
            还需约 {remainingMinutes} 分钟
          </p>
        )}
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <div className="text-3xl mb-2">✨</div>
            <p className="text-sm">选择断点后会生成行动清单</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className={`action-item ${item.completed ? 'completed' : ''}`}
              >
                <button
                  onClick={() => onComplete(item.id)}
                  className="checkbox"
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
                  <div className="flex items-center gap-2">
                    <TypeBadge type={item.type} />
                    <span className={`text-sm font-medium ${item.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {item.title}
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${item.completed ? 'text-gray-300' : 'text-gray-500'}`}>
                    {item.description}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    约 {item.estimatedMinutes} 分钟
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      {items.length > 0 && completedCount === items.length && (
        <div className="p-4 bg-green-50 border-t border-green-200">
          <div className="flex items-center gap-2 text-green-700">
            <span className="text-xl">🎉</span>
            <div>
              <p className="font-medium">太棒了！</p>
              <p className="text-xs">今天的任务已全部完成</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: ActionItem['type'] }) {
  const config = {
    replay: { label: '回放', className: 'bg-blue-100 text-blue-600' },
    exercise: { label: '练习', className: 'bg-purple-100 text-purple-600' },
    review: { label: '复习', className: 'bg-orange-100 text-orange-600' },
  };

  const { label, className } = config[type];

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${className}`}>
      {label}
    </span>
  );
}
