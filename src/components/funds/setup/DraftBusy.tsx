/**
 * The waiting screen while Interlect writes a draft for every stage (prototype `busy`,
 * `Teamopsaetning v3.dc.html`): the coral orb at 64 px, the three steps of the whole run, then one
 * card per stage with its five steps (the stage on show), and a summary once a stage is done. The
 * steps come from the run's own events, not from a timer (`reduceProgress`).
 */
import { Check } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import { stageText } from "@/lib/funds/basis-labels";
import {
  PREPARE_STEPS,
  STAGE_STEPS,
  orbStateOf,
  type DraftProgress,
} from "@/lib/funds/setup-draft-client";
import { STAGE_SERIES, type StageTab } from "@/lib/funds/stage-editor";
import type { MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { series } from "./ScreeningSheets";

const PREPARE_KEYS: readonly MessageKey[] = [
  "fundSetup.draft.prepare0",
  "fundSetup.draft.prepare1",
  "fundSetup.draft.prepare2",
];
const STAGE_KEYS: readonly MessageKey[] = [
  "fundSetup.draft.step0",
  "fundSetup.draft.step1",
  "fundSetup.draft.step2",
  "fundSetup.draft.step3",
  "fundSetup.draft.step4",
];

/** One line of a list: a check when done, a coral dot when it is the one now, else a grey dot. */
function Step({
  label,
  state,
  size,
}: {
  label: string;
  state: "done" | "now" | "later";
  size: "run" | "stage";
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2.5",
        size === "run" ? "text-[15px]" : "text-[14px]",
        state === "later" ? "text-ink-3" : "text-ink-1",
      )}
    >
      {state === "done" ? (
        <Check className="size-3.5 flex-none text-positive" strokeWidth={2.4} aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-[7px] flex-none rounded-full",
            state === "now" ? "bg-ai" : "bg-line-strong",
          )}
        />
      )}
      {label}
    </li>
  );
}

export function DraftBusy({
  progress,
  tabs,
}: {
  progress: DraftProgress;
  /** The team's stages, to name them in the team's own words. */
  tabs: readonly StageTab[];
}) {
  const t = useT();
  const language = useLanguage();
  const rawOf = (stage: SetupStage) => tabs.find((tab) => tab.stage === stage)?.raw ?? stage;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-5 pt-[70px] pb-[90px] text-center"
    >
      <AiOrb size={64} tone="ai" state={orbStateOf(progress)} />
      <h2 className="m-0 text-title leading-[1.2] font-semibold tracking-title">
        {t("fundSetup.draft.title")}
      </h2>
      <ul className="m-0 mb-1 flex w-[min(520px,100%)] list-none flex-col gap-2 p-0 text-left">
        {PREPARE_KEYS.map((key, index) => (
          <Step
            key={key}
            size="run"
            label={t(key)}
            state={index < progress.prepare ? "done" : index === progress.prepare ? "now" : "later"}
          />
        ))}
      </ul>
      <div className="flex w-[min(520px,100%)] flex-col gap-2.5 text-left">
        {progress.stages.map((stage) => {
          const summary = progress.done[stage];
          const now = progress.prepare >= PREPARE_STEPS && progress.current === stage;
          return (
            <div
              key={stage}
              className={cn(
                "rounded-[18px] px-5 py-4 transition-colors duration-[250ms]",
                now ? "bg-ai-wash text-ink-1" : "bg-sunken",
                summary ? "text-ink-1" : !now && "text-ink-3",
              )}
            >
              <div className="flex items-center gap-2.5 text-[15px]">
                <span
                  aria-hidden
                  className="size-[7px] flex-none rounded-full"
                  style={{ background: series(STAGE_SERIES[stage]) }}
                />
                <b className="flex-1 font-semibold">{stageText(rawOf(stage), language)}</b>
                {summary && (
                  <>
                    <span className="text-[13px] text-ink-3">
                      {t("fundSetup.draft.stageSummary", {
                        criteria: summary.criteria,
                        points: summary.points,
                        specialists: summary.specialists,
                      })}
                    </span>
                    <Check
                      className="size-4 flex-none text-positive"
                      strokeWidth={2.4}
                      aria-hidden
                    />
                  </>
                )}
              </div>
              {now && (
                <ul className="m-0 mt-3.5 mb-0.5 flex list-none flex-col gap-2.5 p-0 pl-[18px]">
                  {STAGE_KEYS.slice(0, STAGE_STEPS).map((key, index) => (
                    <Step
                      key={key}
                      size="stage"
                      label={t(key)}
                      state={
                        index < progress.step ? "done" : index === progress.step ? "now" : "later"
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
