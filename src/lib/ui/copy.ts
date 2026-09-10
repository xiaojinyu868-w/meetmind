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
 *   - 所有出现在用户界面（非日志/埋点）的字符串必须来自本目录：核心走 import { COPY }；/app 首屏用不到的域按体积拆在同目录
 *     copy-*.ts（landing / apps / global-ask / intent / settings / share / fenshen，2026-09-09），口吻规则相同，改文案先看所属域文件
 *   - 新增字符串时先找有没有相近语义的键可以复用，避免二次碎片化
 *   - 复杂占位符用函数而非模板字符串，便于测试
 */

export const COPY = {
  identity: {
    productName: 'MeetMind',
    name: '同学',
    tagline: '真正懂你在学什么的 AI 同学',
    subtagline: '理解你的课堂、资料和目标，陪你学懂当下，也发现下一步值得看的内容。',
  },

  // landing / technology 营销页文案在 ./copy-landing.ts（LANDING_COPY）——按体积拆出，口吻规则同此文件


  cta: {
    demo: '看一节示例课',
    record: '开始一节课',
    ask: '问同学',
  },

  navigation: {
    back: '返回',
    classroom: '课堂',
    collection: '收集',
    search: '问同学',
    allCollections: '全部收集',
    /** 侧栏的两段内容（2026-09-09）：继续学习（学习线索 / 上一节课）与最近的课 */
    continueLearning: '继续学习',
    recent: '最近',
    continueThread: '线索',
    continueLesson: '上一节',
    moreLessons: (n: number): string => `还有 ${n} 节 →`,
    /** 相对日期：今天 / 昨天 / M-D */
    today: '今天',
    yesterday: '昨天',
  },


  tutor: {
    /** 对话里对上一条回答的重做；应用产物的重做叫「再做一版」，不混用 */
    regenerate: '重新回答',
    emptyAfterName: '在这里。',
    reviewStarters: ['先讲清这节课的主线', '从我标记的地方开始'] as const,
    /** 复习态开场（2026-09-08）：同桌听过这节课，开场点名学生能核对的时刻 */
    reviewOpening: {
      leadWithAnchors: (count: number, times: string[]): string => (
        `听完了。你在 ${times.join('、')} 留了标记${count > times.length ? `（共 ${count} 处）` : ''}——从哪里开始？`
      ),
      leadWithDifficulties: (count: number): string => `听完了。这节课有 ${count} 个地方值得多说两句——从哪里开始？`,
      anchorPrompt: (time: string): string => `${time} 那里我没跟上，帮我讲一下`,
      /** 时刻有名字（老师原话 / 学生备注）时带上，同桌和学生都知道在说哪一句 */
      anchorPromptNamed: (time: string, title: string): string => `${time}「${title}」那里我没跟上，帮我讲一下`,
      difficultyPrompt: (name: string): string => `帮我讲清「${name}」`,
    },
  },

  actionList: {
    title: '今晚行动清单',
    emptyTitle: '还没有行动项',
    emptyBody: '标记一处困惑后，同学会把下一步放在这里。',
    completedTitle: '今天先到这里',
    completedBody: '行动项已经全部完成。',
    closeHint: '按 ESC 或点击空白处关闭',
  },

  collection: {
    askClassmate: '问同学',
    /**
     * 空态（2026-09-09 二次重做，对标 HyperKnow 首页）：Octo + 一句情境标题 + 一句副题，输入框是整屏主角（hero 变体），
     * 输入框下面一行带图标的能力 pill（丢什么进来），再下面一小段「丢进来会变成什么」。
     */
    emptyTitle: '想到什么，就留在这里。',
    emptyBody: '链接、课件、一句话、一段语音——不用分类，同学会把它接回你的课、目标和问题。',
    /** 能力 pill：丢什么进来；key 供组件映射图标与动作 */
    emptyEntries: [
      { key: 'upload', label: '课件 / 录音 / 图片' },
      { key: 'link', label: 'B 站 / 公众号 / 网页' },
      { key: 'write', label: '一个想法' },
      { key: 'voice', label: '语音随手记' },
      { key: 'wechat', label: '微信里发给我' },
    ] as const,
    /** 微信服务号名 */
    wechatAccountName: 'MeetmindAI原生专属导师',
    emptyWechatTitle: '微信服务号「MeetmindAI原生专属导师」',
    emptyBecomesEyebrow: '丢进来会变成什么',
    emptyBecomes: [
      { input: '一条 B 站视频或公众号文章', output: '讲了什么、哪一段值得回看' },
      { input: '一份课件或一段录音', output: '和你的课对上，课后直接出题、做速查表' },
      { input: '一句想法或一张截图', output: '接回相关的课；问同学时它会记得' },
    ] as const,
    emptyPocketHint: '桌面端：任何应用里选中，⌘⇧M 收下',
    deleteMemoryWarning: '删除后，这条内容不会再进入同学的回答、后续情报和个人上下文。',
    permanentDeleteWarning: '彻底删除后，这条内容不会再进入同学的回答、后续情报和个人上下文。',
    today: '今天',
    selecting: '选择中',
    scrollToLatest: '跳转到最新消息',
    historyTitle: '历史收集',
    menuTitle: '收集菜单',
    statusOrganizing: '正在整理',
    statusOrganizingLesson: '正在整理这节课…',
    statusUnderstood: '已理解',
    statusFailed: '失败',
    videoParsed: (count: number): string => `已解析 · ${count}句`,
    videoParseStale: '解析未完成，换个浏览器再试',
    selectedLabel: '已选',
    transcriptShow: '查看文字',
    transcriptHide: '收起文字',
    playAudio: '播放音频',
    pauseAudio: '暂停音频',
    composerPlaceholder: '发一句想法，贴个链接，或者先把这节课丢进来',
    composerPlaceholderQuotedMulti: '继续顺着这几条内容写...',
    composerPlaceholderQuotedSingle: (typeLabel: string): string => `继续顺着这条${typeLabel}写...`,
    filesReceived: (count: number): string => (count > 1 ? `${count} 个文件已收下` : '文件已收下'),
    confusionNudge: '我现在没懂的是：',
    topBarRecordingVoice: '正在收一段语音',
    topBarReceivingFiles: (count: number): string => `正在收进 ${count} 个文件`,
    voiceRecording: '语音录制中',
    voiceIdleHint: '继续说下去，停下后这段语音会直接留在这里。',
    echoUpdatedHint: '今日情报已根据你的收藏更新',
    // ── 收集菜单面板 ──
    menuSummary: (totalCount: number, activeDays: number): string => `已收 ${totalCount} 条 · 活跃 ${activeDays} 天`,
    menuStreakActive: (days: number): string => `已经连续 ${days} 天在收`,
    menuStreakIdle: '先从今天收一点开始',
    menuTopKinds: (kinds: string): string => `最近收得最多的是：${kinds}`,
    menuIdleHint: '一句困惑、一张图、一份讲义或一段录音，都可以先发进来。',
    menuAllCollectionsDesc: '从以前收进来的课、图和材料里继续接着学。',
    menuEchoActiveHint: '同学正在把你的收藏与目标连起来。',
    menuEchoIdleHint: '先继续收集，有根据的情报会自动出现。',
    activityKind: {
      audio: '录音',
      video: '视频',
      image: '图片',
      document: '材料',
      text: '想法',
    } as Record<string, string>,
    // ── 消息操作菜单 / 多选栏 ──
    actionGoReview: '去复习',
    actionQuote: '引用',
    actionSelect: '选择',
    actionDeselect: '取消选择',
    actionEdit: '编辑',
    actionOpenOriginal: '打开原件',
    actionArchive: '先收起',
    actionCancel: '取消',
    actionConfirmDelete: '确认删除',
    actionDelete: '删除',
    actionRemoveFromFlow: '删除这条',
    multiSelected: '已加入多选',
    selectionCount: (count: number): string => `${count} 条`,
    selectionHint: '已加入这次操作',
    selectionDeleteWarning: '再点一次删除，就会彻底移除这些内容。',
    exitSelection: '退出多选',
    // ── 引用上下文预览 ──
    quotedMulti: (count: number): string => `已引用 ${count} 条内容`,
    quotedAudio: '已引用一段录音',
    quotedSingle: (typeLabel: string): string => `已引用${typeLabel || '内容'}`,
    quotedAutoImport: '发送后自动解析',
    clearQuote: '取消引用',
    uploadFiles: '上传文件',
    dictationTitle: '说一段（备忘录式短录音——完整录一节课请到课堂 Tab）',
    dictationLabel: '说一段',
    sendToCollection: '发送到收集流',
    // ── 整理提示（pulse）：一句话 + 最多两个动作，安静出现在收集流顶部 ──
    pulse: {
      chipAudio: (count: number): string => `${count} 段课堂录音`,
      chipDocument: (count: number): string => `${count} 份材料`,
      chipImage: (count: number): string => `${count} 张图片材料`,
      chipText: (count: number): string => `${count} 条你的想法`,
      chipVideo: (count: number): string => `${count} 个视频来源`,
      recording: {
        title: '正在整理',
        body: '这段语音正在和前面的内容接到同一条学习线索里，你不用先整理它。',
      },
      primaryAndSupport: {
        title: '新的整理提示',
        body: '你已经把课堂录音和补充材料放进了同一条线索。后面不需要总结，继续轻轻往里加就行。',
        actions: [
          { key: 'continue-voice', label: '再录一段' },
          { key: 'capture-confusion', label: '补一句困惑' },
        ],
      },
      audioMany: {
        title: '新的整理提示',
        body: '你已经连续留下了几段课堂录音，这节课的主线开始显出来了。',
        actions: [
          { key: 'capture-confusion', label: '记下没懂的点' },
          { key: 'add-material', label: '贴一份讲义' },
        ],
      },
      audioAndText: {
        title: '新的整理提示',
        body: '你不只是在收课堂内容，也已经留下了自己的理解或困惑，这会让后面的同桌更有抓手。',
        actions: [
          { key: 'continue-voice', label: '继续录音' },
          { key: 'add-material', label: '补充材料' },
        ],
      },
      materialAdded: {
        title: '新的整理提示',
        body: '这份材料已经接进来了。后面再补一句当时没懂的地方，同桌会更容易看出联系。',
        actions: [
          { key: 'capture-confusion', label: '记下没懂的点' },
          { key: 'continue-voice', label: '录一段语音' },
        ],
      },
      audioAdded: {
        title: '新的整理提示',
        body: '这段录音已经留下来了。先别急着整理，继续往里丢材料或困惑，会更有价值。',
        actions: [
          { key: 'capture-confusion', label: '补一句困惑' },
          { key: 'add-material', label: '贴一份材料' },
        ],
      },
      fallback: {
        title: '新的整理提示',
        body: '这条收集流已经开始有自己的形状了。继续轻轻追加，不用一次说完整。',
        actions: [
          { key: 'continue-voice', label: '继续录音' },
          { key: 'capture-confusion', label: '写一句想法' },
        ],
      },
    },
  },

  login: {
    subtitle: '真正懂你在学什么的 AI 同学',
    guestCta: '先试听一节课',
    accountTab: '账号登录',
    emailLabel: '邮箱地址',
    emailPlaceholder: '请输入邮箱地址',
    passwordIdentifierLabel: '邮箱或管理员用户名',
    passwordIdentifierPlaceholder: '请输入邮箱或管理员用户名',
  },

  wechatAgent: {
    rateLimited: '今天聊得够多了，明天再接着聊。',
    failed: '这边卡了一下，稍后再跟我说一次。',
  },
  wechatPodcast: {
    /** 小宇宙链接的即时回执（区别于泛视频链接） */
    receipt: '接住了，是小宇宙播客。转写好了我跟你说。',
    importDone: (title: string, minutes: number): string => `《${title}》转写好了，约 ${minutes} 分钟。`,
    importDoneCta: '点这看看',
    importFailed: (reason?: string): string => reason
      ? `这集转写没成功（${reason}），可以再发一次试试。`
      : '这集转写没成功，可以再发一次试试。',
    duplicate: '这集之前收过了，在这 →',
  },
  player: {
    loadingAudio: '加载音频',
    preparingWaveform: '原声已收下，正在准备波形…',
    loadFailed: '音频加载失败',
    loadFailedHint: '这段原声暂时无法播放，刷新页面或重新进入试试',
  },
  wechatQr: {
    loginAction: '微信扫码登录',
    inWechatAction: '微信登录',
    bindAction: '绑定微信',
    loginTitle: '微信扫码登录',
    bindTitle: '绑定微信账号',
    loginBody: '打开微信扫一扫，确认后这里会自动登录。',
    bindBody: '用要绑定的微信扫码，之后也可以直接用它登录。',
    loading: '正在准备二维码…',
    pending: '等待扫码',
    scanned: '已扫码，正在确认…',
    processing: '正在接上你的账号…',
    loginDone: '登录成功，正在进入 MeetMind…',
    bindDone: '微信已经绑定',
    expiresHint: '二维码 5 分钟内有效',
    expired: '二维码已过期，请刷新后再扫。',
    failed: '这次没有接上，请刷新后重试。',
    retry: '刷新二维码',
    close: '关闭',
    imageAlt: '微信扫码登录二维码',
    bindImageAlt: '微信账号绑定二维码',
    boundToast: '微信账号已绑定',
    mpConfirmed: '已确认，请回到电脑继续。',
    mpExpired: '二维码已过期，请回到电脑刷新后再试。',
    unavailable: '微信扫码登录暂时不可用',
    bindRequiresLogin: '请先登录再绑定微信',
    createFailed: '二维码没有生成，请稍后重试',
    tooManyRequests: '二维码刷新太频繁，请稍后再试',
    sessionMissing: '二维码会话不存在',
    pollFailed: '扫码状态没有接上，请重试',
    identityLinkFailed: '微信账号连接失败',
    identityConflict: '该微信已绑定其他账户',
    identityCreateFailed: '创建用户失败',
    bindFailed: '绑定失败，请重试',
    loginFailed: '登录失败，请重试',
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
    /**
     * 首屏示例卡的三个真实瞬间（2026-09-08）：原话来自示例课转录（fixtures/demo-data），
     * 时间戳能在示例课里核对。卡片循环播放"听见原话 → 有依据地解释"，让第一屏就看见产品在工作。
     */
    proofMoments: [
      {
        quote: "I'm so up in the air right now.",
        time: '00:06',
        answer: '「up in the air」不是“在空中”，是“心里没底、还没定下来”——她刚说完自己要搬家。',
      },
      {
        quote: "I'm having a hard time getting organised.",
        time: '00:17',
        answer: '这里的「getting organised」是把搬家的事理顺，不是在说她性格有没有条理。',
      },
      {
        quote: 'You will not hear the recording a second time.',
        time: '00:42',
        answer: '这是听力考试的规则：只放一遍。后面六道题要边听边答。',
      },
    ] as const,
    /**
     * 循环的第四幕「下课以后」：听懂之外，这节课还长出了什么、记住了什么。
     * 只说机制（没跟上的排最前 / 只考讲过的），不报会随模型变化的数量。"2 处"是示例课固定的两个锚点。
     */
    proofAfter: {
      status: '下课以后',
      time: '01:30',
      title: '这节课，同桌替你留下了',
      items: [
        { name: '闪卡', note: '你没跟上的 2 处排最前' },
        { name: '测验', note: '只考这节课讲过的' },
        { name: '讲给同桌听', note: '把还没懂的地方暴露出来' },
      ],
      memory: '没记住的会进你的上下文——下次问同学，它还记得。',
    },
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

  demo: {
    reviewBannerTitle: '这是示例课',
    /** 访客看完试听落在复习页：说清"你的课也会长成这样"，而不是解释课堂列表在哪 */
    reviewBannerBody: '你的每一节课都会长成这样——录下第一节就开始。',
    reviewBannerAction: '去录我自己的课',
    /** 示例课不是访客自己的课，"留住这节课"留不住；登录的理由是记自己的课 */
    reviewBannerLoginAction: '登录，记自己的课',
    reviewBannerDismiss: '继续看示例课',
  },

  classroomHome: {
    commandEyebrow: '今天',
    title: '今天，继续学懂一件事。',
    outcomeTitle: '内容进来之后',
    outcomeHint: '不只保存，还会继续变成能用的学习结果。',
    today: '今天',
    yesterday: '昨天',
    active: '正在上课',
    launchpadTitle: '补充学习上下文',
    launchpadHint: '材料和问题会自动接到相关课堂',
    actionRecordTitle: '开始一节课',
    actionRecordBody: '录线下课、网课或讨论，边听边形成课堂脉络。',
    actionRecordLabel: '选择声音开始',
    actionMaterialTitle: '放入材料',
    actionMaterialBody: '文档、网页、音视频会自动接到相关课堂和目标。',
    actionMaterialLabel: '选择文件或链接',
    actionSearchTitle: '问课堂和资料',
    actionSearchBody: '带上课堂、资料和目标，直接说你想弄懂什么。',
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
    listeningTitle: '等老师进入正题。',
    understanding: '正在接住刚才这段。',
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

  // 应用等待态的句子在 copy-apps.ts `APPS_COPY.entry`（2026-09-10 起按应用各一句，不再拼接应用名）

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
    defaultLightPrompts: ['刚才那句我没跟上', '这段在讲什么？', '帮我抓一下题眼'] as const,
    quickRecap: '刚才那段',
    quickRecapQuestion: '刚才那段讲了什么？',
    quickCatchUp: '我没跟上',
    quickCatchUpQuestion: '我没跟上，帮我接一下主线。',
    quickMark: '记一下',
    idleStatus: '待命中',
    afterClassStatus: '听完了',
    listeningStarter: '卡住直接问。',
    afterClassStarter: '听完了，换我带你练一下。',
    pending: '正在想…',
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

  /** 桌面端小窗（/companion）：随手记、随口问，不出小窗完成 */
  recording: {
    /** 课中转录卡头部（2026-09-08）：一行状态 + LIVE 徽标，不再放"课堂文字"这种重复标签 */
    liveBadge: 'LIVE',
    listeningSentence: '正在听这一句…',
    recordedSentences: (count: number): string => `已记 ${count} 句`,
    waitingTeacher: '等老师开口',
    demoPause: '暂停',
    demoPlay: '播放',
    demoPlayNeedsGesture: '播放声音',
    /** 出声被浏览器拦截、正在静音播放：点一下才有声音 */
    demoUnmute: '打开声音',
    endLesson: '结束这节课',
    /** 示例课音频播完后的收尾卡（此前硬编码，且把内部词"应用矩阵"说给了用户） */
    afterClass: {
      eyebrow: '课后',
      title: '这节试听课听完了。',
      body: '课堂先停在这里。点「结束这节课」，我带你去复习页——那里有这节课的整理，和接下来怎么学。',
      finish: '结束这节课',
      finishHint: '进入课后复习',
      replay: '再听一遍',
    },
    sourcePrompt: '这节课的声音从哪里来？',
    backToLessons: '返回课程列表',
    sourceMic: '麦克风',
    sourceSystem: '电脑声音',
    sourceMixed: '两路都录',
    sourceMicHint: '线下课',
    sourceSystemShortHint: '在线课程',
    sourceMixedHint: '网课＋自己提问',
    sourceSystemHint: '开始后，在系统窗口勾选“分享音频”。',
    activeStatus: (source: string): string => `正在听 · ${source} · 点开看实时文字`,
    /** 录课态转录卡 LIVE 旁的来源图标提示 */
    sourceListening: (source: string): string => `正在听：${source}`,
    /** mixed 模式系统音频采集失败、降级为纯麦克风时提示 */
    downgradeFromMixed: '电脑声音没录到，只用麦克风在录',
    startFailedFallback: '没有接上录音设备，请检查麦克风权限后再试。',
    recorderNotReady: '录音组件还没准备好，请再点一次。',
    /** 课中「截取这一页」：从屏幕流抓当前帧挂到课堂时间轴 */
    captureFrame: '截取这一页',
    captureFrameSaved: '这一页收下了',
    captureFrameFailed: '没截到，再试一次。',
    startFailed: (reason: string): string => `还没有开始录音。${reason}`,
    finished: '这节课收好了',
    /** 断连缓冲溢出导致音频帧被丢弃时的持续提示（累计秒数） */
    audioGapWarning: (seconds: number): string =>
      `刚才连接不稳，约有 ${seconds} 秒的声音没能转成文字。`,
    /** 重录确认：旧录音会先按正常停录保底落库，再开始新录音 */
    restartConfirm: '确定要重新开始吗？当前这段会先收好，再从零录一段新的。',
    /** 录音中持续检测到零音量（PCM 链路静默）时的一次性提醒 */
    silentAudioWarning: '一直收不到声音，文字不会生成。请检查麦克风或声音来源后重录。',
    finalizingTranscript: (count: number, enhancedCount = 0): string =>
      `实时文字已收下，正在用原声定稿 · ${count} 段${enhancedCount > 0 ? ` · 已优化 ${enhancedCount} 段` : ''}`,
    /** 结束时写服务端失败：内容已在本机，联网 / 回到课堂时自动补传（sync-pending-recordings） */
    syncDeferred: '这节课先存在这台设备上，联网后会自动同步到你的账号。',
    /** 忘记结束的课（2026-09-10）：首页顶部一行安静的恢复条 + 两个文字动作 */
    unfinished: {
      line: (title: string, minutes: number): string =>
        minutes > 0 ? `有一节课没结束：${title} · 已录 ${minutes} 分钟` : `有一节课没结束：${title}`,
      /** 收好前半段，立刻开一段新的（原声无法无缝接续，两段各自成课） */
      resume: '继续录',
      finish: '就到这里',
      finished: '这节课收好了',
      /** 超过 6 小时没回来的课在下次打开时自动收尾 */
      autoFinished: '有一节没结束的课已经替你收好了',
      /** 课堂列表里没结束那张卡的状态字 */
      cardStatus: '还没结束',
    },
    /** 另一台设备正在录这节课（服务端检查点回填）：列表状态字 */
    remoteRecording: (minutes: number): string => (minutes > 0 ? `录制中 · 已 ${minutes} 分钟` : '录制中'),
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
    title: '今天，学懂一件事。',
    record: '录一节课',
    recordHint: '实时听懂',
    addMaterial: '放入资料',
    photo: '拍板书',
    search: '问同学',
    livePromise: '课中看见脉络',
    afterClassPromise: '课后继续练习',
    capabilityLabel: '从输入到结果，一条学习链路',
    capabilityFlow: '课堂脉络',
    capabilityQa: '资料问答',
    capabilityFlashcards: '闪卡',
    capabilityQuiz: '测验',
    capabilityMindmap: '思维导图',
    capabilityFeed: '今日情报',
    intelligenceLabel: '今日情报',
    intelligenceFallback: '从最近的学习里，找到一条值得继续的线索',
    intelligenceAction: '查看',
    recentLabel: '最近收下',
    recentEmpty: '还没有收下的内容',
    openProfile: '打开个人菜单',
    emptyRole: '懂你上下文的 AI 同学',
    emptyEyebrow: '先交给我一段真实学习',
    emptyTitle: '陪你听懂每一节课。',
    emptyBody: '录下学习现场，课中理清脉络，课后继续练会。',
    emptyRecordHint: '边听边形成课堂脉络',
    tryDemo: '试听 90 秒',
    demoPlay: '播放声音',
    demoPause: '暂停',
    demoFinished: '试听结束，可以去看课后练习了',
    demoFinish: '结束试听，看课后',
    demoReviewStatus: '试听课',
    demoFailed: '试听还没加载好，再试一次',
    emptyOutcomeTitle: '回来时，你会得到',
    emptyOutcomeFlow: '课堂脉络',
    emptyOutcomeAnswer: '有根解释',
    emptyOutcomePractice: '课后练习',
    emptyBrowse: '先看看完整工作台',
  },

  reviewTutor: {
    wholeLesson: '整节课',
    wholeLessonTitle: '基于整节课内容对话',
    confusion: '困惑点',
    /** 时刻起不出名字（没有转录也没有备注）时的兜底 */
    confusionUnnamed: '这里没跟上',
    /** 「困惑点」tab 没选中时的列表（MomentList）：每一刻按名字列出 */
    moments: {
      title: (count: number): string => `你标的 ${count} 处`,
      hint: '点一处，回到那一句',
      resolved: '已解决',
      emptyTitle: '这节课还没有标记。',
      emptyBody: '听到没跟上的地方点一下「标记困惑」，下课后就从这里接着问。',
    },
    backToWholeLesson: '返回整节课对话',
    /** 左证据栏「时间轴」tab 下非音视频内容的空态（此前硬编码在 ReviewWorkspacePanel，2026-09-10 收进来） */
    noTimeline: {
      title: '这条内容没有时间轴',
      body: '音频和视频才有时间轴。试试「应用」，和这条内容互动。',
      bodyNight: '夜深了，你也休息一下。明天再回来看，同学还在。',
      action: '打开应用',
    },
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
    // 只留 matrix：app-catalog 在 /app 首屏用它；其余窗口文案在 copy-apps.ts（体积）
    matrix: {
      title: '接下来怎么学',
      recommendedTitle: '现在最适合',
      allTitle: '其他学习方式',
      availableTitle: '可以这样继续',
      previewTitle: '其他内容可以这样学',
      readinessLabel: '学习应用判断',
      assessing: '正在判断这段内容适合怎么学',
      recommendedByContent: '这段内容已经足以支撑这个学习动作。',
      insufficientTitle: '先保留这段原话',
      insufficientBody: '内容还太少。继续记录后，合适的学习方式会自然出现。',
      notLearningTitle: '这段内容不用加工',
      notLearningBody: '它更像普通交流，保留原话就够了。',
      unreliableTitle: '先把原话听清',
      unreliableBody: '当前转录还不稳定，暂时不把它整理成学习结论。',
      executeNotReady: '这段内容还不足以形成可靠的学习应用。',
      executeNotSuitable: '这个学习动作不适合当前内容，换一种方式更可靠。',
      executeNeedsMultipleLessons: '至少选择两节属于同一门课的课堂。',
      /** 模型两次都没做出可用成品（不再用模板题凑数） */
      executeGenerationFailed: '这次没做出来。再试一次，通常就好。',
      noContent: '先录下或放入一段课堂内容。',
      generateFailed: '这次没做好，稍后可以再试一次。',
      generated: (appName: string): string => `${appName}做好了`,
      openResult: '打开',
      timeout: '等得有点久，稍后可以再试一次。',
      timeoutFor: (appName: string): string => `${appName}还没做好，稍后可以再试一次`,
      cancelled: '已取消',
      cancelledFor: (appName: string): string => `已取消${appName}`,
      failedFor: (appName: string): string => `${appName}这次没做好`,
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
      start: '开始',
      open: '打开',
      openImage: '查看图片',
      progress: '正在做…',
      retry: '再试一次',
      tryAnother: '看看其他方式',
      remake: '再做一版',
      ready: '做好了',
      waiting: '还没开始',
      notAvailable: '暂不可用',
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
      noTasks: '还没有正在准备的内容。',
      infographicPreview: '信息图预览',
      podcastPreview: '播客试听',
      downloadImage: '保存图片',
      closePreview: '关闭',
      imageDownloaded: '图片已保存',
      imageDownloadFailed: '没保存上，请长按图片保存',
      windowUnavailableTitle: '这个学习方式暂时打不开',
      windowUnavailableBody: '回到这节课，其他学习方式仍然可以继续使用。',
      windowLoading: '正在接回这节课',
      windowEmptyTitle: '先选一节课',
      windowEmptyBody: '学习应用需要基于真实课堂内容，才不会生成没有依据的结论。',
      windowBackToClassroom: '回到课堂',
      windowErrorTitle: '这次没有接上',
      windowErrorBody: '课堂原文仍然保留着，回到学习方式后可以再试一次。',
      windowLoadTimeout: '这节课暂时没有接上，请返回后再试一次。',
      windowLoadFailed: '这节课暂时没有接上',
      courseCheatsheetSection: '跨课准备',
      courseCheatsheetTitle: '考试速查表',
      courseCheatsheetBody: '从课程上下文选择多节课堂、考试范围与资料，做成真正能打印和带进考场的速查表。',
      courseCheatsheetAction: '选择课程范围',
      courseCheatsheetRouteTitle: '考试速查表从多节课开始',
      courseCheatsheetRouteBody: '先选择一门课程和至少两节课堂；MeetMind 会把课堂、课件与考试范围合成一份可编辑、可打印的速查表。',
      mobileTitle: '这节课，接下来怎么学',
      backToMatrix: '所有学习方式',
      catalogMeta: {
        cheatsheet: { action: '带进考场', bestFor: '多节课已组成单元，或正在准备允许携带资料的考试', time: '排版约 10–20 分钟' },
        quiz: { action: '检验理解', bestFor: '想做题测一测，马上知道哪里没掌握', time: '作答约 5–8 分钟' },
        flashcards: { action: '记住核心', bestFor: '概念、术语和公式需要反复回忆', time: '练习约 5 分钟' },
        mindmap: { action: '看清结构', bestFor: '内容较多，想分清主干、关系和层次', time: '浏览约 2 分钟' },
        'audio-overview': { action: '换种方式再听', bestFor: '通勤或走路时，想用对话重新理解', time: '收听约 6–10 分钟' },
        infographic: { action: '做成一张图', bestFor: '想分享、展示，或用视觉方式记住', time: '查看约 2 分钟' },
        'teach-back': { action: '讲给同桌听', bestFor: '想确认自己是真懂，而不只是看懂了', time: '讲约 5–10 分钟' },
        explainer: {
          name: '板书精讲',
          headline: '黑板上边写边讲，把这节课讲透',
          description: '像坐在教室前排：粉笔字一个个写出来，圈点勾画跟着讲解走。',
          action: '看板书精讲',
          bestFor: '想真正弄懂这节课的核心概念，而不是只留个印象',
          time: '观看约 5–8 分钟',
        },
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
    /** 跨课程空态（2026-09-10：同学开口，不再是一张巨大的空卡） */
    crossCourseEmptySpeaker: '同学',
    crossCourseEmptyOpening: '我还没读到你的课和收藏。留下几条你真正关心的内容，这里会先照见你正在形成的方向，再从外面找真实可读的书、论文和不同观点。',
    crossCourseEmptyAction: '去收一条',
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

  /** 课堂笔记（分段总结）——桌面复习页与移动端共用的等待 / 失败态 */
  digest: {
    working: '正在整理',
    workingBody: '同桌正在把这节课整理成笔记…',
    failedTitle: '这次没整理出来。再试一次，通常就好。',
    retry: '再试一次',
    viewTranscript: '看转录原文',
  },
  mobileJourney: {
    markMoment: '记一下',
    momentMarked: (time: string): string => `记下了 ${time}，课后在困惑点里等你`,
    confusionMarked: '标下了，课后同桌先讲这段',
    playAudio: '播放原声',
    pauseAudio: '暂停原声',
    finishLesson: '结束这节课',
    photoCapturedAt: (timestamp: string): string => `已拍下板书 · ${timestamp}`,
    collapseClassmate: '收起课堂同桌',
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

  adminAi: {
    managementView: '管理视图',
    managementViewEnabled: '已开启',
    managementViewDisabled: '未开启',
    managementViewHint: '开启后，AI 功能旁会显示本次实际输入与运行配置。普通用户不会看到。',
    inspector: '查看本次 AI',
    inspectorTitle: '查看这次回答接入了什么',
    inspectorPanelTitle: '本次 AI 输入',
    closeInspector: '关闭本次 AI 输入',
    inspecting: '正在重建本次输入…',
    inspectorFailed: '暂时无法读取这次 AI 输入，请进入控制中心重试。',
    requestModel: '请求模型',
    noContextReceived: '这次没有接入额外上下文',
    inspectorPrivacy: '输入只在当前浏览器用于这次检查，不写入运行日志。最终模型可能因服务异常自动切换备用通道。',
    tuneThisRun: '用这次输入去调整',
    settingsCaption: '管理员工具',
    openControlCenter: '打开 AI 控制中心',
    settingsDescription: '统一查看提示词、上下文拼接、模型路由和线上版本',
    title: 'AI 控制中心',
    subtitle: '看清每条 AI 链路的上下文、提示词与模型，并安全地发布调整。',
    back: '返回 MeetMind',
    accessDenied: '这里仅对管理员开放',
    accessDeniedBody: '请先使用管理员账号登录。',
    loading: '正在读取 AI 链路…',
    loadFailed: 'AI 配置读取失败，请稍后重试。',
    surfaces: 'AI 链路',
    online: '线上',
    baseline: '代码默认',
    draft: '草稿',
    version: (version: number): string => `v${version}`,
    noPublishedVersion: '尚未发布调整',
    entryPoints: '出现位置',
    contextMap: '输入上下文',
    sensitive: '含个人信息',
    editTitle: '调整这条链路',
    editBody: '保留代码内的基础提示词，只追加你希望改变的行为。',
    enabled: '启用这版调整',
    enabledHint: '关闭后仍可保存草稿，但发布不会改变线上行为。',
    model: '运行模型',
    modelAuto: '沿用产品默认',
    instructions: '追加指令',
    instructionsPlaceholder: '例如：回答概念问题时，先用一个贴近课堂的小例子，再给定义。',
    note: '版本备注',
    notePlaceholder: '这次为什么调整',
    saveDraft: '保存草稿',
    saving: '保存中…',
    publish: '发布到线上',
    publishing: '发布中…',
    publishConfirm: '确认把这版配置发布给所有用户？发布后仍可从版本记录回滚。',
    saved: '草稿已保存',
    published: '已发布，新请求会使用这版配置',
    rolledBack: '已回滚并生成一个新的线上版本',
    actionFailed: '操作失败，请检查内容后重试。',
    previewTitle: '用一次真实输入预演',
    previewBody: '可以直接编辑这次送给模型的上下文样例，不会触发真实回答，也不会影响线上。',
    liveContext: '来自刚才的产品现场',
    sampleContext: '产品样例',
    contextJson: '上下文 JSON',
    optionsJson: '运行选项',
    invalidJson: '上下文不是有效的 JSON。',
    preview: '生成最终输入',
    previewing: '正在拼接…',
    previewEmpty: '生成预览后，这里会显示模型最终收到的系统输入。',
    finalInput: '最终系统输入',
    promptVersion: '基础提示词版本',
    characterCount: (count: number): string => `${count.toLocaleString('zh-CN')} 字符`,
    contextReceived: '实际接入字段',
    lockedContract: '不可覆盖的产品合同',
    lockedHint: '隐私、引用与场景边界始终放在管理员指令之后。',
    compareTitle: '回答对比',
    compareBody: '用同一份上下文和问题，对比当前线上配置与正在编辑的配置。试跑不会写入用户对话。',
    trialQuery: '测试问题',
    trialQueryPlaceholder: '输入一条真实用户会问的问题',
    trialQueryRequired: '先输入一条测试问题。',
    runCompare: '试跑两版回答',
    comparing: '两版同时生成中…',
    compareFailed: '回答试跑失败，请检查模型配置后重试。',
    currentOnline: '当前线上',
    currentEdit: '正在编辑',
    compareEmpty: '试跑后在这里直接比较用户会看到的回答。',
    duration: (durationMs: number): string => `${(durationMs / 1000).toFixed(1)} 秒`,
    history: '版本记录',
    rollback: '回滚到这版',
    rollbackConfirm: (version: number): string => `确认回滚到 v${version}？系统会生成一个新的线上版本。`,
    emptyHistory: '还没有版本记录。',
  },

  /** 管理员成本视图（积分影子计量 Phase 1） */
  adminCosts: {
    title: '模型成本',
    body: '影子计量期只统计真实成本，不会向用户扣减。',
    range7: '近 7 天',
    range30: '近 30 天',
    colFeature: '功能',
    colModel: '模型',
    colRequests: '请求数',
    colTokens: 'Tokens',
    colCost: '成本',
    total: '合计',
    dailyTitle: '每日趋势',
    empty: '这个时间范围还没有计量数据。',
    loadFailed: '成本数据加载失败。',
    cost: (milliYuan: number): string => `¥${(milliYuan / 1000).toFixed(3)}`,
    tokens: (count: number): string => count.toLocaleString('zh-CN'),
  },

  /** 积分（Phase 2）：余额展示、扣费拦截提示、免费录课额度 */
  points: {
    unit: '积分',
    chipLabel: (balance: number): string => `${balance} 积分`,
    balanceCaption: '当前余额',
    freeMinutesRemaining: (minutes: number): string => `本月免费录课还能用 ${minutes} 分钟`,
    freeMinutesUsedUp: '本月免费录课时长已用完',
    recentRecords: '最近记录',
    recordsEmpty: '还没有积分记录。',
    /** 设置页流水默认只展示最近几条，其余收进展开器——否则每次用 AI 都会把设置页拉长 */
    recordsShowAll: (count: number): string => `查看全部 ${count} 条记录`,
    recordsCollapse: '收起记录',
    loadFailed: '积分信息暂时没接上，稍后再看。',
    /** 402 insufficient_points：余额不足 + 当前余额 + 下月发放说明 */
    blockedInsufficient: (balance: number): string =>
      `积分不够了，现在还剩 ${balance}。每月初会发新的，到时候再来。`,
    blockedInsufficientUnknown: '积分不够了。每月初会发新的，到时候再来。',
    /** 402 monthly_cost_cap：本月成本到顶，下月自动恢复 */
    blockedMonthlyCap: '这个月的 AI 用到上限了，先歇一歇，下个月会自动恢复。',
    /** 402 guest_daily_cap：未登录日试用到顶，引导登录 */
    blockedGuestDailyCap: '今天的试用到这里了。登录后就能继续，每月还有固定额度。',
    /** ── Paywall 付费拦截页（高意向时刻截断：402 / 录课额度用尽） ── */
    paywallTitle: '充点积分，接着学',
    paywallInsufficient: (balance: number, required: number): string =>
      `这次需要 ${required} 积分，你还差 ${Math.max(1, required - balance)}。`,
    paywallInsufficientUnknown: '积分不够这次用了，充一点就好。',
    paywallAsrQuota: '本月免费录课时长用完了，充积分可以按分钟继续录。',
    paywallPackCaption: (points: number): string => `${points} 积分`,
    paywallPackLabel: { starter: '体验包', standard: '标准包', scholar: '学霸包' } as Record<string, string>,
    paywallPackRecommend: '最多人选',
    paywallPayCta: (fen: number): string => `微信支付 ¥${(fen / 100).toFixed(2).replace(/\.00$/, '')}`,
    paywallPayingTitle: '微信扫码完成支付',
    paywallPayingHint: '支付成功后积分自动到账，不用刷新页面。',
    paywallPayExpired: '二维码过期了，重新生成一张。',
    paywallSuccessTitle: '积分到账了',
    paywallSuccessBody: (points: number): string => `+${points} 积分，继续吧。`,
    paywallUnavailable: '在线支付即将开通。着急的话，先在公众号里找我们。',
    paywallDismiss: '再想想',
    /** 微信充值到账的客服消息（recharge-order-service 推送） */
    rechargePaidText: (points: number, balanceAfter: number | null): string =>
      `积分到账：+${points} 积分${typeof balanceAfter === 'number' ? `，当前余额 ${balanceAfter}` : ''}。`,
    /** 录课前预检：免费分钟用完，轻提示不阻断 */
    asrQuotaExhausted: (pricePerMinute: number): string =>
      `本月免费录课时长已用完，继续录会按每分钟 ${pricePerMinute} 积分计。`,
    settingsCaption: '积分',
    settingsDescription: '每月发放的额度、免费录课时长和使用记录',
    monthCostLabel: '本月 AI 成本',
    monthCostValue: (milliYuan: number): string => `¥${(milliYuan / 1000).toFixed(2)}`,
    monthCostCap: (milliYuan: number): string => `上限 ¥${(milliYuan / 1000).toFixed(2)}`,
    freeMinutesLabel: '免费录课时长',
    minutesValue: (minutes: number): string => `${minutes} 分钟`,
    deltaLabel: (delta: number): string => (delta > 0 ? `+${delta}` : `${delta}`),
    /** 流水 reason 枚举 → 人类可读文案 */
    reasonLabels: {
      welcome: '新同学见面礼',
      monthly: '每月发放',
      tutor: 'AI 同桌',
      apps: '学习应用',
      asr: '录课转写',
      'asr:import': '播客视频导入转写',
      'admin-adjust': '管理员调整',
    } as const,
    reasonFallback: '其他',
  },

  /** 订阅会员（Free / Pro / Max）：档位名、权益文案、到账通知 */
  membership: {
    tierName: { free: '免费版', pro: 'Pro', max: 'Max' } as Record<string, string>,
    /** 会员档订单支付到账的客服消息（recharge-order-service 推送） */
    paidText: (tierLabel: string, expiresOn: string): string =>
      `${tierLabel} 已开通，有效期至 ${expiresOn}。录课额度与每月积分已按新档位生效。`,
    /** 402 membership_required：免费档触发会员专属能力 */
    blockedMembershipRequired: (tierLabel: string): string =>
      `这个功能是 ${tierLabel} 会员专属的，开通后就能用。`,
    settingsCaption: '会员',
    expiresOn: (date: string): string => `有效期至 ${date}`,
    renewCta: '续费',
    upgradeCta: '升级',
    freeTierCta: '开通会员',
    /** 一级页面直达入口（桌面侧栏底部 / 积分面板）的副标题——付费不藏在设置里。
        必须够短：168px 侧栏里放得下，宁可少写也不许截断出省略号 */
    upgradeEntryHint: '解锁深度模式',
    /** 一级页面用户菜单里的会员入口：按当前档位给动作 */
    menuCta: { free: '开通会员', pro: '升级会员', max: '续费会员' } as Record<string, string>,
    /** ── Paywall 会员 Tab ── */
    paywallTabMembership: '会员',
    paywallTabPoints: '充积分',
    paywallTitle: '开通会员，放开用',
    /** 主动打开（设置页）时的中性地推文案 */
    paywallMembershipPitch: '更长的录课额度、每月更多积分，还有会员专属能力。',
    paywallPointsPitch: '积分可以录课、向同学提问、生成学习产物。',
    planPriceMonth: (fen: number): string =>
      `¥${(fen / 100).toFixed(2).replace(/\.00$/, '')}/月`,
    planCta: (tierLabel: string, fen: number): string =>
      `开通 ${tierLabel} · ¥${(fen / 100).toFixed(2).replace(/\.00$/, '')}/月`,
    benefitFreeMinutes: (minutes: number): string => `每月 ${minutes} 分钟免费录课`,
    benefitMonthlyGrant: (points: number): string => `每月发 ${points} 积分`,
    benefitDeep: '解锁深度模式',
    benefitDiscount: '学习应用 8 折',
    benefitModel: '优先更快的模型',
    paywallSuccessTitle: (tierLabel: string): string => `${tierLabel} 已开通`,
    paywallSuccessBody: '录课额度和每月积分已按新档位生效。',
  },

  /**
   * "被禁用"的词表——供测试脚本 grep 校验，确保面向用户的字符串不退化。
   */
  /** 设置页（/settings）——2026-08 重设计时从 page.tsx 内联字符串收口至此 */

  // 「请一个分身」线（分身架 / 请分身 / 分身对话 / 账本式进度）
  // 铁律：skill 内容永不出现在用户面；蒸馏过程只以"账本式进展"可见。

  // copy-in 的 AI Elements 原语用到的用户面文案（src/components/ai-elements/）
  aiElements: {
    toolStatus: {
      pending: '排队中',
      running: '进行中',
      awaitingApproval: '待确认',
      responded: '已回应',
      completed: '完成',
      error: '出错',
      denied: '已拒绝',
    },
    toolInput: '参数',
    toolResult: '结果',
    toolError: '错误',
    backToLatest: '回到最新',
  },

  bannedWords: ['回声卡', '酿', '预知气泡', '工坊', '研判', '引擎'] as const,
};

export type Copy = typeof COPY;
