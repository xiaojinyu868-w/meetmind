/**
 * copy.ts — 用户面可见文案的单一真相源。
 *
 * 为什么要有这个文件：
 *   过去散在 10+ 个组件里的字符串里夹带了"回声卡 / 酿 / 预知气泡 / 工坊"
 *   这类内部术语，被用户看到时跳戏。把所有用户可见的文案汇总在这里，
 *   才能以"顶级 UI/UX 设计师"的视角一次性审过口吻、去掉行业黑话。
 *
 * 口吻原则（M8-agent-native）：
 *   - 角色：一个叫"同学"的 AI 同桌。像朋友，不像老师，不像客服
 *   - 说话方式：安静、直接、克制
 *   - 禁用词：回声卡 / 酿 / 预知气泡 / 工坊 / 研判 / 引擎 / 引导
 *   - 首选词：笔记总结 / 整理 / 预感 / 应用 / 同学
 *
 * 使用约定：
 *   - 所有出现在用户界面（非日志/埋点）的字符串必须 import { COPY }
 *   - 新增字符串时先找有没有相近语义的键可以复用，避免二次碎片化
 *   - 复杂占位符用函数而非模板字符串，便于测试
 */

export const COPY = {
  identity: {
    name: '同学',
    tagline: '今天这节课。',
    subtagline: '',
  },

  cta: {
    demo: '看一节示例课',
    record: '开始录课',
    ask: '问同学',
  },

  login: {
    subtitle: '进入你的课堂学习现场',
    guestCta: '先试听一节课',
  },

  loading: {
    preparing: '正在准备课堂空间',
    restoring: '正在接回你的学习现场',
    entering: '马上进入',
    fallback: '正在准备学习空间',
  },

  hero: {
    /** 主操作下面的次级链接，邀请用户先看示例 —— 用“想先看看”而不是“demo”。 */
    sideHint: '想先看看？',
  },

  lesson: {
    summaryReady: '笔记总结',
    keyPoints: '重点',
    reviewed: '已复习',
    materials: (count: number): string => `${count} 份材料`,
    actionReady: '继续复习',
    actionReviewed: '再看一遍',
    actionProcessing: '整理中',
    actionFailed: '原声已保留',
    actionUpcoming: '准备上课',
  },

  listening: {
    idle: '我在。',
    hearing: '我在听。',
  },

  stages: {
    /** v3.0：放弃假分阶段叙事，改为 Octo Buddy 听课的诚实表达
     *  app loading 文案根据 appName 动态拼，用 listening 系列 */
    reading: '正在读你的课堂',
    selecting: '正在挑核心',
    composing: '正在排版',
    slow: '稍等一下——内容多的时候我也要再想想',
    /** v3.0 新版 loading 文案 */
    listenStart: (appName: string): string => `在听这节课，给你${appName}`,
    listenSlow: '内容有点多，我多听一会儿',
    listenVerySlow: '还在听——再给我一点时间',
  },

  stop: {
    heard: '这节课我听完了。',
    /**
     * 停止后的总结一句话。
     * 例："共 47 句，标了 2 处你标的困惑。"
     */
    summary: (sentences: number, confusions: number): string => {
      if (sentences <= 0) return '这次只录到很少内容。';
      const base = `共 ${sentences} 句`;
      if (confusions > 0) return `${base}，标了 ${confusions} 处你标的困惑。`;
      return `${base}。`;
    },
    suggestCheatsheet: '要不要我整一张速查表？',
    actionMakeCheatsheet: '整速查表',
    actionViewTranscript: '看文字',
  },

  octoBuddy: {
    idle: '同学在这',
    listening: '陪你听课',
    thinking: '我想一下',
    happy: '接住了',
    surprised: '哎？',
    love: '我在',
    angry: '别一直戳我',
    sleeping: '待命中',
    openHint: '点开一起听',
    openPanel: '打开同学面板',
    dragHint: '单击逗我 · 双击打开同学 · 可拖动',
    hoverLine: '我看到你啦',
    patHappy: '嘿嘿，我在',
    patLove: '今天也一起学',
    patSurprised: '哎？轻一点',
    patAngry: '别一直戳我',
    wakeLine: '醒啦醒啦',
  },

  companion: {
    placeholderIdle: '问问同学…',
    placeholderListening: '老师刚说的那个啥意思？',
    shortcutHint: '有问题？⌘K 问同学',
    newCourseGreet: '我在这里。等你录第一节课，我就开始陪你。',
    emptyListeningPrimary: '我在听，有问题随时问我。',
    emptyListeningSecondary: '我会把刚才那段记住，你不用急着整理。',
    emptyIdlePrimary: '把第一节课录下来，我们就认识了。',
    actionPrompt: '也可以让我直接整理',
    contentPrompt: '已经有内容？试试',
    foresightCount: (count: number): string => `${count} 个预感`,
    foresightDismiss: '划掉',
    foresightAccept: '就这个 · 问下去',
  },

  recording: {
    sourceMic: '麦克风',
    sourceSystem: '电脑声音',
    sourceMixed: '两路都录',
    activeStatus: (source: string): string => `正在听 · ${source} · 点开看实时文字`,
  },

  echoShare: {
    title: '分享这条笔记',
    open: '分享',
    generating: '正在做图片…',
    error: '图片没做出来，再试一次',
    close: '关闭',
    imageAlt: '课堂笔记分享图',
    saveImage: '保存图片',
    nativeShare: '分享给同学',
    sharing: '分享中…',
    copyText: '复制文案',
    saved: '图片已保存',
    copied: '文案已复制',
    copyFailed: '没复制上，请手动保存图片',
    saveFallback: '没保存上，请长按图片保存',
    hint: '也可以长按图片保存',
  },

  flashcardsShare: {
    title: 'MeetMind 试听课闪卡',
    open: '分享试听成果',
    sharing: '分享中…',
    copied: '成果文案已复制',
    failed: '没分享出去，请手动复制',
    summaryTitle: '这节试听课已经变成闪卡',
    summaryBody: (count: number): string => `MeetMind 已经把它整理成 ${count} 张可练习的闪卡。`,
  },

  apps: {
    inlineSource: '已放进对话',
  },

  studyReport: {
    label: '学习报告',
    defaultTitle: '这节课的学习报告',
    emptyLetter: '这节课的结构还在整理中。',
    focusTitle: '先抓住这一层',
    structureTitle: '课堂知识点',
    conversationTitle: '可以这样聊',
    nextTitle: '下一步',
    confusionTitle: '困惑点观察',
    emptyTopics: '这节课的结构还在整理中。',
    topicCount: (count: number): string => `${count} 个知识点`,
    remainingTopics: (count: number): string => `另外 ${count} 个`,
  },

  realtime: {
    defaultTitle: '语音同桌',
    defaultContext: '整节课',
    disabled: '先收一条课堂内容',
    reconnect: '没接通，点重连',
    connecting: '正在接通…',
    authorizing: '点下面按钮开始',
    muted: '已静音 · 我还在',
    listening: '我在听你说…',
    thinking: '我想一下…',
    responding: '我在说…',
    connected: '已接通 · 直接说',
    preparing: '准备中…',
    transcriptTitle: '本轮对话文字',
    assistantLabel: '同学',
    userLabel: '你',
    emptyTranscript: '还没有对话内容',
    showText: '查看文字',
    reconnectAction: '重连',
    collapse: '收起',
    dialing: '接通中',
    start: '开始',
    unmute: '开麦',
    mute: '静音',
    endCall: '结束通话',
  },

  /**
   * v3.0 SharedAgent —— 分享 Agent 的落地页 / 分享卡 / 创建对话框文案
   * 见 roadmap/v3.0-virality-agent.md。
   */
  share: {
    landing: {
      /** 落地页右下角极淡的访问计数 */
      viewCount: (count: number): string => `已被打开 ${count} 次`,
      /** 没登录访问者点"领取到我的工作台"时的引导 */
      claimNeedsLogin: '领取需要先登录，登录后这份内容就在你的工作台里了',
      claimGo: '去登录',
      /** 已登录领取按钮 */
      claimAction: '领取到我的工作台',
      claiming: '正在领取…',
      claimDone: '已领取，去工作台看看',
      claimAlready: '你之前已经领过这一份',
      /** 也分享给别人 */
      reshareAction: '也分享给别人',
      /** 分享态对话输入占位符 */
      chatPlaceholder: '问问这节课…',
      /** 已撤销 / 已过期 */
      notFoundTitle: '这条分享暂时不可用',
      notFoundBody: '可能已被原作者撤回，或者链接打错了。',
      /** 头部副标题：基于分享者昵称 */
      sharedBy: (nickname: string): string => `${nickname} 听完了这节课，留了一份给你`,
      /** 没有昵称兜底 */
      sharedByAnon: '一个同学听完了这节课，留了一份给你',
      /** 转录摘要标题 */
      digestTitle: '这节课讲了什么',
      digestEmpty: '没附转录摘要，可以直接问同学这节课的事。',
      /** 产物预览块标题（按 artifactKind 切换） */
      artifactTitle: (kind: string): string => {
        const map: Record<string, string> = {
          cheatsheet: '考前速查表',
          mindmap: '思维导图',
          quiz: '课堂测验',
          flashcards: '课堂闪卡',
          infographic: '课堂信息图',
          'audio-overview': '课堂播客',
          notes: '同学版笔记',
          'chat-only': '可以直接聊',
        };
        return map[kind] ?? '一份分享';
      },
    },
    creator: {
      /** 录音结束后 Octo Buddy 弹出的标题 */
      title: '今天这节课的结晶',
      subtitle: '挑一个递给同学，也可以丢进班级群',
      /** 选哪种产物（场景层只显示这一组） */
      pickKind: '想送什么过去？',
      pickHint: '挑一个就好。同学会基于这节课在背后陪你回答',
      /** 创建按钮 */
      submit: '生成分享',
      submitting: '正在生成…',
      doneTitle: '已经做好了',
      doneCopy: '复制链接',
      doneCopied: '链接已复制',
      doneShare: '分享给同学',
      doneViewLanding: '看看对方会看到什么',
      /** 仪式入口（应用矩阵 / 录课结束页都会用到的「递结晶」模块） */
      crystal: {
        eyebrow: '今天这节课',
        title: '把这节课递给同学',
        subtitle: '挑一个产物，做成一份能对话的分享',
        cta: '递给同学',
        ctaPreparing: '正在准备…',
        cardReady: '已整好，递给同学',
        cardEmpty: '还没整 · 先做一版',
        cardGenerating: '生成中…',
        emptyHint: '做完一个应用，这里就会出现',
        privacyNote: '只带这节课的内容和你挑的这一份，不会带你的私人对话或答题数据',
      },
    },
  },

  /**
   * "被禁用"的词表——供测试脚本 grep 校验，确保面向用户的字符串不退化。
   */
  bannedWords: ['回声卡', '预知气泡', '工坊', '研判', '引擎'] as const,
};

export type Copy = typeof COPY;
