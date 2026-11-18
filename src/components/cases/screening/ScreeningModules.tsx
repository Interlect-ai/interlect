/**
 * The four cards on Oversigt (Case Screening v5, lines 94–119; "Moduler uden hjælpetekst" and "Hvad
 * styrer screeningen"): Profil mod tesen, Mandatfit, Nøglefund and,
 * when the company has annual reports, Finanser. Each card is a title, one visual and one
 * number, and opens its focus page.
 *
 * Measured: grid gap 12, columns by card count; card padding 22, radius lg, canvas, gap 16;
 * title 13/600 with an up-right arrow in ink-4; visual 104 px high; number 22/600 with title
 * tracking. Hover: surface, raised shadow, y −3 over 420 ms; press .98. Cards rise in 140,
 * 200, 260 and 320 ms after the page.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { MandatfitCircles, type MandatfitGate } from "@/components/ds/MandatfitCircles";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import type { ProfileRow } from "@/lib/cases/screening-view";
import type { FinanceSummary } from "@/lib/cases/finance-summary";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";

export type ScreeningFocus = "profil" | "mandat" | "fund" | "finans" | "hvorfor";

function ModuleCard({
  title,
  delay,
  onOpen,
  children,
  number,
}: {
  title: string;
  delay: number;
  onOpen: () => void;
  children: ReactNode;
  number: ReactNode;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.64, ease: EASE.out, delay }}
    >
      <button
        type="button"
        onClick={onOpen}
        data-focus-card
        aria-label={t("screening.modules.open", { title })}
        className="flex w-full flex-col gap-4 rounded-lg bg-canvas p-[22px] text-left outline-none transition-[transform,box-shadow,background-color] duration-[420ms] ease-standard hover:-translate-y-[3px] hover:bg-surface hover:shadow-raised focus-visible:ring-2 focus-visible:ring-action active:scale-[.98]"
      >
        <span className="flex items-center justify-between">
          <span className="text-list font-semibold text-ink-1">{title}</span>
          <ArrowUpRight className="size-4 text-ink-4" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="flex h-[104px] w-full">{children}</span>
        {number}
      </button>
    </motion.div>
  );
}

const NUMBER = "text-title leading-[1.2] font-semibold tracking-title text-ink-1";

export function ScreeningModules({
  profile,
  gates,
  findings,
  finance,
  onOpen,
}: {
  profile: readonly ProfileRow[];
  gates: readonly MandatfitGate[];
  findings: { up: number; down: number; upWeight: number; downWeight: number };
  finance: FinanceSummary | null;
  onOpen: (focus: ScreeningFocus) => void;
}) {
  const t = useT();
  const passed = gates.filter((gate) => gate.status === "passed").length;
  const maxYear = finance
    ? Math.max(
        1,
        ...finance.years.map((year) =>
          Math.abs((finance.hasRevenue ? year.revenue : year.grossProfit) ?? 0),
        ),
      )
    : 1;
  return (
    // Columns follow the card count: auto-fill left the fourth card alone on a new row
    // at 1440. Four cards go 1 / 2 / 4 across, three cards go 1 / 3, so the last row is never
    // a lone card with empty places beside it.
    <div
      className={
        finance
          ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          : "grid grid-cols-1 gap-3 md:grid-cols-3"
      }
    >
      <ModuleCard
        title={t("screening.modules.profile")}
        delay={0.14}
        onOpen={() => onOpen("profil")}
        number={
          <span className={NUMBER}>
            {t(
              profile.length === 1
                ? "screening.modules.criterionOne"
                : "screening.modules.criterionMany",
              { count: profile.length },
            )}
          </span>
        }
      >
        <span className="flex w-full items-center justify-center" aria-hidden>
          {profile.length > 0 && (
            <PieChart
              data={profile.map((row) => ({
                label: row.label,
                value: row.weight,
                color: row.color,
              }))}
              size={112}
              innerRadius={35}
              padAngle={(1.4 / 100) * Math.PI * 2}
              cornerRadius={0}
            >
              {profile.map((row, index) => (
                <PieSlice key={row.key} index={index} hoverEffect="none" />
              ))}
            </PieChart>
          )}
        </span>
      </ModuleCard>

      <ModuleCard
        title={t("screening.modules.mandate")}
        delay={0.2}
        onOpen={() => onOpen("mandat")}
        number={
          <span className={NUMBER}>
            {t("screening.modules.gatesOf", { passed, total: gates.length })}
          </span>
        }
      >
        <MandatfitCircles gates={gates} variant="module" delay={0.3} className="w-full" />
      </ModuleCard>

      <ModuleCard
        title={t("screening.modules.findings")}
        delay={0.26}
        onOpen={() => onOpen("fund")}
        number={
          <span className="flex w-full items-baseline justify-between">
            <span className={NUMBER}>{findings.up}</span>
            <span className={NUMBER}>{findings.down}</span>
          </span>
        }
      >
        <span className="flex w-full flex-col justify-center gap-3.5">
          <FindingBalance up={findings.upWeight} down={findings.downWeight} height={12} />
          <span className="flex justify-between text-meta text-ink-3">
            <span>{t("screening.modules.strengths")}</span>
            <span>{t("screening.modules.weaknesses")}</span>
          </span>
        </span>
      </ModuleCard>

      {finance && (
        <ModuleCard
          title={t("screening.modules.finance")}
          delay={0.32}
          onOpen={() => onOpen("finans")}
          number={
            // The card says which figure it is ("Omsætning 2024"), not just "20 mio.".
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className={NUMBER}>{finance.headline.value}</span>
              <span className="text-meta text-ink-3">{finance.headline.label}</span>
            </span>
          }
        >
          <span className="flex w-full items-end gap-2 px-1" aria-hidden>
            {finance.years.map((year, index) => {
              const value = (finance.hasRevenue ? year.revenue : year.grossProfit) ?? 0;
              const last = index === finance.years.length - 1;
              return (
                <GrowBar
                  key={year.year}
                  heightPct={Math.max(4, (Math.abs(value) / maxYear) * 100)}
                  color={
                    last
                      ? "var(--series-1)"
                      : "color-mix(in srgb, var(--series-1) 35%, transparent)"
                  }
                  delay={0.3 + index * 0.07}
                />
              );
            })}
          </span>
        </ModuleCard>
      )}
    </div>
  );
}

function GrowBar({ heightPct, color, delay }: { heightPct: number; color: string; delay: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="flex-1 rounded-[7px_7px_3px_3px]"
      style={{ height: `${heightPct}%`, background: color, transformOrigin: "bottom" }}
      initial={reduced ? { opacity: 0 } : { scaleY: 0, opacity: 0 }}
      animate={{ scaleY: 1, opacity: 1 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.7, ease: EASE.out, delay }}
    />
  );
}

/** Styrker (positive) against Svagheder (warning), grown in from each end. */
export function FindingBalance({ up, down, height }: { up: number; down: number; height: number }) {
  const reduced = useReducedMotion();
  if (up + down === 0) {
    return (
      <span className="block w-full rounded-full bg-[var(--chart-track)]" style={{ height }} />
    );
  }
  const grow = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
      : {
          initial: { scaleX: 0 },
          animate: { scaleX: 1 },
          transition: { duration: 0.9, ease: EASE.out, delay },
        };
  return (
    <span className="flex w-full gap-1" style={{ height }} aria-hidden>
      {up > 0 && (
        <motion.span
          className="rounded-full bg-positive"
          {...grow(0.3)}
          style={{ flex: up, transformOrigin: "left" }}
        />
      )}
      {down > 0 && (
        <motion.span
          className="rounded-full bg-warning"
          {...grow(0.38)}
          style={{ flex: down, transformOrigin: "right" }}
        />
      )}
    </span>
  );
}
