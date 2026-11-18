/**
 * "Analyserne" with real data (Case Dyb analyse v5, lines 152–153 and 227–230): the topic cards a
 * standard specialist gets from the sourced card data its deep
 * analysis delivered, next to the cards built from its findings. The prototype's cards
 * say "Founders: 3 personer", "Værdiansættelse: 120 mio. kr. pre"; here every card is one data
 * set the specialist really sourced, with its own small chart:
 *
 * - Team → "Founders og ledelse": the people, each with the mean of the five team axes.
 * - Produkt og marked → "Markedets størrelse": the market size per year (forecasts marked).
 * - Teknologi → "Nøgletal mod branchen": the company's figure next to the industry's; a figure
 *   without the other side is a field of its own, never a bar measured against itself.
 * - Tese og deal → "Ejerskab" (the shares) and "Finansieringsrunder" (the rounds).
 *
 * A data set the sources did not have gives no card (the findings cards still stand), and
 * nothing is computed beyond what is drawn: means, the latest value, counts. Pure, so tested.
 */
import type {
  DeepCardData,
  MarketCardData,
  OwnershipCardData,
  TeamCardData,
  TechBenchmarksCardData,
} from "../analysis/card-data.ts";
import { TEAM_AXES, cardDataKindFor } from "../analysis/card-data-kinds.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";

/** One bar: `fraction` is 0–1 of the chart's height or width; `strong` is drawn in full colour. */
export interface DataBar {
  label: string;
  value: string;
  fraction: number;
  strong: boolean;
}

/** One figure on its own: nothing to compare it with, so it is a field, not a bar. */
export interface DataField {
  label: string;
  value: string;
}

export interface DataTopic {
  /** Also the URL key after "analyse-" (`[a-z_]`, never a score category's name). */
  key: string;
  label: string;
  /** The card's big line ("3 personer"). */
  headline: string;
  /** The sub-page's one sentence. */
  answer: string;
  /** The sub-page chart's title. */
  chartTitle: string;
  bars: DataBar[];
  /** Figures drawn as fields beside (or instead of) the bars; only Teknologi has them. */
  fields: DataField[];
  /** Under the chart: what the bars are (never how many sources they rest on). */
  note: string;
  /** "Det fandt vi": one line per person, year, figure, holder or round. */
  found: string[];
}

/** The data topics' keys; a finding category never starts with "data_". */
export const DATA_TOPIC_PREFIX = "data_";

type Text = (key: MessageKey, vars?: TranslateVars) => string;

function number(value: number, language: Language, digits = 1): string {
  return new Intl.NumberFormat(LANGUAGE_TAGS[language], { maximumFractionDigits: digits }).format(
    value,
  );
}

/** A whole-unit amount the way the cards say it: "40 mio. DKK", "1,2 mia. EUR", "850.000 DKK". */
export function amountText(amount: number, currency: string | null, language: Language): string {
  const text: Text = (key, vars) => translate(language, key, vars);
  const abs = Math.abs(amount);
  const figure =
    abs >= 1e9
      ? `${number(amount / 1e9, language)} ${text("deep.cards.unit.billion")}`
      : abs >= 1e6
        ? `${number(amount / 1e6, language)} ${text("deep.cards.unit.million")}`
        : number(amount, language, 0);
  return currency ? `${figure} ${currency}` : figure;
}

function fraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

