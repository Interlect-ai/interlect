/**
 * Dates for Overblik. "I dag", the weeks and the greeting are Danish: everything is read in
 * Europe/Copenhagen, never in UTC (a case created at 23:30 UTC on Saturday is Sunday's case in
 * Denmark). Pure, so the rules are tested without a browser or a database.
 */
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

export const OVERVIEW_TIME_ZONE = "Europe/Copenhagen";

export type OverviewPeriod = "4w" | "12w" | "52w";

/** `labelKey` is the period's name in the dictionary ("4 uger", "Kvartal", "År"). */
export const PERIODS: ReadonlyArray<{ key: OverviewPeriod; labelKey: MessageKey; weeks: number }> =
  [
    { key: "4w", labelKey: "overview.periods.fourWeeks", weeks: 4 },
    { key: "12w", labelKey: "overview.periods.quarter", weeks: 12 },
    { key: "52w", labelKey: "overview.periods.year", weeks: 52 },
  ];

export const DEFAULT_PERIOD: OverviewPeriod = "4w";

export function parsePeriod(value: unknown): OverviewPeriod {
  return value === "12w" || value === "52w" || value === "4w" ? value : DEFAULT_PERIOD;
}

export function periodWeeks(period: OverviewPeriod): number {
  return PERIODS.find((entry) => entry.key === period)?.weeks ?? 4;
}

/** "seneste 4 uger" (the Pipeline card's label). */
export function periodLabel(period: OverviewPeriod, language: Language = DEFAULT_LANGUAGE): string {
  return translate(
    language,
    period === "4w"
      ? "overview.periods.lastFourWeeks"
      : period === "12w"
        ? "overview.periods.lastQuarter"
        : "overview.periods.lastYear",
  );
}

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: OVERVIEW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: OVERVIEW_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/** The calendar date ("2026-10-01") a moment falls on in Denmark. */
export function copenhagenDate(moment: Date | string): string {
  return dayFormat.format(typeof moment === "string" ? new Date(moment) : moment);
}

/** The hour (0-23) in Denmark. */
export function copenhagenHour(moment: Date): number {
  return Number(hourFormat.format(moment));
}

/** Whole days since 1970-01-01 for a "YYYY-MM-DD" string (calendar arithmetic, no DST). */
function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.round(Date.UTC(year!, (month ?? 1) - 1, day ?? 1) / 86_400_000);
}

/**
 * Calendar days between a moment and `now` in Denmark: 0 = today, 1 = yesterday. A moment in
 * the future is 0 (clock skew must not make a bar negative).
 */
export function daysAgo(moment: Date | string, now: Date): number {
  return Math.max(0, dayNumber(copenhagenDate(now)) - dayNumber(copenhagenDate(moment)));
}

/** True when the moment is inside the period: the last `weeks * 7` calendar days incl. today. */
export function inPeriod(moment: Date | string, period: OverviewPeriod, now: Date): boolean {
  return daysAgo(moment, now) < periodWeeks(period) * 7;
}

/** A calendar date `days` earlier ("2026-10-01", 1 → "2026-09-30"); calendar maths, no DST. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

/** Greeting by the hour ("Hilsen efter tidspunkt"). */
export function greetingFor(hour: number, language: Language = DEFAULT_LANGUAGE): string {
  const key: MessageKey =
    hour >= 5 && hour < 10
      ? "overview.greeting.morning"
      : hour >= 10 && hour < 12
        ? "overview.greeting.lateMorning"
        : hour >= 12 && hour < 18
          ? "overview.greeting.afternoon"
          : hour >= 18 && hour < 23
            ? "overview.greeting.evening"
            : "overview.greeting.hello";
  return translate(language, key);
}

export function greetingLine(
  now: Date,
  firstName: string | null,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const greeting = greetingFor(copenhagenHour(now), language);
  return firstName
    ? translate(language, "overview.greeting.withName", { greeting, name: firstName })
    : greeting;
}

/** "YYYY-MM-DD" of a due date → days from today (negative = overdue). */
export function daysUntil(dueOn: string, now: Date): number {
  return dayNumber(dueOn.slice(0, 10)) - dayNumber(copenhagenDate(now));
}

const dueFormats = new Map<Language, Intl.DateTimeFormat>();
function dueFormat(language: Language): Intl.DateTimeFormat {
  let format = dueFormats.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    dueFormats.set(language, format);
  }
  return format;
}

/**
 * The due date as a line under a task: "Frist i dag", "Frist i morgen", "Frist tor. 2. okt.",
 * "Overskredet med 3 dage". Overdue is the only one that needs to stand out.
 */
export function dueText(
  dueOn: string,
  now: Date,
  language: Language = DEFAULT_LANGUAGE,
): { text: string; overdue: boolean } {
  const days = daysUntil(dueOn, now);
  if (days < 0) {
    const late = -days;
    return {
      text: translate(
        language,
        late === 1 ? "overview.due.overdueOne" : "overview.due.overdueMany",
        {
          count: late,
        },
      ),
      overdue: true,
    };
  }
  if (days === 0) return { text: translate(language, "overview.due.today"), overdue: false };
  if (days === 1) return { text: translate(language, "overview.due.tomorrow"), overdue: false };
  const date = new Date(`${dueOn.slice(0, 10)}T12:00:00Z`);
  return {
    text: translate(language, "overview.due.on", { date: dueFormat(language).format(date) }),
    overdue: false,
  };
}
