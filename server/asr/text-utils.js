/**
 * server/asr/text-utils.js
 *
 * ASR proxy 用到的纯函数工具集（从 server.js 抽出）。
 * 全部是 pure function：无外部依赖，无副作用，便于单测。
 *
 * 在 M1 阶段抽离是为了：
 *   1. server.js 从 1341 行降到 ~1200 行，God File 治理第一步
 *   2. 这些函数在 M2 要改造（重叠缝合、更好的 split 策略、幻觉过滤升级），
 *      独立出来后，M2 的改动可以基于单测驱动
 *   3. 所有函数纯函数化，方便后续在 TS 侧复用
 *
 * 保持 CommonJS 以匹配 server.js。M2 若切 ESM 再统一迁移。
 */

'use strict';

/** ASR 文本比较时的归一化：去标点 + 小写 + NFKC */
function normalizeCompareText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()【】\[\]-]/g, '');
}

/**
 * 计算两个字符串归一化后的最长公共子串占较短串的比例。
 * 用于去重判断："两段内容是否本质一致"。
 * 使用 1D 动态规划，空间 O(min(a,b))。
 */
function longestCommonSubstringRatio(a, b) {
  const left = normalizeCompareText(a);
  const right = normalizeCompareText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;

  const dp = new Array(shorter.length + 1).fill(0);
  let maxLen = 0;

  for (let i = 1; i <= longer.length; i += 1) {
    for (let j = shorter.length; j >= 1; j -= 1) {
      if (longer[i - 1] === shorter[j - 1]) {
        dp[j] = dp[j - 1] + 1;
        if (dp[j] > maxLen) maxLen = dp[j];
      } else {
        dp[j] = 0;
      }
    }
  }

  return maxLen / shorter.length;
}

/**
 * 是否应该把 nextSegment 视作 lastSegment 的覆盖/去重。
 * 条件：相似度 >= dedupSimilarity 且 (overlap 或 gap <= dedupGapMs)。
 */
function shouldDedupSegment(lastSegment, nextSegment, dedupSimilarity, dedupGapMs) {
  if (!lastSegment || !nextSegment) return false;

  const similarity = longestCommonSubstringRatio(lastSegment.text, nextSegment.text);
  const overlap = nextSegment.beginTime <= lastSegment.endTime;
  const gap = Math.max(0, nextSegment.beginTime - lastSegment.endTime);

  return similarity >= dedupSimilarity && (overlap || gap <= dedupGapMs);
}

/**
 * 长转写切分：按句号/问号/叹号/分号断句，字数超上限强切。
 * 输出 [{text, beginTime, endTime}...]，时间戳按字符数等比例分配。
 * 如果切分后只有一段或无法切分，原样返回一段。
 */
/**
 * 把 ASR 给到的"完整一句"按需要切分成更短的片段。
 *
 * **顶级产品原则**：信任 ASR 已经按语义切好的句子，**永不词中切**。
 *
 * 历史教训（M14.5.6）：之前 length >= 60 强制 flush 不分位置，会在
 * 词中间硬切（如 "looks" 切成 "look" + "s"）。用户视觉灾难。
 *
 * 新策略（按优先级递降）：
 *   1. 短句（≤ 200 字）→ 原样返回，**不切**
 *   2. 长句 → 在自然语义点切：
 *      a. 句尾标点 . ! ? 。 ！ ？ + 当前累积 ≥ 40 字 → 优先切
 *      b. 软标点 , ; ， ； + 当前累积 ≥ 130 字 → 次选切
 *      c. 空格 + 当前累积 ≥ 220 字 → 词边界切（绝不词中切）
 *      d. 累积 ≥ 320 字仍无空格 → 才允许字符切（罕见极长无空格 case）
 *
 * 输出 [{text, beginTime, endTime}...]，时间戳按字符数等比例分配。
 */
function splitLongTranscript(text, beginTime, endTime) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];

  // 200 字以内一律不切——绝大多数自然中英文句子都在这个范围
  if (normalized.length <= 200) {
    return [{ text: normalized, beginTime, endTime }];
  }

  const chunks = [];
  let current = '';
  const sentenceEndRe = /[。！？!?]/;
  const softBreakRe = /[，,；;:]/;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    current += ch;

    // 1. 句尾标点 + ≥ 40 字 → 切（自然语义点，最优）
    if (sentenceEndRe.test(ch) && current.length >= 40) {
      chunks.push(current);
      current = '';
      continue;
    }

    // 2. 软标点 + ≥ 130 字 → 切（次选）
    if (softBreakRe.test(ch) && current.length >= 130) {
      chunks.push(current);
      current = '';
      continue;
    }

    // 3. 空格 + ≥ 220 字 → 词边界切（保证不切词）
    if (/\s/.test(ch) && current.length >= 220) {
      chunks.push(current);
      current = '';
      continue;
    }

    // 4. 极长无空格无标点 ≥ 320 字 → 才允许硬切（罕见 case，e.g. URL/代码）
    if (current.length >= 320) {
      chunks.push(current);
      current = '';
    }
  }

  if (current.trim()) chunks.push(current.trim());

  if (chunks.length <= 1) {
    return [{ text: normalized, beginTime, endTime }];
  }

  const duration = Math.max(1, endTime - beginTime);
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalChars <= 0) {
    return [{ text: normalized, beginTime, endTime }];
  }

  let consumed = 0;
  return chunks.map((chunk, index) => {
    const segBegin = Math.round(beginTime + (duration * consumed) / totalChars);
    consumed += chunk.length;
    let segEnd = index === chunks.length - 1
      ? endTime
      : Math.round(beginTime + (duration * consumed) / totalChars);

    if (segEnd <= segBegin) {
      segEnd = Math.min(endTime, segBegin + 200);
    }

    return {
      text: chunk.trim(),
      beginTime: segBegin,
      endTime: segEnd,
    };
  });
}

