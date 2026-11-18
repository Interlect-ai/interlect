"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useChart, useChartStable } from "./chart-context";

export interface BarValueLabelsProps {
  /** Keys summed per category (several for a stacked chart). */
  dataKeys: string[];
  /** Hide zero values so empty bins stay quiet. Default: false */
  hideZero?: boolean | undefined;
}

/**
 * Interlect: the value above each vertical bar, so a chart can be read without hover.
 * Uses the chart's own band and value scales, so labels stay aligned at any width.
 */
export function BarValueLabels({ dataKeys, hideZero = false }: BarValueLabelsProps) {
  const { containerRef } = useChartStable();
  const { data, barScale, bandWidth, barXAccessor, yScale, margin } = useChart();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const container = containerRef.current;
  if (!(mounted && container && barScale && bandWidth && barXAccessor)) return null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {data.map((datum) => {
        const category = barXAccessor(datum);
        const value = dataKeys.reduce((sum, key) => sum + Number(datum[key] ?? 0), 0);
        if (hideZero && value === 0) return null;
        const x = (barScale(category) ?? 0) + bandWidth / 2 + margin.left;
        const y = yScale(value) + margin.top;
        return (
          <span
            key={category}
            className="absolute -translate-x-1/2 -translate-y-full pb-0.5 mono-num text-meta text-ink-2"
            style={{ left: x, top: y }}
          >
            {value.toLocaleString("da-DK")}
          </span>
        );
      })}
    </div>,
    container,
  );
}
