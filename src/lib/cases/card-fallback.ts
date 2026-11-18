/**
 * What a specialist's card on Konklusion shows when its own chart cannot be drawn: a short headline
 * instead of a clipped paragraph, and a chart
 * of what the specialist did find instead of an empty box.
 *
 * - `cardHeadline`: Brain's short point (`headline`), else the summary's first sentence
 *   or its first clause when that is short, never a paragraph clipped mid-word with "…".
 * - `findingCertainty`: the specialist's findings by how sure they are (bekræftet, sandsynligt,
 *   selskabets egne ord), for a card without criteria.
 * - `roundsTimeline`: the financing rounds as bars in one currency. Only rates that are fixed by
 *   law are used (the Danish krone's ERM II central rate to the euro); a round in another
 *   currency is shown with its own amount and no bar, never converted at a guessed rate.
 */
import type { OwnershipCardData } from "@/lib/analysis/card-data";

/** About twelve words (prototype: "Teamet er stærkt og komplet"). */
export const HEADLINE_MAX_WORDS = 12;
const HEADLINE_MIN_WORDS = 4;

function words(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function firstSentence(value: string): string {
  const [sentence] = value
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9])/u)
    .filter(Boolean);
  return (sentence ?? value).trim();
}

/** "Veo has a credible product, and …" → "Veo has a credible product." */
function asSentence(value: string): string {
  const trimmed = value
    .trim()
    .replace(/[,;:–—-]+$/u, "")
    .trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The card's headline: Brain's own short point when the run has one (prompt v15+), else the
 * summary's first sentence when it is short, else its first clause. A long sentence without a
 * short clause is cut at the last word that fits and marked "…", so the card never shows four
 * lines of a paragraph; the whole text is on the tab.
 */
export function cardHeadline(headline: string | null | undefined, summary: string): string | null {
  const own = headline?.trim();
  if (own) {
    // Brain's own point stays whole; a long one gives its first short clause when it has one.
    if (words(own).length <= HEADLINE_MAX_WORDS) return own;
    const first = own.split(/(?<=[,;:])\s+|\s+[–—]\s+/u)[0] ?? "";
    const count = words(first).length;
    return count >= HEADLINE_MIN_WORDS && count <= HEADLINE_MAX_WORDS ? asSentence(first) : own;
  }
  const text = summary.trim();
  if (!text) return null;
  const sentence = firstSentence(text);
  if (words(sentence).length <= HEADLINE_MAX_WORDS) return sentence;
  const clauses = sentence.split(/(?<=[,;:])\s+|\s+[–—]\s+/u);
  const first = clauses[0] ?? "";
  const count = words(first).length;
  if (count >= HEADLINE_MIN_WORDS && count <= HEADLINE_MAX_WORDS) return asSentence(first);
  const cut = words(sentence).slice(0, HEADLINE_MAX_WORDS - 2);
  return `${cut.join(" ").replace(/[,;:–—-]+$/u, "")} …`;
}

/** Fixed by law, not market rates: units of the key per one unit of the value's currency. */
const FIXED_RATES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // ERM II central rate, 7.46038 DKK per EUR (Danmarks Nationalbank).
  DKK: { EUR: 7.46038 },
  EUR: { DKK: 1 / 7.46038 },
};

export function normalCurrency(value: string | null): string | null {
  const code =
    value
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "") ?? "";
  if (code === "KR" || code === "DKR") return "DKK";
  return code.length === 3 ? code : null;
}

export interface RoundBar {
  name: string;
  /** "2021-01-06" or "2019"; null when the sources gave none. */
  date: string | null;
  year: number | null;
  amount: number;
  currency: string;
  /** The amount in the timeline's currency; null when it cannot be converted. */
  converted: number | null;
  /** The fixed rate used (1 unit of `currency` = rate units of the timeline's currency). */
  rate: number | null;
}

export interface RoundsTimeline {
  currency: string;
  bars: RoundBar[];
  /** The largest converted amount (the bars' scale). */
  max: number;
}

/**
 * The rounds with an amount, oldest first, in the currency most of them are stated in (a tie:
 * the latest round's). Null when fewer than two rounds have an amount: one bar is not a timeline.
 */
export function roundsTimeline(rounds: OwnershipCardData["rounds"]): RoundsTimeline | null {
  const priced = rounds
    .map((round) => ({ round, currency: normalCurrency(round.currency) }))
    .filter(
      (item): item is { round: (typeof rounds)[number]; currency: string } =>
        item.round.amount !== null && item.round.amount > 0 && item.currency !== null,
    )
    .map(({ round, currency }) => {
      const year = round.date ? Number(/^(\d{4})/.exec(round.date)?.[1] ?? NaN) : NaN;
      return {
        name: round.name,
        date: round.date,
        year: Number.isFinite(year) ? year : null,
        amount: round.amount!,
        currency,
      };
    });
  if (priced.length < 2) return null;
  // Oldest first; a round without a date keeps its place after the dated ones.
  const ordered = priced
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) => (a.item.date ?? "9999").localeCompare(b.item.date ?? "9999") || a.index - b.index,
    )
    .map(({ item }) => item);
  const tally = new Map<string, number>();
  for (const item of ordered) tally.set(item.currency, (tally.get(item.currency) ?? 0) + 1);
  const top = Math.max(...tally.values());
  const currency = [...ordered]
    .reverse()
    .find((item) => tally.get(item.currency) === top)!.currency;
  const bars: RoundBar[] = ordered.map((item) => {
    const rate = item.currency === currency ? 1 : (FIXED_RATES[currency]?.[item.currency] ?? null);
    return { ...item, rate, converted: rate === null ? null : item.amount * rate };
  });
  const converted = bars.filter((bar) => bar.converted !== null);
  if (converted.length < 2) return null;
  return { currency, bars, max: Math.max(...converted.map((bar) => bar.converted!)) };
}

