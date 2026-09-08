/**
 * concept-label — 把检验留下的"概念"收成一个能放进窄处的词。
 *
 * 闪卡 / 测验留下的概念常常是整句问题（"“up in the air” 在这段对话里是什么意思"），
 * 书桌 chip、掌握轨迹、"先做这一件"的理由都只放得下一个词：句子里有引号包着的术语就用术语，
 * 否则截到可读长度。纯函数，零依赖；掌握轨迹与课后路径共用，避免两套截断规则给同一个概念起两个名。
 */

const QUOTED_TERM = /[“"「『]([^”"」』]{2,24})[”"」』]/;

export function conceptLabel(concept: string, max = 20): string {
  const text = concept.replace(/\s+/g, ' ').trim();
  const quoted = QUOTED_TERM.exec(text)?.[1]?.trim();
  if (quoted && quoted.length < text.length) return quoted;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
