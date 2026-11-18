/**
 * Card → sub-page ("Dybde: ark eller side", Screening v5 fokus-side, Overblik v2 underside). The
 * page underneath fades out and settles to scale.97 while the sub-page
 * fades in over it; a sunken "back" pill with the parent's name sits at the top.
 *
 * Measured in Screening v5: content max 1120 px, padding 28/44/64, gap 28; back pill 34 px,
 * 10/14 px padding, 13/500; title 36/600 with display tracking and a 15 px ink-3 subtitle.
 * The prototype's CSS (opacity 240–380 ms, transform 560 ms ease-standard) becomes the
 * smooth spring. Pages may share `layoutId`s between a card and its sub-page ("Kort → underside"):
 * `FocusHost` wraps both in one LayoutGroup.
 *
 * A card marked `data-focus-card` that opens a sub-page is the sub-page's origin: the page
 * grows out of that card's rectangle (a clip-path on the smooth spring) and shrinks back into it
 * on the way out. Without a marked card, or under reduced motion, the page just fades.
 *
 * Esc goes back. Focus moves to the back pill when the sub-page opens and returns to the card
 * that opened it when the sub-page closes (Esc, the back pill or the browser's Back).
 */
import { type ReactNode, type MouseEvent, useLayoutEffect, useRef } from "react";
import { AnimatePresence, LayoutGroup, animate, motion, useReducedMotion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useBackPill } from "./useBackPill";

/** A card's rectangle as clip-path insets inside the host, in px. */
type Inset = { top: number; right: number; bottom: number; left: number };
type Origin = { at: number; open: Inset; close: Inset; radius: number };

const ORIGIN_MAX_AGE_MS = 1500;

/** The last marked card that was clicked, in viewport coordinates (for pages that open in place). */
let lastCard: { at: number; rect: DOMRect; radius: number } | null = null;

function scrollParent(element: HTMLElement): { scrollTop: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return document.scrollingElement ?? { scrollTop: 0 };
}

const NO_INSET = "inset(0px 0px 0px 0px round 0px)";

