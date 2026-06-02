'use client';

/**
 * RealtimeOrb — 通话场景的 v7 呼吸光晕。
 *
 * 这是「聊聊你想要的」打电话模式 + 复习态语音同桌共用的视觉。
 *
 * 设计宪法（v7）：
 *   - 主基底：纸感米白 / 暖光（不是黑底科技感）
 *   - 主签名色：墨松绿（pine #2D4F3E）作 AI 沉淀的主光环
 *   - 副签名色：朱批红（vermilion #B5483C）作"AI 在说话"时的点缀
 *   - 不要饱和色撞脸 ChatGPT 紫 / Stripe 蓝 / 多邻国绿
 *   - 仪式时刻例外（这是录音模式，是 6 个白名单仪式时刻之一）
 *
 * 状态映射：
 *   idle:      最浅一层呼吸（很慢）
 *   listening: pine 光环呼吸（中速，明显）
 *   thinking:  多层错位旋转（节奏感）
 *   responding: vermilion 点缀 + 中心稍亮（紧凑呼吸）
 *   muted:     呼吸停止，光环锁定
 */

import * as React from 'react';

export type RealtimeOrbState = 'idle' | 'listening' | 'thinking' | 'responding' | 'muted';

interface RealtimeOrbProps {
  state: RealtimeOrbState;
  /** 中心圆的尺寸（默认 144），外圈光晕等比放大 */
  size?: number;
}

export function RealtimeOrb({ state, size = 144 }: RealtimeOrbProps) {
  const isListening = state === 'listening';
  const isThinking = state === 'thinking';
  const isResponding = state === 'responding';
  const isMuted = state === 'muted';
  const isActive = isListening || isThinking || isResponding;

  // 颜色策略
  // - listening / idle：pine 主光环
  // - responding：vermilion 点缀
  // - thinking：pine + vermilion 双色错位
  const ringColor = isResponding ? '#B5483C' : '#2D4F3E';
  const ringSecondaryColor = isThinking ? '#B5483C' : '#2D4F3E';

  // 中心圆颜色：默认深墨黑，responding 时切换到 pine（呼应 AI 在说）
  const coreColor = isMuted
    ? '#8E8B82'
    : isResponding
      ? '#2D4F3E'
      : isThinking
        ? '#1C1B19'
        : '#1C1B19';

  // 外圈光晕的呼吸节奏
  const breatheClass = isMuted
    ? ''
    : isResponding
      ? 'orb-pulse-fast'
      : isThinking
        ? 'orb-pulse-medium'
        : isListening
          ? 'orb-pulse-slow'
          : 'orb-pulse-idle';

  const halfSize = size / 2;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size * 1.8, height: size * 1.8 }}
    >
      {/* 最外层光晕（最大、最淡） */}
      <span
        className={`absolute rounded-full ${breatheClass}`}
        style={{
          width: size * 1.6,
          height: size * 1.6,
          left: `calc(50% - ${size * 0.8}px)`,
          top: `calc(50% - ${size * 0.8}px)`,
          background: `radial-gradient(circle, ${ringColor}1A 0%, ${ringColor}00 60%)`,
          opacity: isActive ? 1 : 0.4,
          animationDelay: '0s',
        }}
      />

      {/* 中层光晕 */}
      <span
        className={`absolute rounded-full ${breatheClass}`}
        style={{
          width: size * 1.25,
          height: size * 1.25,
          left: `calc(50% - ${size * 0.625}px)`,
          top: `calc(50% - ${size * 0.625}px)`,
          background: `radial-gradient(circle, ${ringSecondaryColor}26 0%, ${ringSecondaryColor}00 65%)`,
          opacity: isActive ? 1 : 0.3,
          animationDelay: '0.4s',
        }}
      />

      {/* 内圈环：极细 1px 描边，pine */}
      <span
        className="absolute rounded-full"
        style={{
          width: size * 1.05,
          height: size * 1.05,
          left: `calc(50% - ${size * 0.525}px)`,
          top: `calc(50% - ${size * 0.525}px)`,
          border: `1px solid ${ringColor}40`,
          opacity: isMuted ? 0.4 : 1,
          animation: isThinking
            ? 'orb-rotate 6s linear infinite'
            : isActive
              ? 'orb-ring-pulse 2.4s ease-in-out infinite'
              : undefined,
        }}
      />

      {/* 中心圆：声纹条 */}
      <span
        className="relative z-10 flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: coreColor,
          boxShadow: isResponding
            ? `0 8px 32px ${coreColor}40, inset 0 1px 0 rgba(255,255,255,0.08)`
            : '0 4px 24px rgba(28,27,25,0.18), inset 0 1px 0 rgba(255,255,255,0.06)',
          transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
        }}
      >
        <div
          className="flex items-end justify-center"
          style={{ height: halfSize * 0.32, gap: 4 }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 3,
                borderRadius: 999,
                backgroundColor: '#FFFFFF',
                opacity: isActive ? 0.92 : 0.28,
                height: isActive ? '100%' : '24%',
                animation: isActive
                  ? `orb-bar 0.6s ease-in-out ${i * 0.08}s infinite alternate`
                  : 'none',
              }}
            />
          ))}
        </div>
      </span>

      <style jsx>{`
        @keyframes orb-pulse-slow {
          0%, 100% { transform: scale(0.96); opacity: 0.7; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes orb-pulse-medium {
          0%, 100% { transform: scale(0.94); opacity: 0.55; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes orb-pulse-fast {
          0%, 100% { transform: scale(0.97); opacity: 0.7; }
          50% { transform: scale(1.04); opacity: 1; }
        }
        @keyframes orb-pulse-idle {
          0%, 100% { transform: scale(0.99); opacity: 0.45; }
          50% { transform: scale(1.02); opacity: 0.6; }
        }
        @keyframes orb-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes orb-ring-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.02); }
        }
        @keyframes orb-bar {
          0% { height: 18%; opacity: 0.4; }
          100% { height: 100%; opacity: 1; }
        }
        .orb-pulse-slow { animation: orb-pulse-slow 3.2s ease-in-out infinite; }
        .orb-pulse-medium { animation: orb-pulse-medium 2.4s ease-in-out infinite; }
        .orb-pulse-fast { animation: orb-pulse-fast 1.5s ease-in-out infinite; }
        .orb-pulse-idle { animation: orb-pulse-idle 5s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

export default RealtimeOrb;
