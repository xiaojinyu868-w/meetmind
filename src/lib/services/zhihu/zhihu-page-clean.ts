/**
 * 知乎页面去杂质：Firecrawl 抽回来的回答页 / 专栏页 Markdown → 只剩作者正文 + 少量元数据。
 *
 * 为什么需要它：开放平台不给正文（搜索 / 收藏 / 创作接口都只有摘要），正文只能抓页面；而页面里
 * 混着问题头、登录墙、作者卡、赞同栏、话题标签、「关于作者」——直接喂给老师会把"登录后你可以
 * 不限量看优质回答"当成课文念出来。
 *
 * 结构事实（2026-09-09 实测四类页面，见 DOMAIN.md「页面结构」）：
 * - 回答页：logo → [话题链接]* → # 问题标题 → 问题描述 → 关注者/被浏览/登录墙 → [查看全部 N 个回答]
 *           → 作者卡（头像 / 名字 / 签名 / ​关注；匿名用户只有头像 + 名字）→ 正文
 *           → [编辑于 YYYY-MM-DD HH:MM] / 阅读全文 / ​赞同 N​​M 条评论 → 分享 / 收起 / 查看全部
 * - 专栏页：[封面图] → logo → [标题图] → 正文 → [话题链接]* → ​赞同 N​​M 条评论 → 申请转载 → 关于作者…
 *
 * 纯函数、无 IO；找不到结构标记时退回"只去 logo 与实体链接"的保守清洗，并把 confident 置 false，
 * 让导入层如实标注"正文可能含页面杂质"，而不是装作干净。
 */

export type ZhihuPageKind = 'answer' | 'article' | 'question' | 'pin' | 'zvideo' | 'unknown';

export interface CleanedZhihuPage {
  kind: ZhihuPageKind;
  /** 回答页 = 问题标题；专栏页 = 文章标题（来自 Firecrawl metadata，去掉「 - 知乎」后缀） */
  title: string;
  /** 去杂质后的 Markdown 正文 */
  body: string;
  author: string | null;
  authorUrl: string | null;
  /** 页面上的「编辑于 / 发布于」时间，原样字符串（YYYY-MM-DD HH:MM） */
  editedAt: string | null;
  voteUpCount: number | null;
  commentCount: number | null;
  /** 回答页所属问题链接 */
  questionUrl: string | null;
  /** 结构标记都找到了才为 true；false 表示走了保守清洗，正文可能仍含页面杂质 */
  confident: boolean;
}

const ZWSP = '\u200b';
const LOGO_RE = /^!\[ZhiHu logo\]\(/;
const SEE_ALL_RE = /^\[查看全部\s*\d+\s*个回答\]\((https?:\/\/[^)]+)\)/;
const PEOPLE_LINK_RE = /^\[([^\]]+)\]\((https:\/\/www\.zhihu\.com\/people\/[^)]+)\)/;
const AVATAR_RE = /^\[?!\[/;
const FOLLOW_RE = new RegExp(`^[${ZWSP}\\s]*关注[${ZWSP}\\s]*$`);
const ANON_RE = /^匿名用户$/;
const EDITED_RE = /^\[?(编辑于|发布于)\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/;
const VOTE_RE = new RegExp(`^[${ZWSP}\\s]*赞同\\s*([\\d,]+)`);
const COMMENTS_RE = /([\d,]+)\s*条评论/;
const READ_MORE_RE = /^阅读全文/;
const TOPIC_LINK_RE = /^\[[^\]]+\]\(https:\/\/www\.zhihu\.com\/topic\/\d+\)\s*$/;
const ABOUT_AUTHOR_RE = /^关于作者\s*$/;
const ZHIDA_ENTITY_RE = /\[([^\]]+)\]\(https:\/\/zhida\.zhihu\.com\/search\?[^)]*\)/g;
const OUTLINK_RE = /https:\/\/link\.zhihu\.com\/\?target=([^)\s]+)/g;

