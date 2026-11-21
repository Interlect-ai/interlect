/**
 * The stage pills and "Sammenlign stadier" at the top of "Sådan screener vi" and "Sådan analyserer
 * vi" (prototype `stagePills`, `Teamopsaetning v3.dc.html`). One stage on show at a time; the
 * shell keeps it, so the next place opens on the same stage.
 */
import { ChartColumn } from "lucide-react";
import { Button } from "@/components/ds/Button";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import { stageText } from "@/lib/funds/basis-labels";
import { STAGE_SERIES, type StageTab } from "@/lib/funds/stage-editor";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { series } from "./ScreeningSheets";

export function StagePills({
  tabs,
  active,
  onPick,
  onCompare,
}: {
  tabs: readonly StageTab[];
  active: SetupStage;
  onPick: (stage: SetupStage) => void;
  /** Opens the compare sheet; the button shows only with more than one stage. */
  onCompare: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        role="group"
        aria-label={t("fundSetup.screen.stageGroup")}
        className="inline-flex flex-wrap gap-1.5"
      >
        {tabs.map((tab) => {
          const selected = tab.stage === active;
          return (
            <button
              key={tab.stage}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(tab.stage)}
              className={cn(
                "inline-flex h-10 cursor-pointer items-center gap-2 rounded-pill border-0 px-[18px] font-[inherit] text-[14px] leading-none font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                selected ? "bg-inverse text-ink-inverse" : "bg-sunken text-ink-2 hover:text-ink-1",
              )}
            >
              <span
                aria-hidden
                className="size-[7px] rounded-full"
                style={{ background: series(STAGE_SERIES[tab.stage]) }}
              />
              {stageText(tab.raw, language)}
            </button>
          );
        })}
      </div>
      {tabs.length > 1 && (
        <Button size="sm" variant="quiet" icon={ChartColumn} onClick={onCompare}>
          {t("fundSetup.screen.compare")}
        </Button>
      )}
    </div>
  );
}
