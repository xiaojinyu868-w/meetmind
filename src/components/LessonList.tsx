'use client';

import type { Lesson } from '@/lib/services/meetmind-service';

interface LessonListProps {
  lessons: Lesson[];
  selectedId?: string;
  onSelect: (lesson: Lesson) => void;
}

export function LessonList({ lessons, selectedId, onSelect }: LessonListProps) {
  return (
    <div className="p-3 border-b border-gray-200">
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        今日课程
      </h2>
      <div className="space-y-1">
        {lessons.map((lesson) => (
          <button
            key={lesson.id}
            onClick={() => onSelect(lesson)}
            className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
              selectedId === lesson.id
                ? 'bg-primary-50 text-primary-700 border border-primary-200'
                : 'hover:bg-gray-50 text-gray-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{lesson.courseName}</span>
              <StatusBadge status={lesson.status} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {lesson.title}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Lesson['status'] }) {
  const config = {
    recording: { label: '录制中', className: 'bg-red-100 text-red-600' },
    processing: { label: '处理中', className: 'bg-yellow-100 text-yellow-600' },
    ready: { label: '已就绪', className: 'bg-green-100 text-green-600' },
  };

  const { label, className } = config[status];

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${className}`}>
      {label}
    </span>
  );
}