export function detectZhihuPageKind(url: string): ZhihuPageKind {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'zhuanlan.zhihu.com' && /^\/p\/\d+/.test(u.pathname)) return 'article';
    if (host !== 'zhihu.com') return 'unknown';
    if (/\/answer\/\d+/.test(u.pathname)) return 'answer';
    if (/^\/question\/\d+\/?$/.test(u.pathname)) return 'question';
    if (/^\/pin\/\d+/.test(u.pathname)) return 'pin';
    if (/^\/zvideo\/\d+/.test(u.pathname)) return 'zvideo';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function stripZhihuTitleSuffix(title: string | undefined | null): string {
  return (title ?? '').replace(/\s*-\s*知乎\s*$/, '').trim();
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 正文内的通用清洗：直答实体链接只留文字、外链解包、logo 行删掉、空行压到最多两行 */
function polish(lines: string[]): string {
  return lines
    .filter((line) => !LOGO_RE.test(line))
    .join('\n')
    .replace(ZHIDA_ENTITY_RE, '$1')
    .replace(OUTLINK_RE, (_m, target: string) => {
      try {
        return decodeURIComponent(target);
      } catch {
        return target;
      }
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isBlank(line: string): boolean {
  return line.replace(new RegExp(ZWSP, 'g'), '').trim() === '';
}

function parseFooter(lines: string[], from: number): Pick<CleanedZhihuPage, 'editedAt' | 'voteUpCount' | 'commentCount'> {
  let editedAt: string | null = null;
  let voteUpCount: number | null = null;
  let commentCount: number | null = null;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    const edited = EDITED_RE.exec(line);
    if (edited && !editedAt) editedAt = edited[2];
    const vote = VOTE_RE.exec(line);
    if (vote && voteUpCount === null) {
      voteUpCount = toInt(vote[1]);
      const comments = COMMENTS_RE.exec(line);
      if (comments) commentCount = toInt(comments[1]);
    }
  }
  return { editedAt, voteUpCount, commentCount };
}

function cleanAnswer(lines: string[], title: string): CleanedZhihuPage {
  const seeAllIdx = lines.findIndex((l) => SEE_ALL_RE.test(l));
  const headingLine = lines.find((l) => /^#\s+/.test(l));
  const questionTitle = headingLine ? headingLine.replace(/^#\s+/, '').trim() : title;
  const questionUrl = seeAllIdx >= 0 ? (SEE_ALL_RE.exec(lines[seeAllIdx])?.[1] ?? null) : null;

  if (seeAllIdx < 0) {
    return {
      kind: 'answer',
      title: questionTitle,
      body: polish(lines),
      author: null,
      authorUrl: null,
      ...parseFooter(lines, 0),
      questionUrl,
      confident: false,
    };
  }

  // 作者卡：头像行 → 名字行（或「匿名用户」）→ [签名 → ​关注]
  let i = seeAllIdx + 1;
  let author: string | null = null;
  let authorUrl: string | null = null;
  const skipBlank = () => {
    while (i < lines.length && isBlank(lines[i])) i++;
  };
  skipBlank();
  if (i < lines.length && AVATAR_RE.test(lines[i])) i++;
  skipBlank();
  if (i < lines.length) {
    const people = PEOPLE_LINK_RE.exec(lines[i]);
    if (people) {
      author = people[1].trim();
      authorUrl = people[2];
      i++;
    } else if (ANON_RE.test(lines[i].trim())) {
      author = '匿名用户';
      i++;
    }
  }
  // 签名 + 关注按钮：只有在接下来两行内出现「关注」行时才把签名一起吃掉，否则正文从这里开始
  {
    let probe = i;
    let seenNonBlank = 0;
    let followIdx = -1;
    while (probe < lines.length && seenNonBlank < 2) {
      if (!isBlank(lines[probe])) {
        seenNonBlank++;
        if (FOLLOW_RE.test(lines[probe])) {
          followIdx = probe;
          break;
        }
      }
      probe++;
    }
    if (followIdx >= 0) i = followIdx + 1;
  }
  const bodyStart = i;

  let bodyEnd = lines.length;
  for (let j = bodyStart; j < lines.length; j++) {
    const line = lines[j];
    if (EDITED_RE.test(line) || VOTE_RE.test(line) || READ_MORE_RE.test(line) || SEE_ALL_RE.test(line)) {
      bodyEnd = j;
      break;
    }
  }

  return {
    kind: 'answer',
    title: questionTitle,
    body: polish(lines.slice(bodyStart, bodyEnd)),
    author,
    authorUrl,
    ...parseFooter(lines, bodyEnd),
    questionUrl,
    confident: true,
  };
}

function cleanArticle(lines: string[], title: string): CleanedZhihuPage {
  let start = 0;
  while (start < lines.length) {
    const line = lines[start];
    const isCoverOrLogo =
      isBlank(line) ||
      LOGO_RE.test(line) ||
      /^!\[\]\(https:\/\/zhuanlan\.zhihu\.com\/p\/\d+\)/.test(line) ||
      (title !== '' && line.startsWith(`![${title}](`));
    if (!isCoverOrLogo) break;
    start++;
  }

  const voteIdx = lines.findIndex((l, idx) => idx >= start && VOTE_RE.test(l));
  const aboutIdx = lines.findIndex((l, idx) => idx >= start && ABOUT_AUTHOR_RE.test(l));
  let end = voteIdx >= 0 ? voteIdx : aboutIdx >= 0 ? aboutIdx : lines.length;
  // 赞同栏上方紧挨着的话题标签也是页面杂质
  while (end > start && (isBlank(lines[end - 1]) || TOPIC_LINK_RE.test(lines[end - 1]))) end--;

  let author: string | null = null;
  let authorUrl: string | null = null;
  if (aboutIdx >= 0) {
    for (let j = aboutIdx + 1; j < lines.length; j++) {
      const people = PEOPLE_LINK_RE.exec(lines[j]);
      if (people) {
        author = people[1].trim();
        authorUrl = people[2];
        break;
      }
    }
  }

  return {
    kind: 'article',
    title,
    body: polish(lines.slice(start, end)),
    author,
    authorUrl,
    ...parseFooter(lines, end),
    questionUrl: null,
    confident: voteIdx >= 0 || aboutIdx >= 0,
  };
}

/** 问题页（没有具体回答）：只保留问题标题与描述，供「这是个什么问题」用；回答列表不在这里抓 */
function cleanQuestion(lines: string[], title: string): CleanedZhihuPage {
  const headingIdx = lines.findIndex((l) => /^#\s+/.test(l));
  const questionTitle = headingIdx >= 0 ? lines[headingIdx].replace(/^#\s+/, '').trim() : title;
  const descLines: string[] = [];
  if (headingIdx >= 0) {
    for (let j = headingIdx + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^关注者/.test(line.trim()) || SEE_ALL_RE.test(line)) break;
      descLines.push(line.replace(/显示全部\s*\u200b?\s*$/, ''));
    }
  }
  return {
    kind: 'question',
    title: questionTitle,
    body: polish(descLines),
    author: null,
    authorUrl: null,
    editedAt: null,
    voteUpCount: null,
    commentCount: null,
    questionUrl: null,
    confident: headingIdx >= 0,
  };
}

export function cleanZhihuPage(markdown: string, opts: { url: string; title?: string | null }): CleanedZhihuPage {
  const kind = detectZhihuPageKind(opts.url);
  const title = stripZhihuTitleSuffix(opts.title);
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  switch (kind) {
    case 'answer':
      return cleanAnswer(lines, title);
    case 'article':
      return cleanArticle(lines, title);
    case 'question':
      return cleanQuestion(lines, title);
    default:
      return {
        kind,
        title,
        body: polish(lines),
        author: null,
        authorUrl: null,
        editedAt: null,
        voteUpCount: null,
        commentCount: null,
        questionUrl: null,
        confident: false,
      };
  }
}
