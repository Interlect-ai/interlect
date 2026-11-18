/**
 * Profil mod tesen as a focus page (Case Screening v5, lines 266–320; "Profil mod tesen skal kunne
 * vises som ring, rangering, radar og bidrag"). Same data in four views, the
 * choice remembered in this browser; "Sådan passer casen til tesen" with "Løfter mest" and
 * "Længst fra tesen"; then every criterion with its reasoning behind a click.
 *
 * The ring and the radar are bklit (the prototype's SVG); the ranking and the contributions are
 * the prototype's own HTML bars (gap/R-5-screening.md, choice 9). The fund has no target per
 * criterion, so the marks on the bars and the radar's second line are the fund's threshold
 * (choice 5).
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ChartBarBig,
  ChartNoAxesGantt,
  ChartPie,
  ChevronDown,
  CircleHelp,
  FileText,
  Radar,
  UserRoundPen,
} from "lucide-react";
import { FocusPage } from "@/components/ds/FocusPage";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { Collapse } from "@/components/ds/Collapse";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { RadarChart } from "@/components/charts/radar-chart";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarLabels } from "@/components/charts/radar-labels";
import { RadarArea } from "@/components/charts/radar-area";
import {
  farthestFromThreshold,
  formatPoints,
  formatScore,
  formatSignedPoints,
  liftsMost,
  weightedScore,
  type ProfileRow,
} from "@/lib/cases/screening-view";
import type { CriterionView } from "@/lib/cases/view-model";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ProfileView = "ring" | "rank" | "radar" | "water";
const VIEW_KEY = "interlect.profile-view";

function readView(): ProfileView {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY);
    return stored === "rank" || stored === "radar" || stored === "water" ? stored : "ring";
  } catch {
    return "ring";
  }
}

export function ProfileFocus({
  companyName,
  onBack,
  onEvidence,
  rows,
  criteria,
  threshold,
  profileVersion,
  fitText,
  newAnswerKeys,
}: {
  companyName: string;
  onBack: () => void;
  /** "Se evidens": the sources behind the score (the "Hvorfor?" page). */
  onEvidence: () => void;
  rows: readonly ProfileRow[];
  criteria: readonly CriterionView[];
  threshold: number | null;
  profileVersion: string;
  /** "Sådan passer casen til tesen": the code's own reading of the score (scoring rationale). */
  fitText: string | null;
  /** Criteria with a team answer after the screening ("nyt svar", screen again to count it). */
  newAnswerKeys: ReadonlySet<string>;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const [view, setView] = useState<ProfileView>("ring");
  useEffect(() => setView(readView()), []);
  const choose = (next: ProfileView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A private window keeps the choice for this visit only.
    }
  };
  const score = weightedScore(rows);
  const lifts = liftsMost(rows);
  const far = farthestFromThreshold(rows, threshold);

  return (
    <FocusPage
      backLabel={companyName}
      onBack={onBack}
      title={t("screening.profile.title")}
      subtitle={t(
        rows.length === 1 ? "screening.profile.subtitleOne" : "screening.profile.subtitleMany",
        {
          version: profileVersion.startsWith("v") ? profileVersion : `v${profileVersion}`,
          count: rows.length,
          score: formatScore(score, language),
        },
      )}
      actions={
        <SegmentedControl<ProfileView>
          aria-label={t("screening.profile.view")}
          value={view}
          onChange={choose}
          options={[
            {
              value: "ring",
              label: <ViewLabel icon={ChartPie} text={t("screening.profile.ring")} />,
            },
            {
              value: "rank",
              label: <ViewLabel icon={ChartBarBig} text={t("screening.profile.rank")} />,
            },
            {
              value: "radar",
              label: <ViewLabel icon={Radar} text={t("screening.profile.radar")} />,
            },
            {
              value: "water",
              label: <ViewLabel icon={ChartNoAxesGantt} text={t("screening.profile.water")} />,
            },
          ]}
        />
      }
    >
      <motion.div
        className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-3"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.62, ease: EASE.out, delay: 0.12 }}
      >
        <div className="flex min-h-[380px] items-center justify-center rounded-lg bg-canvas p-5 md:p-7">
          {view === "ring" && <RingView rows={rows} score={score} />}
          {view === "rank" && <RankView rows={rows} threshold={threshold} />}
          {view === "radar" && <RadarView rows={rows} threshold={threshold} />}
          {view === "water" && <WaterView rows={rows} score={score} />}
        </div>
        <div className="flex flex-col gap-3 rounded-lg bg-canvas p-6">
          <span className="text-section font-semibold">{t("screening.profile.fitTitle")}</span>
          {fitText && (
            <p className="m-0 text-body leading-[1.65] text-pretty whitespace-pre-line text-ink-2">
              {fitText}
            </p>
          )}
          <div className="mt-auto grid grid-cols-2 gap-2.5">
            <Tile
              label={t("screening.profile.liftsMost")}
              row={lifts}
              value={lifts ? formatPoints(lifts.contribution, language) : "–"}
            />
            <Tile
              label={t("screening.profile.farthest")}
              row={far?.row ?? null}
              value={
                far && threshold !== null
                  ? `${formatScore(far.row.score, language)} / ${formatScore(threshold, language)}`
                  : t("screening.profile.noneBelow")
              }
            />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="flex flex-col"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.64, ease: EASE.out, delay: 0.18 }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-3">
          <span className="text-title font-semibold tracking-title">
            {rows.length === 1
              ? t("screening.profile.criterionOne")
              : t("screening.profile.criteriaMany", { count: rows.length })}
          </span>
          <span className="text-meta text-ink-4">{t("screening.profile.tapHint")}</span>
        </div>
        {rows.map((row, index) => (
          <CriterionRow
            key={row.key}
            row={row}
            criterion={criteria[index]}
            threshold={threshold}
            newAnswer={newAnswerKeys.has(row.key)}
            initialOpen={index === 0}
            delay={index * 0.04}
            onEvidence={onEvidence}
          />
        ))}
      </motion.div>
    </FocusPage>
  );
}

