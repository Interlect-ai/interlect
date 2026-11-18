/**
 * The half-circle gauge on a specialist tab (Case Dyb analyse v5, line 137; preset
 * "specialist-gauge": stroke 10, round ends, the specialist's series colour). bklit's gauge is
 * not vendored yet, so this is the prototype's own SVG (viewBox 120 × 70, arc r 50) with the
 * arc drawn by motion: 900 ms ease-out, the number in the middle counts up. On a card on
 * Konklusion it is drawn wider, with the screening score as a tick across the arc.
 */
import { motion, useReducedMotion } from "motion/react";
import { CountUp } from "@/components/ds/CountUp";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";

const ARC = "M10 62 A50 50 0 0 1 110 62";

/** The point at radius `r` on the arc for a value 0–100 (the arc's centre is 60, 62). */
function arcPoint(value: number, r: number): { x: number; y: number } {
  const angle = Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
  return { x: 60 + r * Math.cos(angle), y: 62 - r * Math.sin(angle) };
}

export function Gauge({
  value,
  color,
  label,
  mark = null,
  markLabel,
  width = 160,
}: {
  /** 0–100, or null when the specialist has no score. */
  value: number | null;
  color: string;
  label: string;
  /** 0–100: a tick across the arc, e.g. the score at screening. */
  mark?: number | null | undefined;
  /** The tick's tooltip and the end of the label, e.g. "Ved screening: 64". */
  markLabel?: string | undefined;
  width?: number | undefined;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const share = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const height = Math.round((width * 94) / 160);
  const tick = mark === null ? null : { from: arcPoint(mark, 41), to: arcPoint(mark, 59) };
  const scoreLabel =
    value === null
      ? t("deep.gauge.noScore", { label })
      : t("deep.gauge.score", { label, score: Math.round(value) });
  return (
    <div
      className="relative flex-none"
      style={{ width, height }}
      role="img"
      aria-label={tick && markLabel ? `${scoreLabel}. ${markLabel}` : scoreLabel}
    >
      <svg viewBox="0 0 120 70" width={width} height={height} aria-hidden>
        <path
          d={ARC}
          fill="none"
          stroke="var(--chart-track)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {value !== null && share > 0 && (
          <motion.path
            d={ARC}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
            // Reduced motion fades the arc in at its length; it is never drawn as a full arc.
            initial={reduced ? { opacity: 0, pathLength: share } : { pathLength: 0 }}
            animate={reduced ? { opacity: 1, pathLength: share } : { pathLength: share }}
            transition={reduced ? REDUCED_FADE : { duration: 0.9, ease: EASE.out, delay: 0.15 }}
          />
        )}
        {tick && (
          <motion.line
            x1={tick.from.x}
            y1={tick.from.y}
            x2={tick.to.x}
            y2={tick.to.y}
            stroke="var(--ink-2)"
            strokeWidth={2}
            strokeLinecap="round"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? REDUCED_FADE : { duration: 0.3, ease: EASE.out, delay: 0.9 }}
          >
            {markLabel && <title>{markLabel}</title>}
          </motion.line>
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="text-[34px] leading-none font-semibold tracking-display tabular-nums">
          {value === null ? "–" : <CountUp value={Math.round(value)} duration={900} />}
        </span>
      </div>
    </div>
  );
}
