/**
 * The split button ("Split-knap: fast regel overalt"): the left part does the
 * recommended next step, a visible 1 px divider, the arrow on the right opens all actions.
 * Never one surface where text and arrow are the same button.
 *
 * Sizes from the prototypes: `md` 36 px in the case top (CaseStatus, 13 px label, coloured
 * 14 px icon), `sm` 34 px in list rows (Cases v4, 12 px label). The `nudge` variant is
 * inverted ink with "Ingen handling i N dage" in orange underneath (active case idle ≥ 7
 * days). The arrow rotates 180° with the smooth spring while the menu is open; each half has
 * its own hover surface and the divider stays still ("Split-knap").
 *
 * The menu's content is passed as children (MenuHeader, MenuLabel, MenuItem …).
 */
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { Menu, MenuContent, MenuTrigger, useMenuOpen, type MenuSize } from "@/components/ds/Menu";
import { useT } from "@/lib/i18n/useT";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function SplitButton({
  label,
  icon: Icon,
  iconColor,
  onPrimary,
  pending = false,
  size = "md",
  nudgeDays,
  nudgeNote = true,
  inverse = false,
  menuSize = "large",
  open,
  onOpenChange,
  disabled = false,
  children,
  className,
}: {
  label: ReactNode;
  icon?: LucideIcon;
  /** Icon colour as a CSS colour (token), e.g. "var(--ai)". Inherits the text colour if unset. */
  iconColor?: string;
  /** Runs the recommended step. Without it, the left part opens the menu too. */
  onPrimary?: () => void;
  /** The primary step is running: coral orb instead of the icon (AI work). */
  pending?: boolean;
  size?: "lg" | "md" | "sm";
  /** Days without action; 7 or more turns the button into the inverted nudge variant. */
  nudgeDays?: number;
  /**
   * The orange "Ingen handling i N dage" line under the nudge button (Cases v4). Off on Overblik:
   * its row already says it under the name (Overblik v2 only inverts the button).
   */
  nudgeNote?: boolean;
  /** Inverted ink without the nudge line (Opret case: "Start screening", 44 px). */
  inverse?: boolean;
  menuSize?: MenuSize;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Menu content. */
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const nudge = nudgeDays !== undefined && nudgeDays >= 7;
  const inverted = nudge || inverse;
  const md = size !== "sm";
  const lg = size === "lg";
  // Mixed from --ink-inverse (as Toast and BulkBar), so the nudge variant also reads in dark.
  const hover = inverted
    ? "hover:bg-[color-mix(in_oklab,var(--ink-inverse)_12%,transparent)]"
    : "hover:bg-hover";

  // The menu is controlled here, so a left half without its own step can open it without
  // being a second Radix trigger (one trigger: one id and one place for focus to return).
  const [uncontrolled, setUncontrolled] = useState(false);
  const isOpen = open ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (open === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  return (
    <Menu open={isOpen} onOpenChange={setOpen}>
      <span className={cn("inline-flex min-w-0 flex-col items-start gap-[3px]", className)}>
        <span
          className={cn(
            "inline-flex items-stretch rounded-pill transition-colors duration-200",
            lg ? "h-11" : md ? "h-9" : "h-[34px]",
            inverted ? "bg-inverse text-ink-inverse" : "bg-surface text-ink-1 shadow-pill",
            disabled && "pointer-events-none opacity-35",
          )}
        >
          {onPrimary ? (
            <button
              type="button"
              onClick={onPrimary}
              disabled={disabled || pending}
              aria-busy={pending || undefined}
              className={cn(
                "inline-flex items-center gap-[7px] rounded-l-pill pr-3 pl-3.5 font-medium whitespace-nowrap outline-none transition-[background-color,transform] duration-[var(--dur-quick)] active:scale-[.97] focus-visible:ring-2 focus-visible:ring-action",
                lg ? "text-[14px]" : md ? "text-list" : "text-meta",
                hover,
              )}
            >
              <PrimaryIcon icon={Icon} color={iconColor} pending={pending} md={md} />
              {label}
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              // Opens only: Radix closes it on the outside press that precedes this click.
              onClick={() => setOpen(true)}
              className={cn(
                "inline-flex items-center gap-[7px] rounded-l-pill pr-3 pl-3.5 font-medium whitespace-nowrap outline-none transition-[background-color,transform] duration-[var(--dur-quick)] active:scale-[.97] focus-visible:ring-2 focus-visible:ring-action",
                lg ? "text-[14px]" : md ? "text-list" : "text-meta",
                hover,
              )}
            >
              <PrimaryIcon icon={Icon} color={iconColor} pending={pending} md={md} />
              {label}
            </button>
          )}
          <span
            aria-hidden
            className={cn(
              "w-px",
              lg ? "my-[11px]" : md ? "my-[9px]" : "my-2",
              inverted
                ? "bg-[color-mix(in_oklab,var(--ink-inverse)_22%,transparent)]"
                : "bg-line-strong",
            )}
          />
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={t("shell.split.allActions")}
              title={t("shell.split.allActions")}
              disabled={disabled}
              className={cn(
                "grid place-items-center rounded-r-pill outline-none transition-colors duration-[var(--dur-quick)] focus-visible:ring-2 focus-visible:ring-action",
                lg ? "w-11" : md ? "w-9" : "w-[34px] pr-0.5",
                hover,
                inverted
                  ? "data-[state=open]:bg-[color-mix(in_oklab,var(--ink-inverse)_14%,transparent)]"
                  : "data-[state=open]:bg-sunken",
              )}
            >
              <Chevron reduced={Boolean(reduced)} />
            </button>
          </MenuTrigger>
        </span>
        {nudge && nudgeNote && (
          <span className="pl-1 text-micro whitespace-nowrap text-warning">
            {t("shell.split.idle", { days: nudgeDays ?? 0 })}
          </span>
        )}
      </span>
      <MenuContent size={menuSize} align="end">
        {children}
      </MenuContent>
    </Menu>
  );
}

function PrimaryIcon({
  icon: Icon,
  color,
  pending,
  md,
}: {
  icon: LucideIcon | undefined;
  color: string | undefined;
  pending: boolean;
  md: boolean;
}) {
  if (pending) return <AiOrb size={20} tone="ai" state="working" />;
  if (!Icon) return null;
  return (
    <Icon
      className={md ? "size-3.5" : "size-[13px]"}
      style={color ? { color } : undefined}
      strokeWidth={1.9}
      aria-hidden
    />
  );
}

/** Rotates 180° with the smooth spring while the surrounding menu is open. */
function Chevron({ reduced }: { reduced: boolean }) {
  const open = useMenuOpen();
  return (
    <motion.span
      className="grid place-items-center"
      initial={false}
      animate={{ rotate: open ? 180 : 0 }}
      transition={reduced ? { duration: 0 } : SPRING.smooth}
    >
      <ChevronDown className="size-[13px]" strokeWidth={2} aria-hidden />
    </motion.span>
  );
}
