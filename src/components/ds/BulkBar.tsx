/**
 * Bulk bar (Cases v4 "Flere på én gang"): an ink pill at the bottom centre with "N valgt",
 * the bulk actions and a clear button. The action that fits the selected cases' phase is
 * highlighted in coral ("Handlinger v2"). Motion as the toast: y 24 → 0 and
 * scale .96 → 1 with the smooth spring; out y 12 and fade.
 *
 * The translucent button surfaces are mixed from --ink-inverse, so the bar also reads in
 * the dark theme where the inverse surface is light.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface BulkAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Coral: the action that fits all selected cases. */
  highlighted?: boolean;
  disabled?: boolean;
  /** Why it is disabled (tooltip and screen readers). */
  disabledReason?: string;
}

export function BulkBar({
  count,
  actions,
  onClear,
}: {
  /** Number of selected rows; the bar shows from 1. */
  count: number;
  actions: readonly BulkAction[];
  onClear: () => void;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  return (
    <AnimatePresence>
      {count > 0 && (
        // z 60: above Spørg Interlect (z 50), so its actions stay clickable on narrow screens.
        <motion.div
          role="toolbar"
          aria-label={t("shell.bulk.selected", { count })}
          className="fixed bottom-7 left-1/2 z-[60] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-pill bg-inverse py-2 pr-2 pl-[18px] text-ink-inverse shadow-[0_24px_60px_-18px_rgba(23,21,28,.5)] [scrollbar-width:none]"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
          animate={
            reduced
              ? { opacity: 1, transition: REDUCED_FADE }
              : { opacity: 1, y: 0, scale: 1, transition: SPRING.smooth }
          }
          exit={
            reduced
              ? { opacity: 0, transition: REDUCED_FADE }
              : { opacity: 0, y: 12, transition: { duration: 0.16, ease: EASE.in } }
          }
        >
          <span className="shrink-0 pr-2 text-[14px] font-semibold whitespace-nowrap">
            {t("shell.bulk.selected", { count })}
          </span>
          {actions.map((action) => {
            const Icon = action.icon;
            const reason = action.disabled ? action.disabledReason : undefined;
            return (
              <button
                key={action.key}
                type="button"
                onClick={action.disabled ? undefined : action.onClick}
                aria-disabled={action.disabled || undefined}
                {...(reason ? { title: reason, "aria-description": reason } : {})}
                className={cn(
                  "inline-flex h-[38px] shrink-0 items-center gap-[7px] rounded-pill px-[15px] text-list font-medium whitespace-nowrap transition-[background-color,transform] duration-[var(--dur-quick)] active:scale-[.96] aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:active:scale-100",
                  action.highlighted
                    ? "bg-ai text-ink-inverse hover:bg-[color-mix(in_oklab,var(--ai)_86%,white)]"
                    : "bg-[color-mix(in_oklab,var(--ink-inverse)_8%,transparent)] hover:bg-[color-mix(in_oklab,var(--ink-inverse)_18%,transparent)]",
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.9} aria-hidden />
                {action.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onClear}
            title={t("shell.bulk.clear")}
            aria-label={t("shell.bulk.clear")}
            className="grid size-[38px] shrink-0 place-items-center rounded-full opacity-70 transition-[opacity,background-color] hover:bg-[color-mix(in_oklab,var(--ink-inverse)_12%,transparent)] hover:opacity-100"
          >
            <X className="size-4" strokeWidth={1.9} aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
