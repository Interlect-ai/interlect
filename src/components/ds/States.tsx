/**
 * Shared states for rebuilt pages ("EmptyState / ErrorState / NoAccess": orb and a way back).
 * Measured on the "Kun for admins" screen in Brugere og
 * adgang: centred, max 420 px, 56 px tile (radius 16, sunken, ink-3 icon 22 px), title
 * 24/600 with title tracking, 15/1.55 ink-3 text, 14 px gaps, rising in over 500 ms.
 *
 * Loading always uses the orb (never a spinner): neutral ink for ordinary waiting.
 * Error text is written for people; raw error messages are never shown.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CircleAlert, Inbox, LockKeyhole, type LucideIcon } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

function StateFrame({
  icon,
  title,
  body,
  children,
  role,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div className={cn("grid min-h-full place-items-center px-4 py-10 md:p-10", className)}>
      <motion.div
        role={role}
        className="flex max-w-[420px] flex-col items-center gap-3.5 text-center"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.5, ease: EASE.out }}
      >
        {icon}
        <span className="text-[24px] font-semibold tracking-title">{title}</span>
        {body && <span className="text-[15px] leading-[1.55] text-ink-3">{body}</span>}
        {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
      </motion.div>
    </div>
  );
}

function Tile({
  icon: Icon,
  tone = "neutral",
}: {
  icon: LucideIcon;
  tone?: "neutral" | "critical";
}) {
  return (
    <span
      className={cn(
        "grid size-14 place-items-center rounded-[16px]",
        tone === "critical" ? "bg-critical-wash text-critical" : "bg-sunken text-ink-3",
      )}
    >
      <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** Nothing here yet; optionally one action (a way forward or back). */
export function EmptyState({
  title,
  body,
  icon = Inbox,
  children,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  icon?: LucideIcon;
  /** Buttons or links. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <StateFrame
      icon={<Tile icon={icon} />}
      title={title}
      body={body}
      {...(className ? { className } : {})}
    >
      {children}
    </StateFrame>
  );
}

/** Waiting: the neutral orb at 64 px and a short line (or the coral orb for AI work). */
export function LoadingState({
  title,
  ai = false,
  className,
}: {
  title?: string;
  /** AI is working (coral) rather than ordinary waiting (ink). */
  ai?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("grid min-h-[240px] place-items-center px-4 py-10", className)}
    >
      <span className="flex flex-col items-center gap-3.5 text-center">
        <AiOrb size={64} tone={ai ? "ai" : "neutral"} state={ai ? "searching" : "working"} />
        <span className="text-list text-ink-3">{title ?? t("common.loading")}</span>
      </span>
    </div>
  );
}

/** Something failed: a human sentence and "Prøv igen" (never the raw error). */
export function ErrorState({
  title,
  body,
  onRetry,
  children,
  className,
}: {
  title?: ReactNode;
  body?: ReactNode;
  onRetry?: (() => void) | undefined;
  children?: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <StateFrame
      role="alert"
      icon={<Tile icon={CircleAlert} tone="critical" />}
      title={title ?? t("shell.states.errorTitle")}
      body={body ?? t("shell.states.errorBody")}
      {...(className ? { className } : {})}
    >
      {onRetry && (
        <Button variant="secondary" size="md" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
      {children}
    </StateFrame>
  );
}

/** The role does not give access ("Kun for admins" in Brugere og adgang). */
export function NoAccess({
  title,
  body,
  children,
  className,
}: {
  title?: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <StateFrame
      icon={<Tile icon={LockKeyhole} />}
      title={title ?? t("shell.states.noAccessTitle")}
      body={body ?? t("shell.states.noAccessBody")}
      {...(className ? { className } : {})}
    >
      {children}
    </StateFrame>
  );
}
