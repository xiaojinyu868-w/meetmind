/**
 * MeetMind 能力调用层
 * 
 * 封装对三个上游项目的 API 调用：
 * - Open Notebook: 多模型 AI、向量搜索、洞察生成
 * - Discussion: 通义听悟 ASR、通义千问 LLM
 * - LongCut: 时间轴处理、引用匹配
 */

export * from './discussion-service';
export * from './notebook-service';
export * from './longcut-service';
export * from './meetmind-service';