function teamTopic(data: TeamCardData, text: Text, language: Language): DataTopic {
  const people = data.people.map((person) => {
    const scores = TEAM_AXES.map((axis) => person.scores[axis]).filter(
      (value): value is number => value !== null,
    );
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const best = TEAM_AXES.filter((axis) => person.scores[axis] !== null).sort(
      (a, b) => person.scores[b]! - person.scores[a]!,
    )[0]!;
    return { person, mean, best };
  });
  const top = Math.max(...people.map((entry) => entry.mean));
  const strongest = people.findIndex((entry) => entry.mean === top);
  const count = people.length;
  return {
    key: `${DATA_TOPIC_PREFIX}team`,
    label: text("deep.data.team.label"),
    headline: text(count === 1 ? "deep.data.team.headlineOne" : "deep.data.team.headlineMany", {
      count,
    }),
    answer: text(count === 1 ? "deep.data.team.answerOne" : "deep.data.team.answerMany", {
      count,
      name: people[strongest]!.person.name,
    }),
    chartTitle: text("deep.data.team.chart"),
    bars: people.map((entry, index) => ({
      label: entry.person.name,
      value: `${number(entry.mean, language)}/10`,
      fraction: fraction(entry.mean, 10),
      strong: index === strongest,
    })),
    fields: [],
    note: text("deep.data.team.note"),
    found: people.map(({ person, best }) =>
      text(person.role ? "deep.data.team.found" : "deep.data.team.foundNoRole", {
        name: person.name,
        role: person.role,
        axis: text(`deep.cards.teamAxis.${best}`),
        score: number(person.scores[best]!, language),
      }),
    ),
  };
}

function marketTopic(data: MarketCardData, text: Text, language: Language): DataTopic {
  const points = [...data.points].sort((a, b) => a.year - b.year);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const max = Math.max(...points.map((point) => point.value));
  const amount = (value: number) =>
    `${number(value, language)} ${text(`deep.cards.unit.${data.unit}`)} ${data.currency}`.trim();
  const year = (point: (typeof points)[number]) =>
    point.basis === "forecast"
      ? text("deep.data.market.forecastYear", { year: point.year })
      : String(point.year);
  const what = [data.label, data.geography].filter((part) => part.trim() !== "").join(", ");
  return {
    key: `${DATA_TOPIC_PREFIX}market`,
    label: text("deep.data.market.label"),
    headline: text("deep.data.market.headline", { amount: amount(last.value), year: year(last) }),
    answer: text("deep.data.market.answer", {
      what: what || text("deep.data.market.label"),
      from: amount(first.value),
      fromYear: year(first),
      to: amount(last.value),
      toYear: year(last),
    }),
    chartTitle: data.label.trim() || text("deep.data.market.label"),
    bars: points.map((point, index) => ({
      label: year(point),
      value: amount(point.value),
      fraction: fraction(point.value, max),
      strong: index === points.length - 1,
    })),
    fields: [],
    note: text("deep.data.market.note"),
    found: points.map((point) =>
      text("deep.data.market.found", { year: year(point), amount: amount(point.value) }),
    ),
  };
}

/** Units the specialist writes out ("percent", "count") as the cards say them: "%" or nothing. */
const PERCENT_UNITS = new Set(["%", "percent", "per cent", "pct", "pct.", "procent"]);
const COUNT_UNITS = new Set(["count", "counts", "number", "antal", "stk", "stk.", "pcs", "#"]);

/** A key figure with its unit: "80 %", "250", "120 ms" (never "80 percent" or "250 count"). */
export function techValueText(value: number, unit: string, language: Language): string {
  const figure = number(value, language);
  const key = unit.trim().toLowerCase();
  if (PERCENT_UNITS.has(key)) return `${figure} %`;
  if (key === "" || COUNT_UNITS.has(key)) return figure;
  return `${figure} ${unit.trim()}`;
}

