/**
 * D-8 (designlærred, variant A · 26/9-2026): levende kørselstrin som lodret tidslinje.
 * Færdige trin er en blækprik, det aktive trin har orben i koral, ventende trin er en
 * tom ring. Højst én ting bevæger sig: orben på det aktive trin.
 */
import { AiOrb } from "@/components/ai/AiOrb";
import { isStepDone, runStepName, runStepOrb, stepDuration } from "@/lib/cases/run-steps";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";

export interface RunStep {
  key: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

function Marker({ step, animate }: { step: RunStep; animate: boolean }) {
  // Kun ét trin bevæger sig; parallelle trin (fx de fire specialister) får en stille prik.
  if (step.status === "running" && animate) {
    return <AiOrb size={20} tone="ai" state={runStepOrb(step.key)} />;
  }
  if (step.status === "running") {
    return (
      <span className="grid size-5 shrink-0 place-items-center" aria-hidden>
        <span className="size-2 rounded-full bg-ai" />
      </span>
    );
  }
  const failed = step.status === "failed" && !isStepDone(step);
  return (
    <span className="grid size-5 shrink-0 place-items-center" aria-hidden>
      <span
        className={cn(
          "size-2 rounded-full",
          failed
            ? "bg-critical"
            : isStepDone(step)
              ? "bg-ink-2"
              : "border-[1.5px] border-hairline-strong",
        )}
      />
    </span>
  );
}

function stateText(step: RunStep, language: Language) {
  const text = (key: Parameters<typeof translate>[1]) => translate(language, key);
  if (step.status === "running") return text("screening.runSteps.running");
  if (step.status === "skipped") {
    return step.key === "cvr_financials"
      ? text("screening.runSteps.noStatement")
      : text("screening.runSteps.skipped");
  }
  if (step.status === "failed") {
    return step.key === "cvr_financials"
      ? text("screening.runSteps.notFetched")
      : text("screening.runSteps.failed");
  }
  if (isStepDone(step)) {
    return stepDuration(step.startedAt, step.completedAt) ?? text("screening.runSteps.done");
  }
  return text("screening.runSteps.waiting");
}

export function RunSteps({ steps, className }: { steps: RunStep[]; className?: string }) {
  const t = useT();
  const language = useLanguage();
  const ordered = steps;
  const animatedKey = ordered.find((step) => step.status === "running")?.key;
  return (
    <ol className={cn("grid", className)} aria-label={t("screening.runSteps.aria")}>
      {ordered.map((step, index) => {
        const done = isStepDone(step);
        const active = step.status === "running";
        const last = index === ordered.length - 1;
        return (
          <li key={step.key} className="relative flex items-start gap-3 py-1.5">
            {!last && (
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-[-6px] left-[9.5px] top-[26px] w-px",
                  done ? "bg-ink-3" : "bg-hairline-strong",
                )}
              />
            )}
            <Marker step={step} animate={step.key === animatedKey} />
            <span
              className={cn(
                "min-w-0 flex-1 text-list leading-5",
                active ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-4",
              )}
            >
              {runStepName(step.key, language)}
            </span>
            <span className="shrink-0 text-meta tabular-nums text-ink-4">
              {stateText(step, language)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
