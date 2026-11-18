/**
 * Mandatfit as a focus page (Case Screening v5, lines 324–369; "Mandatfit-siden viser alt fra
 * start: Mangler svar øverst, derefter Opfyldt … Ingen foldning"). A requirement the
 * screening found broken is listed as "Ikke opfyldt" between them (the prototype has none).
 *
 * Measured: max 980 px; the circles box canvas, radius xl, padding 26/28, gap 20, title and
 * "N/M" 36/600; group titles 17/600; lists on one surface with the card shadow and hairlines;
 * rows min 72 px, padding 12 16 12 20, a 26 px (24 px for met) status circle, name 15/600
 * (500 for met) over the reasoning in 13/1.5 ink-2; "Udfyld" as a secondary pill that turns
 * into "Luk"; the editor folds out under the row (padding 6 16 20 56).
 *
 * The answer is "Opfyldt"/"Ikke opfyldt" with what was found (GateAnswerEditor); it counts in
 * the score at once. Only an Admin or Lead can turn a requirement that is not met into met
 * ("Tilsidesæt"), with a written reason.
 */
import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { FocusPage } from "@/components/ds/FocusPage";
import { GateAnswerEditor, type GateAnswerDraft } from "@/components/ds/GateAnswerEditor";
import { MandatfitCircles } from "@/components/ds/MandatfitCircles";
import { mandatGroups, type MandatRow } from "@/lib/cases/screening-view";
import type { CaseTask } from "@/lib/cases/tasks.functions";
import type { GateView } from "@/lib/cases/view-model";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Row = MandatRow<GateView, CaseTask>;

export function MandatFocus({
  companyName,
  onBack,
  gates,
  tasks,
  canManage,
  canOverride,
  onAnswer,
}: {
  companyName: string;
  onBack: () => void;
  gates: readonly GateView[];
  tasks: readonly CaseTask[];
  canManage: boolean;
  canOverride: boolean;
  onAnswer: (gate: GateView, task: CaseTask | null, draft: GateAnswerDraft) => Promise<unknown>;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const groups = mandatGroups(gates, tasks);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const met = groups.passed.length;

  const save = async (row: Row, draft: GateAnswerDraft) => {
    setSaving(row.gate.key);
    try {
      await onAnswer(row.gate, row.task, draft);
      setEditing(null);
    } catch {
      // The page has shown the error; the editor stays open with the draft.
    } finally {
      setSaving(null);
    }
  };

  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, ease: EASE.out, delay },
        };

  const section = (title: string, rows: Row[], kind: Row["status"], delay: number) =>
    rows.length > 0 && (
      <motion.section className="flex flex-col gap-2.5" {...rise(delay)}>
        <h3 className="m-0 px-1.5 text-section font-semibold">
          {title}
          {kind === "passed" && <span className="font-normal text-ink-4"> {rows.length}</span>}
        </h3>
        <div className="flex flex-col overflow-hidden rounded-lg bg-surface shadow-card">
          {rows.map((row) => (
            <GateRow
              key={row.gate.key}
              row={row}
              canManage={canManage}
              canOverride={canOverride}
              open={editing === row.gate.key}
              saving={saving === row.gate.key}
              onToggle={() => setEditing((key) => (key === row.gate.key ? null : row.gate.key))}
              onSave={(draft) => void save(row, draft)}
            />
          ))}
        </div>
      </motion.section>
    );

  return (
    <FocusPage
      backLabel={companyName}
      onBack={onBack}
      title={
        <>
          {t("screening.mandate.title")}{" "}
          <span className="text-ink-4">
            {met}/{gates.length}
          </span>
        </>
      }
      className="max-w-[980px]"
    >
      <motion.div
        className="flex flex-col gap-5 rounded-xl bg-canvas px-5 py-6 md:px-7"
        {...rise(0.06)}
      >
        <MandatfitCircles
          variant="focus"
          delay={0.2}
          gates={gates.map((gate) => ({
            key: gate.key,
            label: gate.label,
            status: gate.passed === true ? "passed" : gate.passed === false ? "failed" : "unknown",
          }))}
        />
      </motion.div>
      {section(t("screening.mandate.missing"), groups.missing, "unknown", 0.14)}
      {section(t("screening.mandate.failed"), groups.failed, "failed", 0.18)}
      {section(t("screening.mandate.passed"), groups.passed, "passed", 0.2)}
      {gates.length === 0 && (
        <p className="m-0 text-body text-ink-3">{t("screening.mandate.noGates")}</p>
      )}
    </FocusPage>
  );
}

