import { describe, expect, it } from 'vitest';
import { parseUnderstandingResponse } from './lesson-understanding-service';

const VALID = JSON.stringify({
  topic: '条件概率与贝叶斯公式',
  overview: '这节课从条件概率的定义出发，推到贝叶斯公式，并用疾病筛查例子说明基础概率对结果的影响。',
  takeaways: ['条件概率是缩小样本空间', '贝叶斯公式 = 后验 = 似然 × 先验 / 证据', '筛查阳性不等于真患病'],
  highlights: [
    { title: '贝叶斯公式推导', startSec: 754, quote: '所以后验概率正比于似然乘先验' },
    { title: '疾病筛查例子', startSec: 1630, quote: '一万个人里真正患病的只有五十个' },
  ],
});

describe('parseUnderstandingResponse', () => {
  it('解析合法输出', () => {
    const result = parseUnderstandingResponse(VALID);
    expect(result?.topic).toBe('条件概率与贝叶斯公式');
    expect(result?.overview).toContain('贝叶斯');
    expect(result?.takeaways).toHaveLength(3);
    expect(result?.highlights).toHaveLength(2);
    expect(result?.highlights[0].startSec).toBe(754);
  });

  it('容忍 ```json 代码围栏', () => {
    expect(parseUnderstandingResponse(`\`\`\`json\n${VALID}\n\`\`\``)?.topic).toBe('条件概率与贝叶斯公式');
  });

  it('topic 命中零信息词时被剥掉但其余保留', () => {
    const raw = JSON.stringify({ ...JSON.parse(VALID), topic: '课堂笔记' });
    const result = parseUnderstandingResponse(raw);
    expect(result?.topic).toBeNull();
    expect(result?.overview).toBeTruthy();
  });

  it('超量字段被截断', () => {
    const raw = JSON.stringify({
      ...JSON.parse(VALID),
      takeaways: Array.from({ length: 9 }, (_, i) => `第${i}条要点内容`),
      highlights: Array.from({ length: 10 }, (_, i) => ({ title: `片段${i}`, startSec: i * 60, quote: '原话' })),
    });
    const result = parseUnderstandingResponse(raw);
    expect(result?.takeaways).toHaveLength(5);
    expect(result?.highlights).toHaveLength(6);
  });

  it('startSec 非法的 highlight 被丢弃', () => {
    const raw = JSON.stringify({
      ...JSON.parse(VALID),
      highlights: [{ title: '没有时间', startSec: 'abc' }, { title: '正常', startSec: 42 }],
    });
    const result = parseUnderstandingResponse(raw);
    expect(result?.highlights).toHaveLength(1);
    expect(result?.highlights[0].title).toBe('正常');
  });

  it('非 JSON / 全不达标返回 null', () => {
    expect(parseUnderstandingResponse('模型输出了一坨散文')).toBeNull();
    expect(parseUnderstandingResponse('{}')).toBeNull();
    expect(parseUnderstandingResponse('{"topic":"录音"}')).toBeNull();
  });
});
