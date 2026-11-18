/**
 * The chart catalogue at the top of /intern/grafer. Every bklit chart type in
 * src/components/charts drawn with the active team's real numbers (the Overblik snapshot and
 * the case list, mapped in src/lib/charts/catalog-data.ts), plus its loading and empty state,
 * so the whole library can be checked in light and dark at 1440 and 1024 before a page uses it.
 *
 * Each card carries `data-graf` (the chart type) and `data-tilstand` (data, tom, lader), which
 * the catalogue's e2e test reads (tests/e2e/t670-grafkatalog.ts). Admin only, like the other
 * internal pages (InternalPage); the server functions check the team role themselves.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { curveMonotoneX } from "@visx/curve";
import {
  Area,
  AreaChart,
  AreaChartLoading,
  Bar,
  BarChart,
  BarChartLoading,
  BarXAxis,
  Candlestick,
  CandlestickChart,
  ChartTooltip,
  ChoroplethChart,
  ChoroplethFeatureComponent,
  ChoroplethTooltip,
  ComposedChart,
  FunnelChart,
  Gauge,
  Grid,
  HeatmapCells,
  HeatmapChart,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  HeatmapLegend,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
  Line,
  LineChart,
  LineChartLoading,
  LiveLine,
  LiveLineChart,
  LiveXAxis,
  LiveYAxis,
  PieChart,
  PieSlice,
  RadarArea,
  RadarAxis,
  RadarChart,
  RadarGrid,
  RadarLabels,
  Ring,
  RingCenter,
  RingChart,
  SankeyChart,
  SankeyLink,
  SankeyNode,
  SankeyTooltip,
  Scatter,
  ScatterChart,
  SeriesBar,
  SunburstCenter,
  SunburstChart,
  SunburstLabels,
  SunburstSegment,
  XAxis,
  YAxis,
  buildArcs,
  type ChoroplethFeature,
} from "@/components/charts";
import { EmptyState, ErrorState } from "@/components/ds/States";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { loadWorld, NUMERIC_ID } from "@/components/overview/CountryMap";
import { listCases } from "@/lib/cases/cases.functions";
import {
  activityCalendar,
  activitySeries,
  countryCounts,
  cumulativeActivity,
  funnelData,
  intakeSeries,
  liveActivity,
  medianScore,
  sankeyData,
  scoreBins,
  scoreConfidencePoints,
  scoreRanges,
  sectorStageTree,
  specialistAverages,
  stageSlices,
  thresholdShare,
  type CatalogCase,
  type CatalogSnapshot,
} from "@/lib/charts/catalog-data";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { getOverviewSnapshot } from "@/lib/overview/overview.functions";

type Mode = "data" | "tom" | "lader";
type CardState = Mode | "fejl";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-5)", "var(--series-7)"];

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("da-DK", { day: "numeric", month: "short" });

/**
 * Like Overblik's map: a country without cases stays neutral, a country with cases is drawn in
 * --action in four steps by its share of the busiest country.
 */
function countryColor(feature: ChoroplethFeature): string {
  const value = Number(feature.properties["value"] ?? 0);
  const max = Number(feature.properties["max"] ?? value);
  if (!(value > 0) || !(max > 0)) return "var(--bg-sunken)";
  const step = Math.min(4, Math.ceil((value / max) * 4));
  return `color-mix(in oklab, var(--action) ${[0, 35, 55, 75, 100][step]}%, var(--bg-sunken))`;
}

interface CardSpec {
  type: string;
  title: string;
  question: string;
  source: string;
  /** null: no data for this team, the card shows its empty state. */
  render: (() => ReactNode) | null;
  loading?: () => ReactNode;
}

function CatalogCard({ spec, mode, failed }: { spec: CardSpec; mode: Mode; failed: boolean }) {
  // A failed fetch is an error, never "no data yet" (that would say the team has none).
  const state: CardState =
    mode === "lader"
      ? "lader"
      : mode === "tom"
        ? "tom"
        : failed
          ? "fejl"
          : spec.render
            ? "data"
            : "tom";
  return (
    <section
      data-graf={spec.type}
      data-tilstand={state}
      className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg bg-surface p-[22px] shadow-card"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-micro text-ink-4">{spec.type}</span>
        <h3 className="m-0 text-section font-semibold">{spec.title}</h3>
        <span className="text-meta text-ink-3">{spec.question}</span>
      </div>
      <div className="grid min-h-[240px] place-items-center">
        {state === "lader" ? (
          (spec.loading?.() ?? (
            <div className="h-[200px] w-full animate-pulse rounded-md bg-sunken" aria-busy />
          ))
        ) : state === "fejl" ? (
          <ErrorState title="Tallene kunne ikke hentes" />
        ) : state === "tom" ? (
          <EmptyState
            title="Ingen data endnu"
            body={`Grafen tegnes, når teamet har ${spec.source}.`}
          />
        ) : (
          <div className="w-full">{spec.render!()}</div>
        )}
      </div>
      <span className="text-micro text-ink-4">Data: {spec.source}</span>
    </section>
  );
}

