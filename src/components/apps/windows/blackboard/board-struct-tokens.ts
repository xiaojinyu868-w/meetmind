/**
 * board-struct-tokens — 板书行内记法解析（纯函数）。
 *
 * v31 收缩：v30 的 \frac / \sqrt / \pmatrix / ^{x} / _{x} 手写模拟结构 token
 * 随黑板形态退役（公式一律 write role='formula'，text 写 LaTeX，KaTeX 排版，
 * 见 BoardFormula）。普通 write 文本里只保留两种行内记法：
 *   ==重点==     马克笔高亮（行内纯文本，黄底横扫）
 *   \pm \times…  LaTeX 符号命令 → unicode（模型写正文时的自然习惯，如 ± × Δ）
 *
 * 解析失败（== 不配对等）返回 null，调用方按普通字符继续——
 * 渲染层绝不因模型写错记法而崩。
 */

import type { BoardToken } from './board-model';

/** LaTeX 符号命令 → unicode（命中要求后随非字母边界，防 \pmatrix 被 \pm 吃掉）。
 *  渲染走 punct 类（鸿雷/Caveat，不进笔顺路径）。 */
const SYMBOL_COMMANDS: Record<string, string> = {
  '\\pm': '±',
  '\\mp': '∓',
  '\\times': '×',
  '\\div': '÷',
  '\\cdot': '·',
  '\\ast': '∗',
  '\\Delta': 'Δ',
  '\\Sigma': 'Σ',
  '\\Omega': 'Ω',
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\theta': 'θ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\pi': 'π',
  '\\sigma': 'σ',
  '\\phi': 'φ',
  '\\omega': 'ω',
  '\\infty': '∞',
  '\\geq': '≥',
  '\\leq': '≤',
  '\\neq': '≠',
  '\\approx': '≈',
  '\\propto': '∝',
  '\\Rightarrow': '⇒',
  '\\rightarrow': '→',
  '\\Leftarrow': '⇐',
  '\\leftarrow': '←',
  '\\ldots': '…',
  '\\dots': '…',
};
// 长的先匹配（\Rightarrow 先于 \right…类前缀冲突）
const SYMBOL_KEYS = Object.keys(SYMBOL_COMMANDS).sort((a, b) => b.length - a.length);

/**
 * 在 chars[index] 处尝试匹配一个行内记法 token；命中返回 token 与下一个下标，
 * 否则 null。chars 是 Array.from(text) 的码点数组（\\ 是单个字符）。
 */
export function matchStructToken(
  chars: string[],
  index: number,
): { token: BoardToken; next: number } | null {
  const rest = chars.slice(index).join('');

  // LaTeX 符号命令（\pm \times \Delta …）：后随字母则不是符号
  if (chars[index] === '\\') {
    for (const command of SYMBOL_KEYS) {
      if (!rest.startsWith(command)) continue;
      const after = chars[index + command.length];
      if (after && /[a-zA-Z]/.test(after)) continue;
      return {
        token: { kind: 'punct', text: SYMBOL_COMMANDS[command] },
        next: index + command.length,
      };
    }
  }

  if (rest.startsWith('==')) {
    const close = rest.indexOf('==', 2);
    if (close > 2) {
      const inner = rest.slice(2, close).trim();
      if (inner) return { token: { kind: 'hl', text: inner }, next: index + close + 2 };
    }
    return null;
  }

  return null;
}
