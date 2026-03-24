# LongCut — 转录处理算法层

> 纯算法模块：句子合并、引用匹配、主题提取、时间戳处理。
> 无 IO、无网络调用，所有函数都是纯函数。

## 依赖规则

- ✅ `services/` 可以调用 `longcut/`
- ❌ `longcut/` 不能 import `services/`, `components/`, `hooks/`
- 只依赖自身的 `types.ts`

## 文件索引

| 文件 | 行数 | 职责 | 核心 export |
|------|------|------|------------|
| `types.ts` | 148 | 领域类型 | `TranscriptSegment`, `Topic`, `Citation`, `PlaybackCommand` |
| `quote-matcher.ts` | 390 | 引用匹配（Boyer-Moore + N-gram 相似度） | `buildTranscriptIndex`, `findTextInTranscript` |
| `transcript-sentence-merger.ts` | 351 | 短句→完整段落合并（标点/时间/长度规则） | `mergeTranscriptSegmentsIntoSentences` |
| `topic-utils.ts` | 322 | 主题提取 + 时间戳对齐 | `normalizeTranscript`, `hydrateTopicsWithTranscript` |
| `timestamp-utils.ts` | 93 | 时间戳解析/格式化 | `parseTimestamp`, `formatTimestamp`, `TIMESTAMP_REGEX` |
| `index.ts` | 37 | barrel 导出 | re-export 全部 |
