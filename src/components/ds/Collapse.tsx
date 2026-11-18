/**
 * Fold-out ("Fold-ud"): motion tweens the height from 0 to `auto` with the smooth
 * spring, and the content fades in 60 ms later from y 6. The prototypes do the same with
 * grid-template-rows 0fr → 1fr. Height, not `layout`, on purpose: `layout`
 * scales the content with a transform, and with height the content below moves in normal
 * flow. Closed content is not rendered after the exit, so it is not in the tab order. Under
 * reduced motion it is a short fade.
 */
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";

export function Collapse({
  open,
  children,
  className,
  id,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Pass the id the trigger points to with aria-controls. */
  id?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          id={id}
          className="overflow-hidden"
          initial={reduced ? { opacity: 0 } : { height: 0 }}
          animate={
            reduced
              ? { opacity: 1, transition: REDUCED_FADE }
              : { height: "auto", transition: SPRING.smooth }
          }
          exit={
            reduced
              ? { opacity: 0, transition: REDUCED_FADE }
              : { height: 0, transition: { duration: 0.24, ease: EASE.standard } }
          }
        >
          <motion.div
            className={className}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { duration: 0.24, ease: EASE.out, delay: 0.06 },
            }}
            exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE.in } }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