/** 从 DashScope 消息里提取 item_id */
function extractItemId(msg) {
  return msg.item_id || msg.item?.id || null;
}

/** 从 DashScope 消息里提取最终文本（多个可能字段） */
function extractFinalText(msg) {
  const candidates = [
    msg.item?.content?.[0]?.text,
    msg.transcript,
    msg.text,
    msg.item?.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

/** 从 DashScope 消息里提取服务端时间戳（毫秒） */
function extractServerTimestamp(msg, kind) {
  const beginFields = ['begin_time', 'start_time', 'beginTime', 'startTime', 'audio_start_ms'];
  const endFields = ['end_time', 'endTime', 'audio_end_ms'];
  const fields = kind === 'begin' ? beginFields : endFields;

  for (const field of fields) {
    if (msg[field] !== undefined) return Number(msg[field]);
    if (msg.item?.[field] !== undefined) return Number(msg.item[field]);
  }

  return null;
}

/**
 * 从 interim 消息里提取 {stableText, unstableText, text}
 * stableText = 已稳定的部分
 * unstableText = 末尾抖动中的部分
 * text = 合成结果（给前端展示用）
 */
function extractInterimPayload(msg) {
  const stableText = typeof msg.text === 'string' ? msg.text : '';
  const unstableText = typeof msg.stash === 'string'
    ? msg.stash
    : (typeof msg.delta === 'string' ? msg.delta : '');

  let composed = `${stableText}${unstableText}`.trim();
  if (!composed) {
    composed = stableText || unstableText || '';
  }

  return {
    stableText,
    unstableText,
    text: composed,
  };
}

/** DashScope commit 时的可吞没错误（避免 WS 重连风暴） */
function isIgnorableCommitError(message) {
  return typeof message === 'string' && /error committing input audio buffer/i.test(message);
}

/** DashScope session.update 二次发送的已知吞没错误 */
function isIgnorableSessionUpdateError(message) {
  if (typeof message !== 'string') return false;
  return (
    /session already started or finished or failed/i.test(message) ||
    /input messages do not contain elements with the role of user/i.test(message)
  );
}

/**
 * 幻觉过滤（抗 Whisper 幻觉工业界标准启发式）：
 *   1. 音段时长过短（< 300ms）但文本长度 ≥ 3 字 → 物理上不可能，丢弃
 *   2. 音段 < 500ms 且文本是常见叹词 → 丢弃
 * 返回 true 表示"应该丢弃"。
 */
function isLikelyHallucination(finalText, durationMs) {
  const trimmedText = String(finalText || '').trim();
  const textLen = trimmedText.length;
  if (!textLen) return true;

  const normalizedToken = trimmedText
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
  const normalizedCompactToken = normalizedToken.replace(/\s+/g, '');

  if (durationMs > 0 && durationMs < 300 && textLen >= 3) {
    return true;
  }

  if (durationMs > 0 && durationMs < 500 && textLen <= 2) {
    const suspiciousSingleTokens = ['嗯', '啊', '哦', '呃', '唉', '哼', '嗯嗯', '好', 'uh', 'um', 'ah'];
    if (suspiciousSingleTokens.includes(trimmedText.toLowerCase())) {
      return true;
    }
  }

  // 嘈杂教室里，键盘声、呼吸和远处人声容易被多语种模型解码成极短的
  // 英文附和词。这些片段即使真实存在，也不构成课堂笔记信息；
  // Qwen Realtime 不返回可信词级时间戳，代理的 VAD 时间会把前后静音也
  // 算进去，因此 1.5s 上限过严，手机噪声产生的 "Agree / Yeah / I see"
  // 常落在 2-3s。只对封闭的低信息词表放宽到 3s，完整句不受影响。
  if (durationMs > 0 && durationMs <= 3000) {
    const lowInformationUtterances = new Set([
      '嗯', '啊', '哦', '呃', '唉', '哼', '嗯嗯', '啊对', '对', '好', '好的',
      'uh', 'um', 'ah', 'oh', 'yeah', 'yep', 'yes', 'ok', 'okay', 'i see', 'agree', 'thanks', 'thank you',
    ]);
    if (lowInformationUtterances.has(normalizedToken) || lowInformationUtterances.has(normalizedCompactToken)) {
      return true;
    }
  }

  // 物理上不可能的语速是另一种稳定的噪声幻觉信号。阈值故意保守：
  // 中文 > 16 字/秒或英文 > 9 词/秒才丢弃。
  if (durationMs >= 300) {
    const durationSec = durationMs / 1000;
    const cjkCount = (trimmedText.match(/[\u3400-\u9fff]/g) || []).length;
    const latinWordCount = (trimmedText.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
    if (cjkCount >= 4 && cjkCount / durationSec > 16) return true;
    if (latinWordCount >= 4 && latinWordCount / durationSec > 9) return true;
  }

  return false;
}

module.exports = {
  normalizeCompareText,
  longestCommonSubstringRatio,
  shouldDedupSegment,
  splitLongTranscript,
  extractItemId,
  extractFinalText,
  extractServerTimestamp,
  extractInterimPayload,
  isIgnorableCommitError,
  isIgnorableSessionUpdateError,
  isLikelyHallucination,
};
