/**
 * math-text —— 一段夹着 TeX 的文本怎么切、怎么念（纯函数，零 DOM）。
 *
 * 两个消费方：
 * - 渲染：`components/apps/windows/MathText.tsx`（闪卡 / 测验题干）与 teach-live 的字幕 / 提问卡 / 课堂记录，
 *   把 `$…$` `\(…\)` `$$…$$` `\[…\]` 切出来交给 KaTeX；
 * - 朗读：teach-live 的 TTS——老师偶发把 `$\mathbf{u}\cdot\nabla\mathbf{u}$` 写进口播，念出来是乱码；
 *   `latexToSpeech` 把常见 LaTeX 变成能念的中文（「u 点乘 纳布拉 u」「a 的平方 加 b 的平方 等于 c 的平方」）。
 *
 * 比原 MathText 里的切分多两件事：
 * 1. **裸 LaTeX**（没写 $ 的 `\frac{1}{2}mv^2`）也识别——一段以 `\命令` 开头、只含 TeX 字符的连续文本；
 * 2. **货币误判**：`$5 和 $10` 里的 "5 和 " 不是公式——内容得像数学（有运算符 / 命令 / 上下标，或很短且无空格）。
 */

export interface MathSegment {
  kind: 'text' | 'inline' | 'block';
  value: string;
}

const DELIMITED = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;
/** 裸 LaTeX：以命令开头，后面只有 TeX 字符（遇到中文 / 中文标点即止） */
const BARE = /\\[a-zA-Z]+(?:[\\A-Za-z0-9^_{}()[\]+\-=*/<>|.,'! ]|\\[a-zA-Z]+)*/g;

const TEX_WORDS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lg', 'exp', 'lim', 'min', 'max', 'det', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'mod', 'dx', 'dy', 'dt']);

/** `$…$` 的内容像不像数学（排除货币 / 口语里的美元号） */
export function looksLikeMath(content: string): boolean {
  const s = content.trim();
  if (!s) return false;
  if (/[\\^_=+*/<>{}|]/.test(s)) return true;
  if (/^[A-Za-z0-9.,()\-\s]{1,12}$/.test(s) && !/\s/.test(s)) return true;
  return false;
}

function pushText(segments: MathSegment[], text: string): void {
  if (!text) return;
  // 裸 LaTeX 再切一层
  let last = 0;
  for (const m of text.matchAll(BARE)) {
    const start = m.index ?? 0;
    let raw = m[0];
    // 裸公式后面紧跟的英文单词（" is velocity"）不属于公式：在第一个非函数名的英文词前截断
    // 小写英文词（is / the / velocity）不是公式；大写字母串（PA、AB）与 TeX 函数名（sin、dx）留下
    const wordCut = /\s+(?!\\)([a-z][A-Za-z]+)(?=\s|$)/g;
    let wm: RegExpExecArray | null;
    while ((wm = wordCut.exec(raw))) {
      if (!TEX_WORDS.has(wm[1])) {
        raw = raw.slice(0, wm.index);
        break;
      }
    }
    raw = raw.replace(/[\s.,!]+$/, '');
    if (!raw.includes('\\') || raw.length < 4) continue;
    // 括号 / 花括号要配平，不配平就退到配平的位置
    raw = balanceTrim(raw);
    if (!raw) continue;
    if (start > last) segments.push({ kind: 'text', value: text.slice(last, start) });
    segments.push({ kind: 'inline', value: raw });
    last = start + raw.length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });
}

function balanceTrim(raw: string): string {
  let depth = 0;
  let cut = raw.length;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) {
        cut = i;
        break;
      }
    }
  }
  let out = raw.slice(0, cut);
  // 末尾未闭合的 { 去掉
  while ((out.match(/\{/g) ?? []).length > (out.match(/\}/g) ?? []).length) {
    const idx = out.lastIndexOf('{');
    if (idx < 0) break;
    out = out.slice(0, idx);
  }
  return out.trim();
}

export function splitMathText(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(DELIMITED)) {
    const start = match.index ?? 0;
    const raw = match[0];
    let seg: MathSegment | null = null;
    if (raw.startsWith('$$')) seg = { kind: 'block', value: raw.slice(2, -2) };
    else if (raw.startsWith('\\[')) seg = { kind: 'block', value: raw.slice(2, -2) };
    else if (raw.startsWith('\\(')) seg = { kind: 'inline', value: raw.slice(2, -2) };
    else if (looksLikeMath(raw.slice(1, -1))) seg = { kind: 'inline', value: raw.slice(1, -1) };
    if (!seg) continue; // 货币之类：当文本
    if (start > last) pushText(segments, text.slice(last, start));
    segments.push(seg);
    last = start + raw.length;
  }
  if (last < text.length) pushText(segments, text.slice(last));
  return segments;
}

// ---------- 朗读 ----------

