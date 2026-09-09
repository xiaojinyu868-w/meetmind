/**
 * lesson-title-generic — "这个标题有没有信息量"的唯一判定
 *
 * 之前六处各自维护一份零信息标题名单（lesson-title-service / lessonAdapter /
 * share-artifact-model / db/sessions / course-context / global-ask-desk），
 * 而决定"要不要自动重命名"的服务端那份恰恰最不完整：`课堂录音` 这个产品自己
 * 写下的默认标题不在名单里，线上 152 条课永远停在这个名字上。这里收口成一份，
 * 服务端与客户端共用；名单只列**产品自己会写下的默认值**和**纯时间 / 纯 ID / 纯 URL**
 * 这类形态，不猜用户可能合法输入的词。
 *
 * 纯函数，无依赖，可被 lib/db、lib/utils、services、components 任意一层引用。
 */

/** 产品各条路径会自动写下的默认标题（去首尾空白后精确匹配） */
export const PLACEHOLDER_LESSON_TITLES: ReadonlySet<string> = new Set([
  '课堂',
  '课堂录音',
  '课堂回顾',
  '课堂学习',
  '未命名课堂',
  '新课堂',
  '一节课',
  '未知学科',
  '未知课程',
  '视频复习',
  '录音',
  '屏幕截图',
  '图片材料',
  '微信随手记',
  '微信图片',
  '微信语音',
  '微信服务号消息',
  '正片', // B 站分 P 默认名
  '文档',
  '资料',
  '材料',
  '笔记',
  '学习',
  '内容',
  '总结',
]);

const PLACEHOLDER_PREFIX = /^(?:录音|屏幕截图|图片材料|微信(?:图片|语音|随手记|服务号消息))(?:\s*[·:：\-—]?\s*\d{1,2}:\d{2}(?::\d{2})?)?$/u;
const PURE_ID = /^\d{6,}$/u;
const TIME_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*的课)?$/u;
const DATE_ONLY = /^(?:20\d{2}[./-])?\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2})?(?:\s*的课)?$/u;
const CJK_DATE_ONLY = /^\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s+\d{1,2}:\d{2})?(?:\s*的课)?$/u;
const WEEKDAY_ONLY = /^周[一二三四五六日天](?:的课)?$/u;
const URL_LIKE = /^(?:https?:\/\/|www\.)/iu;
const KNOWN_HOSTS = /(?:bilibili\.com|b23\.tv|youtube\.com|youtu\.be|mp\.weixin\.qq\.com)/iu;

/**
 * 标题是不是零信息（默认占位 / 纯时间 / 纯 ID / URL）。
 * 返回 true 表示"值得让理解层重新起名"，也表示"UI 不该把它当课名念出来"。
 */
export function isPlaceholderLessonTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_LESSON_TITLES.has(trimmed)) return true;
  if (PLACEHOLDER_PREFIX.test(trimmed)) return true;
  if (PURE_ID.test(trimmed)) return true;
  if (TIME_ONLY.test(trimmed) || DATE_ONLY.test(trimmed) || CJK_DATE_ONLY.test(trimmed) || WEEKDAY_ONLY.test(trimmed)) return true;
  if (URL_LIKE.test(trimmed) || KNOWN_HOSTS.test(trimmed)) return true;
  return false;
}