function ViewLabel({ icon: Icon, text }: { icon: typeof ChartPie; text: string }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      {text}
    </span>
  );
}

function Tile({ label, row, value }: { label: string; row: ProfileRow | null; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface p-4">
      <span className="text-meta text-ink-3">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-list font-semibold">
        {row && (
          <span className="size-[7px] shrink-0 rounded-full" style={{ background: row.color }} />
        )}
        <span className="truncate">{row?.label ?? "–"}</span>
      </span>
      <span className="text-[24px] leading-[1.2] font-semibold tracking-title">{value}</span>
    </div>
  );
}

function RingView({ rows, score }: { rows: readonly ProfileRow[]; score: number }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover === null ? null : rows[hover];
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-x-9 gap-y-7 sm:flex-nowrap sm:gap-x-7">
      <div className="relative aspect-square w-[min(240px,100%)] flex-none sm:w-[min(240px,48%)]">
        <PieChart
          data={rows.map((row) => ({ label: row.label, value: row.weight, color: row.color }))}
          size={240}
          innerRadius={80}
          padAngle={(1.2 / 100) * Math.PI * 2}
          cornerRadius={0}
          hoveredIndex={hover}
          onHoverChange={setHover}
          {...(reduced ? {} : { enterTransition: { duration: 0.9, ease: EASE.out } })}
        >
          {rows.map((row, index) => (
            <PieSlice key={row.key} index={index} hoverEffect="grow" hoverOffset={4} />
          ))}
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[56px] leading-none font-semibold tracking-display">
            {formatScore(shown ? shown.score : score, language)}
          </span>
          <span className="max-w-[140px] truncate text-meta text-ink-3">
            {shown ? shown.label : t("screening.profile.weightedScore")}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 sm:max-w-[280px] sm:flex-1">
        {rows.map((row, index) => (
          <div
            key={row.key}
            title={row.label}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            className={cn(
              "grid h-6 grid-cols-[8px_minmax(0,1fr)_44px] items-center gap-2.5 rounded-[7px] px-2 text-meta whitespace-nowrap transition-colors duration-[var(--dur-quick)]",
              hover === index && "bg-surface",
            )}
          >
            <span className="size-2 rounded-full" style={{ background: row.color }} />
            <span className="truncate">{row.label}</span>
            <span className="text-right text-ink-3">
              {formatPoints(row.contribution, language)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrowRow({ delay, children }: { delay: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="absolute inset-0 rounded-[7px]"
      initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
      animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.8, ease: EASE.out, delay }}
      style={{ transformOrigin: "left" }}
    >
      {children}
    </motion.div>
  );
}

function RankView({ rows, threshold }: { rows: readonly ProfileRow[]; threshold: number | null }) {
  const t = useT();
  const language = useLanguage();
  const ranked = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <div className="flex w-full flex-col gap-[9px]">
      {ranked.map((row, index) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(90px,140px)_minmax(0,1fr)_34px] items-center gap-3.5 text-list whitespace-nowrap"
        >
          <span className="truncate text-ink-2">{row.label}</span>
          <div
            className="relative h-3.5 overflow-hidden rounded-[7px]"
            style={{ background: "var(--chart-hatch)" }}
          >
            <div className="absolute inset-y-0 left-0" style={{ width: `${row.score ?? 0}%` }}>
              <GrowRow delay={index * 0.05}>
                <span
                  className="block h-full w-full rounded-[7px]"
                  style={{ background: row.color }}
                />
              </GrowRow>
            </div>
            {threshold !== null && (
              <span
                className="absolute inset-y-0 w-0.5 bg-ink-1 opacity-50"
                style={{ left: `${threshold}%` }}
                aria-hidden
              />
            )}
          </div>
          <span className="text-right font-semibold">{formatScore(row.score, language)}</span>
        </div>
      ))}
      {threshold !== null && (
        <span className="pt-1 text-meta text-ink-4">
          {t("screening.profile.barLine", { score: formatScore(threshold, language) })}
        </span>
      )}
    </div>
  );
}

