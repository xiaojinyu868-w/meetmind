import { describe, expect, it } from 'vitest';
import { extractScript } from '../draw-repair';

describe('extractScript（模型修好的脚本怎么捞）', () => {
  it('takes the inside of a <draw> block and strips fences / explanations', () => {
    expect(extractScript('修正如下：\n```js\nconst c = circle(O, 3);\n```')).toBe('const c = circle(O, 3);');
    expect(extractScript('<draw into="vec">\nconst A = point(0, 0);\n</draw>')).toBe('const A = point(0, 0);');
    expect(extractScript('<draw id="x" title="y">point(1,1);</draw>')).toBe('point(1,1);');
    expect(extractScript('point(2, 2);')).toBe('point(2, 2);');
  });
});
