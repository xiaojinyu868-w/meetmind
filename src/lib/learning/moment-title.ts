/**
 * moment-title — 给「课堂里的一个时刻」起名（纯函数）。
 *
 * 学生标下的一处困惑、一个重点，此前在所有地方都只叫"00:30 · 困惑点 #1"——时间和序号对人没有意义，
 * 他记不得 0:30 老师在说什么。人做笔记会怎么写？写那一刻老师的话，或者自己当时的一句备注。
 * 所以命名顺序是：学生自己的备注（他的话最准）→ 课堂脉络里覆盖这一刻的要点标题（模型已经归纳过）
 * → 老师那一刻的原话首句（永远有）。都没有才退回只有时间。
 *
 * 用法处：复习页困惑点列表、问同学书桌「你标的」、复习同桌开场 chip、课后路径推荐理由。
 * 同一时刻在所有地方叫同一个名字——这是命名系统的意义。
 */

export interface MomentSegment {
  startMs: number;
  endMs?: number;
  text: string;
}

export interface MomentFlowItem {
  title: string;
  startMs: number;
  endMs?: number;
}

export interface MomentLike {
  timestamp: number;
  note?: string | null;
}

export interface MomentTitle {
  /** mm:ss */
  time: string;
  /** 人能认出这一刻的短名；'' = 只有时间 */
  title: string;
  source: 'note' | 'flow' | 'quote' | 'none';
}

const WIDE_CHAR = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
/** 短名预算（显示宽度：CJK 记 2）——大约 14 个汉字 / 5-6 个英文词 */
export const MOMENT_TITLE_UNITS = 28;

export function formatMomentTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 按显示宽度截断（CJK 记 2、其余记 1），超出加省略号；英文在词边界断 */
export function clipDisplay(text: string, maxUnits = MOMENT_TITLE_UNITS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  let units = 0;
  for (let i = 0; i < t.length; i += 1) {
    units += WIDE_CHAR.test(t[i]) ? 2 : 1;
    if (units > maxUnits) {
      let head = t.slice(0, i);
      // 英文不切在词中间：退到最后一个空格（退得太多就算了）
      const lastSpace = head.lastIndexOf(' ');
      if (lastSpace > head.length * 0.6 && !WIDE_CHAR.test(head[head.length - 1] ?? '')) head = head.slice(0, lastSpace);
      return `${head.trimEnd().replace(/[,，、;；:：]$/, '')}…`;
    }
  }
  return t;
}

const MIN_CLAUSE_WORDS = 4;
const MIN_CLAUSE_CJK = 6;

function clauseHasSubstance(clause: string): boolean {
  const cjk = (clause.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjk > 0) return cjk >= MIN_CLAUSE_CJK;
  return clause.split(/\s+/).filter(Boolean).length >= MIN_CLAUSE_WORDS;
}

/**
 * 取一句里最能当名字的子句：按句末标点切开，跳过"That's it exactly" 这类没有信息量的短叹句，
 * 取第一个有实词的子句；逗号只在整句仍太长时才当边界。
 */
export function firstClause(text: string, maxUnits = MOMENT_TITLE_UNITS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  // 句末标点；英文句点只在其后是空格 / 结尾时算（小数点、缩写不切）
  const sentences = t.split(/[。！？!?;；\n]|\.(?=\s|$)/).map((part) => part.trim()).filter(Boolean);
  const sentence = (sentences.find(clauseHasSubstance) ?? sentences[0] ?? '').replace(/[。！？!?.;；,，]+$/, '');
  if (clipDisplay(sentence, maxUnits) === sentence) return sentence;
  const soft = sentence.search(/[，,：:—]/);
  if (soft > 6) {
    const clause = sentence.slice(0, soft);
    if (clipDisplay(clause, maxUnits) === clause && clauseHasSubstance(clause)) return clause;
  }
  return clipDisplay(sentence, maxUnits);
}

/** 这一刻老师在说的那一句（包含时间点的段，段尾不含——正好在边界上算下一句的开头；没有就取之前最近的一段） */
export function quoteAtMoment(segments: readonly MomentSegment[], timestampMs: number): string {
  if (segments.length === 0) return '';
  let hit = segments.find((seg) => timestampMs >= seg.startMs && timestampMs < (seg.endMs ?? seg.startMs + 8_000));
  if (!hit) {
    const before = segments.filter((seg) => seg.startMs <= timestampMs);
    hit = before.length > 0 ? before[before.length - 1] : segments[0];
  }
  return firstClause(hit.text || '');
}

export function describeMoment(
  moment: MomentLike,
  segments: readonly MomentSegment[],
  flow: readonly MomentFlowItem[] = [],
): MomentTitle {
  const time = formatMomentTime(moment.timestamp);
  const note = moment.note?.replace(/\s+/g, ' ').trim();
  if (note) return { time, title: clipDisplay(note), source: 'note' };
  const item = flow.find((f) => moment.timestamp >= f.startMs && moment.timestamp <= (f.endMs ?? f.startMs + 30_000));
  if (item?.title?.trim()) return { time, title: clipDisplay(item.title), source: 'flow' };
  const quote = quoteAtMoment(segments, moment.timestamp);
  if (quote) return { time, title: quote, source: 'quote' };
  return { time, title: '', source: 'none' };
}

/** "00:30 · My name is Jane"；没有短名就只有 "00:30" */
export function momentLabel(described: MomentTitle): string {
  return described.title ? `${described.time} · ${described.title}` : described.time;
}