function RadarView({ rows, threshold }: { rows: readonly ProfileRow[]; threshold: number | null }) {
  const t = useT();
  const language = useLanguage();
  const metrics = rows.map((row) => ({ key: row.key, label: row.label }));
  const data = [
    {
      label: t("screening.profile.radarCase"),
      color: "var(--series-7)",
      values: Object.fromEntries(rows.map((row) => [row.key, row.score ?? 0])),
    },
    ...(threshold !== null
      ? [
          {
            label: t("screening.profile.radarThreshold"),
            color: "var(--ink-3)",
            values: Object.fromEntries(rows.map((row) => [row.key, threshold])),
          },
        ]
      : []),
  ];
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="w-full max-w-[360px]">
        <RadarChart data={data} metrics={metrics} margin={70} levels={4}>
          <RadarGrid showLabels={false} />
          <RadarAxis />
          <RadarLabels fontSize={10} offset={16} />
          {threshold !== null && <RadarArea index={1} showPoints={false} showGlow={false} />}
          <RadarArea index={0} showGlow={false} />
        </RadarChart>
      </div>
      {threshold !== null && (
        <span className="flex items-center gap-2 text-meta text-ink-4">
          <span className="h-0.5 w-4 rounded-full bg-ink-3" aria-hidden />
          {t("screening.profile.fundThreshold", { score: formatScore(threshold, language) })}
        </span>
      )}
    </div>
  );
}

function WaterView({ rows, score }: { rows: readonly ProfileRow[]; score: number }) {
  const t = useT();
  const language = useLanguage();
  const total = score > 0 ? score : 1;
  let cumulative = 0;
  const bars = rows.map((row) => {
    const left = (cumulative / total) * 100;
    cumulative += row.contribution;
    return { row, left, width: (row.contribution / total) * 100 };
  });
  return (
    <div className="flex w-full flex-col gap-1.5">
      {bars.map(({ row, left, width }, index) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(90px,140px)_minmax(0,1fr)_46px] items-center gap-3.5 text-list whitespace-nowrap"
        >
          <span className="truncate text-ink-2">{row.label}</span>
          <div className="relative h-[18px]">
            <div className="absolute inset-y-0" style={{ left: `${left}%`, width: `${width}%` }}>
              <GrowRow delay={index * 0.06}>
                <span
                  className="block h-full w-full rounded-[5px]"
                  style={{ background: row.color }}
                />
              </GrowRow>
            </div>
          </div>
          <span className="text-right font-semibold">
            {formatSignedPoints(row.contribution, language)}
          </span>
        </div>
      ))}
      <div className="grid grid-cols-[minmax(90px,140px)_minmax(0,1fr)_46px] items-center gap-3.5 text-list whitespace-nowrap">
        <span className="truncate font-semibold text-ink-2">
          {t("screening.profile.weightedScore")}
        </span>
        <div className="relative h-[18px]">
          <GrowRow delay={0.65}>
            <span className="block h-full w-full rounded-[5px] bg-ink-1" />
          </GrowRow>
        </div>
        <span className="text-right font-semibold">{formatScore(score, language)}</span>
      </div>
    </div>
  );
}

