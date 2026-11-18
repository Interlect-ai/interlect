/**
 * /intern/grafer: every chart preset from src/lib/charts/presets.ts, drawn with the vendored
 * bklit components where they exist, with a small control bar (duration, stagger, replay)
 * for tuning and "Kopiér preset" to copy the TypeScript object.
 * Charts whose bklit component is not vendored yet say which page brings them.
 *
 * The numbers are the design system's example data (Designsystem "Profil mod tesen"),
 * marked as such on the page; the pages themselves draw real case data.
 */
import { useMemo, useState } from "react";
import { Copy, RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { PieCenter } from "@/components/charts/pie-center";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { Grid } from "@/components/charts/grid";
import { RadarChart } from "@/components/charts/radar-chart";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarLabels } from "@/components/charts/radar-labels";
import { RadarArea } from "@/components/charts/radar-area";
import {
  CardNotFound,
  MarketChart,
  OwnershipChart,
  TeamChart,
  TechChart,
} from "@/components/cases/deep/CardCharts";
import { ScoreGauge } from "@/components/cases/deep/CardFallbackCharts";
import { EconomyNotFound, MissingInfo } from "@/components/cases/deep/CardMissing";
import { Button } from "@/components/ds/Button";
import { showToast } from "@/components/ds/Toast";
import {
  CHART_PRESETS,
  presetTransition,
  tokenColor,
  type ChartPreset,
  type ChartPresetId,
} from "@/lib/charts/presets";

/**
 * Konklusionens specialistgrafer with the prototype's example data (Case Dyb analyse v5,
 * Havbrug Nord); the case page draws the specialists' sourced card data.
 */
const SPECIALIST_EXAMPLES = {
  team: {
    kind: "team" as const,
    people: [
      {
        name: "CEO",
        role: "",
        scores: { domain: 9.5, execution: 8.5, commercial: 4, technical: 6, leadership: 8.8 },
        evidenceIds: ["eksempel"],
      },
      {
        name: "CTO",
        role: "",
        scores: { domain: 8, execution: 7, commercial: 2.5, technical: 9.5, leadership: 6 },
        evidenceIds: ["eksempel"],
      },
    ],
    notFound: null,
  },
  market: {
    kind: "market" as const,
    label: "Landbaserede opdrætsanlæg",
    scope: "market" as const,
    geography: "Norden",
    currency: "DKK",
    unit: "billion" as const,
    points: [
      [2026, 5.1, "actual"],
      [2027, 5.9, "forecast"],
      [2028, 6.9, "forecast"],
      [2029, 8.1, "forecast"],
      [2030, 9.4, "forecast"],
    ].map(([year, value, basis]) => ({
      year: year as number,
      value: value as number,
      basis: basis as "actual" | "forecast",
      evidenceIds: ["eksempel"],
    })),
    notFound: null,
  },
  tech: {
    kind: "techBenchmarks" as const,
    items: [
      { metric: "Dødelighed", unit: "%", company: 4, industry: 9, higherIsBetter: false },
      { metric: "Vand genbrugt", unit: "%", company: 97, industry: 70, higherIsBetter: true },
    ].map((item) => ({ ...item, evidenceIds: ["eksempel"] })),
    notFound: null,
  },
  ownership: {
    kind: "ownership" as const,
    holders: [
      ["Founders", "founder", 54.6],
      ["Seed-investorer", "investor", 22.9],
      ["Nordhav (ny)", "investor", 12],
      ["Medarbejderaktier", "employee_pool", 10.5],
    ].map(([holder, holderType, percent]) => ({
      holder: holder as string,
      holderType: holderType as "founder" | "investor" | "employee_pool",
      percent: percent as number,
      asOf: null,
      evidenceIds: ["eksempel"],
    })),
    rounds: [],
    notFound: null,
  },
};

