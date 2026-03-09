import { notFound } from 'next/navigation';
import { ensureWechatInboxMessageHydrated } from '@/lib/services/wechat-inbox-service';
import WechatCaptureClient from './WechatCaptureClient';

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

  const isBound = message.bindingStatus === 'bound' && message.workspace;

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
            {isBound
              ? '这条内容已经进入你的收集流'
              : '先绑定 MeetMind 账号'}
          </h1>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            {isBound
              ? '以后你可以像发微信一样，把语音、文字和链接直接丢给 MeetMind。重材料再从 H5 继续补。'
              : '绑定之后，你发给服务号的内容会自动进入收集流，就像 flomo 一样随手记。'}
          </p>

          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-stone-600">
              {typeLabel(message.msgType)}
            </span>
            {isBound ? (
              <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                已接到 {message.workspace!.name}
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-amber-600">
                等待绑定
              </span>
            )}
          </div>

          {/* 图片预览 */}
          {message.msgType === 'image' && message.mediaUrl ? (
            <div className="mt-4 overflow-hidden rounded-[24px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={message.mediaUrl}
                alt="微信图片"
                className="w-full rounded-[24px] object-cover"
                loading="lazy"
              />
            </div>
          ) : null}

          {/* 语音消息 */}
          {message.msgType === 'voice' ? (
            <div className="mt-4 flex items-center gap-3 rounded-[24px] bg-stone-50 px-4 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-200">
                <svg className="h-5 w-5 text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <div className="flex-1 text-sm leading-7 text-stone-800">
                {primaryText !== '这条收集已经替你记下来了。' ? primaryText : '语音消息（识别结果待处理）'}
              </div>
            </div>
          ) : null}

          {/* 文字/链接消息内容 */}
          {message.msgType !== 'image' && message.msgType !== 'voice' ? (
            <div className="mt-4 rounded-[24px] bg-stone-50 px-4 py-4 text-sm leading-7 text-stone-800">
              {primaryText}
            </div>
          ) : null}

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

        <WechatCaptureClient
          token={token}
          isBound={!!isBound}
          openId={message.openId}
          workspaceName={message.workspace?.name}
        />
      </div>
    </main>
  );
}