function CriterionRow({
  row,
  criterion,
  threshold,
  newAnswer,
  initialOpen,
  delay,
  onEvidence,
}: {
  row: ProfileRow;
  criterion: CriterionView | undefined;
  threshold: number | null;
  newAnswer: boolean;
  /** The first criterion opens with the page, as in the prototype. */
  initialOpen: boolean;
  delay: number;
  onEvidence: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const panelId = useId();
  const [open, setOpen] = useState(initialOpen);
  const evidence = criterion?.evidenceIds.length ?? 0;
  const why = criterion?.rationale || criterion?.verdict || null;
  return (
    <div
      className={cn(
        "rounded-md transition-colors duration-[360ms] ease-standard",
        open ? "bg-canvas" : "bg-transparent",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid min-h-14 w-full grid-cols-[10px_minmax(0,1fr)_40px_20px] items-center gap-x-4 rounded-md px-4 py-2 text-left whitespace-nowrap outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action sm:grid-cols-[10px_minmax(0,220px)_64px_minmax(0,1fr)_40px_20px] sm:py-0"
      >
        <span className="size-2 rounded-full" style={{ background: row.color }} />
        <span className="flex min-w-0 items-center gap-2 text-list font-semibold">
          <span className="truncate">{row.label}</span>
          {newAnswer && (
            <UserRoundPen
              className="size-[13px] shrink-0 text-action"
              strokeWidth={1.75}
              aria-label={t("screening.profile.newAnswer")}
            />
          )}
        </span>
        <span className="hidden font-mono text-micro text-ink-4 sm:inline">
          {t("screening.profile.weight", { weight: Math.round(row.weight) })}
        </span>
        <div className="relative hidden h-2 rounded-[4px] bg-[var(--chart-track)] sm:block">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-[4px]"
            style={{ background: row.color, transformOrigin: "left", width: `${row.score ?? 0}%` }}
            initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
            animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
            transition={reduced ? REDUCED_FADE : { duration: 0.9, ease: EASE.out, delay }}
          />
          {threshold !== null && (
            <div
              className="absolute -top-1 -bottom-1 w-0.5 rounded-[1px] bg-ink-1 opacity-50"
              style={{ left: `${threshold}%` }}
            />
          )}
        </div>
        <span className="text-right text-[15px] font-semibold">
          {formatScore(row.score, language)}
        </span>
        <motion.span
          className="inline-flex text-ink-4"
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduced ? { duration: 0 } : SPRING.smooth}
        >
          <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
        </motion.span>
      </button>
      <Collapse open={open} id={panelId}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-6 px-4 pt-1.5 pb-6 sm:pl-[42px]">
          <div className="flex flex-col gap-2.5">
            {criterion?.description && (
              <span className="text-meta text-ink-3">
                <span className="font-semibold text-ink-2">{t("screening.profile.weAssess")}</span>{" "}
                {criterion.description}
              </span>
            )}
            <p className="m-0 text-body leading-[1.65] text-ink-2">
              {why ?? t("screening.profile.notEnoughEvidence")}
            </p>
            <Drivers
              title={t("screening.profile.pullsUp")}
              items={criterion?.positiveDrivers ?? []}
            />
            <Drivers
              title={t("screening.profile.pullsDown")}
              items={criterion?.negativeDrivers ?? []}
            />
          </div>
          <div className="flex flex-col gap-3">
            {(criterion?.unknowns.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-meta font-semibold text-ink-2">
                  <CircleHelp className="size-[13px] text-action" strokeWidth={1.75} aria-hidden />
                  {t("screening.profile.unconfirmed")}
                </span>
                <span className="text-meta leading-[1.55] text-ink-3">
                  {criterion!.unknowns.join(" ")}
                </span>
              </div>
            )}
            {newAnswer && (
              <span className="text-meta leading-[1.55] text-ink-3">
                {t("screening.profile.teamAnswered")}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-meta text-ink-4">
              <FileText className="size-[13px]" strokeWidth={1.75} aria-hidden />
              {evidence === 0
                ? t("screening.profile.noEvidencePoints")
                : t(
                    evidence === 1
                      ? "screening.profile.evidencePointOne"
                      : "screening.profile.evidencePointMany",
                    { count: evidence },
                  )}
              ,{" "}
              <button
                type="button"
                onClick={onEvidence}
                className="text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
              >
                {t("screening.profile.seeEvidence")}
              </button>
            </span>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

function Drivers({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-semibold text-ink-3">{title}</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-meta leading-[1.5] text-ink-2">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
