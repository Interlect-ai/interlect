"use client";

import { motion } from "motion/react";
import { radarCssVars, useRadarStable } from "./radar-context";

export interface RadarLabelsProps {
  /** Distance from the chart edge. Default: 24 */
  offset?: number | undefined;
  /** Font size for labels. Default: 11 */
  fontSize?: number | undefined;
  /** Enable interactive hover on labels. Default: false */
  interactive?: boolean | undefined;
  /** Additional class name */
  className?: string | undefined;
  /**
   * Wrap a label onto lines of at most this many characters and anchor it by its side of the
   * chart (start on the right, end on the left), so a long name grows outwards instead of
   * being cut off on a narrow card. Default: off (one centred line).
   */
  wrapChars?: number | undefined;
}

/** Words onto lines of at most `max` characters (a longer single word keeps its own line). */
function wrapLabel(label: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= max)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length > 0 ? lines : [label];
}

export function RadarLabels({
  offset = 24,
  fontSize = 11,
  interactive = false,
  className = "",
  wrapChars,
}: RadarLabelsProps) {
  const { metrics, radius, levels, getAngle, animate } = useRadarStable();

  // Label animation delay (starts after grid begins)
  const gridStagger = 0.08;
  const labelDelay = levels * gridStagger * 0.5;

  const labelRadius = radius + offset;

  return (
    <g className={className}>
      {metrics.map((metric, i) => {
        const angle = getAngle(i);
        const x = labelRadius * Math.cos(angle);
        const y = labelRadius * Math.sin(angle);
        const lines = wrapChars ? wrapLabel(metric.label, wrapChars) : [metric.label];
        const side = Math.cos(angle);
        const anchor = !wrapChars || Math.abs(side) < 0.3 ? "middle" : side > 0 ? "start" : "end";

        return (
          <motion.g
            animate={{ opacity: 1, x, y }}
            initial={animate ? { opacity: 0, x: 0, y: 0 } : { opacity: 1, x, y }}
            key={`label-${metric.key}`}
            transition={{
              opacity: {
                duration: 0.5,
                delay: animate ? labelDelay + i * 0.08 : 0,
              },
              x: { type: "spring", stiffness: 80, damping: 15 },
              y: { type: "spring", stiffness: 80, damping: 15 },
            }}
          >
            <text
              className={
                interactive
                  ? "cursor-pointer transition-opacity duration-150 hover:opacity-100"
                  : ""
              }
              dominantBaseline="middle"
              fontSize={fontSize}
              fontWeight={500}
              opacity={interactive ? 0.8 : 1}
              style={{ fill: radarCssVars.label }}
              textAnchor={anchor}
              x={0}
              y={0}
            >
              {lines.map((line, lineIndex) => (
                <tspan
                  dy={lineIndex === 0 ? `${-0.55 * (lines.length - 1)}em` : "1.1em"}
                  key={lineIndex}
                  x={0}
                >
                  {line}
                </tspan>
              ))}
            </text>
          </motion.g>
        );
      })}
    </g>
  );
}

RadarLabels.displayName = "RadarLabels";

export default RadarLabels;
