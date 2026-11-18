/**
 * Fade and lift in (the prototypes' `rise`: opacity 0 → 1, y 12 → 0, 520 ms ease-out) with a
 * stagger context for the page-load choreography: the headline at 0 ms, the
 * first row of cards +60 ms with 50 ms between them, secondary content +120 ms.
 *
 * `<RevealGroup>` staggers its direct `<Reveal>` children; `delay` adds to the group's slot.
 * `once` (default) plays only on mount, never when data is filtered ("Aldrig ved filtrering").
 * Reduced motion: a 120 ms fade.
 */
import { createContext, useContext, type ReactNode } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { EASE, REDUCED_FADE } from "@/lib/motion";

const GroupContext = createContext<{ start: number; step: number } | null>(null);
const IndexContext = createContext(0);

export function RevealGroup({
  children,
  start = 0.06,
  step = 0.05,
}: {
  children: ReactNode;
  /** Seconds before the first child. */
  start?: number;
  /** Seconds between children. */
  step?: number;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <GroupContext.Provider value={{ start, step }}>
      {items.map((child, index) => (
        // Children keep their own keys inside; the index only sets the slot.
        <IndexContext.Provider key={index} value={index}>
          {child}
        </IndexContext.Provider>
      ))}
    </GroupContext.Provider>
  );
}

export function Reveal({
  children,
  delay = 0,
  y = 12,
  duration = 0.52,
  ...props
}: Omit<HTMLMotionProps<"div">, "initial" | "animate" | "transition"> & {
  children: ReactNode;
  /** Extra seconds on top of the group slot. */
  delay?: number;
  /** Lift distance in px (4–16). */
  y?: number;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const group = useContext(GroupContext);
  const index = useContext(IndexContext);
  const slot = group ? group.start + index * group.step : 0;
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration, ease: EASE.out, delay: slot + delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
