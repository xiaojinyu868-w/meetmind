import { describe, expect, it } from 'vitest';
import { parseOutlineResponse } from './photo-lecture-stream-service';

describe('parseOutlineResponse', () => {
  it('标准大纲：title/solution/units 全保留，checkpoint 标记透传', () => {
    const raw = JSON.stringify({
      title: '二次函数利润最值',
      solution: '销量 250-5x，顶点 x=35，最大利润 1125',
      units: [
        { goal: '审题圈条件' },
        { goal: '推导核心步骤', checkpoint: true },
        { goal: '易错点与总结' },
      ],
    });
    const outline = parseOutlineResponse(raw);
    expect(outline?.title).toBe('二次函数利润最值');
    expect(outline?.units).toHaveLength(3);
    expect(outline?.units[1].checkpoint).toBe(true);
  });

  it('not_a_problem / 缺字段 / units 为空 → null', () => {
    expect(parseOutlineResponse('{"error":"not_a_problem"}')).toBeNull();
    expect(parseOutlineResponse('{"title":"t"}')).toBeNull();
    expect(parseOutlineResponse(JSON.stringify({ title: 't', solution: 's', units: [] }))).toBeNull();
    expect(parseOutlineResponse('不是 JSON')).toBeNull();
  });

  it('units 截断到 5、goal 空丢弃、checkpoint 超过 2 个判非法', () => {
    const raw = JSON.stringify({
      title: 't',
      solution: 's',
      units: [
        { goal: '一' }, { goal: '' }, { goal: '二' }, { goal: '三' },
        { goal: '四' }, { goal: '五' }, { goal: '六（超上限）' },
      ],
    });
    expect(parseOutlineResponse(raw)?.units).toHaveLength(5);

    const tooManyCp = JSON.stringify({
      title: 't',
      solution: 's',
      units: [
        { goal: '一', checkpoint: true },
        { goal: '二', checkpoint: true },
        { goal: '三', checkpoint: true },
      ],
    });
    expect(parseOutlineResponse(tooManyCp)).toBeNull();
  });
});
