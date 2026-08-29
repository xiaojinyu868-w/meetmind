"use client";

/**
 * AI Elements · Message（copy-in，源自 registry.ai-sdk.dev/message，只取需要的三件：
 * Message / MessageContent / MessageResponse；branch、attachment、toolbar 未取）。
 * v7 适配：user 气泡 = vermilion-mist（学生此刻），assistant = 纸面正文；
 * markdown 流式渲染走 Streamdown（AI SDK 同宗）。
 */

import { cn } from "@/lib/utils";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown, type PluginConfig } from "streamdown";
// CJK 友好强调：CommonMark 侧翼规则会让 `的**"xxx"**这` 这类
// 中文引号紧贴 ** 的加粗不解析；与底座 StreamingMarkdown 的
// remark-cjk-friendly 对齐，保证迁移后 CJK 加粗不回归
import remarkCjkFriendly from "remark-cjk-friendly";

/**
 * Streamdown 官方 cjk 插件通道（plugins.cjk.remarkPluginsBefore 在 gfm 前执行，
 * 正是 remark-cjk-friendly 的设计位置）；用默认 remark/rehype 链不变
 */
const CJK_PLUGINS: PluginConfig = {
  cjk: {
    name: "cjk",
    type: "cjk",
    remarkPlugins: [],
    remarkPluginsBefore: [remarkCjkFriendly],
    remarkPluginsAfter: [],
  },
};

export type MessageRole = "user" | "assistant" | "system";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: MessageRole;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm leading-relaxed",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-vermilion-mist group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-ink",
      "group-[.is-assistant]:text-ink",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// memo 比较 children：流式追加时只有活动气泡重渲染（官方原语，保留）
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      plugins={CJK_PLUGINS}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

MessageResponse.displayName = "MessageResponse";
