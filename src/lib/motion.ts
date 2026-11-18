/**
 * Interlect motion tokens: exactly (wins over the prototypes' CSS values). The durations and curves
 * are also CSS variables in
 * src/styles.css (--dur-*, --ease-*), so CSS and motion animations move alike.
 *
 * Rules (§5): interactive things use springs, curves only for fades and
 * draw-ins; distances 4–16 px, scale .94–1, never bounce over 4 %; reduced motion turns
 * everything into short fades. `MotionConfig reducedMotion="user"` sits in the root.
 */
import { useEffect, useState } from "react";
import type { Transition, Variants } from "motion/react";

// ---------------------------------------------------------------------------
// Durations (ms) — the same numbers as --dur-* in styles.css.
// ---------------------------------------------------------------------------
export const DURATION_MS = {
  /** Press feedback (scale down). */
  instant: 90,
  /** Hover, colour, opacity on small things. */
  quick: 160,
  /** Fades, tooltips, chips. */
  base: 240,
  /** Fold-out, tabs, drawers (the curve variant). */
  slide: 380,
  /** Charts drawing in. */
  draw: 800,
  /** Page change. */
  page: 460,
} as const;

export type DurationToken = keyof typeof DURATION_MS;

/** The same durations in seconds, as motion expects them. */
export const DURATION = {
  instant: DURATION_MS.instant / 1000,
  quick: DURATION_MS.quick / 1000,
  base: DURATION_MS.base / 1000,
  slide: DURATION_MS.slide / 1000,
  draw: DURATION_MS.draw / 1000,
  page: DURATION_MS.page / 1000,
} as const satisfies Record<DurationToken, number>;

// ---------------------------------------------------------------------------
// Curves — the same values as --ease-* in styles.css.
// ---------------------------------------------------------------------------
type CubicBezier = readonly [number, number, number, number];

export const EASE = {
  /** Enter animations and draw-ins. */
  out: [0.16, 1, 0.3, 1],
  /** Fold-out and drawers (Apple sheet curve). */
  standard: [0.32, 0.72, 0, 1],
  /** Exit animations (short, 120–180 ms). */
  in: [0.4, 0, 1, 1],
} as const satisfies Record<string, CubicBezier>;

// ---------------------------------------------------------------------------
// Springs — settle without visible overshoot; menus and toggles may overshoot 1–2 %.
// ---------------------------------------------------------------------------
export const SPRING = {
  /** Toggles, segment marker, checkbox. */
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
  /** Menus, popovers, card → page (layout). */
  smooth: { type: "spring", stiffness: 300, damping: 34 },
  /** Drawers, large panels, Brain graph zoom. */
  gentle: { type: "spring", stiffness: 170, damping: 26 },
  /** Button press (scale .97 → 1). */
  press: { type: "spring", stiffness: 700, damping: 30 },
} as const satisfies Record<string, Transition>;

export type SpringToken = keyof typeof SPRING;

/** Everything becomes a short fade under reduced motion. */
export const REDUCED_FADE: Transition = { duration: 0.12, ease: "linear" };

/** Press feedback for buttons: `whileTap={PRESS.whileTap}` with the press spring. */
export const PRESS = {
  whileTap: { scale: 0.97 },
  transition: SPRING.press,
} as const;

/** Exit: 140 ms ease-in without stagger (menus, popovers). */
export const exitTransition: Transition = { duration: 0.14, ease: EASE.in };

/**
 * Page-load choreography: headline at 0 ms (y 12 → 0, 520 ms ease-out),
 * first row of cards +60 ms with 50 ms stagger, charts +200 ms after their card,
 * secondary content +120 ms as one fade. Everything done within ~900 ms.
 */
export const PAGE_LOAD = {
  headline: { y: 12, duration: 0.52, delay: 0 },
  cards: { delay: 0.06, stagger: 0.05 },
  charts: { delayAfterCard: 0.2 },
  secondary: { delay: 0.12 },
} as const;

// ---------------------------------------------------------------------------
// Legacy exports, still imported by existing components (KeyFindings, GateChecklist,
// Financial*). They now point at the tokens above.
// ---------------------------------------------------------------------------

/** @deprecated Use DURATION / SPRING. Seconds; the same values as the legacy CSS aliases. */
export const MOTION = {
  micro: DURATION.quick,
  disclosure: DURATION.base,
  panel: DURATION.base,
  /** Numbers counting (NumberFlow): 600–900 ms ease-out. */
  number: 0.6,
  /** Text sliding in: per word and at most in total. */
  perWord: 0.018,
  textMax: 1.2,
  /** Staggered rows: per row and the maximum number of rows that are staggered. */
  staggerStep: 0.04,
  staggerMaxRows: 8,
} as const;

/** @deprecated Use EASE.out. */
export const EASE_ENTER = EASE.out;
/** @deprecated Use EASE.in. */
export const EASE_LEAVE = EASE.in;

export const enterTransition: Transition = { duration: MOTION.panel, ease: EASE_ENTER };

/**
 * Delay for row number `index` in a list shown for the first time. After the first rows
 * the rest arrive together, so long lists never feel slow.
 */
export function staggerDelay(index: number): number {
  return Math.min(index, MOTION.staggerMaxRows) * MOTION.staggerStep;
}

/** Variants for a row that lifts slightly and fades in. Use `custom={index}`. */
export const rowEnter: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...enterTransition, delay: staggerDelay(index) },
  }),
};

const FIRST_VIEW_PREFIX = "interlect-seen:";

function hasSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(`${FIRST_VIEW_PREFIX}${key}`) === "1";
  } catch {
    return true; // Without storage we do not animate again and again.
  }
}

function markSeen(key: string) {
  try {
    window.localStorage.setItem(`${FIRST_VIEW_PREFIX}${key}`, "1");
  } catch {
    /* private mode or blocked storage: nothing to remember */
  }
}

/**
 * Is this the first time this user sees `key` (e.g. an analysis id)? The product owner:
 * AI text only writes itself in the first time. Decided in the first render (no flash of
 * finished text), reset when the key changes, and marked as seen afterwards.
 * Returns false on the server.
 */
export function useFirstView(key: string | null | undefined): boolean {
  const decide = (candidate: string | null | undefined) =>
    typeof window !== "undefined" && Boolean(candidate) && !hasSeen(candidate as string);
  const [state, setState] = useState(() => ({ key, first: decide(key) }));
  let current = state;
  if (state.key !== key) {
    current = { key, first: decide(key) };
    setState(current);
  }
  useEffect(() => {
    if (key && current.first) markSeen(key);
  }, [key, current.first]);
  return current.first;
}
