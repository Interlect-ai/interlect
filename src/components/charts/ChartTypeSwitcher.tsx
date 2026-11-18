/**
 * Genbrugelig visualiseringsswitcher til kriterie-nedbrud, bygget på bklit/ui
 * (visx + motion). Samme datasæt (kriterium, score, vægt, evt. en
 * sammenligningsserie) kan vises som vandrette eller lodrette søjler, pie
 * (hvert kriteriums vægtede bidrag til scoren), ringe eller radar.
 *
 * Brugerens valg pr. instans huskes i localStorage som en ren bekvemmelighed;
 * intet afhænger af den gemte værdi, så læs/skriv fejler stille.
 */
import {
  BarChart as BarsIcon,
  BarChartHorizontal,
  CircleDot,
  PieChart as PieIcon,
  Radar as RadarIcon,
} from "lucide-react";
import { useLocaleTag, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import {
  ALL_TYPES,
  useChartType,
  type ChartCriterionDatum,
  type ChartType,
} from "./use-chart-type";
import { BarChart } from "./bar-chart";
import { Bar } from "./bar";
import { BarXAxis } from "./bar-x-axis";
import { BarYAxis } from "./bar-y-axis";
import { Grid } from "./grid";
import { ChartTooltip } from "./tooltip";
import { PieChart } from "./pie-chart";
import { PieSlice } from "./pie-slice";
import { PieCenter } from "./pie-center";
import { RingChart } from "./ring-chart";
import { Ring } from "./ring";
import { RingCenter } from "./ring-center";
import { RadarChart } from "./radar-chart";
import { RadarGrid } from "./radar-grid";
import { RadarAxis } from "./radar-axis";
import { RadarLabels } from "./radar-labels";
import { RadarArea } from "./radar-area";

export type { ChartCriterionDatum, ChartType };

const TYPE_OPTIONS: Array<{ type: ChartType; labelKey: MessageKey; Icon: typeof PieIcon }> = [
  { type: "bar", labelKey: "charts.switcher.typeBar", Icon: BarChartHorizontal },
  { type: "column", labelKey: "charts.switcher.typeColumn", Icon: BarsIcon },
  { type: "pie", labelKey: "charts.switcher.typePie", Icon: PieIcon },
  { type: "ring", labelKey: "charts.switcher.typeRing", Icon: CircleDot },
  { type: "radar", labelKey: "charts.switcher.typeRadar", Icon: RadarIcon },
];
/**
 * Otte validerede kategorifarver (--series-1..8, se styles.css) i fast rækkefølge.
 * Kriterie 9 og 10 får en lysere udgave af de første to; navn og tal står altid ved siden af.
 */
const PALETTE = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => `var(--series-${slot})`),
  "color-mix(in oklab, var(--series-1) 55%, var(--chart-background))",
  "color-mix(in oklab, var(--series-2) 55%, var(--chart-background))",
];
const colorAt = (index: number) => PALETTE[index % PALETTE.length]!;

function formatPoints(value: number, localeTag: string) {
  return value.toLocaleString(localeTag, { maximumFractionDigits: 1 });
}

