import { describe, expect, it } from 'vitest';
import { buildExplainerSystemPrompt, buildExplainerUserPrompt } from './explainer-prompts';

describe('explainer board prompt contracts', () => {
  it('system prompt 守住板书脚本输出契约与顺序 write / target 引用', () => {
    const system = buildExplainerSystemPrompt();
    expect(system).toContain('板书脚本');
    expect(system).toContain('只输出一个 JSON 对象');
    expect(system).toContain('"pages"');
    expect(system).toContain('"narration"');
    expect(system).toContain('"actions"');
    expect(system).toContain('按顺序输出 write');
    expect(system).toContain('播放器自动排版，不需要你给位置');
    expect(system).toContain('字符串内容里的英文必须保留单词间正常空格');
    expect(system).toContain('"target":"w3"');
    expect(system).toContain('"from":"w1","to":"w3"');
    expect(system).toContain('本页第 N 个 write');
  });

  it('system prompt 列全七种动作（少结构多智能：不含微管理硬规则）', () => {
    const system = buildExplainerSystemPrompt();
    expect(system).toContain('"type":"write"');
    expect(system).toContain('"type":"circle"');
    expect(system).toContain('"type":"underline"');
    expect(system).toContain('"type":"arrow"');
    expect(system).toContain('"type":"mark"');
    expect(system).toContain('"type":"pause"');
    expect(system).toContain('"type":"ref"');
    // 少结构多智能（2026-08 共识）：密度/结构配方交给模型智能，不写硬规则
    expect(system).not.toContain('板书要饱满');
    expect(system).not.toContain('每页 6-12 个 write');
    // 网格坐标已移除
    expect(system).not.toContain('12 列');
    expect(system).not.toContain('B3:D4');
  });

  it('system prompt 守住嘴手一体 cue、checkpoint 契约、ref 回看', () => {
    const system = buildExplainerSystemPrompt();
    // 内联 cue 嘴手一体（v20：说到它，笔开始写它）
    expect(system).toContain('[aN]');
    expect(system).toContain('嘴手一体');
    expect(system).toContain('说到它，笔开始写它');
    // checkpoint 契约
    expect(system).toContain('"type": "checkpoint"');
    expect(system).toContain('hints 必须恰好 3 条');
    expect(system).toContain('demoActions');
    // ref 跨页回看
    expect(system).toContain('"type":"ref","page":1,"target":"w2"');
    expect(system).toContain('回看');
  });

  it('system prompt 守住逐字引用铁律', () => {
    const system = buildExplainerSystemPrompt();
    expect(system).toContain('逐字');
    expect(system).toContain('不得改写、补字、概括、翻译');
    expect(system).toContain('拿不准就转述');
    expect(system).toContain('quotes');
    expect(system).toContain('startMs');
  });

  it('user prompt 携带转录、困惑标记与板书输出提醒', () => {
    const user = buildExplainerUserPrompt({
      goalIntent: '搞懂边际成本',
      transcriptContext: '段001 [0:00-0:05] 好，我们来看这道题。',
      anchorContext: '1. 待澄清：分不清边际成本和平均成本。',
      terminologyHint: '边际成本',
    });
    expect(user).toContain('搞懂边际成本');
    expect(user).toContain('段001 [0:00-0:05] 好，我们来看这道题。');
    expect(user).toContain('待澄清：分不清边际成本和平均成本。');
    expect(user).toContain('边际成本');
    expect(user).toContain('输出 JSON');
    expect(user).toContain('毫秒');
    expect(user).toContain('板书脚本');
  });
});