function insetCss({ top, right, bottom, left }: Inset, radius: number) {
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

/**
 * The card's rectangle inside the host. `open` is where the card sits once the work area has
 * scrolled to the top (the page opens there), `close` where it sits when Back restores the scroll.
 */
function measureOrigin(host: HTMLElement, card: HTMLElement): Origin {
  const hostRect = host.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const scrolled = scrollParent(host).scrollTop;
  const around = (top: number): Inset => {
    const clampedTop = Math.min(Math.max(0, top), hostRect.height);
    return {
      top: clampedTop,
      left: Math.max(0, cardRect.left - hostRect.left),
      right: Math.max(0, hostRect.right - cardRect.right),
      bottom: Math.max(0, hostRect.height - clampedTop - cardRect.height),
    };
  };
  return {
    at: Date.now(),
    radius: parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0,
    open: around(cardRect.top - hostRect.top - scrolled),
    close: around(cardRect.top - hostRect.top),
  };
}

export function FocusHost({
  focus,
  children,
  className,
}: {
  /** The open sub-page (a `<FocusPage>`), or null. */
  focus: ReactNode | null;
  /** The page underneath. */
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const open = focus !== null && focus !== undefined && focus !== false;
  const hostRef = useRef<HTMLDivElement>(null);
  const origin = useRef<Origin | null>(null);
  const rememberOrigin = (event: MouseEvent<HTMLDivElement>) => {
    const card =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-focus-card]")
        : null;
    origin.current = card && hostRef.current ? measureOrigin(hostRef.current, card) : null;
    lastCard = card
      ? {
          at: Date.now(),
          rect: card.getBoundingClientRect(),
          radius: parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0,
        }
      : null;
  };
  // The origin is taken when the page opens and kept until it has closed, so a re-render in
  // between never changes the animation; a page opened without a click (a link, Back/Forward)
  // has none.
  const shown = useRef<Origin | null>(null);
  if (!open) shown.current = null;
  else if (
    shown.current === null &&
    origin.current &&
    Date.now() - origin.current.at < ORIGIN_MAX_AGE_MS
  ) {
    shown.current = origin.current;
    origin.current = null;
  }
  const from = reduced ? null : shown.current;
  return (
    <LayoutGroup>
      <div
        ref={hostRef}
        onClickCapture={rememberOrigin}
        className={cn("relative min-h-full", className)}
      >
        <motion.div
          aria-hidden={open || undefined}
          inert={open || undefined}
          initial={false}
          animate={open ? { opacity: 0, scale: reduced ? 1 : 0.97 } : { opacity: 1, scale: 1 }}
          transition={reduced ? REDUCED_FADE : SPRING.smooth}
          style={{ transformOrigin: "50% 0%" }}
          className={cn(open && "pointer-events-none")}
        >
          {children}
        </motion.div>
        <AnimatePresence>
          {open && (
            <motion.div
              key="focus"
              className="absolute inset-0"
              initial={
                from ? { opacity: 0, clipPath: insetCss(from.open, from.radius) } : { opacity: 0 }
              }
              animate={{
                opacity: 1,
                // Once open the clip goes away: a sub-page taller than the page underneath must
                // not be cut off at the host's height.
                ...(from ? { clipPath: NO_INSET, transitionEnd: { clipPath: "none" } } : {}),
                transition: {
                  opacity: { duration: 0.24, ease: EASE.standard },
                  clipPath: SPRING.smooth,
                },
              }}
              exit={
                from
                  ? {
                      opacity: 0,
                      clipPath: [NO_INSET, insetCss(from.close, from.radius)],
                      transition: {
                        opacity: { duration: 0.24, ease: EASE.in },
                        clipPath: SPRING.smooth,
                      },
                    }
                  : { opacity: 0, transition: { duration: 0.18, ease: EASE.in } }
              }
            >
              {focus}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

export function FocusPage({
  backLabel,
  onBack,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  /** Name of the page underneath, e.g. the company ("Havbrug Nord"). */
  backLabel: string;
  onBack: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right side of the title row (e.g. a SegmentedControl for the chart type). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const backRef = useBackPill(onBack);

  return (
    <div className={cn("flex max-w-[1120px] flex-col gap-7 px-4 pt-7 pb-16 md:px-11", className)}>
      <motion.button
        ref={backRef}
        type="button"
        onClick={onBack}
        className="inline-flex h-[34px] items-center gap-2 self-start rounded-pill bg-sunken pr-3.5 pl-2.5 text-list font-medium whitespace-nowrap text-ink-2 outline-none transition-transform active:scale-[.97] focus-visible:ring-2 focus-visible:ring-action"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.4, ease: EASE.out }}
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
        {backLabel}
      </motion.button>
      <motion.div
        className="flex flex-wrap items-end gap-6"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay: 0.06 }}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="m-0 text-[30px] leading-[1.05] font-semibold tracking-display md:text-[36px]">
            {title}
          </h2>
          {subtitle && <span className="text-body text-ink-3">{subtitle}</span>}
        </div>
        {actions && (
          <>
            <div className="flex-1" />
            {actions}
          </>
        )}
      </motion.div>
      {children}
    </div>
  );
}

/**
 * A page that opens in place (the deep analysis's topic pages replace the tab's content, they are
 * not a FocusPage) grows out of the card that was clicked, the same way a FocusPage does.
 * Opening only: the page is swapped out again by the route, so there is nothing to shrink.
 */
export function GrowFromCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = ref.current;
    // Kept (not cleared) so a strict-mode re-run of this effect still finds the card; the age
    // limit and the next click end it.
    const card = lastCard;
    if (!element || !card || reduced || Date.now() - card.at > ORIGIN_MAX_AGE_MS) return;
    const box = element.getBoundingClientRect();
    const scrolled = scrollParent(element).scrollTop;
    const top = Math.min(Math.max(0, card.rect.top - box.top - scrolled), box.height);
    const from = insetCss(
      {
        top,
        left: Math.max(0, card.rect.left - box.left),
        right: Math.max(0, box.right - card.rect.right),
        bottom: Math.max(0, box.height - top - card.rect.height),
      },
      card.radius,
    );
    element.style.clipPath = from;
    const run = animate(element, { clipPath: [from, NO_INSET] }, SPRING.smooth);
    // Motion writes the final value after `finished` resolves, so the clip goes a frame later.
    let frame = 0;
    const clear = () => {
      frame = requestAnimationFrame(() => {
        run.cancel();
        element.style.clipPath = "none";
      });
    };
    run.finished.then(clear, clear);
    return () => {
      cancelAnimationFrame(frame);
      run.cancel();
      element.style.removeProperty("clip-path");
    };
  }, [reduced]);
  return <div ref={ref}>{children}</div>;
}
