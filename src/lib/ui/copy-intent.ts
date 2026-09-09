/**
 * copy-intent — 目标共建 / 教练对话（IntentDialog 系列）的用户面文案
 *
 * 从 copy.ts 拆出来的唯一理由是体积：这一块只有 IntentDialog 系列 用到，却随 COPY 单体进 /app 首屏 JS（≈2.1 KB gzip）。
 * 口吻审查仍是同一个入口：改文案先看 copy.ts，IntentDialog 系列看这里。用法：`import { INTENT_COPY } from "@/lib/ui/copy-intent"`。
 */

export const INTENT_COPY = {
    /** 主标题（设置页 caption / 首次进入 header） */
    title: '聊聊你想要的',
    /** 副标 */
    subtitle: '不用写好——说就行',
    /** 设置页 description */
    description: '和教练聊一聊，把脑子里的事一起捋清楚',
    /** 设置页：还没聊过的提示 */
    emptyHint: '还没聊过。你最近想做的事 / 想去的方向 / 还在纠结的选择，都可以慢慢说。',
    /** 设置页：开始按钮 */
    actionStart: '和教练聊一聊',
    /** 设置页：再聊一次按钮 */
    actionResume: '和教练再聊一会',
    /**
     * 首次会面：固定开场选择题（成熟产品 onboarding 模式——先拿稳定属性，再拿时间尺度）。
     * 两题稳定属性（身份 → 阶段，点选即进下一题，零 LLM 往返），一题目标时间尺度；
     * 三题答完合成第一条用户消息发给 AI，稳定属性由 AI 沉淀进「我了解到的你」。
     */
    openingStep1Question: '你现在是——',
    openingStep1Options: ['在校学生', '工作中', '自由职业 / gap 中', '还在找方向'] as string[],
    openingStep2StudentQuestion: '读到哪个阶段了？',
    openingStep2StudentOptions: ['中学', '大学', '研究生', '备考中（考研 / 考证 / 考公）'] as string[],
    openingStep2WorkQuestion: '工作多久了？',
    openingStep2WorkOptions: ['还在试用期', '1-3 年', '3 年以上'] as string[],
    openingStep3Question: '最想让 Octo 帮你盯住哪类事？',
    openingStep3Options: [
      '眼前的考试或 DDL',
      '这个学期 / 季度的进步',
      '长期的方向和本事',
    ] as string[],
    /** 顶部步骤条：说说 → 捋一捋 → 记下了 */
    stepChat: '说说',
    stepShape: '捋一捋',
    stepSaved: '记下了',
    /** 完成态 */
    doneTitle: '记下了',
    doneHint: '它已经进入你的上下文，之后的复习和首页都会围着它转。',
    donePrimary: '好了，去主页看看',
    doneSecondary: '再记一件',
    /** 请求失败 / 卡死看门狗触发时的错误条 */
    errorBanner: '刚刚断了一下，这条没收到回复。',
    errorRetry: '重试',
    errorDismiss: '先不管',
    /** AI 没给选项时的兜底快答（保证永远能点选推进） */
    fallbackContinue: '继续说',
    fallbackWrapUp: '帮我捋出来记着',
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
    /** 目标时间尺度角标（horizon） */
    horizonNear: '短期 · 有明确节点',
    horizonTerm: '中期 · 学期 / 季度',
    horizonLong: '长期 · 方向',
  } as const;

export type IntentCopy = typeof INTENT_COPY;
