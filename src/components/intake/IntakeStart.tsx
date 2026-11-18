/**
 * Opret case, step 1 "Selskab" (prototype "Opret case.dc.html", `sStart`): Velaris fills the
 * whole work area, a 44 px headline, and one large composer (radius 28, padding 18) with the
 * required field "Selskabets navn eller CVR", the three optional sources, the information meter
 * and "Find selskabet". A file dragged over the composer lights it up with a coral ring and
 * scales it 1 → 1.015 ("Drag og drop", smooth spring).
 *
 * The content is centred with `margin: auto 0` (not align-items on the scroller), so tall
 * content is never clipped at the top. The page must be usable without scrolling at about
 * 760 px height ("v4").
 *
 * "Nye i jeres indbakke" is passed in as `inbox` and is empty until real inbound rows
 * exist (no inbound webhook yet). See `InboxPills` in this folder.
 */
import { useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Building2 } from "lucide-react";
import { Velaris } from "@/components/ds/Velaris";
import { EASE, SPRING } from "@/lib/motion";
import { intakeReadiness } from "@/lib/cases/intake-readiness";
import { cn } from "@/lib/utils";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { ReadinessMeter } from "./ReadinessMeter";
import { SourceRows } from "./SourceRows";
import type { IntakeDraft } from "./types";

export function IntakeStart({
  draft,
  onChange,
  onPickFiles,
  onRemoveFile,
  onFind,
  deckError,
  invalidCvrHint,
  inbox,
}: {
  draft: IntakeDraft;
  onChange: (patch: Partial<IntakeDraft>) => void;
  onPickFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onFind: () => void;
  deckError: string | null;
  /** A short note under the name field, e.g. when the number is not a valid CVR. */
  invalidCvrHint?: string | null;
  /** `<InboxPills>` (renders nothing without real inbound mails). */
  inbox?: ReactNode;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const queryId = useId();
  const hintId = useId();
  const readiness = intakeReadiness(
    {
      query: draft.query,
      deckCount: draft.files.length,
      website: draft.website,
      notes: draft.notes,
    },
    language,
  );

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Moving over a child fires dragleave on the box: only reset when leaving the box.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) onPickFiles(files);
  };
  const onQueryKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (readiness.ok) onFind();
    }
  };
  const rise = (delay: number, duration: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.12 } }
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration, ease: EASE.out, delay },
        };

  return (
    <div className="relative isolate flex min-h-0 flex-1 justify-center overflow-auto px-4 py-4 md:px-8">
      <Velaris className="absolute inset-0 -z-10" />
      <div className="my-auto flex w-full max-w-[820px] flex-col items-center gap-3.5">
        <motion.h1
          className="m-0 shrink-0 text-center text-[clamp(30px,3.6vw,44px)] leading-[1.04] font-semibold tracking-display text-ink-1"
          {...rise(0, 0.62)}
        >
          {t("intake.start.heading")}
        </motion.h1>
        <motion.div
          className={cn(
            "box-border flex w-full shrink-0 flex-col gap-3 rounded-[28px] bg-surface p-[18px]",
            "transition-shadow duration-[260ms]",
            dragging
              ? "shadow-[0_0_0_2px_var(--ai),0_30px_80px_-24px_rgba(23,21,28,0.35)]"
              : "shadow-[0_1px_2px_rgba(23,21,28,0.05),0_30px_80px_-30px_rgba(23,21,28,0.28)]",
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, scale: dragging && !reduced ? 1.015 : 1 }}
          transition={
            reduced
              ? { duration: 0.12 }
              : {
                  opacity: { duration: 0.7, ease: EASE.out, delay: 0.12 },
                  y: { duration: 0.7, ease: EASE.out, delay: 0.12 },
                  scale: SPRING.smooth,
                }
          }
        >
          <div className="flex flex-col gap-1.5 px-1">
            <label htmlFor={queryId} className="text-list font-semibold text-ink-1">
              {t("intake.start.queryLabel")}
            </label>
            <span className="flex h-[54px] items-center gap-3 rounded-2xl bg-canvas px-4 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[box-shadow,background-color] duration-[var(--dur-quick)] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]">
              <Building2
                className="size-[18px] shrink-0 text-ink-4"
                strokeWidth={1.75}
                aria-hidden
              />
              <input
                id={queryId}
                value={draft.query}
                onChange={(event) => onChange({ query: event.target.value })}
                onKeyDown={onQueryKey}
                placeholder={t("intake.start.queryPlaceholder")}
                maxLength={200}
                autoComplete="off"
                aria-required
                aria-describedby={invalidCvrHint ? hintId : undefined}
                className="min-w-0 flex-1 bg-transparent text-[18px] font-medium text-ink-1 outline-none placeholder:text-ink-4"
              />
            </span>
            {invalidCvrHint && (
              <span id={hintId} className="text-meta text-ink-3">
                {invalidCvrHint}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="px-2 pt-1 pb-0.5 text-[18px] font-medium tracking-[-0.01em] text-ink-1">
              {t("intake.start.sourcesLead")}
            </span>
            <SourceRows
              draft={draft}
              onChange={onChange}
              onPickFiles={onPickFiles}
              onRemoveFile={onRemoveFile}
              dragging={dragging}
              deckError={deckError}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-line px-1.5 pt-3">
            <ReadinessMeter readiness={readiness} hintId="intake-readiness-hint" />
            <button
              type="button"
              onClick={() => {
                if (readiness.ok) onFind();
              }}
              aria-disabled={!readiness.ok}
              aria-describedby="intake-readiness-hint"
              className={cn(
                "inline-flex h-12 items-center gap-2 rounded-pill px-[22px] text-[15px] font-medium whitespace-nowrap text-ink-inverse outline-none transition-[background-color,transform] duration-300 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                readiness.ok
                  ? "cursor-pointer bg-inverse active:scale-[.97]"
                  : "cursor-not-allowed bg-ink-4",
              )}
            >
              {t("intake.start.findButton")}
              <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </motion.div>
        {inbox}
      </div>
    </div>
  );
}
