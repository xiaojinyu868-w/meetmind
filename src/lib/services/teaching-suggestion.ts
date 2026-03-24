/**
 * 教学建议生成服务
 * 
 * 调用 Discussion LLM 生成教学改进建议
 * 复用: Discussion LLM 100%
 * 自研比例: 20% (Prompt 工程)
 */

import type { Anchor } from '@/types';
import { createLogger } from '@/lib/logger';
const log = createLogger('teaching-suggestion');


export interface TeachingSuggestionContext {
  /** 时间段 */
  timeSlot: string;
  /** 开始时间（毫秒） */
  startMs: number;
  /** 结束时间（毫秒） */
  endMs: number;
  /** 困惑点列表 */
  anchors: Anchor[];
  /** 转录内容 */
  transcriptText?: string;
  /** 学科 */
  subject?: string;
  /** 总时长 */
  totalDuration?: number;
}

export interface TeachingSuggestion {
  /** 问题分析 */
  problemAnalysis: string;
  /** 可能原因 */
  possibleCauses: string[];
  /** 改进建议 */
  suggestions: string[];
  /** 教学策略 */
  teachingStrategies: string[];
  /** 预防措施 */
  preventionTips: string[];
}

/**
 * 生成教学建议
 */
export async function generateTeachingSuggestion(
  context: TeachingSuggestionContext
): Promise<TeachingSuggestion> {
  const systemPrompt = buildSystemPrompt(context.subject);
  const userPrompt = buildUserPrompt(context);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return parseResponse(data.content);
  } catch (error) {
    log.error('Teaching suggestion error:', error);
    return {
      problemAnalysis: '无法生成分析',
      possibleCauses: ['服务暂时不可用'],
      suggestions: ['请稍后重试'],
      teachingStrategies: [],
      preventionTips: [],
    };
  }
}

/**
 * 构建系统提示
 */
function buildSystemPrompt(subject?: string): string {
  const subjectHint = subject ? `当前科目是${subject}。` : '';
  
  return `你是一位资深的教学顾问，帮助教师分析课堂困惑点并提供改进建议。${subjectHint}

请按以下结构回复：

## 问题分析
分析这个时间段学生困惑的核心问题。

## 可能原因
列出 2-3 个可能导致学生困惑的原因。

## 改进建议
给出 3-4 个具体可操作的改进建议。

## 教学策略
推荐 2-3 个适合这个知识点的教学策略。

## 预防措施
给出 2-3 个预防类似困惑的建议。

要求：
- 建议要具体、可操作
- 语气专业但友好
- 考虑学生的认知规律
- 结合学科特点`;
}

/**
 * 构建用户提示
 */
function buildUserPrompt(context: TeachingSuggestionContext): string {
  const uniqueStudents = new Set(context.anchors.map(a => a.studentId || '匿名'));
  const unresolvedCount = context.anchors.filter(a => !a.resolved).length;

  let prompt = `## 课堂困惑点数据

**时间段**: ${context.timeSlot}
**困惑人数**: ${uniqueStudents.size} 人
**困惑次数**: ${context.anchors.length} 次
**未解决**: ${unresolvedCount} 个

`;

  if (context.transcriptText) {
    prompt += `**课堂内容**:\n${context.transcriptText}\n\n`;
  }

  prompt += `**困惑点时间分布**:\n`;
  context.anchors.forEach((anchor, i) => {
    const time = formatTime(anchor.timestamp);
    const status = anchor.resolved ? '已解决' : '待解决';
    prompt += `${i + 1}. [${time}] ${anchor.studentId || '匿名'} - ${status}\n`;
  });

  prompt += `\n请分析这些困惑点并给出教学改进建议。`;

  return prompt;
}

/**
 * 解析 AI 回复
 */
function parseResponse(content: string): TeachingSuggestion {
  const result: TeachingSuggestion = {
    problemAnalysis: '',
    possibleCauses: [],
    suggestions: [],
    teachingStrategies: [],
    preventionTips: [],
  };

  // 提取问题分析
  const analysisMatch = content.match(/## 问题分析\s*([\s\S]*?)(?=##|$)/i);
  if (analysisMatch) {
    result.problemAnalysis = analysisMatch[1].trim();
  }

  // 提取列表项的辅助函数
  const extractList = (section: string): string[] => {
    return section
      .split('\n')
      .filter(line => line.trim().match(/^[-*\d.]/))
      .map(line => line.replace(/^[-*\d.]+\s*/, '').trim())
      .filter(Boolean);
  };

  // 提取可能原因
  const causesMatch = content.match(/## 可能原因\s*([\s\S]*?)(?=##|$)/i);
  if (causesMatch) {
    result.possibleCauses = extractList(causesMatch[1]);
  }

  // 提取改进建议
  const suggestionsMatch = content.match(/## 改进建议\s*([\s\S]*?)(?=##|$)/i);
  if (suggestionsMatch) {
    result.suggestions = extractList(suggestionsMatch[1]);
  }

  // 提取教学策略
  const strategiesMatch = content.match(/## 教学策略\s*([\s\S]*?)(?=##|$)/i);
  if (strategiesMatch) {
    result.teachingStrategies = extractList(strategiesMatch[1]);
  }

  // 提取预防措施
  const preventionMatch = content.match(/## 预防措施\s*([\s\S]*?)(?=##|$)/i);
  if (preventionMatch) {
    result.preventionTips = extractList(preventionMatch[1]);
  }

  // 如果没有结构化内容，使用原始回复
  if (!result.problemAnalysis) {
    result.problemAnalysis = content;
  }

  return result;
}

/**
 * 格式化时间
 */
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/**
 * 教学建议展示组件的数据格式化
 */
export function formatSuggestionForDisplay(suggestion: TeachingSuggestion): string {
  let text = '';

  if (suggestion.problemAnalysis) {
    text += `📊 **问题分析**\n${suggestion.problemAnalysis}\n\n`;
  }

  if (suggestion.possibleCauses.length > 0) {
    text += `🔍 **可能原因**\n`;
    suggestion.possibleCauses.forEach((cause, i) => {
      text += `${i + 1}. ${cause}\n`;
    });
    text += '\n';
  }

  if (suggestion.suggestions.length > 0) {
    text += `💡 **改进建议**\n`;
    suggestion.suggestions.forEach((s, i) => {
      text += `${i + 1}. ${s}\n`;
    });
    text += '\n';
  }

  if (suggestion.teachingStrategies.length > 0) {
    text += `📚 **教学策略**\n`;
    suggestion.teachingStrategies.forEach((s, i) => {
      text += `${i + 1}. ${s}\n`;
    });
    text += '\n';
  }

  if (suggestion.preventionTips.length > 0) {
    text += `🛡️ **预防措施**\n`;
    suggestion.preventionTips.forEach((tip, i) => {
      text += `${i + 1}. ${tip}\n`;
    });
  }

  return text.trim();
}
