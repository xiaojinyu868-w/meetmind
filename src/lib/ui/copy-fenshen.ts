/**
 * copy-fenshen — 「请一个分身」线的用户面文案
 *
 * 从 copy.ts 拆出来的唯一理由是体积：这一块只有 分身线组件 用到，却随 COPY 单体进 /app 首屏 JS（≈1.5 KB gzip）。
 * 口吻审查仍是同一个入口：改文案先看 copy.ts，分身线组件看这里。用法：`import { FENSHEN_COPY } from "@/lib/ui/copy-fenshen"`。
 */

export const FENSHEN_COPY = {
    entryLabel: '请一个分身',
    entryBody: '把孔子，或你信任的老师，请进你的课堂。',
    entrySectionTitle: '请一位听过这节课的老师',
    shelfTitle: '分身架',
    /** 架子副标题（带课时）：兑现「听过这节课的老师」契约，课在旅程里始终在场 */
    shelfLessonBody: (lessonTitle: string): string => `请谁来和你一起复习《${lessonTitle}》？`,
    /** 对话头部常驻 chip：明示分身此刻正在读哪节课 */
    chatLessonChip: (lessonTitle: string): string => `正在陪你复习《${lessonTitle}》`,
    shelfEmpty: '架上还空着。请一位听过你课的老师，慢慢聊。',
    invite: '请一个分身',
    back: '返回分身架',
    close: '关闭',
    statusLearning: '学习中',
    statusReady: '就绪',
    statusFailed: '没成',
    progressLedger: (count: number): string => `分身在学习 · ${count} 条进展`,
    sourceLabel: (sourceType: 'hall' | 'bilibili' | 'upload'): string =>
      sourceType === 'hall' ? '名人堂' : sourceType === 'bilibili' ? 'B 站课程' : '上传录音',
    /** 同名分身区分：创建日期（M月d日） */
    egoCreatedAt: (iso: string): string => {
      const d = new Date(iso);
      return `${d.getMonth() + 1}月${d.getDate()}日请来`;
    },
    onboardTitle: '请一个分身',
    onboardBody: '分身在后台读完语料、备好课，再来和你聊这节课。',
    tabHall: '名人堂',
    tabBilibili: '贴 B 站链接',
    tabUpload: '上传录音',
    hallConfucius: '孔子',
    nameLabel: '称呼',
    namePlaceholder: '怎么称呼这位老师',
    bilibiliLabel: 'B 站链接',
    bilibiliPlaceholder: 'https://www.bilibili.com/video/…',
    uploadLabel: '录音文件',
    uploadPick: '选择录音',
    uploadMissing: '先选一个录音文件。',
    submit: '开始邀请',
    submitting: '正在邀请…',
    createFailed: '这次没请成，稍后再试一次。',
    chatEmptyReady: (name: string): string => `${name}已经就位。问问他这节课里你没跟上的地方。`,
    chatEmptyLearning: (name: string): string => `${name}正在备课。可以先看看他读到了什么。`,
    chatPlaceholder: (name: string): string => `和${name}聊聊…`,
    chatPlaceholderLearning: '分身还在备课，就绪后再聊',
    listenHint: '先试听一段，听听他讲得像不像。',
    listenSuggestion: '让他把这节课最难的地方再讲一遍',
    feedbackPrompt: '听起来像他吗？',
    feedbackLike: '像他',
    feedbackUnlike: '不像他',
    feedbackUnlikeNotePlaceholder: '哪里不像？（可选）',
    feedbackUnlikeSubmit: '请分身再学一轮',
    feedbackThanks: '记下了。',
    feedbackRelearning: '好，分身带着你的意见再去学一轮。',
    sendFailed: '没发出去，稍后再试一次。',
    feedbackFailed: '反馈没记上，稍后再试一次。',
    interrupt: '打住',
    speaking: '分身正在说…',
  } as const;

export type FenshenCopy = typeof FENSHEN_COPY;
