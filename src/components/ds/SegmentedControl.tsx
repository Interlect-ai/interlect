/**
 * Pill group for sub-levels of a page ("App-skal": sunken track, the indicator is a surface pill
 * with the pill shadow that slides between the options). The indicator moves
 * with `layoutId` and the snappy spring; the text changes colour in 160 ms.
 *
 * Sizes measured in the prototypes:
 * - `md` (Designsystem tabs): track padding 4, 32 px options, 13/500, count in 11 px ink-4.
 * - `sm` (Screening | Dyb analyse, Noter | Beskeder): track padding 3, 30 px options, 12/500.
 * An option can carry a 7 px dot (e.g. the specialist colour on "Dyb analyse").
 *
 * By default a radio group: one tab stop, the arrow keys (and Home/End) move and select, like a
 * native segmented control. With `tabs` it is a real tablist (role tablist/tab, aria-selected,
 * roving tabindex, and aria-controls on the selected tab pointing at `${tabs.idPrefix}-panel`;
 * the page gives its panel role="tabpanel" with that id and aria-labelledby
 * `${tabs.idPrefix}-tab-${value}`). Arrow keys still select as they move (automatic activation).
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | string;
  /** Dot colour as a CSS colour (use a token: "var(--ai)"). */
  dot?: string;
  /** Shown in front of the label instead of the dot (a specialist's figure). */
  icon?: ReactNode;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  "aria-label": ariaLabel,
  className,
  tabs,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  "aria-label": string;
  className?: string;
  /** Make this a real tablist; see the file comment. */
  tabs?: { idPrefix: string };
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter((option) => !option.disabled);
  // The tab stop: the selected option, or the first enabled one when nothing valid is selected.
  const tabStop = enabled.some((option) => option.value === value) ? value : enabled[0]?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key) || enabled.length === 0) return;
    event.preventDefault();
    const current = enabled.findIndex((option) => option.value === value);
    const last = enabled.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? current <= 0
              ? last
              : current - 1
            : current >= last
              ? 0
              : current + 1;
    const target = enabled[next];
    if (!target) return;
    if (target.value !== value) onChange(target.value);
    group.current
      ?.querySelector<HTMLButtonElement>(`[data-segment="${CSS.escape(target.value)}"]`)
      ?.focus();
  };

  return (
    <LayoutGroup id={id}>
      <div
        ref={group}
        role={tabs ? "tablist" : "radiogroup"}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn(
          "relative inline-flex max-w-full flex-none gap-0.5 overflow-x-auto rounded-pill bg-sunken whitespace-nowrap [scrollbar-width:none]",
          size === "md" ? "p-1" : "p-[3px]",
          className,
        )}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              {...(tabs
                ? {
                    role: "tab",
                    id: `${tabs.idPrefix}-tab-${option.value}`,
                    "aria-selected": active,
                    "aria-controls": active ? `${tabs.idPrefix}-panel` : undefined,
                  }
                : { role: "radio", "aria-checked": active })}
              data-segment={option.value}
              tabIndex={option.value === tabStop ? 0 : -1}
              disabled={option.disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative inline-flex flex-none items-center gap-[7px] rounded-pill px-3.5 font-medium outline-none transition-[color,transform] duration-[var(--dur-quick)] active:scale-[.97]",
                "focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-40",
                size === "md" ? "h-8 text-list" : "h-[30px] text-meta",
                active ? "text-ink-1" : "text-ink-3 hover:text-ink-1",
              )}
            >
              {active && (
                <motion.span
                  layoutId="segment-indicator"
                  className="absolute inset-0 rounded-pill bg-surface shadow-pill"
                  transition={reduced ? { duration: 0 } : SPRING.snappy}
                  aria-hidden
                />
              )}
              <span className="relative inline-flex items-center gap-[7px]">
                {option.icon ? (
                  <span className="inline-flex shrink-0" aria-hidden>
                    {option.icon}
                  </span>
                ) : option.dot ? (
                  <span
                    className="size-[7px] shrink-0 rounded-full"
                    style={{ background: option.dot }}
                    aria-hidden
                  />
                ) : null}
                {/* A long label (a team's own specialist) ends in an ellipsis instead of pushing the
                    last tab out of view. */}
                <span
                  className="max-w-[170px] truncate"
                  {...(typeof option.label === "string" ? { title: option.label } : {})}
                >
                  {option.label}
                </span>
                {option.count !== undefined && (
                  <span className="text-micro text-ink-4">{option.count}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