function techTopic(data: TechBenchmarksCardData, text: Text, language: Language): DataTopic {
  const value = (figure: number, unit: string) => techValueText(figure, unit, language);
  const bars: DataBar[] = [];
  const fields: DataField[] = [];
  const found: string[] = [];
  let compared = 0;
  let better = 0;
  for (const item of data.items) {
    if (item.company !== null && item.industry !== null) {
      // Only a pair is drawn as bars: two figures in one unit, measured against the larger.
      const max = Math.max(item.company, item.industry);
      bars.push(
        {
          label: text("deep.data.tech.company", { metric: item.metric }),
          value: value(item.company, item.unit),
          fraction: fraction(item.company, max),
          strong: true,
        },
        {
          label: text("deep.data.tech.industry", { metric: item.metric }),
          value: value(item.industry, item.unit),
          fraction: fraction(item.industry, max),
          strong: false,
        },
      );
      compared += 1;
      if (item.higherIsBetter ? item.company > item.industry : item.company < item.industry) {
        better += 1;
      }
      found.push(
        text("deep.data.tech.found", {
          metric: item.metric,
          company: value(item.company, item.unit),
          industry: value(item.industry, item.unit),
        }),
      );
    } else if (item.company !== null) {
      fields.push({ label: item.metric, value: value(item.company, item.unit) });
      found.push(
        text("deep.data.tech.foundCompany", {
          metric: item.metric,
          company: value(item.company, item.unit),
        }),
      );
    } else if (item.industry !== null) {
      fields.push({
        label: text("deep.data.tech.industry", { metric: item.metric }),
        value: value(item.industry, item.unit),
      });
      found.push(
        text("deep.data.tech.foundIndustry", {
          metric: item.metric,
          industry: value(item.industry, item.unit),
        }),
      );
    }
  }
  const count = data.items.length;
  const companyOnly = compared === 0 && data.items.every((item) => item.company !== null);
  return {
    key: `${DATA_TOPIC_PREFIX}tech`,
    label: text("deep.data.tech.label"),
    headline: text(count === 1 ? "deep.data.tech.headlineOne" : "deep.data.tech.headlineMany", {
      count,
    }),
    answer:
      compared > 0
        ? text("deep.data.tech.answer", { better, total: compared })
        : text(companyOnly ? "deep.data.tech.answerCompanyOnly" : "deep.data.tech.answerNoPair"),
    chartTitle: text(
      compared > 0
        ? "deep.data.tech.chart"
        : companyOnly
          ? "deep.data.tech.chartCompany"
          : "deep.data.tech.chartFound",
    ),
    bars,
    fields,
    note: text(
      compared === 0
        ? "deep.data.tech.noteNoPair"
        : fields.length > 0
          ? "deep.data.tech.noteMixed"
          : "deep.data.tech.note",
    ),
    found,
  };
}