/** Designsystem "Profil mod tesen": criterion, weight %, score. */
const PROFILE = [
  ["Founder-market fit", 16, 62],
  ["Team", 12, 58],
  ["Produkt-market fit", 12, 54],
  ["TAM og potentiale", 13, 60],
  ["Timing", 10, 57],
  ["Traction", 13, 43],
  ["Teknologi", 10, 64],
  ["Transformativ", 7, 55],
  ["Transparens", 4, 49],
  ["Fremtid", 3, 63],
] as const;

const WEEKS = [4, 6, 3, 7, 5, 8, 6, 9].map((n, i) => ({
  name: `Uge ${36 + i}`,
  videre: Math.round(n * 0.4),
  rest: n - Math.round(n * 0.4),
}));
const HISTOGRAM = [1, 2, 4, 6, 9, 7, 5, 3, 2, 1].map((n, i) => ({
  name: `${i * 10}–${i * 10 + 9}`,
  value: n,
}));
const STAGES = [
  { label: "Pre-seed", value: 11 },
  { label: "Seed", value: 14 },
  { label: "Serie A", value: 6 },
  { label: "Vækst", value: 3 },
];

interface Tuning {
  durationScale: number;
  staggerMs: number | null;
}

function tunedPreset(preset: ChartPreset, tuning: Tuning): ChartPreset {
  const enter =
    preset.motion.enter.kind === "ease"
      ? {
          ...preset.motion.enter,
          durationMs: Math.round(preset.motion.enter.durationMs * tuning.durationScale),
        }
      : preset.motion.enter;
  return {
    ...preset,
    motion: {
      ...preset.motion,
      enter,
      staggerMs: tuning.staggerMs ?? preset.motion.staggerMs,
    },
  };
}

