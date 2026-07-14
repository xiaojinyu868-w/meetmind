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
 *   - 首选词：收藏 / 整理 / 情报 / 应用 / 同学
 *
 * 使用约定：
 *   - 所有出现在用户界面（非日志/埋点）的字符串必须 import { COPY }
 *   - 新增字符串时先找有没有相近语义的键可以复用，避免二次碎片化
 *   - 复杂占位符用函数而非模板字符串，便于测试
 */

export const COPY = {
  identity: {
    name: '同学',
    tagline: '真正懂你在学什么的 AI 同学',
    subtagline: '理解你的课堂、资料和目标，陪你学懂当下，也发现下一步值得看的内容。',
  },

  cta: {
    demo: '看一节示例课',
    record: '开始一节课',
    ask: '问同学',
  },

  navigation: {
    classroom: '课堂',
    collection: '收集',
    search: '问 MeetMind',
    allCollections: '全部收集',
  },

  globalAsk: {
    title: 'Ask MeetMind',
    subtitle: '带着你的课堂、资料和长期记忆继续问。',
    quickMode: '直接问',
    deepMode: '深度学习',
    memoryAction: '我的上下文',
    newConversation: '新对话',
    historyRestored: '已接回上次对话',
    historyLoading: '正在接回上次对话…',
    freshConversation: '新的对话',
    emptyTitle: '你不需要先找到某一节课。',
    emptyBody: '直接问。MeetMind 会判断该接哪段课堂、哪份资料，以及你已经确认过的个人上下文。',
    composerQuick: '问任何正在学、正在想的事',
    composerDeep: '说说这次想真正学会什么',
    send: '发送',
    stop: '停止',
    preparingIntent: '正在接回上下文，判断这次怎么学…',
    intentEyebrow: 'MeetMind 的理解',
    intentQuestionTitle: (count: number): string => `开始前，再对齐 ${count} 件事`,
    intentSingle: '选一个最接近的',
    intentMultiple: '可以多选',
    intentCancel: '不用规划，直接回答',
    intentResolve: '选好了，开始',
    intentStart: '开始学习',
    intentFirstStep: '先从这里开始',
    approachUnderstand: '理解清楚',
    approachPractice: '练到会用',
    approachSynthesize: '串成体系',
    approachCreate: '做出结果',
    contextPersonal: '用长期上下文',
    contextCurrent: '用当前内容',
    contextMixed: '两边一起看',
    progressEyebrow: '这次真正留下的',
    progressHint: '只把你确认的内容放进长期记忆。',
    progressDismiss: '这次不记',
    progressSave: '记住确认的',
    progressSaved: '已放进长期记忆',
    memoryTitle: 'MeetMind 记得什么',
    memorySubtitle: '只有你确认过的内容，才会用于以后的回答。你可以随时暂停或删除。',
    memoryBack: '回到 Ask',
    memoryAdd: '添加一条',
    memoryInput: '例如：我更喜欢先看具体例子，再看公式',
    memoryEmpty: '还没有长期记忆。深度学习后的进展会先让你确认，不会自动写入。',
    memoryActive: '正在使用',
    memoryPaused: '已暂停',
    memoryPause: '暂停使用',
    memoryResume: '重新使用',
    memoryDelete: '删除',
    recentTitle: '最近学习现场',
    recentEmpty: '最近还没有可恢复的学习活动。',
    threadTitle: '上次还在继续',
    threadResume: '接着学',
    threadComplete: '这条学完了',
    preparingError: '这次没理解准，先直接回答你。',
    refiningError: '先按目前的理解开始，之后还可以随时调整。',
    responseError: '刚才没有接上，再发一次就好。',
    sourceContext: '刚刚在看的内容',
    sourceCurrentLesson: '当前课堂转录',
    openSource: '打开原内容',
    close: '关闭 Ask MeetMind',
    assistantLabel: 'MeetMind 回答',
    userLabel: '你的问题',
    thinking: '正在把上下文接起来…',
    recentConversation: 'Ask MeetMind 对话',
    recentDeepSession: '深度学习会话',
    recoveryEyebrow: '接回学习现场',
    recoveryTitle: '不用重新开始',
    recoveryBody: 'MeetMind 留住了上次的脉络，回来可以直接接着走。',
    recoveryResume: '接着上次学',
    recoveryRecent: '最近停在这里',
    appActivity: (name: string) => `完成了「${name}」`,
    appResultSummary: (count: number) => `生成了 ${count} 条可继续使用的学习内容`,
  },

  collection: {
    askClassmate: '问同学',
    deleteMemoryWarning: '删除后，这条内容不会再进入同学的回答、后续情报和个人上下文。',
    permanentDeleteWarning: '彻底删除后，这条内容不会再进入同学的回答、后续情报和个人上下文。',
  },

  login: {
    subtitle: '真正懂你在学什么的 AI 同学',
    guestCta: '先试听一节课',
  },

  loading: {
    preparing: '正在准备课堂空间',
    restoring: '正在接回你的学习现场',
    entering: '马上进入',
    fallback: '正在准备学习空间',
  },

  hero: {
    eyebrow: 'MEETMIND · AI 同学',
    title: '陪你听懂每一节课。',
    subtitle: '老师讲到哪，我就听到哪。卡住时当场问；下课后，每个答案都能回到原话。',
    sideHint: '先听 90 秒示例课',
    evidencePromise: '回答有依据，点击时间就能回到老师原话。',
    proofStatus: '正在一起听',
    proofQuote: 'The exact timing is still up in the air.',
    proofTime: '00:31',
    proofLabel: '同学听懂了',
    proofAnswer: '这里不是“在空中”，而是“具体时间还没有决定”。',
    proofAction: '进入这节示例课',
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

  classroomHome: {
    title: '继续你的学习现场',
    subtitle: '从最近一节课接着学，或把新的课堂和资料交给 MeetMind。',
    contextStatus: '个人上下文已连接',
    capabilityLabel: 'MeetMind 会把内容继续变成什么',
    capabilityListenTitle: '听懂现场',
    capabilityListenBody: '实时转录 · 课堂脉络 · 随时追问',
    capabilityConnectTitle: '连起资料',
    capabilityConnectBody: '文档与课堂一起理解',
    capabilityPracticeTitle: '练成结果',
    capabilityPracticeBody: '闪卡 · 测验 · 思维导图',
    today: '今天',
    yesterday: '昨天',
    active: '正在上课',
    launchpadTitle: '补充学习上下文',
    launchpadHint: '材料和问题会自动接到相关课堂',
    actionRecordTitle: '开始一节课',
    actionRecordBody: '录线下课、网课或讨论，边听边形成课堂脉络。',
    actionRecordLabel: '选择声音开始',
    actionMaterialTitle: '放入学习材料',
    actionMaterialBody: '文档、网页、音视频会自动接到相关课堂和目标。',
    actionMaterialLabel: '选择文件或链接',
    actionSearchTitle: '找到并继续问',
    actionSearchBody: '搜索过去的课堂和资料，带着真实原文继续理解。',
    actionSearchLabel: '搜索我的内容',
  },

  sourceType: {
    audio: '录音',
    video: '视频',
    image: '图片',
    document: '文章',
    text: '笔记',
  },

  sourceOrigin: {
    quickNote: '速记',
    wechat: '从微信发来',
    wechatArticle: '微信公众号',
    bilibili: '哔哩哔哩',
    youtube: 'YouTube',
  },

  sourceState: {
    extracting: '正在读取正文',
    complete: '正文完整',
    partial: '仅取得摘要',
    linkOnly: '已保存原链接',
    failed: '读取失败，原链接已保留',
  },

  sourceReader: {
    saved: '已收下',
    untitled: '未命名内容',
    openOriginal: '查看原文',
    noBody: '正文暂时没有读取出来，原始内容仍然保留。',
  },

  listening: {
    idle: '我在。',
    hearing: '我在听。',
  },

  classroomFlow: {
    eyebrow: '课堂脉络',
    listeningTitle: '先跟上老师正在讲的。',
    listeningBody: '我会等内容足够清楚，再告诉你现在讲到哪里。不会把开场和闲聊硬整理成知识点。',
    understanding: '我正在理解刚才这段，新的判断会自然接到这里。',
    emptyPromiseTitle: '这里不会提前写课后总结',
    emptyPromiseBody: '课堂进行时只保留方向、推进和真正值得回来的内容；思维导图、闪卡和测验会留到课后。',
    refreshing: '正在接住刚才这段',
    now: '正在讲',
    recent: '刚才怎么走到这里',
    recentHint: '只留与当前有关的推进',
    keep: '留到课后',
    mobileFlow: '脉络',
    mobileTranscript: '原话',
    kindDefinition: '定义',
    kindFormula: '公式',
    kindExample: '例子',
    kindQuestion: '待弄清',
    kindContrast: '对比',
    kindConclusion: '结论',
    kindOther: '值得回来',
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
    errorTitle: '同学刚刚没接上',
    errorBody: '只影响这次对话，你的课堂和复习内容都还在。',
    errorRetry: '重新连接',
  },

  recording: {
    sourcePrompt: '这节课的声音从哪里来？',
    sourceMic: '麦克风',
    sourceSystem: '电脑声音',
    sourceMixed: '两路都录',
    sourceMicHint: '线下课',
    sourceSystemShortHint: '在线课程',
    sourceMixedHint: '网课＋自己提问',
    sourceSystemHint: '开始后，在系统窗口勾选“分享音频”。',
    multiSpeaker: '多人课堂',
    multiSpeakerEnabled: '多人课堂 · 已区分说话人',
    activeStatus: (source: string): string => `正在听 · ${source} · 点开看实时文字`,
    /** mixed 模式系统音频采集失败、降级为纯麦克风时提示 */
    downgradeFromMixed: '电脑声音没录到，只用麦克风在录',
  },

  mobileComposer: {
    placeholder: '发一句想法，贴个链接…',
    attach: '添加文件',
    send: '发送',
    startDictation: '开始语音听写',
    stopDictation: '停止语音听写',
    connecting: '正在连接麦克风…',
    listening: '我在听，说完再点一下',
  },

  mobileHome: {
    commandCenterLabel: '学习控制台',
    eyebrow: '今天，从这里开始',
    contextStatus: (count: number): string => count > 0
      ? `已接上 ${count} 段上下文`
      : '还没有上下文',
    title: '今天，开始真正学会。',
    body: '听一节课、读一份资料，或直接说出你想弄懂的事。',
    record: '录一节课',
    recordHint: '实时听懂',
    addMaterial: '放入资料',
    photo: '拍板书',
    search: 'Ask MeetMind',
    livePromise: '课中看见脉络',
    afterClassPromise: '课后继续练习',
    capabilityLabel: '从输入到结果，一条学习链路',
    capabilityFlow: '课堂脉络',
    capabilityQa: '资料问答',
    capabilityFlashcards: '闪卡',
    capabilityQuiz: '测验',
    capabilityMindmap: '思维导图',
    capabilityFeed: '今日发现',
    intelligenceLabel: '今日发现',
    intelligenceFallback: '从最近的学习里，找到一条值得继续的线索',
    intelligenceAction: '查看',
    recentLabel: '最近上下文',
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
    matrix: {
      eyebrow: '基于这节课',
      title: '接下来怎么学',
      subtitle: '先选一个当下最需要的动作。同学会在后台做好，你可以留在这里继续看。',
      recommendedTitle: '现在最适合',
      recommendedHint: '根据这节课的内容和你留下的标记排序，不替你做决定。',
      allTitle: '其他学习方式',
      contextBasis: (segments: number, anchors: number, difficulties: number): string => {
        const parts = [`${segments} 段课堂内容`];
        if (anchors > 0) parts.push(`${anchors} 处标记`);
        if (difficulties > 0) parts.push(`${difficulties} 个难点`);
        return parts.join(' · ');
      },
      summary: (total: number, done: number, running: number, failed: number): string => (
        `${total} 种学习方式 · 已做好 ${done}${running > 0 ? ` · 正在做 ${running}` : ''}${failed > 0 ? ` · 待处理 ${failed}` : ''}`
      ),
      recommendedForConfusion: (count: number): string => `你留下了 ${count} 处标记，先检验能不能讲清楚。`,
      recommendedForDifficulty: (count: number): string => `这节课有 ${count} 个难点，先把关键概念练到能回忆。`,
      recommendedForStructure: '这节课内容较长，先看清主干和分支。',
      recommendedDefault: '先把这节课压成一页，最快建立整体印象。',
      start: '先做一版',
      open: '继续使用',
      openImage: '查看图片',
      progress: '查看进度',
      retry: '再试一次',
      remake: '再做一版',
      ready: '做好了',
      waiting: '待开始',
      failed: '没做好',
      running: '正在做',
      workingOn: (action: string): string => `${action}，可以先返回继续看这节课`,
      failedWithoutLoss: '这次没做好，原课堂内容没有受到影响。',
      recommended: '适合现在',
      taskTray: '学习内容',
      taskPanelTitle: '正在准备与已经做好的内容',
      taskRunning: (count: number): string => `正在做 ${count}`,
      taskDone: (count: number): string => `已做好 ${count}`,
      taskNeedsAttention: (count: number): string => `待处理 ${count}`,
      collapse: '收起',
      cancel: '取消',
      mobileTitle: '这节课，接下来怎么学',
      mobileSubtitle: '选一种学习动作，同学会直接基于这节课开始。',
      backToMatrix: '所有学习方式',
      workspaceSubtitle: (action: string, bestFor: string): string => `${action} · ${bestFor}`,
      catalogMeta: {
        cheatsheet: { action: '带走重点', bestFor: '想快速建立全貌，或考前最后过一遍', time: '阅读约 1 分钟' },
        quiz: { action: '检验理解', bestFor: '想知道自己是真懂，还是只是看懂了', time: '作答约 5–8 分钟' },
        flashcards: { action: '记住核心', bestFor: '概念、术语和公式需要反复回忆', time: '练习约 5 分钟' },
        mindmap: { action: '看清结构', bestFor: '内容较多，想分清主干、关系和层次', time: '浏览约 2 分钟' },
        'audio-overview': { action: '换种方式再听', bestFor: '通勤或走路时，想用对话重新理解', time: '收听约 6–10 分钟' },
        infographic: { action: '做成一张图', bestFor: '想分享、展示，或用视觉方式记住', time: '查看约 2 分钟' },
      },
    },
  },

  /**
   * 信息流（M15：替换笔记总结）
   * 基于个人上下文的 LLM 驱动信息流——同一节课不同人看到不同的内容。
   */
  feed: {
    /** tab 标签（单课复习态遗留，跨课程信息流改走侧栏抽屉） */
    tabLabel: '信息流',
    /** 侧栏「收集 → 相关信息」子导航文案 */
    relatedInfoLabel: '今日情报',
    /** 抽屉标题——替换原「笔记总结」 */
    drawerTitle: '今日情报',
    drawerSubtitle: '一半照见你正在关心的事，一半把真实的书、论文和新观点带进来。',
    todayBrief: '看见自己',
    internalDiscoveries: '看见自己',
    internalDiscoveriesHint: '从你的收藏、笔记和目标里，找到正在形成的方向。',
    externalDiscoveries: '向外看看',
    externalDiscoveriesHint: '真实来源，可直接打开；既有顺着目标深入，也有不同视角。',
    useful: '有用',
    notRelevant: '不相关',
    feedbackUseful: '已记下，以后多找这类内容',
    feedbackDismissed: '已减少这类推荐',
    refresh: '更新',
    addContext: '补一条线索',
    refreshing: '正在寻找与你有关的新内容',
    notGeneratedYet: '等待第一次发现',
    updatedJustNow: '刚刚更新',
    updatedMinutesAgo: (minutes: number): string => `${minutes} 分钟前更新`,
    updatedAt: (time: string): string => `今日 ${time} 更新`,
    refreshFailedKeepingPrevious: '这次没更新成，先保留上一版。',
    contextBasis: (captures: number, goals: number): string => (
      goals > 0 ? `基于 ${captures} 条收藏 · ${goals} 个当前目标` : `基于 ${captures} 条收藏`
    ),
    sourceCount: (count: number): string => `来自 ${count} 条收藏`,
    goalAlignment: (goal: string): string => `对齐目标「${goal}」`,
    /** 生成中（跨课程） */
    loading: '同学正在查找真实的书、论文和外部资料…',
    /** 空状态（没有收集内容） */
    empty: '还没有收集内容。先去收一节课或一篇文章，同学会自动整理方向。',
    /** 跨课程空态 */
    crossCourseEmptyTitle: '先留下几条你真正关心的内容。',
    crossCourseEmptyBody: '这里会先看见你正在形成的方向，再从外部找到真实可读的书、论文和不同观点。',
    /** 生成失败 */
    error: '没整理出来，再试一次',
    /** 重试按钮 */
    retry: '重新整理',
    /** 条目类型标签 */
    typeSummary: '你最近在意的',
    typeProbeNear: '同主题',
    typeProbeLateral: '相关方向',
    typeProbeBridge: '跨界',
    typeConfusionLink: '你标记的困惑',
    typeWebRecommend: '外部发现',
    typeBiliRecommend: '同学帮你找的',
    typeEcho: '同桌沉淀',
    /** echo 卡分享按钮 */
    shareEcho: '分享',
    /** 动作按钮 */
    actionJumpTimestamp: '跳回去听',
    actionMakeFlashcard: '做成闪卡',
    actionAskTutor: '让同学解释',
    actionReviewPrev: '看上节课',
    actionOpenCapture: '看这条收集',
    actionOpenExternal: '打开原文',
    actionOpenBilibili: '在 B站看',
    /** whyForYou 前缀 */
    whyPrefix: '为什么与你有关',
    differentPerspectivePrefix: '为什么值得换个角度',
    kindWeb: '文章',
    kindPaper: '论文',
    kindBook: '书籍',
    kindReport: '研究报告',
    perspectiveDeepen: '顺着目标深入',
    perspectiveAdjacent: '相邻视角',
    perspectiveCounterpoint: '不同视角',
    unknownAuthor: '作者未标注',
  },

  /**
   * 「聊聊你想要的」—— 用户和 AI 教练对话梳理目标的入口。
   * 是 v3.0 信息流哲学落地的第一个产品入口（替代旧硬编码 LearnerOnboarding 表单）。
   * 设置页常驻 + 首次进入 app 自动弹出。
   */
  intent: {
    /** 主标题（设置页 caption / 首次进入 header） */
    title: '聊聊你想要的',
    /** 副标 */
    subtitle: '不用写好——说就行',
    /** 设置页 description */
    description: '和教练聊一聊，把脑子里的事一起捋清楚——也可以打电话语音聊',
    /** 设置页：还没聊过的提示 */
    emptyHint: '还没聊过。你最近想做的事 / 想去的方向 / 还在纠结的选择，都可以慢慢说。',
    /** 设置页：开始按钮 */
    actionStart: '和教练聊一聊',
    /** 设置页：再聊一次按钮 */
    actionResume: '和教练再聊一会',
    /** IntentDialog header：右上角切换通话 */
    switchToCall: '打电话聊',
    /** 通话视图：切回文字 */
    switchToText: '文字',
    /** 通话视图：标题 */
    callTitle: '在听你说',
    /** 通话视图：底部状态行（基于 useOmniRealtimeCall.status） */
    callStatusListening: '我在听你说…',
    callStatusThinking: '我想一下…',
    callStatusResponding: '我在说…',
    callStatusMuted: '已静音 · 我还在',
    callStatusConnected: '直接说就好',
    callStatusConnecting: '正在接通…',
    callStatusAuthorizing: '点下面按钮开始',
    callStatusError: '没接通，点重连',
    callStatusPreparing: '准备中…',
    /** 输入条：占位符 */
    inputPlaceholder: '说说你最近想做的事',
    inputPlaceholderBusy: '同学正在听…',
    /** 首次进入：跳过文案 */
    firstTimeSkip: '先不聊，下次再说',
    /** 开场提示——已有 N 个目标时 */
    greetingWithGoals: (count: number): string =>
      `欢迎回来。你之前留下了 ${count} 件想做的事——是想聊聊新的，还是更新一下旧的？`,
    /** 开场提示——首次 */
    greetingFirstTime:
      '不急。你现在脑子里有什么想做、想去、想搞清楚的事？哪怕还没完全想明白，也可以慢慢说。',
    /** 卡片：标题（"我听到的是"） */
    summaryEyebrow: '我听到的是',
    /** 卡片：先放放 */
    summaryDismiss: '先放放',
    /** 卡片：就是这样（保存） */
    summaryAccept: '就是这样',
    /** 卡片：保存中 */
    summarySaving: '记着…',
    /** 卡片：已保存 */
    summarySaved: '已记下了',
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

  mobileJourney: {
    processingEyebrow: '正在整理',
    processingTitleLead: '把这节课',
    processingTitleAccent: '听懂',
    waitingTranscript: '等待转录完成…',
    readingTranscript: '正在读转录原文…',
    buildingNotes: '正在生成分段笔记…',
    processingDone: '整理完成',
    noSpeechStatus: '没有听到可整理的内容',
    processingEstimate: '约 1 分钟',
    waiting: '等待中…',
    done: '完成',
    leaveWhileProcessing: '先回首页',
    openNotes: '笔记整理好了，去看看 →',
    understood: '已理解',
    originalPreserved: '原声已保留',
    restoringTranscript: '正在恢复这节课的转录内容…',
    noSpeechTitle: '这段录音里没有识别到语音',
    noSpeechBody: '可能是录音太短或声音太小。原声已保留，可以返回首页稍后再看。',
    backHome: '返回首页',
  },

  help: {
    classroomRecordingAnswer: '录课中 MeetMind 会实时展示：\n\n- 实时原话：老师说的内容会跟着出现\n- 课堂脉络：告诉你现在讲到哪里、刚才如何推进、什么值得课后回来\n- 同学：有问题随时可以问，它会带着刚才的课堂上下文回答\n\n这些都会自动完成。思维导图、闪卡和测验会在课后应用中生成，不会在上课时抢走注意力。',
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
      claimRedirecting: '正在打开你的工作台…',
      claimAlready: '你之前已经领过这一份',
      /** 也分享给别人 */
      reshareAction: '复制链接',
      reshareFailed: '复制失败，请手动复制地址栏',
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
      doneCopy: '复制链接',
      doneCopied: '链接已复制',
      doneLinkCreated: '分享链接已生成',
      doneCopyFailed: '复制失败，请手动复制链接',
      doneCopying: '复制中...',
      fallbackTitle: '分享链接已生成',
      fallbackBody: '浏览器没有允许自动复制，可以直接复制下面的链接。',
      loginRequired: '先登录再分享',
      createFailed: '创建分享失败',
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
