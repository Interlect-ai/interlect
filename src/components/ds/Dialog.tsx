/**
 * Dialog (CaseStatus "Bekræft handling"): a blurred scrim and a centred 480 px panel with
 * radius 24 and 26 px of air. In with the smooth spring from y 14 and scale .97 (replacing
 * the prototype's cubic-bezier(.34,1.25,.64,1)); the scrim fades 240 ms. Radix handles focus,
 * Esc and the outside click; everything renders in a portal, so no ancestor transform can
 * move it ("Case-status", teknisk note).
 *
 * `ReasonDialog` is the status dialog: reason chips (multi-select), a note and the action.
 * It can only be confirmed with at least one reason or a note.
 */
import { useEffect, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ds/Button";
import type { MenuTone } from "@/components/ds/Menu";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING, exitTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  tone = { color: "ink-3", wash: "bg-sunken" },
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** 40 px tinted tile before the title. */
  icon?: LucideIcon;
  tone?: MenuTone;
  children?: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div
                className="fixed inset-0 z-[95] bg-[var(--scrim)] backdrop-blur-[4px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.24, ease: EASE.out } }}
                exit={{ opacity: 0, transition: exitTransition }}
              />
            </DialogPrimitive.Overlay>
            <div className="pointer-events-none fixed inset-0 z-[96] grid place-items-center p-5">
              <DialogPrimitive.Content
                forceMount
                asChild
                {...(description ? {} : { "aria-describedby": undefined })}
              >
                <motion.div
                  className={cn(
                    "pointer-events-auto flex max-h-[calc(100vh-40px)] w-[min(480px,calc(100vw-40px))] flex-col gap-[18px] overflow-auto rounded-[24px] bg-surface p-[26px] text-ink-1 shadow-[0_32px_80px_-20px_rgba(23,21,28,.45)] outline-none",
                    className,
                  )}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
                  animate={
                    reduced
                      ? { opacity: 1, transition: REDUCED_FADE }
                      : { opacity: 1, y: 0, scale: 1, transition: SPRING.smooth }
                  }
                  exit={{ opacity: 0, transition: reduced ? REDUCED_FADE : exitTransition }}
                >
                  <div className="flex items-center gap-3">
                    {Icon && (
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-[12px]"
                        style={{ background: `var(--${tone.wash})`, color: `var(--${tone.color})` }}
                      >
                        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col leading-[1.3]">
                      <DialogPrimitive.Title className="m-0 text-[20px] font-semibold tracking-[-0.015em]">
                        {title}
                      </DialogPrimitive.Title>
                      {description && (
                        <DialogPrimitive.Description className="m-0 text-list text-ink-3">
                          {description}
                        </DialogPrimitive.Description>
                      )}
                    </span>
                  </div>
                  {children}
                  {footer && <div className="flex justify-end gap-2">{footer}</div>}
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/** Reason chip: 36 px, radius 10; chosen = ink, else surface with a hairline ring. */
export function ReasonChip({
  selected,
  onClick,
  disabled = false,
  title,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  /** Can't be chosen now (e.g. the maximum is reached); a chosen chip can always be removed. */
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      {...(title ? { title } : {})}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-sm px-3.5 text-list font-medium whitespace-nowrap transition-[background-color,color,transform] duration-200 active:scale-[.96]",
        selected
          ? "bg-inverse text-ink-inverse"
          : "bg-surface text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)]",
        disabled && "cursor-default opacity-45 active:scale-100",
      )}
    >
      {children}
    </button>
  );
}

export interface ReasonResult {
  /** The chosen reasons' values (the label when the reasons are plain strings). */
  reasons: string[];
  note: string;
}

/** A reason with a stored value (e.g. a brain_reason_codes code) and a visible label. */
export interface ReasonOption {
  value: string;
  label: string;
}

const asOption = (reason: string | ReasonOption): ReasonOption =>
  typeof reason === "string" ? { value: reason, label: reason } : reason;

export function ReasonDialog({
  open,
  onOpenChange,
  question,
  confirmLabel,
  reasons,
  moreReasons,
  notePlaceholder,
  icon,
  tone,
  pending = false,
  footnote,
  error,
  maxReasons = 10,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: string;
  confirmLabel: string;
  reasons: readonly (string | ReasonOption)[];
  /** Further reasons behind "Flere årsager" (the fund's full list). */
  moreReasons?: readonly (string | ReasonOption)[];
  notePlaceholder: string;
  icon?: LucideIcon;
  tone?: MenuTone;
  pending?: boolean;
  /** Quiet line under the note, e.g. "Gælder 5 cases". */
  footnote?: ReactNode;
  /** A Danish error from the server, announced to screen readers. */
  error?: string | null;
  /** The most reasons one move can carry (the server's limit, harden SF1). */
  maxReasons?: number;
  onConfirm: (result: ReasonResult) => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [showMore, setShowMore] = useState(false);

  // A new question starts empty.
  useEffect(() => {
    if (open) {
      setChosen([]);
      setNote("");
      setShowMore(false);
    }
  }, [open, question]);

  const primary = reasons.map(asOption);
  const more = (moreReasons ?? []).map(asOption);
  // A chosen extra reason stays visible after "Færre årsager".
  const visibleMore = showMore ? more : more.filter((option) => chosen.includes(option.value));

  const ready = chosen.length > 0 || note.trim().length > 0;
  const full = chosen.length >= maxReasons;
  const toggle = (reason: string) =>
    setChosen((current) =>
      current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason],
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={question}
      description={t("shell.dialog.reasonDescription")}
      {...(icon ? { icon } : {})}
      {...(tone ? { tone } : {})}
      footer={
        <>
          <Button
            variant="quiet"
            size="md"
            className="h-[42px]"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("shell.dialog.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            className="h-[42px] px-5 text-[14px]"
            disabled={!ready}
            pending={pending}
            onClick={() => onConfirm({ reasons: chosen, note: note.trim() })}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {[...primary, ...visibleMore].map((reason) => (
          <ReasonChip
            key={reason.value}
            selected={chosen.includes(reason.value)}
            disabled={full && !chosen.includes(reason.value)}
            {...(full && !chosen.includes(reason.value)
              ? { title: t("shell.dialog.maxReasons", { count: maxReasons }) }
              : {})}
            onClick={() => toggle(reason.value)}
          >
            {reason.label}
          </ReasonChip>
        ))}
        {more.length > 0 && (
          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setShowMore((value) => !value)}
            className="inline-flex h-9 items-center rounded-sm px-2.5 text-list font-medium whitespace-nowrap text-ink-3 transition-colors hover:text-ink-1"
          >
            {showMore ? t("shell.dialog.fewerReasons") : t("shell.dialog.moreReasons")}
          </button>
        )}
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={notePlaceholder}
        aria-label={t("shell.dialog.note")}
        maxLength={2000}
        className="min-h-[84px] resize-y rounded-sm bg-canvas px-3.5 py-3 text-[14px] leading-[1.55] text-ink-1 shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow duration-[var(--dur-quick)] placeholder:text-ink-4 focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]"
      />
      {error ? (
        <p role="alert" className="m-0 -mt-1.5 text-meta text-critical">
          {error}
        </p>
      ) : (
        footnote && <p className="m-0 -mt-1.5 text-meta text-ink-3">{footnote}</p>
      )}
    </Dialog>
  );
}