function useWorld() {
  const [world, setWorld] = useState<Array<Feature<Geometry>> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadWorld().then((features) => alive && setWorld(features));
    return () => {
      alive = false;
    };
  }, []);
  return world;
}

export function ChartCatalog() {
  const { fundId } = useActiveFund();
  const [mode, setMode] = useState<Mode>("data");
  const loadOverview = useServerFn(getOverviewSnapshot);
  const loadCases = useServerFn(listCases);
  const overview = useQuery({
    queryKey: ["chart-catalog", "overview", fundId],
    queryFn: () => loadOverview({ data: { fundId: fundId!, period: "52w" } }),
    enabled: Boolean(fundId),
    retry: false,
  });
  const cases = useQuery({
    queryKey: ["chart-catalog", "cases", fundId],
    queryFn: () => loadCases({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
    retry: false,
  });
  const world = useWorld();

  const snapshot: CatalogSnapshot | null =
    overview.data?.status === "ready" ? overview.data.data : null;
  const caseRows: CatalogCase[] = useMemo(() => cases.data ?? [], [cases.data]);
  const specs = useMemo(() => buildSpecs(snapshot, caseRows, world), [snapshot, caseRows, world]);
  const loading = overview.isLoading || cases.isLoading;

  return (
    <div className="flex flex-col gap-4" data-graf-katalog>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 text-title font-semibold tracking-title">Grafkatalog</h2>
          <span className="text-meta text-ink-3">
            Alle graftyper fra bklit-ui (MIT) med teamets rigtige tal fra Overblik og caselisten.
            {overview.isError || cases.isError ? " Tallene kunne ikke hentes." : ""}
          </span>
        </div>
        <div className="flex-1" />
        <SegmentedControl<Mode>
          aria-label="Tilstand"
          size="sm"
          value={loading ? "lader" : mode}
          onChange={setMode}
          options={[
            { value: "data", label: "Rigtige data" },
            { value: "tom", label: "Tom" },
            { value: "lader", label: "Lader" },
          ]}
        />
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))]">
        {specs.map((spec) => (
          <CatalogCard
            key={spec.type}
            spec={spec}
            mode={loading ? "lader" : mode}
            failed={overview.isError || cases.isError}
          />
        ))}
      </div>
    </div>
  );
}

/** The world map with each country's case count and the busiest country's count (for the steps). */
function countryCollection(
  world: Array<Feature<Geometry>>,
  countries: ReadonlyArray<{ code: string; value: number }>,
): FeatureCollection<Geometry, { name?: string; value?: number; max?: number }> {
  const alphaById = new Map(Object.entries(NUMERIC_ID).map(([alpha, id]) => [id, alpha]));
  const valueByAlpha = new Map(countries.map((entry) => [entry.code, entry.value]));
  const max = Math.max(...countries.map((entry) => entry.value));
  return {
    type: "FeatureCollection",
    features: world.map((feature) => {
      const alpha = alphaById.get(String(feature.id));
      const value = alpha ? valueByAlpha.get(alpha) : undefined;
      return {
        ...feature,
        properties: {
          name: alpha ?? String(feature.id),
          max,
          ...(value !== undefined ? { value } : {}),
        },
      };
    }),
  };
}

