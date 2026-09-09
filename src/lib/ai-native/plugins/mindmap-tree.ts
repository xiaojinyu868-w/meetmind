/**
 * mindmap-tree — 思维导图的纯数据结构与 Markdown 互转（客户端/服务端共用）。
 *
 * 从 mindmap.plugin.ts 拆出（2026-08-20 生产构建根修）：MindmapWindow /
 * ShareMindmapGraph / mindmap-layout 等客户端模块只需要这些纯函数，原来
 * 从 mindmap.plugin 导入会把 llm-service（→ undici → node:crypto）静态
 * 打进浏览器包，生产构建直接失败。客户端一律从这里导入。
 */

export interface MindmapNode {
  title: string;
  children?: MindmapNode[];
  startMs?: number;
  endMs?: number;
}

/** 将嵌套树结构递归转为 Markdown 大纲（markmap 直接消费） */
export function treeToMarkdown(root: string, children: MindmapNode[], depth: number = 1): string {
  const lines: string[] = [`# ${root}`];
  const walk = (nodes: MindmapNode[], level: number) => {
    for (const node of nodes) {
      const indent = '  '.repeat(level - 1);
      lines.push(`${indent}- ${node.title}`);
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, level + 1);
      }
    }
  };
  walk(children, depth);
  return lines.join('\n');
}

/** SVG <text> 渲染不了 KaTeX：把节点里常见的 $…$ 折成 Unicode 数学符号 */
const TEX_SYMBOLS: Record<string, string> = {
  to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦', iff: '⇔', implies: '⇒',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', circ: '∘', infty: '∞', partial: '∂', nabla: '∇',
  sum: '∑', prod: '∏', int: '∫', sqrt: '√', angle: '∠', perp: '⊥', parallel: '∥', mid: '|', ldots: '…', cdots: '⋯', dots: '…',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
};
const SUBSCRIPT_DIGITS: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', n: 'ₙ', i: 'ᵢ', k: 'ₖ' };
const SUPERSCRIPT_DIGITS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', '-': '⁻', '+': '⁺' };

function texToUnicode(tex: string): string {
  return tex
    .replace(/\\(?:mathrm|mathbf|mathbb|mathcal|text|operatorname)\{([^}]*)\}/g, '$1')
    .replace(/\\(?:left|right)/g, '')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
    .replace(/\\xrightarrow(?:\[[^\]]*\])?\{([^}]*)\}/g, '─$1→')
    .replace(/\\xleftarrow(?:\[[^\]]*\])?\{([^}]*)\}/g, '←$1─')
    .replace(/\\(?:overset|stackrel)\{([^}]*)\}\{([^}]*)\}/g, '$2⁽$1⁾')
    // 函数名 / 算子：\lim \sin \log 直接去掉反斜杠
    .replace(/\\(lim|sin|cos|tan|cot|sec|csc|ln|log|exp|max|min|sup|inf|det|dim|deg|gcd|arg)(?![A-Za-z])/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (match, name: string) => TEX_SYMBOLS[name] ?? match)
    .replace(/\^\{?([0-9n+\-])\}?/g, (_m, ch: string) => SUPERSCRIPT_DIGITS[ch] ?? `^${ch}`)
    .replace(/\^\{([^}]*)\}/g, '^$1')
    .replace(/_\{?([0-9nik])\}?(?![A-Za-z])/g, (_m, ch: string) => SUBSCRIPT_DIGITS[ch] ?? `_${ch}`)
    .replace(/_\{([^}]*)\}/g, '_$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把文本里的 $…$ 数学片段折成可直接放进 SVG 文字的 Unicode（`$X \to Y$` → `X → Y`） */
export function flattenInlineTex(text: string): string {
  if (!text.includes('$') && !text.includes('\\')) return text;
  return text
    .replace(/\$\$([^$]+)\$\$/g, (_m, tex: string) => texToUnicode(tex))
    .replace(/\$([^$\n]+)\$/g, (_m, tex: string) => texToUnicode(tex))
    .replace(/\\([A-Za-z]+)/g, (match, name: string) => TEX_SYMBOLS[name] ?? match);
}

/**
 * 去掉节点文本里的 inline markdown 标记（**粗体** / *斜体* / `代码` / [链接](url) / 前导 # - 等），
 * 并把 $…$ 数学折成 Unicode（flattenInlineTex）——SVG 节点只能是纯文本。
 * SVG <text> 不渲染 markdown，节点标题必须是干净纯文本，否则会显示成字面量 `**xxx**`。
 */
export function stripInlineMarkdown(text: string): string {
  return flattenInlineTex(text)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*+/g, '')
    .trim();
}

/** 从 Markdown 层级大纲解析出树形结构（兼容 LLM 直接输出 Markdown） */
export function markdownToTree(markdown: string): { root: string; children: MindmapNode[] } {
  const lines = markdown.split('\n').filter((line) => line.trim());
  let root = '课堂知识结构';

  const rootMatch = lines[0]?.match(/^#{1,2}\s+(.+)/);
  if (rootMatch) {
    root = stripInlineMarkdown(rootMatch[1]);
    lines.shift();
  }

  const stack: { node: MindmapNode; depth: number }[] = [];
  const topChildren: MindmapNode[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)-\s+(.+)/);
    if (!match) continue;
    const depth = Math.floor(match[1].length / 2);
    const title = stripInlineMarkdown(match[2]);
    if (!title) continue;
    const node: MindmapNode = { title, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      topChildren.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }
    stack.push({ node, depth });
  }

  return { root, children: topChildren };
}
