/**
 * "Hvad betyder det?" on each Overblik sub-page (rule): one to three plain sentences
 * written IN CODE from the real numbers. Nothing is written by an AI and nothing is invented:
 * a sentence is only returned when the numbers support it and there is enough data, otherwise
 * the list is empty and the page leaves the section out. Danish number format, singular and
 * plural right ("1 case", "2 cases").
 */
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import { dayWord } from "./waiting.ts";
import { MIN_HEAT_CASES, SCORE_BINS, type OverviewCore } from "./snapshot.ts";

const numbers: Record<Language, Intl.NumberFormat> = {
  da: new Intl.NumberFormat(LANGUAGE_TAGS.da, { maximumFractionDigits: 1 }),
  en: new Intl.NumberFormat(LANGUAGE_TAGS.en, { maximumFractionDigits: 1 }),
};
export const formatNumber = (value: number, language: Language = DEFAULT_LANGUAGE) =>
  numbers[language].format(value);

/** "1 case", "2 cases" in the language. */
export const casesText = (count: number, language: Language = DEFAULT_LANGUAGE) =>
  translate(language, count === 1 ? "overview.meaning.casesOne" : "overview.meaning.casesMany", {
    count,
  });

const regionNames = new Map<Language, Intl.DisplayNames | null>();
/** A country code's name in the language ("DK" → "Danmark" / "Denmark"); the code if unknown. */
export function countryName(code: string, language: Language = DEFAULT_LANGUAGE): string {
  if (!regionNames.has(language)) {
    try {
      regionNames.set(language, new Intl.DisplayNames([language], { type: "region" }));
    } catch {
      regionNames.set(language, null);
    }
  }
  try {
    return regionNames.get(language)?.of(code) ?? code;
  } catch {
    return code;
  }
}

const percent = (part: number, whole: number) => Math.round((part / whole) * 100);

export function pipelineMeaning(
  core: OverviewCore,
  language: Language = DEFAULT_LANGUAGE,
): string[] {
  const { funnel, threshold } = core;
  if (funnel.cohort === 0) return [];
  const screened = funnel.steps.find((step) => step.key === "screened")?.count ?? 0;
  const deep = funnel.steps.find((step) => step.key === "deep")?.count ?? 0;
  const lines = [
    translate(language, "overview.meaning.pipelineScreened", {
      screened,
      cases: casesText(funnel.cohort, language),
      deep,
    }),
  ];
  if (funnel.overNotForwarded > 0) {
    lines.push(
      translate(language, "overview.meaning.pipelineOverNotForwarded", {
        cases: casesText(funnel.overNotForwarded, language),
        threshold,
      }),
    );
  }
  const wait = core.longestCommitteeWait;
  if (wait && wait.days > 0) {
    lines.push(
      translate(language, "overview.meaning.pipelineLongestWait", {
        name: wait.name,
        days: dayWord(wait.days, language),
      }),
    );
  }
  return lines;
}

export function geoMeaning(core: OverviewCore, language: Language = DEFAULT_LANGUAGE): string[] {
  const { rows, noCountry } = core.geo;
  const known = rows.reduce((sum, row) => sum + row.total, 0);
  if (known === 0) return [];
  const lines: string[] = [];
  const top = rows[0]!;
  const country = countryName(top.code, language);
  lines.push(
    rows.length === 1
      ? translate(language, "overview.meaning.geoAll", { country })
      : translate(
          language,
          rows.length === 2 ? "overview.meaning.geoTopOne" : "overview.meaning.geoTopMany",
          { percent: percent(top.total, known), country, others: rows.length - 1 },
        ),
  );
  if (noCountry > 0) {
    lines.push(
      translate(language, "overview.meaning.geoNoCountry", {
        cases: casesText(noCountry, language),
      }),
    );
  }
  return lines;
}

