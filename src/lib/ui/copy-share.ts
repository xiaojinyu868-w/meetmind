/**
 * copy-share — 分享页 / 分享裂变的用户面文案
 *
 * 从 copy.ts 拆出来的唯一理由是体积：这一块只有 分享页 用到，却随 COPY 单体进 /app 首屏 JS（≈1.6 KB gzip）。
 * 口吻审查仍是同一个入口：改文案先看 copy.ts，分享页看这里。用法：`import { SHARE_COPY } from "@/lib/ui/copy-share"`。
 */

export const SHARE_COPY = {
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
      claimSub: '领取后可以在自己的工作台里继续学',
      /** 领取接口异常的兜底文案 */
      claimFailed: '领取失败',
      /** 也分享给别人 */
      reshareAction: '复制链接',
      reshareFailed: '复制失败，请手动复制地址栏',
      /** 分享态对话输入占位符 */
      chatPlaceholder: '问问这节课…',
      /** 分享态对话：等待回答时的输入条占位 */
      chatBusyPlaceholder: '同学在想…',
      /** 分享态对话：空态卡后半句（接在 sharedBy 之后） */
      chatEmptyHint: '可以问我任何关于这节课的事。',
      /** 分享态对话顶栏状态 */
      chatStatusBusy: '在听',
      chatStatusReady: '就绪',
      /** 已撤销 / 已过期 */
      notFoundTitle: '这条分享暂时不可用',
      notFoundBody: '可能已被原作者撤回，或者链接打错了。',
      /** 404 态回首页链接 */
      backHome: '回 MeetMind 首页',
      /** 头部副标题：基于分享者昵称 */
      sharedBy: (nickname: string): string => `${nickname} 听完了这节课，留了一份给你`,
      /** 没有昵称兜底 */
      sharedByAnon: '一个同学听完了这节课，留了一份给你',
      /** 分享者昵称兜底（各处展示用） */
      sharerAnon: '一位同学',
      /** Octo 主图 alt */
      octoAlt: (nickname: string): string => `${nickname} 的学习同桌`,
      /** 凌晨加载态（Octo sleeping） */
      loadingSleeping: '夜深了 · 同学先打个盹',
      /** 转录摘要标题 */
      digestTitle: '这节课讲了什么',
      digestEmpty: '没附转录摘要，可以直接问同学这节课的事。',
      /** 转录摘要折叠提示：还有 N 段未展示 */
      digestMore: (count: number): string => `另 ${count} 段在同学的记忆里。`,
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
      doneCopy: '复制链接',
      doneCopied: '链接已复制',
      doneLinkCreated: '分享链接已生成',
      doneCopyFailed: '复制失败，请手动复制链接',
      doneCopying: '复制中...',
      fallbackTitle: '分享链接已生成',
      fallbackBody: '浏览器没有允许自动复制，可以直接复制下面的链接。',
      loginRequired: '先登录再分享',
      loginAction: '登录后继续',
      createFailed: '创建分享失败',
      currentAction: '分享',
      currentPreparing: '正在生成链接',
    },
  } as const;

export type ShareCopy = typeof SHARE_COPY;
