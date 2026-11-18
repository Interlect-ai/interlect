/**
 * The weighting donut ("Vægtning": gap 1,2 %, butt caps, hover highlights the segment and shows its
 * value in the middle). bklit's pie chart with the "profil-ring" preset's colours and
 * draw-in; the hover is controlled, so a slider row can light up its own segment too. The same
 * component draws the ring in Teamopsætning and in Ny investeringstese ("Grafkortet": one component
 * both places, c2); the wizard passes its own size, ring width and centre.
 */
import { useMemo, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { CHART_PRESETS, presetTransition, tokenColor } from "@/lib/charts/presets";
import { useLocaleTag, useT } from "@/lib/i18n/useT";

/** The colour of criterion `index` (the same series colours as the Se card and the screening). */
export function weightColor(index: number): string {
  const series = CHART_PRESETS["profil-ring"].colors.series.map(tokenColor);
  return series[index % series.length]!;
}

export function WeightDonut({
  items,
  hovered,
  onHover,
  size = 148,
  innerRatio = 0.32,
  center,
}: {
  items: Array<{ label: string; weight: number }>;
  hovered: number | null;
  onHover: (index: number | null) => void;
  size?: number;
  /** The hole as a share of the size (0.32: Teamopsætning's thick ring). */
  innerRatio?: number;
  /** The text in the middle, given the hovered criterion (null: none hovered). */
  center?: (current: { label: string; weight: number } | null) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const localeTag = useLocaleTag();
  const preset = CHART_PRESETS["profil-ring"];
  const data = useMemo(
    () =>
      items.map((item, index) => ({
        label: item.label || t("fundEditor.donut.unnamed"),
        value: Math.max(item.weight, 0.0001),
        color: weightColor(index),
      })),
    [items, t],
  );
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const current = hovered !== null ? items[hovered] : null;
  if (!items.length) return null;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={t("fundEditor.donut.label", {
        items: items.map((item) => `${item.label} ${item.weight} %`).join(", "),
      })}
    >
      <PieChart
        data={data}
        size={size}
        innerRadius={size * innerRatio}
        hoverOffset={4}
        padAngle={((preset.geometry.gap ?? 1.2) / 100) * Math.PI * 2}
        cornerRadius={0}
        hoveredIndex={hovered}
        onHoverChange={onHover}
        enterTransition={presetTransition(preset, Boolean(reduced))}
      >
        {data.map((slice, index) => (
          <PieSlice key={`${slice.label}-${index}`} index={index} hoverEffect="grow" />
        ))}
      </PieChart>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        {center ? (
          center(current ?? null)
        ) : (
          <div className="flex max-w-[60%] flex-col items-center leading-tight">
            <span className="text-[22px] font-semibold tracking-title tabular-nums">
              {(current ? current.weight : total).toLocaleString(localeTag, {
                maximumFractionDigits: 1,
              })}{" "}
              %
            </span>
            {current && (
              <span className="max-w-full truncate text-micro text-ink-3">{current.label}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