/** Two short sentences fit the top of Konklusion (prototype: 2 sentences, about 25 words). */
const CONCLUSION_LEAD_MAX = 240;

/**
 * The conclusion's top: the first two sentences when they are short, else the first one;
 * the rest folds out under "Læs mere". `rest` is null when nothing is left.
 */
export function splitConclusion(value: string): { lead: string; rest: string | null } {
  const sentences = value
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9])/u)
    .filter(Boolean);
  if (sentences.length === 0) return { lead: value.trim(), rest: null };
  const two = sentences.slice(0, 2).join(" ");
  const count = sentences.length > 1 && two.length <= CONCLUSION_LEAD_MAX ? 2 : 1;
  const rest = sentences.slice(count).join(" ").trim();
  return { lead: sentences.slice(0, count).join(" "), rest: rest || null };
}

/** A figure the specialist found (`highlights`), as the card draws it. */
export interface HighlightFigure {
  label: string;
  value: number;
  unit: string;
  period: string | null;
}

/**
 * Which chart fits a specialist's figures ("en graf, der passer til tallene"). Only
 * figures in the same unit are drawn on one scale; a figure in another unit never shares a bar
 * with them, it is a chip beside the chart.
 *
 * - `columns`: two or more figures in one unit for different years or months: a time line.
 * - `bars`: two or more figures in one unit without a shared time: horizontal bars, largest first.
 * - `tiles`: no two figures share a unit: each figure on its own, nothing compared.
 *
 * A figure that is a calendar year ("AMLR applies from 2027 year") is a date, not an amount: it is
 * never a bar or a column (two full bars for 2027 and 2028 compared nothing).
 */
export type HighlightsPlan =
  | {
      kind: "columns";
      unit: string;
      scale: number;
      figures: HighlightFigure[];
      rest: HighlightFigure[];
    }
  | {
      kind: "bars";
      unit: string;
      scale: number;
      figures: HighlightFigure[];
      rest: HighlightFigure[];
    }
  | { kind: "tiles"; figures: HighlightFigure[] };

function unitKey(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "2021" or "2021-06" sorts as text; anything else is not a period we can place. */
function periodKey(period: string | null): string | null {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(period?.trim() ?? "");
  return match ? `${match[1]}-${match[2] ?? "00"}` : null;
}

/** A year as the value itself (unit "year", "år" or none), not a number of years. */
function isCalendarYear(figure: HighlightFigure): boolean {
  return (
    Number.isInteger(figure.value) &&
    figure.value >= 1900 &&
    figure.value <= 2100 &&
    /^(|year|yr|år|årstal)$/.test(unitKey(figure.unit))
  );
}

export function highlightsPlan(items: readonly HighlightFigure[]): HighlightsPlan | null {
  const figures = items.filter((item) => Number.isFinite(item.value));
  if (figures.length === 0) return null;
  const groups = new Map<string, HighlightFigure[]>();
  for (const figure of figures) {
    if (isCalendarYear(figure)) continue;
    const key = unitKey(figure.unit);
    groups.set(key, [...(groups.get(key) ?? []), figure]);
  }
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
  const top = ranked[0];
  if (!top || top.length < 2) return { kind: "tiles", figures };
  const rest = figures.filter((figure) => !top.includes(figure));
  const unit = top[0]!.unit.trim();
  const periods = new Set(top.map((figure) => periodKey(figure.period)));
  // One metric over time: the same label in every figure; different metrics are never a time line.
  const sameMetric = new Set(top.map((figure) => figure.label.trim().toLowerCase())).size === 1;
  const timed =
    sameMetric &&
    top.every((figure) => periodKey(figure.period) !== null) &&
    periods.size === top.length;
  const isPercent = unit === "%";
  const largest = Math.max(...top.map((figure) => Math.abs(figure.value)));
  const scale = isPercent && largest <= 100 ? 100 : largest;
  if (timed) {
    const ordered = [...top].sort((a, b) =>
      periodKey(a.period)!.localeCompare(periodKey(b.period)!),
    );
    return { kind: "columns", unit, scale, figures: ordered, rest };
  }
  const ordered = [...top].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { kind: "bars", unit, scale, figures: ordered, rest };
}
