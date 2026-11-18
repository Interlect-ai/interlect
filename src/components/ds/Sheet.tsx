/**
 * Sheet ("Dybde: ark eller side"): a detail that opens from the right edge over the page,
 * for a lookup that does not deserve its own page ("Brain om denne case"). A 12 px inset card of
 * radius 24, up to 440 px wide and full height; it slides in 24 px with the smooth spring while the
 * scrim fades 240 ms (a plain fade under reduced motion). Radix handles focus, Esc and the outside
 * click, and everything renders in a portal, like `Dialog`.
 */
import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { IconButton } from "@/components/ds/Button";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING, exitTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  onCloseAutoFocus,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Pinned under the scrolling content. */
  footer?: ReactNode;
  /** Radix returns focus to the opener on close; call `preventDefault` to place it elsewhere. */
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div
                className="fixed inset-0 z-[95] bg-[var(--scrim)] backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.24, ease: EASE.out } }}
                exit={{ opacity: 0, transition: exitTransition }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              forceMount
              asChild
              {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
              {...(description ? {} : { "aria-describedby": undefined })}
            >
              <motion.div
                className={cn(
                  "fixed inset-y-3 right-3 z-[96] flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] bg-surface text-ink-1 shadow-[0_32px_80px_-20px_rgba(23,21,28,.45)] outline-none",
                  className,
                )}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                animate={
                  reduced
                    ? { opacity: 1, transition: REDUCED_FADE }
                    : { opacity: 1, x: 0, transition: SPRING.smooth }
                }
                exit={{ opacity: 0, transition: reduced ? REDUCED_FADE : exitTransition }}
              >
                <header className="flex shrink-0 items-start gap-3 py-[18px] pr-3.5 pl-[22px]">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[1.3]">
                    <DialogPrimitive.Title className="m-0 text-[20px] font-semibold tracking-[-0.015em]">
                      {title}
                    </DialogPrimitive.Title>
                    {description && (
                      <DialogPrimitive.Description className="m-0 text-list text-ink-3">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </span>
                  <DialogPrimitive.Close asChild>
                    <IconButton
                      icon={X}
                      size={32}
                      aria-label={t("common.close")}
                      className="bg-transparent text-ink-3 shadow-none hover:bg-hover"
                    />
                  </DialogPrimitive.Close>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[22px] pb-5">
                  {children}
                </div>
                {footer && (
                  <div className="shrink-0 border-t border-line px-[22px] py-3.5">{footer}</div>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