const GREEK: Record<string, string> = {
  alpha: '阿尔法',
  beta: '贝塔',
  gamma: '伽马',
  delta: '德尔塔',
  epsilon: '艾普西隆',
  varepsilon: '艾普西隆',
  zeta: '泽塔',
  eta: '伊塔',
  theta: '西塔',
  iota: '约塔',
  kappa: '卡帕',
  lambda: '拉姆达',
  mu: '缪',
  nu: '纽',
  xi: '克西',
  pi: '派',
  rho: '柔',
  sigma: '西格玛',
  tau: '陶',
  upsilon: '宇普西隆',
  phi: '斐',
  varphi: '斐',
  chi: '卡伊',
  psi: '普赛',
  omega: '欧米伽',
  Gamma: '伽马',
  Delta: '德尔塔',
  Theta: '西塔',
  Lambda: '拉姆达',
  Pi: '派',
  Sigma: '西格玛',
  Phi: '斐',
  Omega: '欧米伽',
};

const WORDS: Record<string, string> = {
  cdot: '乘',
  times: '乘',
  div: '除以',
  pm: '正负',
  mp: '负正',
  le: '小于等于',
  leq: '小于等于',
  ge: '大于等于',
  geq: '大于等于',
  ne: '不等于',
  neq: '不等于',
  approx: '约等于',
  equiv: '恒等于',
  propto: '正比于',
  sim: '相似于',
  to: '趋于',
  rightarrow: '趋于',
  Rightarrow: '推出',
  Leftrightarrow: '等价于',
  infty: '无穷',
  in: '属于',
  notin: '不属于',
  subset: '包含于',
  subseteq: '包含于',
  cup: '并',
  cap: '交',
  forall: '任意',
  exists: '存在',
  perp: '垂直于',
  parallel: '平行于',
  angle: '角',
  triangle: '三角形',
  partial: '偏',
  nabla: '纳布拉',
  sum: '求和',
  prod: '求积',
  int: '积分',
  oint: '环路积分',
  lim: '极限',
  log: 'log',
  ln: 'ln',
  lg: 'lg',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  cot: 'cot',
  sec: 'sec',
  csc: 'csc',
  arcsin: 'arcsin',
  arccos: 'arccos',
  arctan: 'arctan',
  exp: 'exp',
  max: '最大值',
  min: '最小值',
  det: '行列式',
  degree: '度',
  circ: '度',
  ldots: '等等',
  cdots: '等等',
  dots: '等等',
  prime: '一撇',
  hbar: 'h 拔',
  ell: 'l',
};

/** 只是排版、没有读音的命令 */
const SILENT = new Set(['left', 'right', 'displaystyle', 'textstyle', 'quad', 'qquad', 'mathrm', 'mathit', 'operatorname', 'text', 'textbf', 'mathbf', 'boldsymbol', 'mathbb', 'mathcal', 'mathsf', 'bm', 'limits', 'nolimits', 'big', 'Big', 'bigg', 'Bigg', ',', ';', ':', '!', ' ']);

interface Node {
  kind: 'cmd' | 'group' | 'sym' | 'text';
  value: string;
  args?: Node[][];
}

/** 极简 TeX 词法：命令 / 花括号组 / 单字符 */
function parse(src: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  const readGroup = (): Node[] => {
    // 假定 src[i] === '{'
    i++;
    const inner: Node[] = [];
    while (i < src.length && src[i] !== '}') inner.push(...readOne());
    i++; // skip }
    return inner;
  };
  const readOne = (): Node[] => {
    const ch = src[i];
    if (ch === '{') return [{ kind: 'group', value: '', args: [readGroup()] }];
    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) {
        i++;
        return [];
      }
      i += m[0].length;
      const name = m[1];
      const node: Node = { kind: 'cmd', value: name, args: [] };
      const argc = name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'binom' ? 2 : name === 'sqrt' || name === 'vec' || name === 'hat' || name === 'bar' || name === 'dot' || name === 'overline' || name === 'underline' || name === 'tilde' || SILENT.has(name) ? 1 : 0;
      // \sqrt[n]{x}
      if (name === 'sqrt' && src[i] === '[') {
        const close = src.indexOf(']', i);
        if (close > i) {
          node.args!.push(parse(src.slice(i + 1, close)));
          i = close + 1;
        }
      }
      for (let k = 0; k < argc; k++) {
        while (src[i] === ' ') i++;
        if (src[i] === '{') node.args!.push(readGroup());
        else if (i < src.length && src[i] !== '\\' && !SILENT.has(name)) {
          node.args!.push([{ kind: 'sym', value: src[i] }]);
          i++;
        } else break;
      }
      return [node];
    }
    i++;
    return [{ kind: 'sym', value: ch }];
  };
  while (i < src.length) nodes.push(...readOne());
  return nodes;
}