function buildSpecs(
  snapshot: CatalogSnapshot | null,
  cases: readonly CatalogCase[],
  world: Array<Feature<Geometry>> | null,
): CardSpec[] {
  const funnel = snapshot && funnelData(snapshot);
  const sankey = snapshot && sankeyData(snapshot);
  const countries = snapshot && countryCounts(snapshot);
  const bins = snapshot && scoreBins(snapshot);
  const intake = snapshot && intakeSeries(snapshot, new Date());
  const stages = snapshot && stageSlices(snapshot);
  const share = snapshot && thresholdShare(snapshot);
  const median = snapshot && medianScore(snapshot);
  const activity = snapshot && activitySeries(snapshot);
  const cumulative = snapshot && cumulativeActivity(snapshot);
  const live = snapshot && liveActivity(snapshot);
  const calendar = snapshot && activityCalendar(snapshot);
  const points = scoreConfidencePoints(cases);
  const ranges = scoreRanges(cases);
  const radar = specialistAverages(cases);
  const tree = sectorStageTree(cases);

  const geo: FeatureCollection<Geometry, { name?: string; value?: number; max?: number }> | null =
    countries && world ? countryCollection(world, countries) : null;

  return [
    {
      type: "funnel",
      title: "Pipeline-tragt",
      question: "Hvor mange af årets cases nåede hvert trin?",
      source: "cases i pipelinen (Overblik)",
      render: funnel ? () => <FunnelChart data={funnel} /> : null,
    },
    {
      type: "sankey",
      title: "Strøm gennem pipelinen",
      question: "Hvor går casene videre, og hvor stopper de?",
      source: "cases i pipelinen (Overblik)",
      render: sankey
        ? () => (
            <SankeyChart
              data={sankey}
              aspectRatio="4 / 3"
              nodePadding={30}
              margin={{ top: 12, right: 150, bottom: 12, left: 12 }}
            >
              <SankeyLink />
              <SankeyNode />
              <SankeyTooltip />
            </SankeyChart>
          )
        : null,
    },
    {
      type: "choropleth",
      title: "Hvor casene kommer fra",
      question: "Hvilke lande kommer casene fra?",
      source: "selskabernes land (CVR og registrene)",
      render: geo
        ? () => (
            <ChoroplethChart data={geo} aspectRatio="2 / 1">
              <ChoroplethFeatureComponent getFeatureColor={countryColor} />
              <ChoroplethTooltip />
            </ChoroplethChart>
          )
        : null,
    },
    {
      type: "bar",
      title: "Scorefordeling",
      question: "Hvordan fordeler screeningsscorerne sig?",
      source: "screenede cases",
      render: bins
        ? () => (
            <BarChart data={bins} xDataKey="label" aspectRatio="16 / 9" barGap={0.35}>
              <Grid horizontal />
              <Bar dataKey="count" fill={SERIES[0]} lineCap={6} />
              <BarXAxis showAllLabels maxLabels={bins.length} />
            </BarChart>
          )
        : null,
      loading: () => <BarChartLoading aspectRatio="16 / 9" />,
    },
    {
      type: "composed",
      title: "Tilgang og sendt videre",
      question: "Hvor mange nye cases kom ind, og hvor mange gik videre?",
      source: "nye cases pr. fire uger det seneste år (Overblik)",
      render: intake
        ? () => (
            <ComposedChart data={intake}>
              <Grid horizontal />
              <SeriesBar dataKey="total" fill={SERIES[0]} />
              <Line dataKey="forwarded" stroke={SERIES[2]} curve={curveMonotoneX} />
              <XAxis />
              <ChartTooltip />
            </ComposedChart>
          )
        : null,
    },
    {
      type: "pie",
      title: "Stadie",
      question: "Hvilke stadier er selskaberne i?",
      source: "aktive cases med stadie",
      render: stages
        ? () => (
            <div className="mx-auto w-full max-w-[260px]">
              <PieChart
                data={stages.map((slice, index) => ({
                  ...slice,
                  color: `var(--series-${(index % 8) + 1})`,
                }))}
                innerRadius={0}
              >
                {stages.map((slice, index) => (
                  <PieSlice key={slice.label} index={index} />
                ))}
              </PieChart>
            </div>
          )
        : null,
    },
    {
      type: "ring",
      title: "Over tærsklen",
      question: "Hvor stor en del af de screenede cases ligger over teamets tærskel?",
      source: "screenede cases og teamets tærskel",
      render: share
        ? () => (
            <div className="mx-auto w-full max-w-[260px]">
              <RingChart
                data={[
                  {
                    label: "Over tærsklen",
                    value: share.over,
                    maxValue: share.total,
                    color: SERIES[1],
                  },
                ]}
                size={240}
                strokeWidth={16}
              >
                <Ring index={0} />
                <RingCenter defaultLabel={`${share.percent} % over tærsklen`} />
              </RingChart>
            </div>
          )
        : null,
    },
    {
      type: "gauge",
      title: "Medianscore",
      question: "Hvor ligger den typiske case i forhold til tærsklen?",
      source: "screenede cases",
      render: median
        ? () => (
            <Gauge
              value={median.value}
              centerValue={Math.round(median.value)}
              totalNotches={40}
              defaultLabel={`Median · tærskel ${median.threshold}`}
            />
          )
        : null,
    },
    {
      type: "line",
      title: "Analyser pr. dag",
      question: "Hvor mange analyser har teamet kørt de sidste 14 dage?",
      source: "kørsler de sidste 14 dage",
      render: activity
        ? () => (
            <LineChart data={activity}>
              <Grid horizontal />
              <Line dataKey="runs" stroke={SERIES[0]} curve={curveMonotoneX} />
              <XAxis />
              <ChartTooltip />
            </LineChart>
          )
        : null,
      loading: () => <LineChartLoading />,
    },
    {
      type: "area",
      title: "Analyser i alt",
      question: "Hvor mange analyser er kørt i perioden, dag for dag?",
      source: "kørsler de sidste 14 dage",
      render: cumulative
        ? () => (
            <AreaChart data={cumulative}>
              <Grid horizontal />
              <Area dataKey="total" fill={SERIES[2]} fillOpacity={0.35} curve={curveMonotoneX} />
              <XAxis />
              <ChartTooltip />
            </AreaChart>
          )
        : null,
      loading: () => <AreaChartLoading />,
    },
    {
      type: "live-line",
      title: "Aktivitet lige nu",
      question: "Hvordan har aktiviteten udviklet sig frem til i dag?",
      source: "kørsler de sidste 14 dage",
      render: live
        ? () => (
            <LiveLineChart data={live.data} value={live.value} window={15 * 86_400}>
              <LiveLine dataKey="value" stroke={SERIES[0]} curve={curveMonotoneX} />
              <LiveXAxis formatTime={dayLabel} />
              <LiveYAxis />
            </LiveLineChart>
          )
        : null,
    },
    {
      type: "heatmap",
      title: "Aktivitetskalender",
      question: "Hvilke dage arbejder teamet med cases?",
      source: "kørsler de sidste 14 dage",
      render: calendar
        ? () => (
            <HeatmapInteractionProvider>
              <HeatmapInteractionBoundary>
                <div className="mx-auto flex w-full max-w-[360px] flex-col items-stretch gap-3">
                  <HeatmapChart className="w-full" data={calendar} layout="fluid">
                    <HeatmapCells />
                    <HeatmapXAxis />
                    <HeatmapYAxis />
                    <HeatmapTooltip />
                  </HeatmapChart>
                  <HeatmapLegend />
                </div>
              </HeatmapInteractionBoundary>
            </HeatmapInteractionProvider>
          )
        : null,
    },
    {
      type: "scatter",
      title: "Score og datatillid",
      question: "Følges en høj score af god evidens?",
      source: "scorede cases",
      render: points
        ? () => (
            <ScatterChart data={points}>
              <Grid horizontal />
              <Scatter dataKey="score" fill={SERIES[0]} />
              <Scatter dataKey="confidence" fill={SERIES[2]} />
              <XAxis />
              <ChartTooltip />
            </ScatterChart>
          )
        : null,
    },
    {
      type: "candlestick",
      title: "Scoreudvikling pr. case",
      question: "Hvor meget har en case' score flyttet sig mellem kørslerne?",
      source: "cases med mindst to kørsler",
      render: ranges
        ? () => (
            <CandlestickChart data={ranges}>
              <Grid horizontal />
              <Candlestick />
              <XAxis />
              <YAxis />
              <ChartTooltip />
            </CandlestickChart>
          )
        : null,
    },
    {
      type: "radar",
      title: "Specialisternes gennemsnit",
      question: "Hvor er teamets dybe analyser stærkest og svagest?",
      source: "dybe analyser",
      render: radar
        ? () => (
            <div className="mx-auto w-full max-w-[340px]">
              <RadarChart
                data={[
                  {
                    label: "Gennemsnit",
                    color: SERIES[1]!,
                    values: Object.fromEntries(radar.map((axis) => [axis.label, axis.value])),
                  },
                ]}
                metrics={radar.map((axis) => ({ key: axis.label, label: axis.label }))}
                margin={92}
                levels={4}
              >
                <RadarGrid showLabels={false} />
                <RadarAxis />
                <RadarLabels fontSize={11} offset={14} wrapChars={14} />
                <RadarArea index={0} showGlow={false} />
              </RadarChart>
            </div>
          )
        : null,
    },
    {
      type: "sunburst",
      title: "Sektor og stadie",
      question: "Hvilke sektorer fylder, og i hvilke stadier?",
      source: "cases med sektor og stadie",
      render: tree
        ? () => {
            const { arcs } = buildArcs(tree);
            return (
              <div className="mx-auto w-full max-w-[320px]">
                <SunburstChart data={tree} size={300}>
                  {arcs.map((arc) => (
                    <SunburstSegment index={arc.arcIndex} key={arc.id} />
                  ))}
                  <SunburstCenter />
                  <SunburstLabels />
                </SunburstChart>
              </div>
            );
          }
        : null,
    },
  ];
}
