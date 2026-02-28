'use client';

import React, { useState, useCallback } from 'react';

// ==================== Types ====================

interface RoleOption {
  label: string;
  emoji: string;
  intents: IntentOption[];
}

interface IntentOption {
  label: string;
  emoji: string;
  prompt: string; // 注入到 AI system prompt 的角色+意图描述
}

interface IntentBubbleExplorerProps {
  transcriptText: string;
  onSend: (prompt: string, meta?: { role: string; intent: string }) => void;
}

// ==================== 角色 × 意图矩阵（纯规则） ====================

const ROLE_INTENT_MATRIX: RoleOption[] = [
  {
    label: '学生',
    emoji: '🎓',
    intents: [
      { label: '理解知识', emoji: '📖', prompt: '我是学生，想深入理解这段内容的知识点' },
      { label: '备考复习', emoji: '📝', prompt: '我是学生，想用这段内容来备考复习' },
      { label: '练听力', emoji: '🎧', prompt: '我是学生，想用这段内容练习听力' },
      { label: '做笔记', emoji: '✏️', prompt: '我是学生，帮我把这段内容整理成学习笔记' },
    ],
  },
  {
    label: '职场人',
    emoji: '💼',
    intents: [
      { label: '整理纪要', emoji: '📋', prompt: '我是职场人，帮我整理这段内容的会议纪要和要点' },
      { label: '提取行动', emoji: '📌', prompt: '我是职场人，帮我提取待办事项和行动计划' },
      { label: '准备汇报', emoji: '🎯', prompt: '我是职场人，帮我基于这段内容准备汇报材料' },
      { label: '深入研究', emoji: '🔍', prompt: '我是职场人，想深入研究这段内容涉及的话题' },
    ],
  },
  {
    label: '自学者',
    emoji: '📚',
    intents: [
      { label: '梳理脉络', emoji: '🗺️', prompt: '我在自学，帮我梳理这段内容的知识脉络' },
      { label: '答疑解惑', emoji: '❓', prompt: '我在自学，帮我解答这段内容中不理解的地方' },
      { label: '拓展延伸', emoji: '🚀', prompt: '我在自学，帮我基于这段内容做拓展延伸' },
    ],
  },
  {
    label: '创作者',
    emoji: '🎙',
    intents: [
      { label: '提炼观点', emoji: '💡', prompt: '我是内容创作者，帮我提炼这段内容中的核心观点' },
      { label: '找灵感', emoji: '✨', prompt: '我是内容创作者，帮我从这段内容中找创作灵感' },
      { label: '改写引用', emoji: '📝', prompt: '我是内容创作者，帮我改写和引用这段内容的精华' },
    ],
  },
  {
    label: '研究者',
    emoji: '🔬',
    intents: [
      { label: '分析论点', emoji: '📊', prompt: '我是研究者，帮我分析这段内容中的论点和论据' },
      { label: '文献关联', emoji: '📑', prompt: '我是研究者，帮我关联这段内容相关的知识领域' },
      { label: '批判思考', emoji: '🤔', prompt: '我是研究者，帮我批判性地审视这段内容的观点' },
    ],
  },
];

// 气泡散落布局偏移（模拟即刻风格的随机感）
const BUBBLE_OFFSETS = [
  { x: -8, y: 0 },
  { x: 12, y: -6 },
  { x: -4, y: 8 },
  { x: 16, y: 2 },
  { x: -12, y: -4 },
];

const INTENT_OFFSETS = [
  { x: -6, y: 4 },
  { x: 10, y: -4 },
  { x: -10, y: 0 },
  { x: 4, y: 6 },
];

// ==================== Main Component ====================

export default function IntentBubbleExplorer({
  onSend,
}: IntentBubbleExplorerProps) {
  const [selectedRole, setSelectedRole] = useState<RoleOption | null>(null);

  // 选择角色
  const handleRoleClick = useCallback((role: RoleOption) => {
    if (selectedRole?.label === role.label) {
      setSelectedRole(null);
      return;
    }
    setSelectedRole(role);
  }, [selectedRole]);

  // 选择意图 → 开始对话
  const handleIntentClick = useCallback(
    (intent: IntentOption) => {
      onSend(intent.prompt, {
        role: selectedRole?.label || '',
        intent: intent.label,
      });
    },
    [selectedRole, onSend]
  );

  // 第一层：选角色
  if (!selectedRole) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">你好呀 👋</h3>
        <p className="text-sm text-gray-500 mb-6">选择你的角色，我来个性化帮你</p>

        {/* 角色气泡 - 散落布局 */}
        <div className="relative flex flex-wrap justify-center gap-4 max-w-xs mb-6">
          {ROLE_INTENT_MATRIX.map((role, i) => {
            const offset = BUBBLE_OFFSETS[i % BUBBLE_OFFSETS.length];
            return (
              <div key={role.label} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
                <button
                  onClick={() => handleRoleClick(role)}
                  className="flex flex-col items-center gap-1.5 group bubble-pop-in"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-50 to-amber-100 border-2 border-amber-200/60 flex items-center justify-center group-hover:border-amber-400 group-hover:shadow-lg group-hover:shadow-amber-100 transition-all group-hover:scale-110 group-active:scale-95">
                    <span className="text-2xl">{role.emoji}</span>
                  </div>
                  <span className="text-xs text-gray-600 group-hover:text-amber-700 transition-colors font-medium">
                    {role.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* 自由对话入口 */}
        <p className="text-xs text-gray-400">
          或直接在下方输入，开始自由对话
        </p>
      </div>
    );
  }

  // 第二层：选意图（角色已选）
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      {/* 已选角色 */}
      <button
        onClick={() => setSelectedRole(null)}
        className="flex items-center gap-2 mb-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <span>←</span>
        <span>重选角色</span>
      </button>

      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center mb-2 bubble-pop-in">
        <span className="text-2xl">{selectedRole.emoji}</span>
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-0.5">
        {selectedRole.emoji} {selectedRole.label}
      </h3>
      <p className="text-sm text-gray-500 mb-5">你想做什么？</p>

      {/* 意图气泡 - 散落布局 */}
      <div className="relative flex flex-wrap justify-center gap-3 max-w-sm mb-5">
        {selectedRole.intents.map((intent, i) => {
          const offset = INTENT_OFFSETS[i % INTENT_OFFSETS.length];
          return (
            <div key={intent.label} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
              <button
                onClick={() => handleIntentClick(intent)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 hover:shadow-md transition-all active:scale-95 bubble-sub-pop-in"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <span>{intent.emoji}</span>
                {intent.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* 自由对话入口 */}
      <p className="text-xs text-gray-400">
        或直接在下方输入，开始自由对话
      </p>
    </div>
  );
}
