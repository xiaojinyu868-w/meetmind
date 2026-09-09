/**
 * LaTeX 在模型 JSON 输出里的反斜杠修复。
 *
 * 模型（尤其在 JSON 约束解码下）写 `$X \to Y$` 进 JSON 字符串时会发生这些事：
 *   1. 单反斜杠 + 合法转义字母（\t \f \n \b \r）→ JSON.parse 吃成制表符 / 换页符，`\to` 变成 "<TAB>o"、`\frac` 变成 "<FF>rac"；
 *   2. 单反斜杠 + 非法转义（\m \i \s …）→ 整段 JSON 解析失败；
 *   3. 约束解码被迫先补一个 `\\` 或塞一个 `_` / `.`，再写原命令：`\\\to` → 运行时 `\<TAB>o`；`\_subseteq` `\.in` → 命令字母前多了个符号；
 *   4. 过度转义 `\\\\to` → 运行时 `\\to`，KaTeX 把 `\\` 当换行。
 * 两层纯函数：解析前让 JSON.parse 能过且少吃字母；解析后在数学范围（$…$ / $$…$$ / latex 字段）里把
 * 残留的控制字符 / `\_` / 双反斜杠折回真正的命令。正文其它地方不碰。
 */

/** 数学范围：$$…$$ 允许跨行；$…$ 也允许跨行（被吃成换行的 \n 就在里面），但限制长度防止吞掉整段 */
const MATH_SPAN_PATTERN = /\$\$[\s\S]+?\$\$|\$(?:[^$])(?:[^$]{0,400}?)\$/g;
const LATEX_FIELD_PATTERN = /("latex"\s*:\s*")((?:[^"\\]|\\.)*)(")/g;

const CONTROL_TO_LETTER: Record<string, string> = { '\t': 't', '\f': 'f', '\b': 'b', '\r': 'r', '\n': 'n' };

/** 解析前、数学源码内：`\to` `\\\to` 这类 ⇒ 真正想写的是 LaTeX 命令，保住字母 */
function protectControlEscapes(mathSource: string): string {
  return mathSource
    // `\\\to`（转义反斜杠 + \t）→ `\\to`
    .replace(/\\\\\\([ftbnr])(?=[A-Za-z])/g, '\\\\$1')
    // `\to`（单反斜杠 + 合法转义字母 + 字母）→ `\\to`
    .replace(/(?<!\\)\\([ftbnr])(?=[A-Za-z])/g, '\\\\$1');
}

/** 解析前：让 JSON.parse 能过，且不把 LaTeX 命令吃成控制字符 */
export function repairLatexEscapesInJson(raw: string): string {
  let out = raw.replace(LATEX_FIELD_PATTERN, (_match, open: string, value: string, close: string) => `${open}${protectControlEscapes(value)}${close}`);
  out = out.replace(MATH_SPAN_PATTERN, (span) => protectControlEscapes(span));
  // 非法转义（\m \i \s …）在任何位置都只能是"想写一个反斜杠"：翻倍让它成为合法 JSON
  out = out.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, '\\\\');
  return out;
}

/**
 * 解析后、数学源码内：
 *   - `\<TAB>o` → `\to`（控制字符还原成字母）
 *   - `\_subseteq` `\.in` → `\subseteq` `\in`（约束解码塞进来的下划线 / 句点；`\"in` `\/in` 只在后面是已知命令时才折——`\"o` 是合法的变音符）
 *   - `\\to` → `\to`；`\\` 后跟空白 / 行尾 / `[` 是 LaTeX 换行，保留
 */
export function collapseDoubledLatexBackslashes(mathSource: string): string {
  return mathSource
    .replace(/\\([\t\f\b\r\n])(?=[A-Za-z])/g, (_match, control: string) => `\\${CONTROL_TO_LETTER[control]}`)
    .replace(/\\[._](?=[A-Za-z])/g, '\\')
    .replace(/\\+["/](?=[A-Za-z]+)/g, (match, offset: number, source: string) => {
      const rest = source.slice(offset + match.length).match(/^[A-Za-z]+/)?.[0] ?? '';
      return KNOWN_LATEX_COMMANDS.has(rest) ? '\\' : match;
    })
    .replace(/\\\\(?=[A-Za-z{}|(),;:!<>=+\-*/^_~&%#.'])/g, '\\');
}

/** 约束解码会在这些命令前塞 `"` `/`：只认名单，避免误伤 `\"o` 这类真变音符 */
const KNOWN_LATEX_COMMANDS = new Set([
  'in', 'notin', 'ni', 'int', 'iint', 'oint', 'infty', 'iff', 'implies', 'impliedby', 'imath', 'jmath',
  'sum', 'prod', 'lim', 'sup', 'inf', 'max', 'min', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp',
  'subset', 'subseteq', 'supset', 'supseteq', 'cup', 'cap', 'setminus', 'emptyset', 'varnothing', 'forall', 'exists', 'nexists',
  'to', 'mapsto', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow', 'Leftrightarrow',
  'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'equiv', 'sim', 'simeq', 'cong', 'propto', 'pm', 'mp', 'times', 'div', 'cdot', 'circ',
  'frac', 'dfrac', 'tfrac', 'sqrt', 'partial', 'nabla', 'mathbb', 'mathcal', 'mathrm', 'mathbf', 'text', 'operatorname',
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'phi', 'varphi', 'omega', 'xi', 'eta', 'rho', 'tau', 'Delta', 'Sigma', 'Omega',
  'quad', 'qquad', 'left', 'right', 'begin', 'end', 'hat', 'bar', 'vec', 'dot', 'ddot', 'tilde', 'overline', 'underline', 'binom', 'ldots', 'cdots', 'vdots',
  'mid', 'langle', 'rangle', 'lfloor', 'rfloor', 'lceil', 'rceil', 'neg', 'lnot', 'land', 'lor', 'wedge', 'vee', 'oplus', 'otimes', 'perp', 'parallel', 'angle', 'triangle',
]);

/** 运行时正文：只修 $…$ / $$…$$ 里的反斜杠 */
export function normalizeLatexInRichText(text: string): string {
  return text.replace(MATH_SPAN_PATTERN, (span) => collapseDoubledLatexBackslashes(span));
}