function GateRow({
  row,
  canManage,
  canOverride,
  open,
  saving,
  onToggle,
  onSave,
}: {
  row: Row;
  canManage: boolean;
  canOverride: boolean;
  open: boolean;
  saving: boolean;
  onToggle: () => void;
  onSave: (draft: GateAnswerDraft) => void;
}) {
  const t = useT();
  const panelId = useId();
  const { gate, task, status } = row;
  const answer = task?.status === "resolved" ? task.answerValue : null;
  // Only a live team answer can be an override: once a newer screening replaced the verdict, an
  // old task answer must not label the requirement.
  const override = gate.teamAnswered === true && answer?.override === true;
  // A "Ikke opfyldt" or an override from the team decides a binding requirement: only an Admin
  // or Lead may change it (harden F1).
  const binding = gate.teamAnswered && (status === "failed" || override);
  const action =
    !canManage || (binding && !canOverride)
      ? null
      : status === "unknown"
        ? "fill"
        : status === "failed"
          ? gate.teamAnswered
            ? "edit"
            : canOverride
              ? "override"
              : null
          : gate.teamAnswered
            ? "edit"
            : null;
  const reason =
    gate.teamAnswered && task?.status === "resolved"
      ? [
          task.resolvedByName
            ? t("screening.mandate.providedBy", { name: task.resolvedByName })
            : t("screening.mandate.providedByTeam"),
          task.answerText,
        ]
          .filter(Boolean)
          .join(": ")
      : gate.rationale;

  return (
    <div
      className={cn(
        "border-line transition-colors duration-[360ms] ease-standard not-first:border-t",
        open && "bg-canvas",
      )}
    >
      <div className="grid min-h-[72px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3.5 py-3 pr-4 pl-5">
        <StatusCircle status={status} />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span
            className={cn("text-[15px]", status === "passed" ? "font-medium" : "font-semibold")}
          >
            {gate.label}
          </span>
          {reason && <span className="text-list leading-[1.5] text-ink-2">{reason}</span>}
          {override && (
            <span className="text-meta text-ink-3">{t("screening.mandate.overridden")}</span>
          )}
        </div>
        {action &&
          (action === "edit" ? (
            <Button
              variant="quiet"
              size="sm"
              className="text-action hover:bg-action-wash"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
            >
              {open ? t("common.close") : t("screening.mandate.edit")}
            </Button>
          ) : (
            <Button
              variant={open ? "quiet" : "secondary"}
              size="sm"
              className={cn("px-3.5", open && "text-ink-3")}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
            >
              {open ? t("common.close") : t(`screening.mandate.${action}`)}
            </Button>
          ))}
      </div>
      <Collapse open={open} id={panelId}>
        <div className="pt-1.5 pr-4 pb-5 pl-5 sm:pl-14">
          <GateAnswerEditor
            passedNow={gate.passed}
            canOverride={canOverride}
            initial={
              gate.teamAnswered && task?.status === "resolved"
                ? {
                    passed: typeof answer?.gatePassed === "boolean" ? answer.gatePassed : null,
                    text: task.answerText ?? "",
                    override,
                  }
                : status === "failed"
                  ? { passed: true, text: "", override: false }
                  : undefined
            }
            pending={saving}
            onSave={onSave}
            onClose={onToggle}
          />
        </div>
      </Collapse>
    </div>
  );
}

function StatusCircle({ status }: { status: Row["status"] }) {
  const t = useT();
  if (status === "passed") {
    return (
      <span className="grid size-6 place-items-center rounded-full bg-positive text-ink-inverse">
        <Check className="size-[13px]" strokeWidth={2.25} aria-hidden />
        <span className="sr-only">{t("screening.mandate.passed")}</span>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="grid size-[26px] place-items-center rounded-full bg-critical text-ink-inverse">
        <X className="size-[13px]" strokeWidth={2.25} aria-hidden />
        <span className="sr-only">{t("screening.mandate.failed")}</span>
      </span>
    );
  }
  return (
    <span className="grid size-[26px] place-items-center rounded-full text-meta font-semibold text-action shadow-[inset_0_0_0_1.5px_var(--action)]">
      ?<span className="sr-only">{t("screening.mandate.missing")}</span>
    </span>
  );
}