function ownershipTopics(data: OwnershipCardData, text: Text, language: Language): DataTopic[] {
  const topics: DataTopic[] = [];
  if (data.holders.length > 0) {
    const holders = [...data.holders].sort((a, b) => b.percent - a.percent);
    const top = holders[0]!;
    const max = top.percent;
    const percent = (value: number) => `${number(value, language)} %`;
    const count = holders.length;
    topics.push({
      key: `${DATA_TOPIC_PREFIX}ownership`,
      label: text("deep.data.ownership.label"),
      headline: text(
        count === 1 ? "deep.data.ownership.headlineOne" : "deep.data.ownership.headlineMany",
        { count },
      ),
      answer: text(top.asOf ? "deep.data.ownership.answerAsOf" : "deep.data.ownership.answer", {
        holder: top.holder,
        percent: percent(top.percent),
        asOf: top.asOf ?? "",
      }),
      chartTitle: text("deep.data.ownership.chart"),
      bars: holders.map((holder, index) => ({
        label: holder.holder,
        value: percent(holder.percent),
        fraction: fraction(holder.percent, max),
        strong: index === 0,
      })),
      fields: [],
      note: text("deep.data.ownership.note"),
      found: holders.map((holder) =>
        text("deep.data.ownership.found", {
          holder: holder.holder,
          type: text(`deep.data.holderType.${holder.holderType}`),
          percent: percent(holder.percent),
        }),
      ),
    });
  }
  if (data.rounds.length > 0) {
    // Dated rounds oldest to newest, so the newest is last; rounds without a date go first in
    // the specialist's order (a round whose date is unknown is never taken as the latest).
    // Only an ISO date (ÅÅÅÅ, ÅÅÅÅ-MM or ÅÅÅÅ-MM-DD) can be ordered; any other date is shown
    // as written and the round counts as undated (it is never taken as the latest).
    const iso = (date: string | null) => date !== null && /^\d{4}(-\d{2}){0,2}$/.test(date);
    const rounds = [
      ...data.rounds.filter((round) => !iso(round.date)),
      ...data.rounds
        .filter((round) => iso(round.date))
        .sort((a, b) => a.date!.localeCompare(b.date!)),
    ];
    // Bars only compare amounts in one currency: the most common one among the rounds.
    const tally = new Map<string, number>();
    for (const round of rounds) {
      if (round.amount !== null && round.currency) {
        tally.set(round.currency, (tally.get(round.currency) ?? 0) + 1);
      }
    }
    const currency = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const comparable = (round: (typeof rounds)[number]) =>
      round.amount !== null && round.currency === currency;
    const max = Math.max(0, ...rounds.filter(comparable).map((round) => round.amount!));
    // The latest round is known only when a round has an ISO date.
    const dated = rounds.filter((round) => iso(round.date));
    const latest = dated[dated.length - 1] ?? null;
    const amount = (round: (typeof rounds)[number]) =>
      round.amount === null
        ? text("deep.cards.unknownShare")
        : amountText(round.amount, round.currency, language);
    const title = (round: (typeof rounds)[number]) =>
      !round.date
        ? round.name
        : `${round.name}, ${iso(round.date) ? round.date.slice(0, 4) : round.date}`;
    const count = rounds.length;
    topics.push({
      key: `${DATA_TOPIC_PREFIX}rounds`,
      label: text("deep.data.rounds.label"),
      headline: text(
        count === 1 ? "deep.data.rounds.headlineOne" : "deep.data.rounds.headlineMany",
        { count },
      ),
      answer: !latest
        ? text(
            count === 1 ? "deep.data.rounds.answerUndatedOne" : "deep.data.rounds.answerUndated",
            {
              count,
            },
          )
        : text(
            latest.amount === null ? "deep.data.rounds.answerNoAmount" : "deep.data.rounds.answer",
            { round: title(latest), amount: amount(latest) },
          ),
      chartTitle: text("deep.data.rounds.chart"),
      bars: rounds.map((round) => ({
        label: title(round),
        value: amount(round),
        fraction: comparable(round) ? fraction(round.amount!, max) : 0,
        strong: round === latest,
      })),
      fields: [],
      note: text("deep.data.rounds.note"),
      found: rounds.map((round) =>
        text(round.investors.length > 0 ? "deep.data.rounds.found" : "deep.data.rounds.foundNone", {
          round: title(round),
          amount: amount(round),
          investors: round.investors.join(", "),
        }),
      ),
    });
  }
  return topics;
}

/**
 * The data topics of one specialist (by its module id): none for a fund's own specialist, a
 * run from, or data the sources did not have.
 */
export function dataTopics(
  moduleId: string,
  cardData: DeepCardData | null | undefined,
  language: Language = "da",
): DataTopic[] {
  const kind = cardDataKindFor(moduleId);
  if (!kind || !cardData) return [];
  const text: Text = (key, vars) => translate(language, key, vars);
  switch (kind) {
    case "team": {
      const slot = cardData.team;
      return slot.status === "found" && slot.data && slot.data.people.length > 0
        ? [teamTopic(slot.data, text, language)]
        : [];
    }
    case "market": {
      const slot = cardData.market;
      return slot.status === "found" && slot.data && slot.data.points.length > 0
        ? [marketTopic(slot.data, text, language)]
        : [];
    }
    case "techBenchmarks": {
      const slot = cardData.techBenchmarks;
      return slot.status === "found" && slot.data && slot.data.items.length > 0
        ? [techTopic(slot.data, text, language)]
        : [];
    }
    case "ownership": {
      const slot = cardData.ownership;
      return slot.status === "found" && slot.data ? ownershipTopics(slot.data, text, language) : [];
    }
  }
}

export function isDataTopicKey(key: string): boolean {
  return key.startsWith(DATA_TOPIC_PREFIX);
}
