/**
 * Pipeline funnel and weekly intake (Overblik v2). Pure.
 *
 * The funnel measures a COHORT: the cases created in the period, and how far each of them has
 * got ("har nået trinnet"), not which phase the cases are in now. A case that has reached a
 * step has reached every step before it, so a case moved straight to Komité counts as screened
 * and in Dyb analyse too (phases can be skipped), and the chain never goes up from one step to
 * the next. "Over tærsklen" is a condition, not a step: the case's latest screening scored at
 * least the threshold the screening was run with (the fund's active version, as in Cases).
 */
import { translate } from "../i18n/translate.ts";
import { daysAgo, inPeriod, periodWeeks, type OverviewPeriod } from "./dates.ts";

export type FunnelKey = "in" | "screened" | "over" | "deep" | "committee" | "invested";

const FUNNEL_KEYS: readonly FunnelKey[] = [
  "in",
  "screened",
  "over",
  "deep",
  "committee",
  "invested",
];

/** The steps with their Danish label (the page shows `overview.funnel.<key>` in the fund's language). */
export const FUNNEL_STEPS: ReadonlyArray<{ key: FunnelKey; label: string }> = FUNNEL_KEYS.map(
  (key) => ({ key, label: translate("da", `overview.funnel.${key}`) }),
);

export interface FunnelFacts {
  caseId: string;
  createdAt: string;
  /** A finished screening exists. */
  hasScreening: boolean;
  screeningScore: number | null;
  /** The case has had a deep analysis, is in Dyb analyse, or has been further. */
  reachedDeep: boolean;
  reachedCommittee: boolean;
  reachedInvested: boolean;
}

export interface FunnelStep {
  key: FunnelKey;
  label: string;
  count: number;
  /** Share of the cohort in whole percent; null for the first step and an empty cohort. */
  percent: number | null;
}

export interface FunnelResult {
  steps: FunnelStep[];
  cohort: number;
  /** Cases over the threshold that have not reached a deep analysis. Never negative. */
  overNotForwarded: number;
  /** The cohort's case ids (what "Cases bag tallet" lists). */
  cohortIds: string[];
}

/** What a case has reached, with the chain implied: invested ⇒ committee ⇒ deep ⇒ screened. */
export function reachedSteps(facts: FunnelFacts, threshold: number): Record<FunnelKey, boolean> {
  const invested = facts.reachedInvested;
  const committee = facts.reachedCommittee || invested;
  const deep = facts.reachedDeep || committee;
  const screened = facts.hasScreening || deep;
  return {
    in: true,
    screened,
    over: facts.screeningScore !== null && facts.screeningScore >= threshold,
    deep,
    committee,
    invested,
  };
}

export function funnelCounts(
  facts: readonly FunnelFacts[],
  threshold: number,
  period: OverviewPeriod,
  now: Date,
): FunnelResult {
  const cohort = facts.filter((entry) => inPeriod(entry.createdAt, period, now));
  const reached = cohort.map((entry) => reachedSteps(entry, threshold));
  const steps = FUNNEL_STEPS.map(({ key, label }, index): FunnelStep => {
    const count = reached.filter((entry) => entry[key]).length;
    return {
      key,
      label,
      count,
      percent:
        index === 0 || cohort.length === 0 ? null : Math.round((count / cohort.length) * 100),
    };
  });
  return {
    steps,
    cohort: cohort.length,
    overNotForwarded: reached.filter((entry) => entry.over && !entry.deep).length,
    cohortIds: cohort.map((entry) => entry.caseId),
  };
}

// ---------------------------------------------------------------------------------------------
// Transition log
// ---------------------------------------------------------------------------------------------

export interface TransitionEvent {
  id: string;
  caseId: string;
  field: string;
  toPhase: string | null;
  toStatus: string | null;
  occurredAt: string;
  /** Set on the row that undoes another row. */
  undoOf: string | null;
}

/**
 * The log rows that still stand: a row that was undone ("Fortryd") and the undo row itself are
 * both left out, so a case that was sent to Komité and brought back has not reached Komité.
 */
export function effectiveEvents(events: readonly TransitionEvent[]): TransitionEvent[] {
  const undone = new Set(events.map((event) => event.undoOf).filter((id): id is string => !!id));
  return events.filter((event) => event.undoOf === null && !undone.has(event.id));
}

export interface EventReach {
  deep: boolean;
  committee: boolean;
  invested: boolean;
  /** When the case last entered Komité (null if the log has no such row). */
  committeeSince: string | null;
}

export function reachFromEvents(events: readonly TransitionEvent[]): Map<string, EventReach> {
  const reach = new Map<string, EventReach>();
  for (const event of effectiveEvents(events)) {
    const entry = reach.get(event.caseId) ?? {
      deep: false,
      committee: false,
      invested: false,
      committeeSince: null,
    };
    if (event.field === "phase") {
      if (event.toPhase === "deep_analysis") entry.deep = true;
      if (event.toPhase === "committee") {
        entry.deep = true;
        entry.committee = true;
        if (!entry.committeeSince || event.occurredAt > entry.committeeSince) {
          entry.committeeSince = event.occurredAt;
        }
      }
    }
    if (event.field === "status" && event.toStatus === "invested") {
      entry.invested = true;
    }
    reach.set(event.caseId, entry);
  }
  return reach;
}

// ---------------------------------------------------------------------------------------------
// Tilgang: new cases per week
// ---------------------------------------------------------------------------------------------

export interface IntakeFacts {
  createdAt: string;
  /** Reached a deep analysis or further. */
  forwarded: boolean;
}

export interface IntakeBar {
  /** Calendar days back from today the bar starts and ends (inclusive). */
  fromDaysAgo: number;
  toDaysAgo: number;
  total: number;
  forwarded: number;
}

export interface IntakeResult {
  bars: IntakeBar[];
  /** Weeks one bar covers: 1, and 4 for the year (13 bars). */
  weeksPerBar: number;
  total: number;
  forwarded: number;
  /** "4 uger siden": where the first bar starts. */
  fromLabel: string;
}

/** Oldest bar first. A year is shown as 13 bars of four weeks, a quarter as 12 weeks. */
export function intakeBars(
  facts: readonly IntakeFacts[],
  period: OverviewPeriod,
  now: Date,
): IntakeResult {
  const weeks = periodWeeks(period);
  const weeksPerBar = period === "52w" ? 4 : 1;
  const count = weeks / weeksPerBar;
  const span = weeksPerBar * 7;
  const bars: IntakeBar[] = Array.from({ length: count }, (_, index) => {
    const newestFirst = count - 1 - index;
    return {
      fromDaysAgo: newestFirst * span,
      toDaysAgo: newestFirst * span + span - 1,
      total: 0,
      forwarded: 0,
    };
  });
  for (const entry of facts) {
    const age = daysAgo(entry.createdAt, now);
    if (age >= weeks * 7) continue;
    const bar = bars[count - 1 - Math.floor(age / span)];
    if (!bar) continue;
    bar.total += 1;
    if (entry.forwarded) bar.forwarded += 1;
  }
  return {
    bars,
    weeksPerBar,
    total: bars.reduce((sum, bar) => sum + bar.total, 0),
    forwarded: bars.reduce((sum, bar) => sum + bar.forwarded, 0),
    fromLabel: translate("da", "overview.charts.weeksAgo", { count: weeks }),
  };
}
