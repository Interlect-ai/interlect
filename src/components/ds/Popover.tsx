/**
 * Popover: a free-form floating surface with the same look and motion as the compact menu
 * (surface, radius 14, the menu shadow; in with the smooth spring from y −6, scale .97 and a
 * 4 px blur; out 140 ms ease-in). Radix handles focus, Esc, outside clicks and collision, so
 * it never overlaps the viewport edge. Use `Menu` for lists of actions and this for content
 * (a filter builder, an explanation, a small form).
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { REDUCED_FADE, SPRING, exitTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

const OpenContext = createContext(false);

export function Popover({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  return (
    <OpenContext.Provider value={open}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        {children}
      </PopoverPrimitive.Root>
    </OpenContext.Provider>
  );
}

export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  children,
  className,
  align = "start",
  side = "bottom",
  sideOffset = 6,
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}) {
  const open = useContext(OpenContext);
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <PopoverPrimitive.Portal forceMount>
          <PopoverPrimitive.Content
            forceMount
            asChild
            align={align}
            side={side}
            sideOffset={sideOffset}
            collisionPadding={12}
          >
            <motion.div
              className={cn(
                "z-[110] max-h-[min(var(--radix-popover-content-available-height),calc(100vh-40px))] overflow-auto rounded-md bg-surface p-4 text-ink-1 shadow-[var(--shadow-menu)] outline-none",
                "origin-[var(--radix-popover-content-transform-origin)]",
                className,
              )}
              initial={
                reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97, filter: "blur(4px)" }
              }
              animate={
                reduced
                  ? { opacity: 1, transition: REDUCED_FADE }
                  : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: SPRING.smooth }
              }
              exit={{ opacity: 0, transition: reduced ? REDUCED_FADE : exitTransition }}
            >
              {children}
            </motion.div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}
