"use client";

import { useId } from "react";

export interface DashTailStrokeProps {
  /** SVG path `d` for the full series (single curved path). */
  pathD: string | null;
  /** Total length of `pathD` in user units. */
  pathLength: number;
  /** Path length at which the dashed tail begins. */
  dashStartLength: number;
  /** X coordinate (chart inner space) where the tail clip begins. */
  dashStartX: number;
  innerWidth: number;
  innerHeight: number;
  /** Stroke paint — solid color or gradient url. */
  stroke: string;
  strokeWidth: number;
  dashArray: string;
}

export function DashTailStroke({
  pathD,
  pathLength,
  dashStartLength,
  dashStartX,
  innerWidth,
  innerHeight,
  stroke,
  strokeWidth,
  dashArray,
}: DashTailStrokeProps) {
  const clipPathId = useId().replace(/:/g, "");
  const headClipPathId = `${clipPathId}-head`;

  if (!pathD || pathLength <= 0 || dashStartLength >= pathLength) {
    return null;
  }

  const pad = strokeWidth * 2;
  const tailWidth = Math.max(0, innerWidth - dashStartX + pad);

  return (
    <>
      <defs>
        <clipPath id={clipPathId}>
          <rect
            height={innerHeight + pad}
            width={tailWidth}
            x={dashStartX - strokeWidth}
            y={-strokeWidth}
          />
        </clipPath>
        <clipPath id={headClipPathId}>
          <rect
            height={innerHeight + pad}
            width={Math.max(0, dashStartX + pad)}
            x={-pad}
            y={-strokeWidth}
          />
        </clipPath>
      </defs>
      {/* Solid head — clipped to x ≤ dashStartX. Interlect (c2): the split is by x, not by
          an index share of the path length, so it lands on the point also when the points are
          not evenly spaced (e.g. 2018, 2024, 2025). */}
      <path
        clipPath={`url(#${headClipPathId})`}
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
      />
      {/* Dashed tail — clipped to x ≥ dashStartX so dashes follow the curve */}
      <path
        clipPath={`url(#${clipPathId})`}
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeDasharray={dashArray}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
      />
    </>
  );
}
