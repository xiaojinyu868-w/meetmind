import { describe, it, expect } from 'vitest';
import { cleanZhihuPage, detectZhihuPageKind, stripZhihuTitleSuffix } from './zhihu-page-clean';

// 夹具按 2026-09-09 Firecrawl 实抓的四类知乎页面结构逐行还原（页面杂质原样，作者正文缩成两三行）。
// Z = 知乎页面里大量出现的零宽空格（U+200B）。
const Z = '\u200b';
const LOGO = '![ZhiHu logo](https://static.zhihu.com/heifetz/assets/wechat-share-logo.39ea9ecd.png)';

const ANSWER_WITH_AUTHOR = [
  LOGO,
  '',
  '# ChatGPT现在还值得开会员吗？',
  '',
  `对GPT的需求： 英文翻译润色 代码询问 请问这俩需求值得开会员吗显示全部 ${Z}`,
  '',
  '关注者',
  '',
  '**189**',
  '',
  '被浏览',
  '',
  '**135,018**',
  '',
  `关注问题${Z}写回答`,
  '',
  `${Z}邀请回答`,
  '',
  `${Z}好问题 3`,
  '',
  `${Z}添加评论`,
  '',
  `${Z}分享`,
  '',
  Z,
  '',
  '登录后你可以',
  '',
  '不限量看优质回答私信答主深度交流精彩内容一键收藏',
  '',
  '登录',
  '',
  '[查看全部 112 个回答](https://www.zhihu.com/question/13521457542)',
  '',
  '[![时光纪](https://pic1.zhimg.com/v2-84ce.jpg?source=2c26e567)](https://www.zhihu.com/people/wang-yong-kang-98-91)',
  '',
  '[时光纪](https://www.zhihu.com/people/wang-yong-kang-98-91)',
  '',
  '哥们，别搞，我也是水军。',
  '',
  `${Z} 关注`,
  '',
  '首先要澄清一个常见误解：ChatGPT的免费版和付费版使用的是不同模型与功能配置，体验差距确实很大。',
  '',
  '最后不建议拼会员，多人共用一个账号容易导致模型输出错乱。',
  '',
  '[编辑于2025-05-27 22:24](https://www.zhihu.com/question/13521457542/answer/1903044959663284716)・江苏',
  '',
  `${Z}赞同 65${Z}${Z}40 条评论${Z}57 ${Z}1`,
  '',
  `${Z}分享`,
  '',
  `${Z}收起${Z}`,
  '',
  '[查看全部 112 个回答](https://www.zhihu.com/question/13521457542)',
].join('\n');

const ANSWER_ANONYMOUS = [
  LOGO,
  '',
  '[数据挖掘](https://www.zhihu.com/topic/19553534)',
  '',
  '[自然语言处理](https://www.zhihu.com/topic/19560026)',
  '',
  '# 自然语言处理中有哪些常用的数据增强的方式呢？',
  '',
  `不同的任务可以分开回答，比如分类问题是否可以参考图像的Mask呢显示全部 ${Z}`,
  '',
  '关注者',
  '',
  '**575**',
  '',
  '登录后你可以',
  '',
  '登录',
  '',
  '[查看全部 13 个回答](https://www.zhihu.com/question/305256736)',
  '',
  '![匿名用户](https://picx.zhimg.com/v2-d41c.jpg?source=2c26e567)',
  '',
  '匿名用户',
  '',
  '现存NLP的Data Augmentation大致有两条思路，一个是加噪，另一个是Back Translation。',
  '',
  'Back Translation的想法很简单。',
  '',
  `阅读全文${Z}`,
  '',
  `${Z}赞同 158${Z}${Z}16 条评论${Z}195 ${Z}20`,
  '',
  `${Z}分享`,
  '',
  '[查看全部 13 个回答](https://www.zhihu.com/question/305256736)',
].join('\n');

