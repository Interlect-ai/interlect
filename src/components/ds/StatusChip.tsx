/**
 * A case's status ("Split-knap: fast regel", Cases v4 status column): a tinted,
 * non-clickable chip with the status icon in its signal colour and the word in ink.
 * 28 px high, 12/10 px padding, 7 px gap, 12 px icon, meta 500. It never grows beyond
 * its column (max-width 100 %, ellipsis).
 */
import {
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  Gavel,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";

export type CaseStatusKey = "active" | "on_hold" | "closed" | "invested" | "awaiting_decision";

/** `label` is the Danish word for callers without a language; render `labelKey` with `t()`. */
export const CASE_STATUS: Record<
  CaseStatusKey,
  { label: string; labelKey: MessageKey; icon: LucideIcon; color: string; wash: string }
> = {
  active: {
    label: translate("da", "cases.status.active"),
    labelKey: "cases.status.active",
    icon: CirclePlay,
    color: "var(--positive)",
    wash: "var(--positive-wash)",
  },
  on_hold: {
    label: translate("da", "cases.status.on_hold"),
    labelKey: "cases.status.on_hold",
    icon: CirclePause,
    color: "var(--warning)",
    wash: "var(--warning-wash)",
  },
  closed: {
    label: translate("da", "cases.status.closed"),
    labelKey: "cases.status.closed",
    icon: CircleX,
    color: "var(--ink-3)",
    wash: "var(--bg-sunken)",
  },
  invested: {
    label: translate("da", "cases.status.invested"),
    labelKey: "cases.status.invested",
    icon: CircleCheck,
    color: "var(--positive)",
    wash: "var(--positive-wash)",
  },
  awaiting_decision: {
    label: translate("da", "cases.status.awaiting_decision"),
    labelKey: "cases.status.awaiting_decision",
    icon: Gavel,
    color: "var(--warning)",
    wash: "var(--warning-wash)",
  },
};

/**
 * `sm` (28 px) in the Cases list, `md` (36 px, 12 px padding, 13 px icon) in the case top
 * next to the split button (CaseStatus).
 */
export function StatusChip({
  status,
  size = "sm",
  label,
  className,
}: {
  status: CaseStatusKey;
  size?: "sm" | "md";
  /** Overrides the word (e.g. "Afventer beslutning" is derived in the case top too). */
  label?: string;
  className?: string;
}) {
  const t = useT();
  const entry = CASE_STATUS[status];
  const Icon = entry.icon;
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-[7px] overflow-hidden rounded-pill text-meta font-medium whitespace-nowrap text-ink-1 transition-colors duration-300",
        size === "md" ? "h-9 px-3" : "h-7 pr-3 pl-2.5",
        className,
      )}
      style={{ background: entry.wash }}
    >
      <Icon
        className={cn("shrink-0", size === "md" ? "size-[13px]" : "size-3")}
        style={{ color: entry.color }}
        strokeWidth={2}
        aria-hidden
      />
      <span className="truncate">{label ?? t(entry.labelKey)}</span>
    </span>
  );
}