function speakNodes(nodes: Node[], vectorish: boolean): string {
  const out: string[] = [];
  const text = (n: Node[]): string => speakNodes(n, vectorish);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const next = nodes[i + 1];
    if (n.kind === 'group') {
      out.push(text(n.args![0]));
      continue;
    }
    if (n.kind === 'sym') {
      const s = n.value;
      if (s === '^' && next) {
        const exp = next.kind === 'group' ? text(next.args![0]) : next.kind === 'cmd' ? speakNodes([next], vectorish) : next.value;
        i++;
        const trimmed = exp.trim();
        const prevWord = out[out.length - 1] ?? '';
        if (/^从 /.test(prevWord) || /(求和|求积|积分)$/.test(prevWord)) out.push(`到 ${trimmed}`);
        else if (trimmed === '度') out.push('度');
        else if (trimmed === '2') out.push('的平方');
        else if (trimmed === '3') out.push('的立方');
        else if (trimmed === '一撇' || trimmed === "'") out.push('一撇');
        else out.push(`的 ${trimmed} 次方`);
        continue;
      }
      if (s === '_' && next) {
        const sub = next.kind === 'group' ? text(next.args![0]) : next.kind === 'cmd' ? speakNodes([next], vectorish) : next.value;
        i++;
        const trimmed = sub.trim();
        // 上一个词是求和 / 积分 / 极限：下标是「从 …」
        const prev = out[out.length - 1] ?? '';
        if (/极限$/.test(prev)) out.push(trimmed);
        else if (/(求和|求积|积分)$/.test(prev)) out.push(`从 ${trimmed}`);
        else if (/^\d+$/.test(trimmed)) out[out.length - 1] = `${prev}${trimmed}`;
        else out.push(`下标 ${trimmed}`);
        continue;
      }
      // 数字串（含小数点）和大写字母串（AB、PA）合成一个词来念
      if (/[0-9]/.test(s) || /[A-Z]/.test(s)) {
        const cls = /[0-9]/.test(s) ? /[0-9.]/ : /[A-Z]/;
        let word = s;
        while (nodes[i + 1]?.kind === 'sym' && cls.test(nodes[i + 1].value)) {
          word += nodes[i + 1].value;
          i++;
        }
        out.push(word);
        continue;
      }
      if (s === '=') out.push('等于');
      else if (s === '+') out.push('加');
      else if (s === '-') out.push(out.length === 0 || /(等于|加|减|乘|除以|括号|趋于|从)$/.test(out[out.length - 1]) ? '负' : '减');
      else if (s === '*') out.push('乘');
      else if (s === '/') out.push('除以');
      else if (s === '<') out.push('小于');
      else if (s === '>') out.push('大于');
      else if (s === '!') out.push('的阶乘');
      else if (s === "'") out.push('一撇');
      else if (s === '|') {
        const close = nodes.findIndex((m, k) => k > i && m.kind === 'sym' && m.value === '|');
        if (close > i) {
          out.push(`${text(nodes.slice(i + 1, close))} 的绝对值`);
          i = close;
        }
      }
      else if (s === '{' || s === '}' || s === '(' || s === ')' || s === '[' || s === ']' || s === '&' || s === '~') {
        // 括号不念（停顿由 TTS 自己处理）
      } else if (/\s/.test(s)) {
        // 空白
      } else out.push(s);
      continue;
    }
    // cmd
    const name = n.value;
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const [a, b] = n.args ?? [];
      out.push(`${text(b ?? [])} 分之 ${text(a ?? [])}`);
      continue;
    }
    if (name === 'binom') {
      const [a, b] = n.args ?? [];
      out.push(`${text(a ?? [])} 选 ${text(b ?? [])}`);
      continue;
    }
    if (name === 'sqrt') {
      const args = n.args ?? [];
      if (args.length === 2) out.push(`${text(args[1])} 的 ${text(args[0])} 次方根`);
      else out.push(`根号 ${text(args[0] ?? [])}`);
      continue;
    }
    if (name === 'vec') {
      out.push(`向量 ${text(n.args?.[0] ?? [])}`);
      continue;
    }
    if (name === 'hat') {
      out.push(`${text(n.args?.[0] ?? [])} 帽`);
      continue;
    }
    if (name === 'bar' || name === 'overline') {
      out.push(`${text(n.args?.[0] ?? [])} 拔`);
      continue;
    }
    if (name === 'dot') {
      out.push(`${text(n.args?.[0] ?? [])} 点`);
      continue;
    }
    if (name === 'tilde' || name === 'underline') {
      out.push(text(n.args?.[0] ?? []));
      continue;
    }
    if (SILENT.has(name)) {
      if (n.args?.[0]) out.push(text(n.args[0]));
      continue;
    }
    if (name === 'cdot') {
      out.push(vectorish ? '点乘' : '乘');
      continue;
    }
    if (GREEK[name]) {
      out.push(GREEK[name]);
      continue;
    }
    if (WORDS[name]) {
      out.push(WORDS[name]);
      continue;
    }
    // 未知命令：念名字总比念反斜杠好
    out.push(name);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** 单段 LaTeX → 可念中文 */
export function latexToSpeech(tex: string): string {
  const src = tex.replace(/\\\\/g, ' ').trim();
  if (!src) return '';
  const vectorish = /\\(mathbf|vec|boldsymbol|bm)\b/.test(src);
  try {
    return speakNodes(parse(src), vectorish);
  } catch {
    return src.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_$]/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/** 整段口播：把里面的公式换成能念的话（其余原样） */
export function speakableText(text: string): string {
  if (!/[$\\]/.test(text)) return text;
  return splitMathText(text)
    .map((seg) => (seg.kind === 'text' ? seg.value : ` ${latexToSpeech(seg.value)} `))
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
