"use client";

/**
 * AI Elements · Tool（copy-in，源自 registry.ai-sdk.dev/tool）。
 * 适配：
 * - CodeBlock（shiki，重）未取，输入/输出用 <pre> 平铺——分身线只用它做
 *   账本式进度容器，不需要代码高亮
 * - 状态徽章文案走 COPY.aiElements.toolStatus（用户面字符串铁律）
 * - token 换 v7：border-divider / bg-paper-warm / text-ink*
 */

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { COPY } from "@/lib/ui/copy";
import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("not-prose mb-4 w-full rounded-md border border-divider bg-card", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
};

const getStatusBadge = (status: ToolUIPart["state"]) => {
  const labels = COPY.aiElements.toolStatus;

  const labelByState: Record<ToolUIPart["state"], string> = {
    "input-streaming": labels.pending,
    "input-available": labels.running,
    "approval-requested": labels.awaitingApproval,
    "approval-responded": labels.responded,
    "output-available": labels.completed,
    "output-error": labels.error,
    "output-denied": labels.denied,
  };

  const icons: Record<ToolUIPart["state"], ReactNode> = {
    "input-streaming": <CircleIcon className="size-4" />,
    "input-available": <ClockIcon className="size-4 animate-pulse" />,
    "approval-requested": <ClockIcon className="size-4 text-vermilion" />,
    "approval-responded": <CheckCircleIcon className="size-4 text-pine" />,
    "output-available": <CheckCircleIcon className="size-4 text-pine" />,
    "output-error": <XCircleIcon className="size-4 text-vermilion" />,
    "output-denied": <XCircleIcon className="size-4 text-vermilion" />,
  };

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {labelByState[status]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "group flex w-full items-center justify-between gap-4 p-3",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-ink-muted" />
      <span className="font-medium text-sm text-ink">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-ink-muted transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "text-ink outline-none",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
    <h4 className="font-medium text-ink-muted text-xs uppercase tracking-wide">
      {COPY.aiElements.toolInput}
    </h4>
    <pre className="overflow-x-auto rounded-md bg-paper-warm p-3 text-xs text-ink-secondary">
      {JSON.stringify(input, null, 2)}
    </pre>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <pre className="p-3 text-xs">{JSON.stringify(output, null, 2)}</pre>
    );
  } else if (typeof output === "string") {
    Output = <pre className="whitespace-pre-wrap p-3 text-xs">{output}</pre>;
  }

  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-ink-muted text-xs uppercase tracking-wide">
        {errorText ? COPY.aiElements.toolError : COPY.aiElements.toolResult}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-vermilion-mist text-vermilion"
            : "bg-paper-warm text-ink"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
