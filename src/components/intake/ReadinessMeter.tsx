/**
 * The information meter on the Opret case start screen (prototype "Opret case.dc.html",
 * `readyLbl` / `readyBars` / `readyHint`): label 13/600, three 6 px segments (max 320 px) and a
 * 12 px hint that always names the next best step. Level 1 is orange, 2-3 green; the segments
 * recolour with a 400 ms curve. The rules live in `src/lib/cases/intake-readiness.ts`.
 */
import { cn } from "@/lib/utils";
import type { IntakeReadiness } from "@/lib/cases/intake-readiness";

export function ReadinessMeter({
  readiness,
  hintId,
}: {
  readiness: IntakeReadiness;
  hintId?: string;
}) {
  return (
    <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className="text-list font-semibold text-ink-1"
          // The label changes as the user types: announce it politely.
          aria-live="polite"
        >
          {readiness.label}
        </span>
      </div>
      <div className="flex h-1.5 max-w-[320px] gap-1" aria-hidden>
        {[1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={cn(
              "flex-1 rounded-[3px] transition-colors duration-[400ms] ease-[var(--ease-standard)]",
              readiness.level >= segment
                ? readiness.level === 1
                  ? "bg-warning"
                  : "bg-positive"
                : "bg-[var(--chart-track)]",
            )}
          />
        ))}
      </div>
      <span id={hintId} className="text-meta leading-[1.45] text-ink-3">
        {readiness.hint}
      </span>
    </div>
  );
}
