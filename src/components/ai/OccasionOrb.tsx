/**
 * An `AiOrb` for one occasion in the orb catalogue (src/lib/ai/orb-occasions.ts): the
 * catalogue decides state, size and tone, so every wait looks the same across pages.
 * A phase change crossfades the two states ("AI"); under reduced motion the
 * swap is a short fade and the orb itself is paused by AiOrb.
 */
import { AnimatePresence, motion } from "motion/react";
import { AiOrb } from "@/components/ai/AiOrb";
import {
  ORB_OCCASIONS,
  orbSizeFor,
  orbStateFor,
  type OrbOccasionId,
  type OrbPlacement,
} from "@/lib/ai/orb-occasions";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function OccasionOrb({
  occasion,
  phase = 0,
  placement,
  label,
  className,
  paused = false,
}: {
  occasion: OrbOccasionId;
  /** 0-based phase for occasions with several states (e.g. searching → solving). */
  phase?: number;
  placement?: OrbPlacement;
  /** Screen-reader text in Danish; leave out when visible text stands next to the orb. */
  label?: string;
  className?: string;
  /** Hold still (only one orb moves at a time on a screen). */
  paused?: boolean;
}) {
  const entry = ORB_OCCASIONS[occasion];
  const state = orbStateFor(occasion, phase);
  const size = orbSizeFor(occasion, placement);
  const onDark = "onDark" in entry ? entry.onDark : false;

  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={state}
          className="absolute inset-0 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE.out }}
        >
          <AiOrb state={state} size={size} tone={entry.tone} onDark={onDark} paused={paused} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