function shortLabel(label: string, max: number) {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

/** The small icon buttons; only the types the data can show. */
function ChartTypePicker({
  type,
  available,
  onChoose,
  className,
}: {
  type: ChartType;
  available: readonly ChartType[];
  onChoose: (type: ChartType) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn("flex items-center justify-end gap-1", className)}
      role="group"
      aria-label={t("charts.switcher.pickType")}
    >
      {TYPE_OPTIONS.filter((option) => available.includes(option.type)).map(
        ({ type: optionType, labelKey, Icon }) => (
          <button
            key={optionType}
            type="button"
            aria-pressed={type === optionType}
            title={t(labelKey)}
            onClick={() => onChoose(optionType)}
            className={cn(
              "grid size-7 place-items-center rounded-sm border transition-colors",
              type === optionType
                ? "border-action/30 bg-action-wash text-action"
                : "border-transparent text-ink-4 hover:border-hairline hover:text-ink-2",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{t(labelKey)}</span>
          </button>
        ),
      )}
    </div>
  );
}

export function ChartTypeSwitcher({
  id,
  data,
  defaultType = "bar",
  types = ALL_TYPES,
  seriesLabel: seriesLabelProp,
  compareLabel: compareLabelProp,
}: {
  /** Stabil nøgle for denne visnings gemte valg, fx "deep-criteria". */
  id: string;
  data: ChartCriterionDatum[];
  defaultType?: ChartType;
  types?: ChartType[];
  seriesLabel?: string;
  compareLabel?: string;
}) {
  const t = useT();
  const seriesLabel = seriesLabelProp ?? t("charts.switcher.seriesLabel");
  const compareLabel = compareLabelProp ?? t("charts.switcher.compareLabel");
  const { type, available, choose } = useChartType({ id, data, defaultType, types });

  const hasCompare = data.some((item) => item.compare !== undefined);

  if (data.length === 0 || data.every((item) => item.score === null)) {
    return <p className="text-meta text-ink-4">{t("charts.switcher.empty")}</p>;
  }

  return (
    <div>
      <ChartTypePicker type={type} available={available} onChoose={choose} />
      <div className="mt-3">
        {(type === "bar" || type === "column") && (
          <CriteriaBars
            data={data}
            horizontal={type === "bar"}
            hasCompare={hasCompare}
            seriesLabel={seriesLabel}
            compareLabel={compareLabel}
          />
        )}
        {type === "pie" && <CriteriaContribution data={data} />}
        {type === "ring" && <CriteriaRings data={data} />}
        {type === "radar" && (
          <CriteriaRadar
            data={data}
            hasCompare={hasCompare}
            seriesLabel={seriesLabel}
            compareLabel={compareLabel}
          />
        )}
      </div>
      {hasCompare && type !== "pie" && type !== "ring" && (
        <div className="mt-2 flex flex-wrap gap-4 text-meta text-ink-3">
          <LegendDot color="var(--chart-1)" label={seriesLabel} />
          <LegendDot color="var(--chart-2)" label={compareLabel} />
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

function CriteriaBars({
  data,
  horizontal,
  hasCompare,
  seriesLabel,
  compareLabel,
}: {
  data: ChartCriterionDatum[];
  horizontal: boolean;
  hasCompare: boolean;
  seriesLabel: string;
  compareLabel: string;
}) {
  const t = useT();
  const notScored = t("charts.notScored");
  // Kategorinøglen skal være unik, ellers slår båndskalaen to kriterier med
  // samme forkortede navn sammen.
  const seen = new Map<string, number>();
  const rows = data.map((item) => {
    // Navn og tal står altid på aksen, så diagrammet kan læses uden hover.
    const value = item.score === null ? notScored : String(Math.round(item.score));
    const compare =
      item.compare === undefined
        ? ""
        : ` / ${item.compare === null ? notScored : Math.round(item.compare)}`;
    const base = horizontal
      ? `${shortLabel(item.label, 26)} · ${value}${compare}`
      : `${shortLabel(item.label, 9)} ${value}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      name: count === 1 ? base : `${base} (${count})`,
      // Manglende score tegnes som en tom søjle; aksen og tooltippen siger "ikke scoret".
      score: item.score ?? 0,
      scored: item.score !== null,
      // Manglende sammenligning er usikkerhed, ikke 0: søjlen udelades.
      compare: item.compare ?? null,
    };
  });
  const aspectRatio = horizontal
    ? `16 / ${Math.max(5, Math.round(rows.length * (hasCompare ? 1.3 : 0.9)))}`
    : "16 / 9";
  return (
    <BarChart
      data={rows}
      xDataKey="name"
      orientation={horizontal ? "horizontal" : "vertical"}
      valueMax={100}
      aspectRatio={aspectRatio}
      barGap={hasCompare ? 0.3 : 0.35}
      margin={
        horizontal
          ? { top: 8, right: 16, bottom: 8, left: 170 }
          : { top: 16, right: 8, bottom: 36, left: 8 }
      }
    >
      <Grid horizontal={!horizontal} vertical={horizontal} />
      <Bar dataKey="score" fill="var(--chart-1)" lineCap={4} />
      {hasCompare && <Bar dataKey="compare" fill="var(--chart-2)" lineCap={4} />}
      {horizontal ? <BarYAxis /> : <BarXAxis showAllLabels maxLabels={rows.length} />}
      <ChartTooltip
        showCrosshair={false}
        rows={(point) => [
          {
            color: "var(--chart-1)",
            label: seriesLabel,
            value: point["scored"] ? Number(point["score"] ?? 0) : notScored,
          },
          ...(hasCompare
            ? [
                {
                  color: "var(--chart-2)",
                  label: compareLabel,
                  value:
                    point["compare"] === null || point["compare"] === undefined
                      ? notScored
                      : Number(point["compare"]),
                },
              ]
            : []),
        ]}
      />
    </BarChart>
  );
}

/**
 * Pie over hvert kriteriums vægtede bidrag (vægt × score); summen er den vægtede score.
 * `compact`: for a card on Konklusion: the pie as large as the card allows, with a tight
 * list of names and scores right beside it (wrapping under it on a narrow card).
 */
export function CriteriaContribution({
  data,
  compact = false,
}: {
  data: readonly ChartCriterionDatum[];
  compact?: boolean;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const totalWeight = data.reduce((sum, item) => sum + (item.weight ?? 0), 0);
  if (totalWeight <= 0) {
    return <p className="text-meta text-ink-4">{t("charts.switcher.noWeights")}</p>;
  }
  // Et kriterium uden score bidrager med 0 point; legenden skriver "ikke scoret".
  const slices = data.map((item, index) => ({
    label: item.label,
    value: Math.round(((item.weight ?? 0) / totalWeight) * (item.score ?? 0) * 10) / 10,
    color: item.color ?? colorAt(index),
  }));
  const hasUnscored = data.some((item) => item.score === null);
  const size = compact ? 250 : 220;
  return (
    <div
      className={cn(
        "w-full items-center",
        compact
          ? "flex flex-wrap justify-center gap-x-7 gap-y-4"
          : "grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]",
      )}
    >
      <div className={cn(!compact && "mx-auto")} style={{ width: size }}>
        <PieChart
          data={slices}
          size={size}
          innerRadius={compact ? 74 : 70}
          padAngle={0.02}
          cornerRadius={3}
        >
          {slices.map((slice, index) => (
            <PieSlice key={data[index]!.key} index={index} hoverEffect="grow" />
          ))}
          <PieCenter
            defaultLabel={
              hasUnscored
                ? t("charts.switcher.pointsFromScored")
                : t("charts.switcher.weightedScore")
            }
            formatOptions={{ maximumFractionDigits: 0 }}
          />
        </PieChart>
      </div>
      <ul className={cn("grid", compact ? "gap-2 text-list" : "gap-1.5 text-meta")}>
        {data.map((item, index) => (
          <li
            key={item.key}
            className={cn(
              "grid items-center",
              // On a card the score sits right after the name, not across the card.
              compact
                ? "grid-cols-[10px_auto_auto] gap-x-2.5"
                : "grid-cols-[10px_minmax(0,1fr)_auto] gap-2",
            )}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: item.color ?? colorAt(index) }}
              aria-hidden
            />
            <span className="truncate text-ink-2" title={item.label}>
              {item.label}
            </span>
            {compact ? (
              // On a card only the score: the points and weights are in the tab.
              <span className="mono-num text-ink">
                {item.score === null ? t("charts.notScored") : Math.round(item.score)}
              </span>
            ) : (
              <span className="mono-num text-ink-3">
                {item.score === null ? (
                  t("charts.notScored")
                ) : (
                  <>
                    <span className="text-ink">
                      {t("charts.switcher.points", {
                        points: formatPoints(slices[index]!.value, localeTag),
                      })}
                    </span>{" "}
                    · {Math.round(item.score)}
                  </>
                )}{" "}
                · {t("charts.percent", { value: Math.round(item.weight ?? 0) })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One ring per criterion (its score of 100). `compact`: smaller, for a card on Konklusion. */
export function CriteriaRings({
  data,
  compact = false,
}: {
  data: readonly ChartCriterionDatum[];
  compact?: boolean;
}) {
  const t = useT();
  const scoredCount = data.filter((item) => item.score !== null).length;
  const rings = data.map((item, index) => ({
    label: item.label,
    value: item.score ?? 0,
    maxValue: 100,
    color: item.color ?? colorAt(index),
  }));
  const size = compact ? 250 : 240;
  const weight = data.reduce(
    (sum, item) => sum + (item.score === null ? 0 : (item.weight ?? 1)),
    0,
  );
  const centre =
    weight > 0
      ? Math.round(
          data.reduce(
            (sum, item) => sum + (item.score === null ? 0 : item.score * (item.weight ?? 1)),
            0,
          ) / weight,
        )
      : null;
  return (
    <div
      className={cn(
        "w-full items-center",
        compact
          ? "flex flex-wrap justify-center gap-x-7 gap-y-4"
          : "grid gap-4 sm:grid-cols-[240px_minmax(0,1fr)]",
      )}
    >
      <div className={cn(!compact && "mx-auto")} style={{ width: size }}>
        <RingChart
          data={rings}
          size={size}
          strokeWidth={compact ? 10 : 9}
          ringGap={compact ? 3 : 4}
          // On a card the rings fill the circle: one criterion is one large ring, not a small one.
          baseInnerRadius={compact ? Math.max(30, size / 2 - 4 - rings.length * 13) : 44}
        >
          {rings.map((ring, index) => (
            <Ring key={data[index]!.key} index={index} />
          ))}
          <RingCenter>
            {({ value, label, isHovered }) =>
              compact ? (
                // On a card the centre is the number that matters, as large as the ring allows
                // The hovered criterion's score, else the weighted score.
                <div className="text-center">
                  <div
                    className={cn(
                      "mono-num leading-none font-semibold text-ink",
                      rings.length === 1 ? "text-[44px]" : "text-[32px]",
                    )}
                  >
                    {isHovered ? Math.round(value) : (centre ?? "–")}
                  </div>
                  {isHovered && rings.length > 1 && (
                    <div className="max-w-[72px] truncate text-micro text-ink-3">{label}</div>
                  )}
                </div>
              ) : (
                <div className="text-center">
                  <div className="mono-num text-lead font-semibold text-ink">
                    {isHovered ? Math.round(value) : `${scoredCount}/${data.length}`}
                  </div>
                  <div
                    className={cn(
                      "text-ink-3",
                      compact
                        ? "line-clamp-2 max-w-[64px] text-micro leading-tight"
                        : "max-w-[92px] truncate text-meta",
                    )}
                  >
                    {isHovered ? label : t("charts.switcher.criteriaScored")}
                  </div>
                </div>
              )
            }
          </RingCenter>
        </RingChart>
      </div>
      {!(compact && rings.length === 1) && (
        <ul className={cn("grid", compact ? "gap-2 text-list" : "gap-1.5 text-meta")}>
          {data.map((item, index) => (
            <li
              key={item.key}
              className={cn(
                "grid items-center",
                // On a card the score sits right after the name, not across the card.
                compact
                  ? "grid-cols-[10px_auto_auto] gap-x-2.5"
                  : "grid-cols-[10px_minmax(0,1fr)_auto] gap-2",
              )}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: item.color ?? colorAt(index) }}
                aria-hidden
              />
              <span className="truncate text-ink-2" title={item.label}>
                {item.label}
              </span>
              <span className="mono-num text-ink-3">
                {item.score === null ? t("charts.notScored") : Math.round(item.score)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CriteriaRadar({
  data,
  hasCompare,
  seriesLabel,
  compareLabel,
}: {
  data: ChartCriterionDatum[];
  hasCompare: boolean;
  seriesLabel: string;
  compareLabel: string;
}) {
  const t = useT();
  const scored = data.filter((item) => item.score !== null);
  const unscored = data.filter((item) => item.score === null);
  const metrics = scored.map((item) => ({
    key: item.key,
    label: `${shortLabel(item.label, 16)} ${Math.round(item.score ?? 0)}`,
  }));
  const series = [
    {
      label: seriesLabel,
      color: "var(--chart-1)",
      values: Object.fromEntries(scored.map((item) => [item.key, item.score ?? 0])),
    },
    ...(hasCompare && scored.every((item) => item.compare !== null && item.compare !== undefined)
      ? [
          {
            label: compareLabel,
            color: "var(--chart-2)",
            values: Object.fromEntries(scored.map((item) => [item.key, item.compare ?? 0])),
          },
        ]
      : []),
  ];
  return (
    <div className="mx-auto w-full max-w-[380px]">
      <RadarChart data={series} metrics={metrics} margin={72}>
        <RadarGrid showLabels={false} />
        <RadarAxis />
        <RadarLabels fontSize={11} offset={18} />
        {series.map((item, index) => (
          <RadarArea key={item.label} index={index} />
        ))}
      </RadarChart>
      {unscored.length > 0 && (
        <p className="mt-1 text-center text-meta text-ink-4">
          {t("charts.switcher.unscoredList", {
            list: unscored.map((item) => item.label).join(", "),
          })}
        </p>
      )}
    </div>
  );
}
