/**
 * Mandatfit as status circles ("Status-cirkler"; Case Screening v5: the "Mandatfit" module card and
 * the header of the Mandatfit focus page).
 *
 * Measured in the prototype:
 * - The circle size follows the number of gates: module 30/26/22/18/14 px for ≤5/≤8/≤12/≤16/
 *   more, focus page 56/46/40/32/26 px. Glyph 45 % (module) / 40 % (focus) of the circle and
 *   the gap 30 % / 25 %, both rounded.
 * - Module: a wrapping row, vertically centred in 104 px. Here the 104 px is a minimum, so a
 *   very long list of gates grows the card instead of overflowing it. Focus page: a plain
 *   wrapping row.
 * - Passed: filled --positive with an inverse-ink check. Unknown: empty with a 1.5 px --action ring
 *   and a "?" (600). Breach: filled --critical (an inverse-ink cross, so it does not rely on colour).
 * Motion ("Mandatfit-cirkler", which wins over the prototype's 45/55 ms): pop in
 * from scale.85 with a 35 ms stagger, capped so long rows land within ~600 ms.
 * A status change crossfades the colour over 300 ms and the check draws itself (pathLength).
 * Reduced motion: short fades, no drawing.
 *
 * `DrawnCheck` is the shared drawn-in check ("Checkbox og løs task": pathLength 0 → 1 over 260 ms
 * ease-out), also used by the task rows.
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type GateStatus = "passed" | "unknown" | "failed";

export interface MandatfitGate {
  key: string;
  /** The gate's name; shown as the tooltip and read by screen readers. */
  label: string;
  status: GateStatus;
}

const STATUS_WORD: Record<GateStatus, MessageKey> = {
  passed: "screening.mandate.passed",
  unknown: "screening.mandate.missing",
  failed: "shared.mandate.breach",
};

type SizeStep = 0 | 1 | 2 | 3 | 4;

const SIZES = {
  module: [30, 26, 22, 18, 14],
  focus: [56, 46, 40, 32, 26],
} as const;

function sizeStep(count: number): SizeStep {
  if (count <= 5) return 0;
  if (count <= 8) return 1;
  if (count <= 12) return 2;
  if (count <= 16) return 3;
  return 4;
}

/** Longest total stagger, so many gates never keep the page waiting. */
const MAX_STAGGER = 0.56;
const STAGGER = 0.035;

/** A check that draws itself in (lucide "check" path). Inherits the text colour. */
export function DrawnCheck({
  size,
  strokeWidth = 2,
  delay = 0,
  className,
}: {
  size: number;
  strokeWidth?: number | undefined;
  /** Seconds before the stroke starts. */
  delay?: number | undefined;
  className?: string | undefined;
}) {
  const reduced = useReducedMotion();
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <motion.path
        d="M20 6 9 17l-5-5"
        initial={reduced ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{
          pathLength: { duration: 0.26, ease: EASE.out, delay },
          opacity: { duration: 0.01, delay },
        }}
      />
    </svg>
  );
}

export function MandatfitCircles({
  gates,
  variant = "module",
  delay = 0,
  className,
}: {
  gates: readonly MandatfitGate[];
  /** `module`: the screening card. `focus`: the larger circles on the Mandatfit page. */
  variant?: "module" | "focus" | undefined;
  /** Seconds before the first circle pops in (after the card has landed). */
  delay?: number | undefined;
  className?: string | undefined;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  // After the first paint a gate that turns "passed" draws its check at once (no stagger).
  const [landed, setLanded] = useState(false);
  useEffect(() => setLanded(true), []);

  const focus = variant === "focus";
  const size = SIZES[variant][sizeStep(gates.length)];
  const glyph = Math.round(size * (focus ? 0.4 : 0.45));
  const gap = Math.round(size * (focus ? 0.25 : 0.3));
  const step = gates.length > 1 ? Math.min(STAGGER, MAX_STAGGER / (gates.length - 1)) : 0;

  return (
    <div
      role="list"
      aria-label={t("screening.mandate.title")}
      className={cn("flex flex-wrap", !focus && "min-h-[104px] content-center", className)}
      style={{ gap }}
    >
      {gates.map((gate, index) => {
        const popDelay = delay + index * step;
        const passed = gate.status === "passed";
        const failed = gate.status === "failed";
        return (
          <motion.span
            key={gate.key}
            role="listitem"
            title={gate.label}
            className="grid shrink-0 place-items-center rounded-full transition-[background-color,box-shadow,color] duration-300 ease-standard"
            style={{
              width: size,
              height: size,
              fontSize: glyph,
              background: passed ? "var(--positive)" : failed ? "var(--critical)" : "transparent",
              boxShadow: passed || failed ? "none" : "inset 0 0 0 1.5px var(--action)",
              color: passed || failed ? "var(--ink-inverse)" : "var(--action)",
            }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduced
                ? REDUCED_FADE
                : {
                    scale: { ...SPRING.smooth, delay: popDelay },
                    opacity: { duration: 0.24, ease: EASE.out, delay: popDelay },
                  }
            }
          >
            <span className="sr-only">
              {gate.label}: {t(STATUS_WORD[gate.status])}
            </span>
            {passed && <DrawnCheck size={glyph} delay={landed ? 0 : popDelay + 0.12} />}
            {failed && <X width={glyph} height={glyph} strokeWidth={2} aria-hidden />}
            {gate.status === "unknown" && (
              <span aria-hidden className="leading-none font-semibold">
                ?
              </span>
            )}
          </motion.span>
        );
      })}
    </div>
  );
}
