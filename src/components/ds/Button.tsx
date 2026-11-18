/**
 * Buttons (Designsystem "Knapper og kontroller", "Komponenter").
 *
 * - `primary`: filled ink pill, one per screen; hover opacity .88.
 * - `secondary`: white pill with the pill shadow; hover the canvas colour.
 * - `quiet`: text pill, hover tint.
 * - `danger`: quiet destructive; turns critical on hover.
 * Heights 44 / 36 / 32 (`lg` / `md` / `sm`); `icon` is a round 44 px button. Press
 * scales to .97 (the press spring). While pending the label crossfades to an orb and a
 * word ("Screener…"); the width is locked when waiting starts, so it never jumps. AI work shows
 * the coral orb (`pending="ai"`), ordinary waiting the ink orb.
 *
 * `buttonClass()` gives the same look to links (`<Link className={buttonClass(...)}>`).
 */
import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { DURATION, EASE, PRESS } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "lg" | "md" | "sm";

const base =
  "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-pill font-medium outline-none transition-[background-color,color,opacity,box-shadow,transform] duration-[var(--dur-quick)] disabled:pointer-events-none disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-inverse text-ink-inverse hover:opacity-[.88]",
  secondary: "bg-surface text-ink-1 shadow-pill hover:bg-canvas",
  quiet: "bg-transparent text-ink-2 hover:bg-hover",
  danger: "bg-transparent text-ink-3 hover:bg-critical-wash hover:text-critical",
};

const sizes: Record<ButtonSize, string> = {
  lg: "h-11 gap-[9px] px-5 text-[14px]",
  md: "h-9 gap-2 px-4 text-list",
  sm: "h-8 gap-1.5 px-3 text-meta",
};

/** Quiet buttons have less side padding in the prototypes (16 instead of 20 at 44 px). */
const quietPadding: Record<ButtonSize, string> = { lg: "px-4", md: "px-3.5", sm: "px-2.5" };

export function buttonClass({
  variant = "secondary",
  size = "lg",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    base,
    variants[variant],
    sizes[size],
    (variant === "quiet" || variant === "danger") && quietPadding[size],
    "active:scale-[.97]",
    className,
  );
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "style" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd" | "onDragOver"
>;

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Pending: `true` shows the ink orb, `"ai"` the coral orb (AI is working). */
  pending?: boolean | "ai";
  /** Text while pending, e.g. "Screener…" or "Sender". Defaults to the label. */
  pendingLabel?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "lg",
    icon: Icon,
    pending = false,
    pendingLabel,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const reduced = useReducedMotion();
  const isPending = pending !== false;
  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  // The width is locked at the moment the button starts waiting ("Knapper"), so an
  // idle button is exactly as wide as the prototype's and never jumps when it waits.
  const innerRef = useRef<HTMLButtonElement | null>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (isPending && innerRef.current) setLockedWidth(innerRef.current.offsetWidth);
    if (!isPending) setLockedWidth(null);
  }, [isPending]);
  const setRefs = (node: HTMLButtonElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  const label = (
    <>
      {Icon && <Icon className={iconSize} strokeWidth={1.75} aria-hidden />}
      {children}
    </>
  );
  const onInverse = variant === "primary";
  const pendingContent = (
    <>
      <AiOrb
        size={20}
        tone={pending === "ai" ? "ai" : "neutral"}
        state="working"
        onDark={pending !== "ai" && onInverse}
      />
      <span>{pendingLabel ?? children}</span>
    </>
  );

  return (
    <motion.button
      ref={setRefs}
      type={type}
      disabled={disabled || isPending}
      {...(lockedWidth !== null ? { style: { minWidth: lockedWidth } } : {})}
      aria-busy={isPending || undefined}
      {...(reduced || disabled || isPending ? {} : { whileTap: PRESS.whileTap })}
      transition={PRESS.transition}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        (variant === "quiet" || variant === "danger") && quietPadding[size],
        // A pending button keeps its colours (not the 35 % disabled look).
        isPending && "disabled:opacity-100",
        className,
      )}
      {...props}
    >
      <span className="grid items-center">
        <AnimatePresence initial={false}>
          <motion.span
            key={isPending ? "pending" : "idle"}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center justify-center",
              size === "lg" ? "gap-[9px]" : size === "md" ? "gap-2" : "gap-1.5",
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.quick, ease: EASE.out }}
          >
            {isPending ? pendingContent : label}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
});

/** Round icon button (44 px, pill shadow). Needs an aria-label. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  NativeButtonProps & { icon: LucideIcon; "aria-label": string; size?: 44 | 36 | 32 }
>(function IconButton({ icon: Icon, size = 44, className, type = "button", ...props }, ref) {
  const reduced = useReducedMotion();
  const dimension = size === 44 ? "size-11" : size === 36 ? "size-9" : "size-8";
  return (
    <motion.button
      ref={ref}
      type={type}
      {...(reduced ? {} : { whileTap: { scale: 0.94 } })}
      transition={PRESS.transition}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-surface text-ink-2 shadow-pill outline-none transition-colors duration-[var(--dur-quick)] hover:bg-canvas hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action disabled:pointer-events-none disabled:opacity-35",
        dimension,
        className,
      )}
      {...props}
    >
      <Icon className={size === 44 ? "size-[17px]" : "size-4"} strokeWidth={1.75} aria-hidden />
    </motion.button>
  );
});