const ARTICLE_PLAIN = [
  LOGO,
  '',
  '> 详细的理解请看论文Neural Network and Deep Learning： [Neural networks and deep learning](https://link.zhihu.com/?target=http%3A//neuralnetworksanddeeplearning.com/)',
  '',
  '## 1\\. 前向传播（forward）',
  '',
  '简单理解就是将上一层的输出作为下一层的输入。',
  '',
  '## 2\\. 反向传播（backward）',
  '',
  '实际上， **反向传播仅指用于计算梯度的方法。**',
  '',
  '[深度学习（Deep Learning）](https://www.zhihu.com/topic/19813032)',
  '',
  '[反向传播算法](https://www.zhihu.com/topic/20312114)',
  '',
  `${Z}赞同 313${Z}${Z}9 条评论${Z}548 ${Z}44`,
  '',
  `${Z}分享`,
  '',
  `${Z}申请转载${Z}`,
  '',
  Z,
  '',
  '关于作者',
  '',
  '[![初识CV](https://pica.zhimg.com/v2-1634.jpg?source=172ae18b)](https://www.zhihu.com/people/AI_team-WSF)',
  '',
  '[初识CV](https://www.zhihu.com/people/AI_team-WSF)',
  '',
  '美好年华，扬起理想之帆，踏上新的征程加油！',
  '',
  `${Z}关注他${Z}发私信`,
].join('\n');

const ARTICLE_WITH_COVER = [
  '![](https://zhuanlan.zhihu.com/p/21407711)',
  '',
  LOGO,
  '',
  '![CS231n课程笔记翻译：反向传播笔记](https://picx.zhimg.com/6cfac.jpg?source=172ae18b)',
  '',
  '译者注：本文 [智能单元](https://zhuanlan.zhihu.com/intelligentunit) 首发。',
  '',
  '- [复合表达式](https://zhida.zhihu.com/search?content_id=747009&content_type=Article&q=%E5%A4%8D%E5%90%88&zd_token=abc.def.ghi&zhida_source=entity)，链式法则，反向传播',
  '',
  '**目标**：本节将帮助读者对 **反向传播** 形成直观而专业的理解。',
  '',
  '[机器学习](https://www.zhihu.com/topic/19559450)',
  '',
  `${Z}赞同 2,031${Z}${Z}120 条评论${Z}5,000 ${Z}300`,
  '',
  '关于作者',
  '',
  '[杜客](https://www.zhihu.com/people/du-ke)',
].join('\n');

const QUESTION_PAGE = [
  LOGO,
  '',
  '# 量化策略因子研究怎么样算研究得深入细致？',
  '',
  `想知道业界在因子研究上到什么程度才算细致显示全部 ${Z}`,
  '',
  '关注者',
  '',
  '**1,203**',
  '',
  '[查看全部 27 个回答](https://www.zhihu.com/question/552012526)',
  '',
  '[某答主](https://www.zhihu.com/people/x)',
  '',
  '第一个回答的正文不该被当成问题描述。',
].join('\n');

describe('detectZhihuPageKind / stripZhihuTitleSuffix', () => {
  it('按 URL 判断页面种类', () => {
    expect(detectZhihuPageKind('https://www.zhihu.com/answer/1903044959663284716')).toBe('answer');
    expect(detectZhihuPageKind('https://www.zhihu.com/question/305256736/answer/550873100?utm_source=x')).toBe('answer');
    expect(detectZhihuPageKind('https://zhuanlan.zhihu.com/p/21407711')).toBe('article');
    expect(detectZhihuPageKind('https://www.zhihu.com/question/552012526')).toBe('question');
    expect(detectZhihuPageKind('https://www.zhihu.com/pin/1234567890')).toBe('pin');
    expect(detectZhihuPageKind('https://www.zhihu.com/zvideo/1234567890')).toBe('zvideo');
    expect(detectZhihuPageKind('https://example.com/x')).toBe('unknown');
    expect(detectZhihuPageKind('not a url')).toBe('unknown');
  });

  it('去掉 Firecrawl 标题的「 - 知乎」后缀', () => {
    expect(stripZhihuTitleSuffix('ChatGPT现在还值得开会员吗？ - 知乎')).toBe('ChatGPT现在还值得开会员吗？');
    expect(stripZhihuTitleSuffix('无后缀')).toBe('无后缀');
    expect(stripZhihuTitleSuffix(undefined)).toBe('');
  });
});

