import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ensureWechatInboxMessageHydrated } from '@/lib/services/wechat-inbox-service';

function formatMessageTime(value: Date | null): string {
  if (!value) return '刚刚收进来';

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function typeLabel(msgType: string): string {
  switch (msgType) {
    case 'text':
      return '文字';
    case 'voice':
      return '语音';
    case 'image':
      return '图片';
    case 'link':
      return '链接';
    case 'event':
      return '服务号事件';
    default:
      return '消息';
  }
}

export default async function WechatCapturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const message = await ensureWechatInboxMessageHydrated(token);

  if (!message) {
    notFound();
  }

  const primaryText =
    message.normalizedText || message.previewText || '这条收集已经替你记下来了。';

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 text-stone-900">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col gap-4">
        <section className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              微信收集
            </span>
            <span className="text-xs text-stone-500">{formatMessageTime(message.messageAt)}</span>
          </div>

          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-stone-950">
            这条内容已经进入你的收集流
          </h1>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            以后你可以像发微信一样，把语音、文字和链接直接丢给 MeetMind。重材料再从 H5 继续补。
          </p>

          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-stone-600">
              {typeLabel(message.msgType)}
            </span>
            {message.bindingStatus === 'bound' && message.workspace ? (
              <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                已接到 {message.workspace.name}
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-stone-500">
                暂未绑定工作区
              </span>
            )}
          </div>

          <div className="mt-4 rounded-[24px] bg-stone-50 px-4 py-4 text-sm leading-7 text-stone-800">
            {primaryText}
          </div>

          {message.sourceUrl ? (
            <a
              href={message.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block rounded-[20px] border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700"
            >
              来源链接：{message.sourceUrl}
            </a>
          ) : null}

          {message.echoTitle && message.echoBody ? (
            <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="text-sm font-medium text-amber-900">{message.echoTitle}</div>
              <p className="mt-2 text-sm leading-6 text-amber-900/80">{message.echoBody}</p>
            </div>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
          <h2 className="text-base font-semibold text-stone-900">下一步怎么继续</h2>
          <div className="mt-4 grid gap-3">
            <Link
              href={`/app?mobile=1&wechat_capture=${encodeURIComponent(token)}`}
              className="rounded-[20px] bg-stone-950 px-4 py-4 text-center text-sm font-medium text-white"
            >
              打开 H5 继续这一条收集
            </Link>
            <p className="rounded-[20px] bg-stone-50 px-4 py-4 text-sm leading-7 text-stone-600">
              如果你要补 PDF、课件、录音文件，或者继续进 Tutor 深挖，就从 H5 继续。
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
