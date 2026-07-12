'use client';

/**
 * LearnerOnboarding — 两步学习者画像收集
 *
 * Step 1: 选身份阶段（K12 / 大学 / 研究生 / 在职）
 * Step 2: 根据阶段填 2-3 个字段
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

import { useState, useCallback } from 'react';
import type { LearnerStage, LearnerProfile } from '@/types/user';

interface LearnerOnboardingProps {
  onComplete: (profile: LearnerProfile) => Promise<void>;
  onSkip: () => void;
}

type SelectableLearnerStage = Exclude<LearnerStage, 'unknown'>;

const STAGES: { key: SelectableLearnerStage; label: string; desc: string; icon: string }[] = [
  { key: 'k12', label: '中小学生', desc: '初中 / 高中', icon: '📖' },
  { key: 'university', label: '大学生', desc: '本科在读', icon: '🎓' },
  { key: 'graduate', label: '研究生', desc: '硕士 / 博士', icon: '🔬' },
  { key: 'working', label: '在职学习', desc: '考证 / 转行 / 提升', icon: '💼' },
];

const K12_GRADES = ['初一', '初二', '初三', '高一', '高二', '高三'];
const UNIVERSITY_YEARS = ['大一', '大二', '大三', '大四', '大五'];

export default function LearnerOnboarding({ onComplete, onSkip }: LearnerOnboardingProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [stage, setStage] = useState<SelectableLearnerStage | null>(null);
  const [saving, setSaving] = useState(false);

  // Step 2 form fields
  const [gradeLevel, setGradeLevel] = useState('');
  const [major, setMajor] = useState('');
  const [year, setYear] = useState('');
  const [field, setField] = useState('');
  const [industry, setIndustry] = useState('');
  const [learningGoal, setLearningGoal] = useState('');
  const [otherInterests, setOtherInterests] = useState('');

  const handleStageSelect = useCallback((s: SelectableLearnerStage) => {
    setStage(s);
    setStep(2);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!stage) return;
    setSaving(true);

    const extras = {
      ...(otherInterests.trim() ? { otherInterests: otherInterests.trim() } : {}),
    };

    let profile: LearnerProfile;

    switch (stage) {
      case 'k12':
        profile = { stage: 'k12', gradeLevel: gradeLevel || '高一', ...extras };
        break;
      case 'university':
        profile = { stage: 'university', major: major || '未填写', year: year || '大一', ...extras };
        break;
      case 'graduate':
        profile = { stage: 'graduate', field: field || '未填写', ...extras };
        break;
      case 'working':
        profile = { stage: 'working', industry: industry || '未填写', learningGoal: learningGoal || '未填写', ...extras };
        break;
    }

    try {
      await onComplete(profile);
    } finally {
      setSaving(false);
    }
  }, [stage, gradeLevel, major, year, field, industry, learningGoal, otherInterests, onComplete]);

  const canSubmit = (() => {
    if (!stage) return false;
    switch (stage) {
      case 'k12': return !!gradeLevel;
      case 'university': return !!major && !!year;
      case 'graduate': return !!field;
      case 'working': return !!industry && !!learningGoal;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(247,247,245,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md mx-4 rounded-2xl p-8" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E8E2D5' }}>

        {/* 进度指示 */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#1C1B19' }} />
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: step === 2 ? '#1C1B19' : '#E8E2D5' }} />
        </div>

        {/* Step 1: 选身份 */}
        {step === 1 && (
          <>
            <h2 className="text-xl font-semibold text-center mb-1" style={{ color: '#1C1B19' }}>
              你现在是
            </h2>
            <p className="text-sm text-center mb-6" style={{ color: '#5C5A55' }}>
              帮助 MeetMind 更懂你的学习
            </p>

            <div className="grid grid-cols-2 gap-3">
              {STAGES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => handleStageSelect(s.key)}
                  className="flex flex-col items-center gap-1.5 p-4 rounded-xl transition-colors hover:bg-paper-warm"
                  style={{ border: '1px solid #E8E2D5' }}
                >
                  <span className="text-2xl">{s.icon}</span>
                  <span className="text-sm font-medium" style={{ color: '#1C1B19' }}>{s.label}</span>
                  <span className="text-xs" style={{ color: '#8E8B82' }}>{s.desc}</span>
                </button>
              ))}
            </div>

            <button
              onClick={onSkip}
              className="w-full mt-5 py-2 text-sm transition-colors hover:underline"
              style={{ color: '#8E8B82' }}
            >
              稍后再说
            </button>
          </>
        )}

        {/* Step 2: 填字段 */}
        {step === 2 && stage && (
          <>
            <button
              onClick={() => setStep(1)}
              className="mb-4 text-sm flex items-center gap-1 transition-colors hover:underline"
              style={{ color: '#5C5A55' }}
            >
              ← 重新选择
            </button>

            <h2 className="text-xl font-semibold mb-1" style={{ color: '#1C1B19' }}>
              {STAGES.find(s => s.key === stage)?.icon} {STAGES.find(s => s.key === stage)?.label}
            </h2>
            <p className="text-sm mb-5" style={{ color: '#5C5A55' }}>
              填完就好，10 秒的事
            </p>

            <div className="space-y-4">
              {stage === 'k12' && (
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#1C1B19' }}>年级</label>
                  <div className="flex flex-wrap gap-2">
                    {K12_GRADES.map(g => (
                      <button
                        key={g}
                        onClick={() => setGradeLevel(g)}
                        className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                        style={{
                          backgroundColor: gradeLevel === g ? '#1C1B19' : '#FAF7F2',
                          color: gradeLevel === g ? '#FFFFFF' : '#1C1B19',
                          border: `1px solid ${gradeLevel === g ? '#1C1B19' : '#E8E2D5'}`,
                        }}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {stage === 'university' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#1C1B19' }}>专业</label>
                    <input
                      type="text"
                      value={major}
                      onChange={(e) => setMajor(e.target.value)}
                      placeholder="例如：计算机科学"
                      className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                      style={{ backgroundColor: '#FAF7F2', border: '1px solid #E8E2D5', color: '#1C1B19' }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#1C1B19' }}>年级</label>
                    <div className="flex flex-wrap gap-2">
                      {UNIVERSITY_YEARS.map(y => (
                        <button
                          key={y}
                          onClick={() => setYear(y)}
                          className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                          style={{
                            backgroundColor: year === y ? '#1C1B19' : '#FAF7F2',
                            color: year === y ? '#FFFFFF' : '#1C1B19',
                            border: `1px solid ${year === y ? '#1C1B19' : '#E8E2D5'}`,
                          }}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {stage === 'graduate' && (
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#1C1B19' }}>研究方向</label>
                  <input
                    type="text"
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                    placeholder="例如：自然语言处理"
                    className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                    style={{ backgroundColor: '#FAF7F2', border: '1px solid #E8E2D5', color: '#1C1B19' }}
                  />
                </div>
              )}

              {stage === 'working' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#1C1B19' }}>所在行业</label>
                    <input
                      type="text"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="例如：互联网"
                      className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                      style={{ backgroundColor: '#FAF7F2', border: '1px solid #E8E2D5', color: '#1C1B19' }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#1C1B19' }}>学习目标</label>
                    <input
                      type="text"
                      value={learningGoal}
                      onChange={(e) => setLearningGoal(e.target.value)}
                      placeholder="例如：CPA 考证 / 转行产品经理"
                      className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                      style={{ backgroundColor: '#FAF7F2', border: '1px solid #E8E2D5', color: '#1C1B19' }}
                    />
                  </div>
                </>
              )}

              {/* 所有阶段共享——学习是多线程的 */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#5C5A55' }}>
                  还在学什么？
                  <span className="font-normal text-xs ml-1" style={{ color: '#8E8B82' }}>选填</span>
                </label>
                <input
                  type="text"
                  value={otherInterests}
                  onChange={(e) => setOtherInterests(e.target.value)}
                  placeholder="例如：英语、出国准备、吉他"
                  className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                  style={{ backgroundColor: '#FAF7F2', border: '1px solid #E8E2D5', color: '#1C1B19' }}
                />
              </div>
            </div>

            {/* 提交按钮 */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="w-full mt-6 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              style={{
                backgroundColor: canSubmit ? '#1C1B19' : '#E8E2D5',
                color: '#FFFFFF',
              }}
            >
              {saving ? '保存中...' : '开始使用'}
            </button>

            <button
              onClick={onSkip}
              className="w-full mt-2 py-2 text-sm transition-colors hover:underline"
              style={{ color: '#8E8B82' }}
            >
              稍后再说
            </button>
          </>
        )}
      </div>
    </div>
  );
}
