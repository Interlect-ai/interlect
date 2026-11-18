/**
 * Masterplan F3 (lærred "Stadie pr. fase", variant A): hvilke selskabsstadier når videre?
 * Én 100 %-stablet bjælke pr. fase; farven følger stadiet (fast rækkefølge), antallet står
 * ved hver bjælke. Under fem cases er der intet mønster at vise.
 */
export interface PhaseCounts {
  total: number;
  created: number;
  screened: number;
  deep: number;
  committee: number;
}
import { stageText } from "@/lib/funds/basis-labels";
import type { MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { stageColor } from "@/lib/overview/stage-color";

const PHASES: Array<{ key: keyof Omit<PhaseCounts, "total">; label: MessageKey }> = [
  { key: "created", label: "overview.stagePhase.created" },
  { key: "screened", label: "overview.stagePhase.screened" },
  { key: "deep", label: "overview.stagePhase.deep" },
  { key: "committee", label: "overview.stagePhase.committee" },
];

/** Fast rækkefølge og farve pr. stadie, så farven aldrig skifter med filtre. */
const STAGE_ORDER = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "later",
  "growth",
  "buyout",
  "unknown",
];
const MIN_CASES = 5;

/** Kendte stadier i fast rækkefølge; ukendte nøgler til sidst. */
function stageRank(stage: string) {
  const index = STAGE_ORDER.indexOf(stage);
  return index < 0 ? STAGE_ORDER.length : index;
}

export function StagePhaseBars({ stages }: { stages: Array<{ stage: string } & PhaseCounts> }) {
  const t = useT();
  const language = useLanguage();
  const stageName = (stage: string) =>
    stage === "unknown" ? t("overview.stagePhase.unknown") : stageText(stage, language);
  const total = stages.reduce((sum, stage) => sum + stage.total, 0);
  if (total < MIN_CASES) {
    return (
      <p className="text-list text-ink-3">
        {t("overview.stagePhase.tooFew", { count: total, min: MIN_CASES })}
      </p>
    );
  }
  const ordered = [...stages].sort((a, b) => stageRank(a.stage) - stageRank(b.stage));
  return (
    <div className="grid gap-3">
      <ol className="grid gap-2.5">
        {PHASES.map((phase) => {
          const phaseLabel = t(phase.label);
          const count = ordered.reduce((sum, stage) => sum + stage[phase.key], 0);
          const present = ordered.filter((stage) => stage[phase.key] > 0);
          return (
            <li
              key={phase.key}
              className="grid grid-cols-[88px_minmax(0,1fr)_28px] items-center gap-3 text-meta"
            >
              <span className="text-ink-2">{phaseLabel}</span>
              <span
                className="flex h-4 gap-[2px]"
                role="img"
                aria-label={
                  count === 0
                    ? t("overview.stagePhase.noCases", { phase: phaseLabel })
                    : `${phaseLabel}: ${present.map((stage) => `${stageName(stage.stage)} ${stage[phase.key]}`).join(", ")}`
                }
              >
                {count === 0 ? (
                  <span className="flex-1 rounded-[2px] bg-surface-neutral" />
                ) : (
                  present.map((stage) => (
                    <span
                      key={stage.stage}
                      className="grid min-w-0 place-items-center overflow-hidden rounded-[2px] text-[11px] font-semibold leading-none text-surface tabular-nums"
                      style={{ flex: stage[phase.key], background: stageColor(stage.stage) }}
                      title={`${stageName(stage.stage)}: ${stage[phase.key]}`}
                      aria-hidden
                    >
                      {/* Antallet står i segmentet, når der er plads (mindst 15 %). */}
                      {stage[phase.key] / count >= 0.15 ? stage[phase.key] : ""}
                    </span>
                  ))
                )}
              </span>
              <span className="text-right font-medium tabular-nums text-ink">{count}</span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-3" aria-hidden>
        {ordered
          .filter((stage) => stage.total > 0)
          .map((stage) => (
            <span key={stage.stage} className="flex items-center gap-1">
              <span
                className="size-[7px] rounded-[2px]"
                style={{ background: stageColor(stage.stage) }}
              />
              {stageName(stage.stage)}
              <span className="tabular-nums text-ink-2">{stage.total}</span>
            </span>
          ))}
      </div>
    </div>
  );
}
