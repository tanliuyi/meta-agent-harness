import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { useState } from "react";
import type {
  MainAgentDraftContext,
  MainAgentSelection,
  MainAgentSessionSnapshot,
} from "../../../../shared/main-agent-contracts.ts";
import { cn } from "../../shared/lib/cn.ts";
import { Popover } from "../../shared/ui/popover.tsx";
import { PopoverContent } from "../../shared/ui/popover-content.tsx";
import { PopoverTrigger } from "../../shared/ui/popover-trigger.tsx";
import { Tooltip } from "../../shared/ui/tooltip.tsx";
import { TooltipContent } from "../../shared/ui/tooltip-content.tsx";
import { TooltipTrigger } from "../../shared/ui/tooltip-trigger.tsx";

interface MainAgentSelectProps {
  context: MainAgentDraftContext | null;
  inheritedProfile?: MainAgentSessionSnapshot | null;
  inherited?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onInherit?(): void;
  onValueChange(selection: MainAgentSelection): void;
}

export type MainAgentSelectOption =
  | { kind: "inherit-parent"; id: string; revision: number; name: string; description: string; builtin: boolean }
  | {
      kind: "profile";
      id: string;
      revision: number;
      name: string;
      description: string;
      builtin: boolean;
    };

export function mainAgentSelectOptions(
  context: MainAgentDraftContext | null,
  inheritedProfile?: MainAgentSessionSnapshot | null,
): MainAgentSelectOption[] {
  const inherited = inheritedProfile
    ? [
        {
          kind: "inherit-parent" as const,
          id: inheritedProfile.profileId,
          revision: inheritedProfile.profileRevision,
          name: inheritedProfile.profileName,
          description: "使用父会话的创建时配置快照",
          builtin: inheritedProfile.profileId === "desktop-default",
        },
      ]
    : [];
  const profiles =
    context?.profiles.flatMap((profile) =>
      inheritedProfile &&
      profile.id === inheritedProfile.profileId &&
      profile.revision === inheritedProfile.profileRevision
        ? []
        : [{ kind: "profile" as const, ...profile }],
    ) ?? [];
  return [...inherited, ...profiles];
}

/** Main-session profile picker. This does not select or launch delegated subagents. */
export function MainAgentSelect({
  context,
  inheritedProfile,
  inherited = false,
  disabled = false,
  loading = false,
  onInherit,
  onValueChange,
}: MainAgentSelectProps) {
  const [open, setOpen] = useState(false);
  const options = mainAgentSelectOptions(context, inheritedProfile);
  const selected = inherited
    ? options.find((option) => option.kind === "inherit-parent")
    : options.find(
        (option) =>
          option.kind === "profile" &&
          option.id === context?.selection.id &&
          option.revision === context.selection.revision,
      );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={1000}>
        <TooltipTrigger asChild>
          <PopoverTrigger
            role="combobox"
            aria-label={loading ? "正在加载智能体" : "选择主智能体"}
            aria-busy={loading || undefined}
            disabled={disabled || loading || !context}
            className={cn(
              "flex h-7 min-w-0 max-w-44 items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-muted-foreground outline-none",
              "hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Bot className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{selected?.name ?? (loading ? "加载智能体" : "智能体")}</span>
            {inherited ? <span className="shrink-0 text-[10px] text-muted-foreground">继承</span> : null}
            <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">选择主会话智能体</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-(--stack-menu) max-h-[min(24rem,var(--radix-popover-content-available-height))] w-72 overflow-y-auto rounded-lg p-1"
      >
        <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">主会话智能体</div>
        {options.map((option) => {
          const active =
            option.kind === "inherit-parent"
              ? inherited
              : !inherited && option.id === context?.selection.id && option.revision === context.selection.revision;
          return (
            <button
              key={`${option.kind}:${option.id}:${option.revision}`}
              type="button"
              className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => {
                setOpen(false);
                if (option.kind === "inherit-parent") onInherit?.();
                else onValueChange({ id: option.id, revision: option.revision });
              }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                {active ? <Check className="size-3.5" aria-hidden="true" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                  <span className="truncate">{option.name}</span>
                  {option.builtin ? <span className="shrink-0 text-[10px] text-muted-foreground">内置</span> : null}
                  {option.kind === "inherit-parent" ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">父会话快照</span>
                  ) : null}
                </span>
                {option.description ? (
                  <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
