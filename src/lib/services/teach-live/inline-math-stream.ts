/**
 * inline-math-stream —— 流式文本里的 {{ 表达式 }} 在到达时算好再放出去。
 *
 * 老师口播「每秒 {{ 24 / 2 }} 米」：数字由代码算，不靠模型心算。表达式可能被 chunk 边界切开，
 * 所以遇到未闭合的 `{{` 就扣住后面的文本，等 `}}` 到了一起求值放出；块闭合时 flush 把残余原样放出。
 * TTS、字幕、课堂记录、模型历史看到的都是算好的数字。
 */

import { evaluateInlineMath } from '@/lib/utils/safe-math';

export class InlineMathStream {
  private held = '';

  push(delta: string): string {
    const text = this.held + delta;
    this.held = '';
    const open = text.lastIndexOf('{{');
    const close = text.lastIndexOf('}}');
    if (open >= 0 && open > close) {
      // 有未闭合的 {{：它之前的部分可以放出（先算掉里面已闭合的），它之后扣住
      this.held = text.slice(open);
      return evaluateInlineMath(text.slice(0, open));
    }
    // 尾部可能是半个 "{"：也扣一下
    if (text.endsWith('{')) {
      this.held = '{';
      return evaluateInlineMath(text.slice(0, -1));
    }
    return evaluateInlineMath(text);
  }

  flush(): string {
    const rest = this.held;
    this.held = '';
    return rest ? evaluateInlineMath(rest) : '';
  }
}
