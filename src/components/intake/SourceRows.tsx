/**
 * The three always-visible, combinable source rows on the Opret case start screen ("kilder v3",
 * prototype "Opret case.dc.html"): Pitch deck (drop row that becomes file chips
 * plus "Flere filer"), Hjemmeside (URL field) and Jeres noter (field that grows on focus).
 * Each row has an icon tile that gets a green check with a spring once it is filled in.
 *
 * Values measured in the prototype: rows grid 40 px / 1fr, gap 14, padding 10/4; tile radius 12,
 * 17 px icon in its series colour at 14 %; check badge 18 px, offset -4, ring 2 px surface;
 * drop row 46 px, radius 14, inset 1.5 px ring in coral at 35 % (full coral on hover/drag).
 * The drop row is a real button, so the deck can be chosen with the keyboard.
 */
import { useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, FileText, Globe, PencilLine, Plus, Presentation, Upload, X } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { CASE_FILE_ACCEPT } from "@/lib/cases/case-files";
import { countWords } from "@/lib/cases/intake-readiness";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/useT";
import type { IntakeDraft } from "./types";

const FIELD =
  "rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none transition-shadow duration-[var(--dur-quick)] focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]";

function Tile({
  icon: Icon,
  color,
  done,
}: {
  icon: typeof Presentation;
  /** CSS colour (token) of the series colour. */
  color: string;
  done: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <span
      className="relative grid size-10 place-items-center rounded-xl text-[17px]"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      <Icon className="size-[17px]" strokeWidth={1.75} aria-hidden />
      <motion.span
        className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-positive text-white shadow-[0_0_0_2px_var(--bg-surface)]"
        initial={false}
        animate={{ scale: done ? 1 : 0 }}
        transition={reduced ? { duration: 0.12 } : SPRING.snappy}
        aria-hidden
      >
        <Check className="size-2.5" strokeWidth={3} />
      </motion.span>
    </span>
  );
}

function Row({ tile, title, children }: { tile: ReactNode; title: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-3.5 px-1 py-2.5">
      {tile}
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-[15px] font-semibold">{title}</span>
          <span className="text-meta text-ink-3">{t("intake.sources.optional")}</span>
        </span>
        {children}
      </div>
    </div>
  );
}

export function SourceRows({
  draft,
  onChange,
  onPickFiles,
  onRemoveFile,
  dragging,
  deckError,
}: {
  draft: IntakeDraft;
  onChange: (patch: Partial<IntakeDraft>) => void;
  onPickFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  /** A file is dragged over the composer: the drop row lights up. */
  dragging: boolean;
  deckError: string | null;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const fileInput = useRef<HTMLInputElement>(null);
  const [notesFocused, setNotesFocused] = useState(false);
  const websiteId = useId();
  const notesId = useId();
  const deckErrorId = useId();
  const words = countWords(draft.notes);
  const hasFiles = draft.files.length > 0;
  const openPicker = () => fileInput.current?.click();
  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    onPickFiles(Array.from(event.target.files ?? []));
    // The same file can be chosen again after it has been removed.
    event.target.value = "";
  };

  return (
    <div className="flex flex-col rounded-[20px] bg-canvas px-3.5 py-1">
      <Row
        title={t("intake.sources.deck")}
        tile={<Tile icon={Presentation} color="var(--series-3)" done={hasFiles} />}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={CASE_FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={onInput}
        />
        {!hasFiles ? (
          <button
            type="button"
            onClick={openPicker}
            aria-describedby={deckError ? deckErrorId : undefined}
            className={cn(
              "flex h-[46px] cursor-pointer items-center gap-2.5 rounded-[14px] bg-surface px-4 text-left text-list text-ink-2 outline-none transition-shadow duration-200 focus-visible:ring-2 focus-visible:ring-action",
              dragging
                ? "shadow-[inset_0_0_0_1.5px_var(--ai)]"
                : "shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--ai)_35%,transparent)] hover:shadow-[inset_0_0_0_1.5px_var(--ai)]",
            )}
          >
            <Upload className="size-4 text-ai" strokeWidth={1.75} aria-hidden />
            <span>
              {t("intake.sources.dropBefore")}
              <span className="font-medium text-ai-ink">{t("intake.sources.dropPick")}</span>
            </span>
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {draft.files.map((file, index) => (
              <motion.span
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className="inline-flex h-11 items-center gap-2.5 rounded-xl bg-surface pr-1.5 pl-3.5 text-list shadow-pill"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={reduced ? { duration: 0.12 } : SPRING.smooth}
              >
                <FileText className="size-4 text-series-3" strokeWidth={1.75} aria-hidden />
                <span className="max-w-[260px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(index)}
                  aria-label={t("intake.sources.remove", { name: file.name })}
                  className="grid size-[26px] place-items-center rounded-full text-ink-4 outline-none transition-colors hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </motion.span>
            ))}
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3.5 text-meta font-medium whitespace-nowrap text-ink-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("intake.sources.moreFiles")}
            </button>
          </div>
        )}
        {deckError && (
          <span id={deckErrorId} role="alert" className="text-meta text-critical">
            {deckError}
          </span>
        )}
      </Row>
      <div className="ml-[58px] h-px bg-line" />
      <Row
        title={t("intake.sources.website")}
        tile={<Tile icon={Globe} color="var(--series-5)" done={draft.website.trim().length > 0} />}
      >
        <div className={cn("flex h-[46px] items-center gap-2.5 px-4", FIELD)}>
          <input
            id={websiteId}
            value={draft.website}
            onChange={(event) => onChange({ website: event.target.value })}
            placeholder={t("intake.sources.websitePlaceholder")}
            aria-label={t("intake.sources.website")}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink-1 outline-none placeholder:text-ink-4"
          />
        </div>
      </Row>
      <div className="ml-[58px] h-px bg-line" />
      <Row
        title={t("intake.sources.notes")}
        tile={<Tile icon={PencilLine} color="var(--action)" done={words >= 10} />}
      >
        <textarea
          id={notesId}
          value={draft.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          onFocus={() => setNotesFocused(true)}
          onBlur={() => setNotesFocused(false)}
          placeholder={t("intake.sources.notesPlaceholder")}
          aria-label={t("intake.sources.notes")}
          maxLength={20_000}
          className={cn(
            "resize-y px-4 py-[11px] text-[15px] leading-[1.5] text-ink-1 placeholder:text-ink-4",
            "transition-[min-height,box-shadow] duration-[360ms] ease-[var(--ease-standard)]",
            FIELD,
            "focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]",
            draft.notes.trim() || notesFocused ? "min-h-24" : "min-h-[46px]",
          )}
        />
      </Row>
    </div>
  );
}