describe('cleanZhihuPage · 回答页', () => {
  it('有作者卡：正文从签名与「关注」之后开始，到「编辑于」之前结束；元数据齐全', () => {
    const page = cleanZhihuPage(ANSWER_WITH_AUTHOR, {
      url: 'https://www.zhihu.com/answer/1903044959663284716',
      title: 'ChatGPT现在还值得开会员吗？ - 知乎',
    });
    expect(page.kind).toBe('answer');
    expect(page.confident).toBe(true);
    expect(page.title).toBe('ChatGPT现在还值得开会员吗？');
    expect(page.author).toBe('时光纪');
    expect(page.authorUrl).toBe('https://www.zhihu.com/people/wang-yong-kang-98-91');
    expect(page.questionUrl).toBe('https://www.zhihu.com/question/13521457542');
    expect(page.editedAt).toBe('2025-05-27 22:24');
    expect(page.voteUpCount).toBe(65);
    expect(page.commentCount).toBe(40);
    expect(page.body.startsWith('首先要澄清一个常见误解')).toBe(true);
    expect(page.body.endsWith('容易导致模型输出错乱。')).toBe(true);
    for (const junk of ['登录后你可以', '查看全部', '关注问题', '哥们，别搞', '赞同', 'ZhiHu logo', '编辑于']) {
      expect(page.body).not.toContain(junk);
    }
  });

  it('匿名作者：没有签名与关注行，正文紧跟「匿名用户」，到「阅读全文」之前结束', () => {
    const page = cleanZhihuPage(ANSWER_ANONYMOUS, {
      url: 'https://www.zhihu.com/question/305256736/answer/550873100',
      title: '自然语言处理中有哪些常用的数据增强的方式呢？ - 知乎',
    });
    expect(page.confident).toBe(true);
    expect(page.author).toBe('匿名用户');
    expect(page.authorUrl).toBeNull();
    expect(page.body).toBe(
      '现存NLP的Data Augmentation大致有两条思路，一个是加噪，另一个是Back Translation。\n\nBack Translation的想法很简单。',
    );
    expect(page.voteUpCount).toBe(158);
    expect(page.commentCount).toBe(16);
    expect(page.editedAt).toBeNull();
  });

  it('作者卡带勋章图 + 签名（2026-09-12 实测「话题下的优秀答主」）：整张卡吃掉，正文从第一段开始；没评论时 commentCount 为 null', () => {
    const page = [
      LOGO,
      '',
      '# 能不能详细讲一下，如何通过正则化权重惩罚的方法，来降低模型的过拟合问题？',
      '',
      '关注者',
      '',
      '**1**',
      '',
      '[查看全部 1 个回答](https://www.zhihu.com/question/2073447066982937453)',
      '',
      '[![石溪](https://picx.zhimg.com/v2-3eda.jpg?source=2c26e567)](https://www.zhihu.com/people/zhang-san-5-26-12)',
      '',
      '[石溪](https://www.zhihu.com/people/zhang-san-5-26-12)',
      `[${Z}![](https://pica.zhimg.com/v2-27bf.png?source=32738c0c)](https://www.zhihu.com/question/48509984) ${Z}![](https://pica.zhimg.com/v2-4812.jpg?source=88ceefae)`,
      '',
      '数学话题下的优秀答主',
      '',
      `${Z} 关注`,
      '',
      '**我是石溪，欢迎关注我的知乎账号。**',
      '',
      '## 模型训练目标',
      '',
      '模型训练涉及两个关键的步骤和目标，一个是优化，一个是泛化。',
      '',
      `阅读全文${Z}`,
      '',
      `${Z}赞同 1${Z}${Z}添加评论${Z}1 ${Z}喜欢`,
    ].join('\n');
    const result = cleanZhihuPage(page, { url: 'https://www.zhihu.com/question/2073447066982937453/answer/2073447709726467019' });
    expect(result.confident).toBe(true);
    expect(result.author).toBe('石溪');
    expect(result.body.startsWith('**我是石溪')).toBe(true);
    expect(result.body).not.toContain('优秀答主');
    expect(result.body).not.toContain('pica.zhimg.com');
    expect(result.body.endsWith('一个是泛化。')).toBe(true);
    expect(result.voteUpCount).toBe(1);
    expect(result.commentCount).toBeNull();
  });

  it('作者卡之后紧跟像正文的长句时不多吞（没有「关注」行的匿名 / 旧版式）', () => {
    const page = [
      '# 问题',
      '',
      '[查看全部 2 个回答](https://www.zhihu.com/question/1)',
      '',
      '[某人](https://www.zhihu.com/people/x)',
      '',
      '这是一段很长很长的正文开头，它明显不是签名，因为它带着完整的句子和句号，长度也超过了签名的样子。',
      '',
      '后面还有。',
    ].join('\n');
    const result = cleanZhihuPage(page, { url: 'https://www.zhihu.com/question/1/answer/2' });
    expect(result.body.startsWith('这是一段很长很长的正文开头')).toBe(true);
    expect(result.author).toBe('某人');
  });

  it('找不到结构标记时走保守清洗：去 logo、标 confident=false、不吞正文', () => {
    const raw = [LOGO, '', '# 某个问题', '', '一段没有任何知乎页面骨架的文字。'].join('\n');
    const page = cleanZhihuPage(raw, { url: 'https://www.zhihu.com/answer/1' });
    expect(page.confident).toBe(false);
    expect(page.title).toBe('某个问题');
    expect(page.body).not.toContain('ZhiHu logo');
    expect(page.body).toContain('一段没有任何知乎页面骨架的文字。');
  });
});

