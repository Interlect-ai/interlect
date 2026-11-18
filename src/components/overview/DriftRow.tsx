/**
 * What the prototype does not have but the product keeps: "I gang nu" (real runs with
 * their step) as a thin line, and "Aktivitet" in a folded row below the composition.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { Collapse } from "@/components/ds/Collapse";
import { runStepName, runStepOrb } from "@/lib/cases/run-steps";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { daysAgo } from "@/lib/overview/dates";
import type { OverviewSnapshot } from "@/lib/overview/overview.functions";
import { cn } from "@/lib/utils";

export function RunningLine({ running }: { running: OverviewSnapshot["running"] }) {
  const t = useT();
  const language = useLanguage();
  if (running.length === 0) return null;
  return (
    <ul
      aria-label={t("overview.drift.runningAria")}
      className="m-0 flex list-none flex-col gap-1 rounded-xl bg-canvas px-4 py-2.5 p-0"
    >
      {running.map((run) => (
        <li key={`${run.caseId}-${run.kind}`}>
          <Link
            to="/cases/$caseId"
            params={{ caseId: run.caseId }}
            search={{ view: run.kind === "deep" ? "deep" : "screening" }}
            className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-hover"
          >
            <AiOrb
              size={20}
              tone="ai"
              state={run.stepKey ? runStepOrb(run.stepKey) : "breathing"}
            />
            <strong className="text-list font-semibold">{run.companyName}</strong>
            <span className="min-w-0 flex-1 truncate text-list text-ink-2">
              {run.stepKey
                ? runStepName(run.stepKey, language)
                : run.kind === "deep"
                  ? t("overview.drift.preparingDeep")
                  : t("overview.drift.preparingScreening")}
            </span>
            {run.total > 0 && (
              <span className="text-meta tabular-nums text-ink-3">
                {t("overview.drift.stepsOf", { done: run.completed, total: run.total })}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const relative = (value: string, now: Date, t: ReturnType<typeof useT>) => {
  const days = daysAgo(value, now);
  return days === 0
    ? t("overview.drift.today")
    : days === 1
      ? t("overview.drift.yesterday")
      : t("overview.drift.daysAgo", { count: days });
};

/**
 * Aktivitet, folded: runs per day for the last 14 days and the latest runs. Money is not shown
 * here; AI-kreditter above is the one place for it (P13).
 */
export function DriftRow({ data }: { data: OverviewSnapshot }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const max = Math.max(1, ...data.activityByDay.map((day) => day.count));
  const total = data.activityByDay.reduce((sum, day) => sum + day.count, 0);
  const now = new Date(data.generatedAt);
  return (
    <section className="rounded-xl bg-canvas px-6 py-3.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 text-left text-section font-semibold outline-none focus-visible:ring-2 focus-visible:ring-action"
      >
        {t("overview.drift.title")}
        <span className="text-list font-normal text-ink-4">
          {t("overview.drift.runsFourteenDays", { count: total })}
        </span>
        <div className="flex-1" />
        <ChevronDown
          className={cn("size-4 text-ink-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <Collapse open={open}>
        <div className="pt-4">
          <div
            className="flex h-24 items-end gap-1"
            role="img"
            aria-label={t("overview.drift.activityAria", { count: total })}
          >
            {data.activityByDay.map((day) => (
              <span
                key={day.day}
                title={`${day.day.slice(8, 10)}/${Number(day.day.slice(5, 7))}: ${day.count}`}
                className={cn("flex-1 rounded-[3px]", day.count ? "bg-series-1" : "bg-chart-track")}
                style={{ height: `${Math.max(6, (day.count / max) * 100)}%` }}
              />
            ))}
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-line p-0">
            {data.activity.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 text-meta text-ink-2">
                  <strong className="font-medium text-ink-1">{item.companyName}</strong> ·{" "}
                  {item.text}
                </span>
                <span className="shrink-0 text-meta text-ink-4">{relative(item.at, now, t)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Collapse>
    </section>
  );
}
