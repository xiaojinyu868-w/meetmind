/**
 * safe-math —— 无 eval 的算术 / 一元函数表达式求值器（手写 shunting-yard）。
 *
 * 给 teach-live 的三处用：<plot> 声明式函数图、<draw> 运行时的字符串函数（"x^2 - 2x"）、
 * 老师口播里的 {{ 24 / 2 }} 内联计算。支持 + - * / ^、一元负号、括号、常见函数、pi / e、
 * 隐式乘法（2x、3(x+1)、xsin(x) 不支持）。任何解析失败抛 Error，调用方决定回退。
 */

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' };

const FUNCTIONS: Record<string, (a: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, π: Math.PI };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/√/g, 'sqrt');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i));
      if (!m) throw new Error(`bad number at ${i}`);
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Zπ_]/.test(ch)) {
      const m = /^[a-zA-Zπ_][a-zA-Z0-9_]*/.exec(s.slice(i))!;
      let word = m[0];
      i += word.length;
      // 把 "2x" 之类连在一起的写法拆开：xsin 这种不处理；但 "x2" 视为 x*2 不合理，交给隐式乘法规则前先拆常见形态
      if (word.length > 1 && !(word in FUNCTIONS) && !(word in CONSTANTS) && word !== 'x') {
        // 形如 "xe" / "pix"：拆成已知符号序列
        const parts: string[] = [];
        let rest = word;
        while (rest.length) {
          const known = Object.keys(FUNCTIONS)
            .concat(Object.keys(CONSTANTS), ['x'])
            .filter((k) => rest.startsWith(k))
            .sort((a, b) => b.length - a.length)[0];
          if (!known) throw new Error(`unknown symbol ${rest}`);
          parts.push(known);
          rest = rest.slice(known.length);
        }
        for (const p of parts) tokens.push({ t: 'id', v: p });
        continue;
      }
      word = word.toLowerCase() === 'x' ? 'x' : word;
      tokens.push({ t: 'id', v: word });
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ t: 'lp' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: 'rp' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ t: 'comma' });
      i++;
      continue;
    }
    throw new Error(`unexpected '${ch}'`);
  }
  // 隐式乘法：num/id/rp 后面跟 num/id/lp（函数名后跟 lp 是调用，不插）
  const out: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k];
    const prev = out[out.length - 1];
    if (prev) {
      const prevIsValue = prev.t === 'num' || prev.t === 'rp' || (prev.t === 'id' && !(prev.v in FUNCTIONS));
      const curStartsValue = cur.t === 'num' || cur.t === 'id' || cur.t === 'lp';
      if (prevIsValue && curStartsValue) out.push({ t: 'op', v: '*' });
    }
    out.push(cur);
  }
  return out;
}

type Rpn = Array<{ k: 'num'; v: number } | { k: 'var' } | { k: 'op'; v: string } | { k: 'fn'; v: string } | { k: 'neg' }>;

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

export function compileExpression(src: string): (x: number) => number {
  const tokens = tokenize(src);
  const output: Rpn = [];
  const stack: Array<Token | { t: 'neg' }> = [];
  let expectOperand = true;
  for (const tok of tokens) {
    if (tok.t === 'num') {
      output.push({ k: 'num', v: tok.v });
      expectOperand = false;
    } else if (tok.t === 'id') {
      if (tok.v in FUNCTIONS) {
        stack.push(tok);
        expectOperand = true;
      } else if (tok.v in CONSTANTS) {
        output.push({ k: 'num', v: CONSTANTS[tok.v] });
        expectOperand = false;
      } else if (tok.v === 'x') {
        output.push({ k: 'var' });
        expectOperand = false;
      } else throw new Error(`unknown identifier ${tok.v}`);
    } else if (tok.t === 'op') {
      if (tok.v === '-' && expectOperand) {
        stack.push({ t: 'neg' });
        continue;
      }
      if (tok.v === '+' && expectOperand) continue;
      for (;;) {
        const top = stack[stack.length - 1];
        if (!top) break;
        if (top.t === 'neg') {
          if (tok.v === '^') break; // -x^2 = -(x^2)
          output.push({ k: 'neg' });
          stack.pop();
          continue;
        }
        if (top.t === 'op' && (PREC[top.v] > PREC[tok.v] || (PREC[top.v] === PREC[tok.v] && tok.v !== '^'))) {
          output.push({ k: 'op', v: top.v });
          stack.pop();
          continue;
        }
        break;
      }
      stack.push(tok);
      expectOperand = true;
    } else if (tok.t === 'lp') {
      stack.push(tok);
      expectOperand = true;
    } else if (tok.t === 'rp') {
      for (;;) {
        const top = stack.pop();
        if (!top) throw new Error('unbalanced )');
        if (top.t === 'lp') break;
        if (top.t === 'neg') output.push({ k: 'neg' });
        else if (top.t === 'op') output.push({ k: 'op', v: top.v });
      }
      const fn = stack[stack.length - 1];
      if (fn && fn.t === 'id' && fn.v in FUNCTIONS) {
        output.push({ k: 'fn', v: fn.v });
        stack.pop();
      }
      expectOperand = false;
    } else if (tok.t === 'comma') {
      throw new Error('multi-arg functions unsupported');
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === 'lp') throw new Error('unbalanced (');
    if (top.t === 'neg') output.push({ k: 'neg' });
    else if (top.t === 'op') output.push({ k: 'op', v: top.v });
    else if (top.t === 'id') output.push({ k: 'fn', v: top.v });
  }
  return (x: number) => {
    const st: number[] = [];
    for (const item of output) {
      if (item.k === 'num') st.push(item.v);
      else if (item.k === 'var') st.push(x);
      else if (item.k === 'neg') st.push(-(st.pop() ?? NaN));
      else if (item.k === 'fn') st.push(FUNCTIONS[item.v](st.pop() ?? NaN));
      else {
        const b = st.pop() ?? NaN;
        const a = st.pop() ?? NaN;
        st.push(item.v === '+' ? a + b : item.v === '-' ? a - b : item.v === '*' ? a * b : item.v === '/' ? a / b : Math.pow(a, b));
      }
    }
    return st.length === 1 ? st[0] : NaN;
  };
}

/** 纯算术（无 x）求值；失败抛 Error */
export function evaluateArithmetic(src: string): number {
  const f = compileExpression(src);
  const v = f(0);
  if (!Number.isFinite(v)) throw new Error('not finite');
  return v;
}

/** 给人念的数字：最多 4 位有效小数，去掉尾零，-0 → 0 */
export function formatNumber(n: number, maxDecimals = 4): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.round(n * 10 ** maxDecimals) / 10 ** maxDecimals;
  const s = String(rounded === 0 ? 0 : rounded);
  return s.includes('e') ? rounded.toPrecision(6).replace(/\.?0+e/, 'e') : s;
}

/** 把文本里的 {{ 表达式 }} 换成算好的数；算不出来的原样保留（去掉花括号） */
export function evaluateInlineMath(text: string): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_whole, expr: string) => {
    try {
      return formatNumber(evaluateArithmetic(expr));
    } catch {
      return expr.trim();
    }
  });
}
