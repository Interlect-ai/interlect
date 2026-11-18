/**
 * The answer to a mandate requirement (Case Screening v5, Mandatfit "Mangler svar" and "Skal
 * afklares"; "Næste skridt": "Gem og genberegn" saves as told by the analyst and the code score is
 * calculated again). The server needs a clear answer to the requirement,
 * so the editor asks "Opfyldt" or "Ikke opfyldt" and takes what was found as text, with an
 * optional file.
 *
 * A requirement that is not met can only be turned into "Opfyldt" by an Admin or Lead, with a
 * written reason; the answer is then an override and goes to the audit log ('s rule). A
 * revised override stays one.
 *
 * The look is the prototype's editor: 36 px choice buttons (radius 10, the chosen one filled
 * ink), a 72 px text field with the field focus ring, the file row with a 1.5 px action ring on
 * hover, the 12 px ink-4 note "Gemmes som oplyst af dig …" and "Gem og genberegn" / "Annullér".
 */
import { useId, useRef, useState, type DragEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { needsOverride, overrideReasonOk } from "@/lib/cases/gate-answer";
import { useT } from "@/lib/i18n/useT";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface GateAnswerDraft {
  passed: boolean;
  text: string;
  file: File | null;
  override: boolean;
}

const FIELD_RING =
  "shadow-[inset_0_0_0_1px_var(--line-strong)] focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]";

export function GateAnswerEditor({
  passedNow,
  canOverride,
  initial,
  pending = false,
  onSave,
  onClose,
  closeLabel = "cancel",
  showLabel = false,
  className,
}: {
  /** The requirement's status now, with the team's answers applied (null = unknown). */
  passedNow: boolean | null;
  /** Admin or Lead (override_mandate_gate). */
  canOverride: boolean;
  /** The saved answer when it is edited again ("Redigér"). */
  initial?: { passed: boolean | null; text: string; override: boolean } | undefined;
  pending?: boolean | undefined;
  onSave: (draft: GateAnswerDraft) => void;
  onClose: () => void;
  /** "Annullér" (cancel) or "Luk" (close) on the second button. */
  closeLabel?: "cancel" | "close";
  /** "Svar" above the choices (in the task list; the Mandatfit page has the gate's name). */
  showLabel?: boolean;
  className?: string | undefined;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const textId = useId();
  const noteId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [passed, setPassed] = useState<boolean | null>(initial?.passed ?? null);
  const [text, setText] = useState(initial?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const override = needsOverride({
    passed,
    passedNow,
    previousOverride: initial?.override === true,
  });
  const blocked = override && !canOverride;
  const reasonShort = override && !overrideReasonOk(text);
  const ready = passed !== null && !blocked && !reasonShort;

  const save = () => {
    if (!ready || pending || passed === null) return;
    onSave({ passed, text: text.trim(), file, override });
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  return (
    <div className={cn("flex max-w-[620px] flex-col gap-3", className)}>
      {showLabel && <span className="text-meta font-semibold text-ink-3">{t("tasks.answer")}</span>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("tasks.gate.question")}>
        {(
          [
            [true, t("tasks.gateMet")],
            [false, t("tasks.gateNotMet")],
          ] as const
        ).map(([value, label]) => {
          const selected = passed === value;
          return (
            <motion.button
              key={label}
              type="button"
              aria-pressed={selected}
              onClick={() => setPassed(value)}
              {...(reduced ? {} : { whileTap: { scale: 0.96 }, transition: SPRING.press })}
              className={cn(
                "h-9 whitespace-nowrap rounded-sm px-[15px] text-list outline-none transition-[background-color,color] duration-[220ms] ease-standard focus-visible:ring-2 focus-visible:ring-action",
                selected
                  ? "bg-inverse text-ink-inverse"
                  : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]",
              )}
            >
              {label}
            </motion.button>
          );
        })}
      </div>

      {override && (
        <p id={noteId} className="m-0 text-meta leading-[1.5] text-ink-2">
          {canOverride ? t("tasks.gate.overrideNote") : t("tasks.gate.blockedNote")}
        </p>
      )}

      <textarea
        id={textId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={override ? t("tasks.gate.reasonPlaceholder") : t("tasks.foundPlaceholder")}
        aria-label={override ? t("tasks.gate.reasonLabel") : t("tasks.gate.foundLabel")}
        {...(override ? { "aria-describedby": noteId } : {})}
        disabled={blocked}
        className={cn(
          "min-h-[72px] max-w-[560px] resize-y rounded-sm bg-surface px-3.5 py-3 text-[14px] leading-[1.5] text-ink-1 outline-none transition-shadow duration-[var(--dur-quick)] disabled:opacity-50",
          FIELD_RING,
        )}
      />

      <input
        ref={fileInputRef}
        type="file"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex max-w-[420px] items-center gap-3 rounded-md bg-surface p-3.5 text-left text-list text-ink-2 outline-none transition-shadow duration-[var(--dur-quick)] hover:shadow-[inset_0_0_0_1.5px_var(--action)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]",
          dragging
            ? "shadow-[inset_0_0_0_1.5px_var(--action)]"
            : "shadow-[inset_0_0_0_1px_var(--line-strong)]",
        )}
      >
        <FileUp className="size-[18px] shrink-0 text-action" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {file ? t("tasks.fileReady", { name: file.name }) : t("tasks.gate.attach")}
        </span>
      </button>

      <span className="text-meta text-ink-4">{t("tasks.gate.savedNote")}</span>
      <div className="flex gap-1.5">
        <Button variant="primary" size="md" disabled={!ready} pending={pending} onClick={save}>
          {t("tasks.gate.saveRecalc")}
        </Button>
        <Button variant="quiet" size="md" className="text-ink-3" onClick={onClose}>
          {t(closeLabel === "close" ? "tasks.close" : "tasks.cancel")}
        </Button>
      </div>
    </div>
  );
}