export function sectorMeaning(core: OverviewCore, language: Language = DEFAULT_LANGUAGE): string[] {
  if (core.activeCases < MIN_HEAT_CASES) return [];
  const top = core.heat.rows[0];
  const lines: string[] = [];
  if (top) {
    lines.push(
      translate(language, "overview.meaning.sectorTop", {
        sector: top.label,
        count: top.total,
        total: core.activeCases,
      }),
    );
  }
  const stage = [...core.stages].sort((a, b) => b.count - a.count)[0];
  if (stage) {
    lines.push(
      translate(language, "overview.meaning.sectorStage", {
        stage: stage.label,
        count: stage.count,
        total: core.activeCases,
      }),
    );
  }
  return lines;
}

export function intakeMeaning(core: OverviewCore, language: Language = DEFAULT_LANGUAGE): string[] {
  const { intake } = core;
  if (intake.total === 0) return [];
  const weeks = intake.bars.length * intake.weeksPerBar;
  const lines = [
    translate(language, "overview.meaning.intakeTotal", {
      cases: casesText(intake.total, language),
      average: formatNumber(intake.total / weeks, language),
      forwarded: intake.forwarded,
      percent: percent(intake.forwarded, intake.total),
    }),
  ];
  // Only an even number of bars splits into two equal halves (the year has 13).
  if (intake.total >= 6 && intake.bars.length % 2 === 0) {
    const half = Math.floor(intake.bars.length / 2);
    const first = intake.bars.slice(0, half).reduce((sum, bar) => sum + bar.total, 0);
    const second = intake.bars
      .slice(intake.bars.length - half)
      .reduce((sum, bar) => sum + bar.total, 0);
    lines.push(translate(language, "overview.meaning.intakeHalves", { second, first }));
  }
  return lines;
}

const binText = (label: string, language: Language) =>
  label === "<50"
    ? translate(language, "overview.meaning.binUnder50")
    : label === "80+"
      ? translate(language, "overview.meaning.bin80Plus")
      : translate(language, "overview.meaning.binBetween", {
          from: label,
          to: Number(label) + 10,
        });

export function scoreMeaning(core: OverviewCore, language: Language = DEFAULT_LANGUAGE): string[] {
  const { scores, threshold } = core;
  if (scores.count === 0) return [];
  const lines = [
    translate(language, "overview.meaning.scoreMedian", {
      median: formatNumber(scores.median ?? 0, language),
      over: scores.overThreshold,
      count: scores.count,
      threshold,
    }),
  ];
  const biggest = scores.bins.reduce((best, bin) => (bin.count > best.count ? bin : best));
  if (biggest.count > 1 && SCORE_BINS.some((bin) => bin.label === biggest.label)) {
    lines.push(
      translate(language, "overview.meaning.scoreBiggest", {
        bin: binText(biggest.label, language),
        cases: casesText(biggest.count, language),
      }),
    );
  }
  return lines;
}

export function stageMeaning(core: OverviewCore, language: Language = DEFAULT_LANGUAGE): string[] {
  const total = core.stages.reduce((sum, slice) => sum + slice.count, 0);
  if (total === 0) return [];
  const known = core.stages.filter((slice) => slice.key !== "unknown");
  const top = [...known].sort((a, b) => b.count - a.count)[0];
  const lines: string[] = [];
  if (top)
    lines.push(
      translate(language, "overview.meaning.stageTop", {
        stage: top.label,
        count: top.count,
        total,
      }),
    );
  const unknown = core.stages.find((slice) => slice.key === "unknown")?.count ?? 0;
  if (unknown > 0)
    lines.push(
      translate(language, "overview.meaning.stageUnknown", {
        cases: casesText(unknown, language),
      }),
    );
  return lines;
}

export function tasksMeaning(core: OverviewCore, language: Language = DEFAULT_LANGUAGE): string[] {
  const { open, overdue, cases: caseCount } = core.tasks;
  if (open === 0) return [];
  return [
    translate(language, open === 1 ? "overview.meaning.tasksOne" : "overview.meaning.tasksMany", {
      open,
      overdue,
      cases: casesText(caseCount, language),
    }),
  ];
}
