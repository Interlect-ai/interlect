/**
 * Mobile top bar (no prototype; the same menu as desktop): the logo and a round menu button
 * that opens the menu as a drawer from the left with the gentle spring, over the scrim.
 * Closes on a choice, on navigation, on Esc and on a click outside (Radix Dialog).
 * The drawer's content is passed in, so the visual harness can draw it without data.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Menu as MenuIcon, X } from "lucide-react";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { useT } from "@/lib/i18n/useT";
import { DURATION, EASE, REDUCED_FADE, SPRING, exitTransition } from "@/lib/motion";

/** Mobile top bar: logo and a menu button that opens the menu as a drawer from the left. */
export function MobileTopBar({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const reduced = useReducedMotion();
  const t = useT();

  // Close on navigation (also for links inside page content while the drawer is open).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close when the window grows to desktop: the drawer is hidden there, and an open modal
  // would keep the page locked (pointer events, scroll, aria-hidden).
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    onChange();
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 bg-canvas px-4 md:hidden print:hidden">
        <Link to="/" aria-label={t("shell.rail.homeLink")} className="flex items-center gap-[3px]">
          <InterlectMark size={20} />
          <span className="text-[16px] leading-none font-semibold tracking-[-0.02em]">
            Interlect
          </span>
        </Link>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            className="ml-auto grid size-9 place-items-center rounded-full bg-surface text-ink-2 shadow-pill transition-transform active:scale-[0.96]"
            aria-label={t("shell.mobile.openMenu")}
          >
            <MenuIcon className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </DialogPrimitive.Trigger>
      </header>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-[var(--scrim)] md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
                exit={{ opacity: 0, transition: exitTransition }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content forceMount asChild aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-2 left-2 z-50 flex w-[min(300px,86vw)] flex-col rounded-xl bg-canvas pt-3.5 pr-2.5 pb-2.5 pl-3 shadow-overlay outline-none md:hidden"
                initial={reduced ? { opacity: 0 } : { x: "-104%" }}
                animate={
                  reduced
                    ? { opacity: 1, transition: REDUCED_FADE }
                    : { x: 0, transition: SPRING.gentle }
                }
                exit={
                  reduced
                    ? { opacity: 0, transition: REDUCED_FADE }
                    : { x: "-104%", transition: { duration: 0.22, ease: EASE.in } }
                }
              >
                <DialogPrimitive.Title className="sr-only">
                  {t("shell.mobile.menu")}
                </DialogPrimitive.Title>
                <DialogPrimitive.Close asChild>
                  <button
                    type="button"
                    className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink-1"
                    aria-label={t("shell.mobile.closeMenu")}
                  >
                    <X className="size-4" strokeWidth={1.75} aria-hidden />
                  </button>
                </DialogPrimitive.Close>
                {children(() => setOpen(false))}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