function PresetChart({ preset, replay }: { preset: ChartPreset; replay: number }) {
  const reduced = Boolean(useReducedMotion());
  const transition = presetTransition(preset, reduced);
  const series = preset.colors.series.map(tokenColor);
  const key = `${preset.id}-${replay}`;

  switch (preset.id as ChartPresetId) {
    case "profil-ring": {
      const data = PROFILE.map(([label, weight, score], i) => ({
        label,
        value: Math.round(((weight * score) / 100) * 10) / 10,
        color: series[i % series.length],
      }));
      return (
        <div className="mx-auto w-[220px]" key={key}>
          <PieChart
            data={data}
            size={220}
            innerRadius={78}
            padAngle={((preset.geometry.gap ?? 1.3) / 100) * Math.PI * 2}
            cornerRadius={0}
            enterTransition={transition}
          >
            {data.map((slice, index) => (
              <PieSlice key={slice.label} index={index} hoverEffect="grow" />
            ))}
            <PieCenter defaultLabel="Vægtet score" formatOptions={{ maximumFractionDigits: 0 }} />
          </PieChart>
        </div>
      );
    }
    case "overblik-stadie": {
      const data = STAGES.map((stage, i) => ({ ...stage, color: series[i % series.length] }));
      return (
        <div className="mx-auto w-[200px]" key={key}>
          <PieChart
            data={data}
            size={200}
            innerRadius={144 / 2}
            padAngle={((preset.geometry.gap ?? 1.2) / 100) * Math.PI * 2}
            cornerRadius={0}
            enterTransition={transition}
          >
            {data.map((slice, index) => (
              <PieSlice key={slice.label} index={index} hoverEffect="grow" />
            ))}
            <PieCenter defaultLabel="Cases" formatOptions={{ maximumFractionDigits: 0 }} />
          </PieChart>
        </div>
      );
    }
    case "profil-rangering":
    case "unit-economics": {
      const rows = [...PROFILE]
        .map(([name, , score]) => ({ name, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, preset.id === "unit-economics" ? 4 : 10);
      return (
        <BarChart
          key={key}
          data={rows}
          xDataKey="name"
          orientation="horizontal"
          valueMax={100}
          aspectRatio="4 / 3"
          barGap={0.45}
          enterTransition={transition}
          margin={{ top: 4, right: 12, bottom: 4, left: 132 }}
        >
          <Bar dataKey="score" fill={series[0]} lineCap={preset.geometry.radius ?? 6} />
          <BarYAxis />
        </BarChart>
      );
    }
    case "overblik-tilgang":
      return (
        <BarChart
          key={key}
          data={WEEKS}
          xDataKey="name"
          stacked
          aspectRatio="16 / 9"
          barGap={0.35}
          enterTransition={transition}
        >
          <Grid horizontal />
          <Bar dataKey="videre" fill={series[0]} lineCap={preset.geometry.radius ?? 6} />
          <Bar dataKey="rest" fill={series[1]} lineCap={preset.geometry.radius ?? 6} />
          <BarXAxis showAllLabels maxLabels={WEEKS.length} />
        </BarChart>
      );
    case "overblik-scorefordeling":
      return (
        <BarChart
          key={key}
          data={HISTOGRAM}
          xDataKey="name"
          aspectRatio="16 / 9"
          barGap={0.25}
          enterTransition={transition}
        >
          <Grid horizontal />
          <Bar dataKey="value" fill={series[0]} lineCap={preset.geometry.radius ?? 6} />
          <BarXAxis maxLabels={5} />
        </BarChart>
      );
    case "profil-radar":
    case "team-radar": {
      const axes = preset.id === "team-radar" ? PROFILE.slice(0, 5) : PROFILE.slice(0, 6);
      const metrics = axes.map(([label]) => ({ key: label, label }));
      const data = [
        {
          label: "Casen",
          color: series[0],
          values: Object.fromEntries(axes.map(([label, , score]) => [label, score])),
        },
      ];
      return (
        <div className="mx-auto w-full max-w-[320px]" key={key}>
          <RadarChart
            data={data}
            metrics={metrics}
            margin={64}
            levels={preset.id === "team-radar" ? 3 : 4}
            enterTransition={transition}
          >
            <RadarGrid showLabels={false} />
            <RadarAxis />
            <RadarLabels fontSize={11} offset={16} />
            <RadarArea index={0} />
          </RadarChart>
        </div>
      );
    }
    default:
      return null;
  }
}

const PAGE_TICKET: Record<string, string> = {
  Screening: "R-5",
  "Dyb analyse": "R-6",
  Overblik: "R-8",
};

export function ChartGallery() {
  const [tuning, setTuning] = useState<Tuning>({ durationScale: 1, staggerMs: null });
  const [replay, setReplay] = useState(0);
  const presets = useMemo(
    () => Object.values(CHART_PRESETS).map((preset) => tunedPreset(preset, tuning)),
    [tuning],
  );

  const copy = async (preset: ChartPreset) => {
    try {
      await navigator.clipboard.writeText(
        `export const ${preset.id.replace(/-./g, (m) => m[1]!.toUpperCase())}Preset = ${JSON.stringify(preset, null, 2)} satisfies ChartPreset;`,
      );
      showToast({ message: "Preset kopieret" });
    } catch {
      showToast({ message: "Kunne ikke kopiere. Marker teksten i stedet.", tone: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-canvas px-5 py-4">
        <span className="text-list font-medium">Motion</span>
        <label className="flex items-center gap-2 text-meta text-ink-3">
          Varighed
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={tuning.durationScale}
            onChange={(event) =>
              setTuning((t) => ({ ...t, durationScale: Number(event.target.value) }))
            }
            className="accent-[var(--action)]"
          />
          <span className="w-10 tabular-nums text-ink-1">
            {Math.round(tuning.durationScale * 100)} %
          </span>
        </label>
        <label className="flex items-center gap-2 text-meta text-ink-3">
          Stagger
          <input
            type="range"
            min={0}
            max={120}
            step={5}
            value={tuning.staggerMs ?? 50}
            onChange={(event) =>
              setTuning((t) => ({ ...t, staggerMs: Number(event.target.value) }))
            }
            className="accent-[var(--action)]"
          />
          <span className="w-12 tabular-nums text-ink-1">
            {tuning.staggerMs === null ? "preset" : `${tuning.staggerMs} ms`}
          </span>
        </label>
        <div className="flex-1" />
        <Button
          variant="quiet"
          size="sm"
          onClick={() => setTuning({ durationScale: 1, staggerMs: null })}
        >
          Nulstil
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={RotateCcw}
          onClick={() => setReplay((n) => n + 1)}
        >
          Afspil igen
        </Button>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
        {presets.map((preset) => (
          <section
            key={preset.id}
            className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg bg-surface p-[22px] shadow-card"
          >
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h3 className="m-0 text-section font-semibold">{preset.name}</h3>
                <span className="text-micro text-ink-4">
                  {preset.chart} · {preset.pages.join(", ")}
                </span>
              </div>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => void copy(preset)}
                className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink-1"
                aria-label={`Kopiér preset ${preset.id}`}
                title="Kopiér preset"
              >
                <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            <div className="grid min-h-[180px] place-items-center">
              {preset.available ? (
                <div className="w-full">
                  <PresetChart preset={preset} replay={replay} />
                </div>
              ) : (
                <span className="max-w-[240px] text-center text-meta text-ink-4">
                  bklit-komponenten kommer med siden (
                  {preset.pages.map((page) => PAGE_TICKET[page] ?? page).join(", ")})
                </span>
              )}
            </div>
            <p className="m-0 text-meta leading-[1.5] text-ink-3">{preset.rule}</p>
            <div className="flex flex-wrap gap-1.5">
              {preset.colors.series.slice(0, 10).map((token) => (
                <span
                  key={token}
                  className="size-3 rounded-full"
                  style={{ background: tokenColor(token) }}
                  title={token}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-section font-semibold">Konklusionens specialistgrafer</h3>
          <span className="text-meta text-ink-3">
            Eksempeldata fra prototypen (Havbrug Nord). Casesiden tegner specialisternes kortdata
            med kilder (T-751, T-656).
          </span>
        </div>
        <div
          key={replay}
          className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr))]"
        >
          {[
            ["Team · radar over personerne", <TeamChart data={SPECIALIST_EXAMPLES.team} />],
            [
              "Produkt og marked · markedsvækst",
              <MarketChart data={SPECIALIST_EXAMPLES.market} color="var(--series-5)" />,
            ],
            [
              "Teknologi og IP · mod branchen",
              <TechChart data={SPECIALIST_EXAMPLES.tech} color="var(--series-1)" />,
            ],
            ["Tese og deal · ejerandele", <OwnershipChart data={SPECIALIST_EXAMPLES.ownership} />],
            [
              "Ikke fundet",
              <CardNotFound reason="Ingen offentlige tal for markedets størrelse i kilderne." />,
            ],
            [
              "Én score mod screeningen (ét kriterium, T-918)",
              <ScoreGauge score={72} screening={64} color="var(--series-5)" label="Marked" />,
            ],
            [
              "Økonomi uden regnskaber (T-918)",
              <EconomyNotFound
                question="Hvad har Havbrug Nord haft i omsætning de seneste år?"
                onFill={() => showToast({ message: "Udfyld åbner Ny opgave", tone: "success" })}
              />,
            ],
            [
              "Mangler information (uden score, T-918)",
              <MissingInfo
                fundId="00000000-0000-0000-0000-000000000000"
                caseId="00000000-0000-0000-0000-000000000000"
                label="Regulering"
                reason={null}
                question="Hvad ved vi om Havbrug Nord for Regulering?"
                onFill={() => showToast({ message: "Udfyld åbner Ny opgave", tone: "success" })}
              />,
            ],
          ].map(([title, chart]) => (
            <div
              key={title as string}
              className="flex min-h-[320px] flex-col gap-4 rounded-xl bg-canvas px-[26px] py-6"
            >
              <span className="text-[15px] font-semibold">{title}</span>
              <div className="flex flex-1 items-center justify-center">{chart}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