describe('cleanZhihuPage · 专栏页', () => {
  it('去 logo，正文到话题标签与赞同栏之前结束；外链解包；作者取自「关于作者」', () => {
    const page = cleanZhihuPage(ARTICLE_PLAIN, {
      url: 'https://zhuanlan.zhihu.com/p/447113449',
      title: '【深度学习篇】：前向传播（forward）和反向传播（backward） - 知乎',
    });
    expect(page.kind).toBe('article');
    expect(page.confident).toBe(true);
    expect(page.title).toBe('【深度学习篇】：前向传播（forward）和反向传播（backward）');
    expect(page.body.startsWith('> 详细的理解请看论文')).toBe(true);
    expect(page.body).toContain('(http://neuralnetworksanddeeplearning.com/)');
    expect(page.body).not.toContain('link.zhihu.com');
    expect(page.body.endsWith('**反向传播仅指用于计算梯度的方法。**')).toBe(true);
    expect(page.body).not.toContain('topic/');
    expect(page.body).not.toContain('关于作者');
    expect(page.author).toBe('初识CV');
    expect(page.authorUrl).toBe('https://www.zhihu.com/people/AI_team-WSF');
    expect(page.voteUpCount).toBe(313);
    expect(page.commentCount).toBe(9);
  });

  it('封面图（alt = 标题）与专栏自链接图被去掉；直答实体链接只留文字；千分位数字可解析', () => {
    const page = cleanZhihuPage(ARTICLE_WITH_COVER, {
      url: 'https://zhuanlan.zhihu.com/p/21407711',
      title: 'CS231n课程笔记翻译：反向传播笔记 - 知乎',
    });
    expect(page.body.startsWith('译者注：本文')).toBe(true);
    expect(page.body).toContain('- 复合表达式，链式法则，反向传播');
    expect(page.body).not.toContain('zhida.zhihu.com');
    expect(page.body).not.toContain('picx.zhimg.com/6cfac');
    expect(page.body.endsWith('形成直观而专业的理解。')).toBe(true);
    expect(page.voteUpCount).toBe(2031);
    expect(page.commentCount).toBe(120);
    expect(page.author).toBe('杜客');
  });
});

describe('cleanZhihuPage · 问题页与其他', () => {
  it('问题页只留标题与描述，不把第一个回答当成问题描述', () => {
    const page = cleanZhihuPage(QUESTION_PAGE, { url: 'https://www.zhihu.com/question/552012526' });
    expect(page.kind).toBe('question');
    expect(page.confident).toBe(true);
    expect(page.title).toBe('量化策略因子研究怎么样算研究得深入细致？');
    expect(page.body).toBe('想知道业界在因子研究上到什么程度才算细致');
  });

  it('未知种类只做通用清洗', () => {
    const page = cleanZhihuPage([LOGO, '', '正文'].join('\n'), { url: 'https://www.zhihu.com/pin/1' });
    expect(page.kind).toBe('pin');
    expect(page.confident).toBe(false);
    expect(page.body).toBe('正文');
  });
});
