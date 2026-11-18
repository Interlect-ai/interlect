/**
 * The self-host demo data's outputs, built from the pre-written cases in demo-cases.ts. Pure: no
 * database and no AI. Every output is shaped exactly like the model's answer the product stores
 * (screeningOutputSchema, specialistOutputSchema, deepAnalysisOutputSchema), and the tests run the
 * product's own checks on them (demo-build.test.ts), so a demo case looks and scores like a real
 * one. Everything is written for the fund's criteria and gates as they are when the seed runs: a
 * criterion the case has no fact for is left to the stage prior, as the product does.
 */
import { createHash } from "node:crypto";
import type { ScoreCategory } from "../../../src/lib/domain/types.ts";
import type {
  CriterionAssessment,
  GateAssessment,
  RiskAssessment,
  ScreeningOutput,
} from "../../../src/lib/analysis/contracts.ts";
import {
  DEEP_FINDING_CATEGORIES,
  type DeepAnalysisOutput,
} from "../../../src/lib/analysis/deep.contracts.ts";
import type { SpecialistOutput } from "../../../src/lib/analysis/specialist.contracts.ts";
import type { CardData } from "../../../src/lib/analysis/card-data.ts";
import { TEAM_AXES } from "../../../src/lib/analysis/card-data-kinds.ts";
import { mergeSpecialistRationales } from "../../../src/lib/analysis/deep-merge.ts";
import type { FundProfile } from "../../../src/lib/funds/profiles.ts";
import type { DemoCase, DemoRisk } from "./demo-cases.ts";

/** Marks every demo run (workflow_version) and names its prompt, so a demo run is never mistaken. */
export const DEMO_WORKFLOW_VERSION = "selfhost-demo-v1";
export const DEMO_PROMPT_NAME = "selfhost-demo-fictional";

/** A stable UUID (version 5 layout) from the fund and a name, so a rerun finds the same rows. */
export function demoId(fundId: string, name: string): string {
  const h = createHash("sha1").update(`interlect-selfhost-demo:${fundId}:${name}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface DemoIds {
  company: string;
  case: string;
  screeningRun: string;
  deepRun: string;
  evidence: (key: string) => string;
  person: (key: string) => string;
  note: (index: number) => string;
}

export function demoIds(fundId: string, item: Pick<DemoCase, "key">): DemoIds {
  const id = (name: string) => demoId(fundId, `${item.key}:${name}`);
  return {
    company: id("company"),
    case: id("case"),
    screeningRun: id("run:screening"),
    deepRun: id("run:deep"),
    evidence: (key) => id(`evidence:${key}`),
    person: (key) => id(`person:${key}`),
    note: (index) => id(`note:${index}`),
  };
}

/** The company's name in the product: always marked as a demo. */
export function demoCompanyName(item: Pick<DemoCase, "name">): string {
  return `${item.name} (demo)`;
}

export interface BuildContext {
  caseId: string;
  profile: Pick<FundProfile, "id" | "version" | "criteria" | "gates">;
  ids: DemoIds;
}

/** A specialist as the deep run knows it (DeepSpecialist's fields the demo needs). */
export interface DemoModule {
  id: string;
  title: string;
  categories: readonly ScoreCategory[];
}

const FINANCE_MODULE = "fund_finance_deal";

function evidenceIdsOf(item: DemoCase, ctx: BuildContext, keys: readonly string[]): string[] {
  return keys.map((key) => {
    if (!item.evidence.some((row) => row.key === key)) {
      throw new Error(`${item.key}: evidence ${key} is not in the case`);
    }
    return ctx.ids.evidence(key);
  });
}

function band(score: number): string {
  if (score >= 80) return "This is a clear strength against the fund's bar for the stage.";
  if (score >= 70) return "This meets the fund's bar for the stage, with some points still open.";
  if (score >= 55)
    return "This is mixed: promising signals, but not yet enough to carry an investment.";
  return "This falls short of what the fund expects at this stage.";
}

function verdict(score: number): string {
  if (score >= 80) return "Strong";
  if (score >= 70) return "Solid";
  if (score >= 55) return "Mixed";
  return "Weak";
}

/** The criterion's assessment from the case's fact for its category (null score without one). */
function assessment(
  item: DemoCase,
  ctx: BuildContext,
  criterion: BuildContext["profile"]["criteria"][number],
  depth: "screening" | "specialist" | "synthesis",
): CriterionAssessment {
  const fact = item.facts[criterion.category];
  const score = item.scores[criterion.category];
  if (!fact || score === undefined) {
    return {
      criterionKey: criterion.key,
      proposedScore: null,
      confidence: 0.2,
      verdict: "Unknown",
      rationale: `The material on ${item.name} says nothing reliable about ${criterion.label.toLowerCase()}, so the score follows the stage prior until the team has asked.`,
      positiveDrivers: [],
      negativeDrivers: [],
      citations: [],
      unknowns: [`Nothing documented yet on ${criterion.label.toLowerCase()}.`],
    };
  }
  const deepNote = item.deep?.notes[criterion.category];
  const sources = evidenceIdsOf(item, ctx, fact.evidence);
  const evidenceLine =
    fact.evidence.length > 1
      ? `The assessment rests on ${fact.evidence.length} sources in the case, including ${item.evidence.find((row) => row.key === fact.evidence[0])!.statedBy.toLowerCase()}.`
      : `The assessment rests on ${item.evidence.find((row) => row.key === fact.evidence[0])!.statedBy.toLowerCase()}.`;
  const parts =
    depth === "synthesis"
      ? [fact.text, band(score)]
      : depth === "specialist"
        ? [fact.text, deepNote ?? "", band(score), evidenceLine, fact.watch ?? ""]
        : [fact.text, band(score), evidenceLine];
  return {
    criterionKey: criterion.key,
    proposedScore: score,
    confidence: fact.confidence ?? 0.7,
    verdict: verdict(score),
    rationale: parts.filter(Boolean).join(" "),
    positiveDrivers: fact.up ? [fact.up] : [],
    negativeDrivers: fact.down ? [fact.down] : [],
    citations: sources.map((evidenceId) => ({ evidenceId, support: "supporting" as const })),
    unknowns: fact.unknown ? [fact.unknown] : [],
  };
}

const GATE_TEXT: Record<string, (item: DemoCase, passed: boolean | null) => string> = {
  stage_fit: (item, passed) =>
    passed === false
      ? `${item.name} is past the stages the fund invests in.`
      : `${item.name} is raising a ${stageWords(item.stage)} round, inside the fund's stages.`,
  geography_fit: (item, passed) =>
    passed === false
      ? `${item.name} is headquartered outside the fund's geography.`
      : `${item.name} is headquartered in ${countryWords(item.geography)}, inside the fund's geography.`,
  ticket_fit: (item, passed) =>
    passed === null
      ? `The round size of ${item.name} is not confirmed, so the fund's ticket cannot be checked yet.`
      : passed
        ? `The round of ${item.name} leaves room for a ticket within the fund's range.`
        : `The round of ${item.name} is too small for the fund's minimum ticket.`,
  legal_dealbreakers: (item, passed) =>
    passed === null
      ? `No legal or regulatory exclusion is documented for ${item.name}, but nothing has been checked yet either.`
      : `Nothing in the material on ${item.name} touches the fund's legal or ethical exclusions.`,
};

function gate(
  item: DemoCase,
  ctx: BuildContext,
  gateDef: BuildContext["profile"]["gates"][number],
): GateAssessment {
  const passed = item.gates?.[gateDef.key] ?? true;
  const text =
    GATE_TEXT[gateDef.key]?.(item, passed) ??
    (passed === null
      ? `The material on ${item.name} does not settle "${gateDef.label}".`
      : passed
        ? `The material on ${item.name} meets "${gateDef.label}".`
        : `The material on ${item.name} does not meet "${gateDef.label}".`);
  return {
    gateKey: gateDef.key,
    passed,
    confidence: passed === null ? 0.3 : 0.8,
    rationale: text,
    evidenceIds: passed === null ? [] : evidenceIdsOf(item, ctx, [item.evidence[0]!.key]),
  };
}

/** A risk's reasoning: cause, evidence, likelihood and impact (the deep quality check's rule). */
export function riskRationale(risk: DemoRisk): string {
  return [
    risk.cause,
    risk.evidenceNote,
    risk.context ?? "",
    `The likelihood is ${likelihoodWords(risk.likelihood)}: ${risk.likelihoodWhy}`,
    `The impact would be ${impactWords(risk.impact)}: ${risk.impactWhy}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function risk(item: DemoCase, ctx: BuildContext, value: DemoRisk): RiskAssessment {
  return {
    riskKey: value.key,
    label: value.label,
    level: value.level,
    likelihood: value.likelihood,
    impact: value.impact,
    rationale: riskRationale(value),
    evidenceIds: evidenceIdsOf(item, ctx, value.evidence),
    mitigation: value.mitigation,
  };
}

function criterionKeyFor(ctx: BuildContext, category: ScoreCategory): string | null {
  return ctx.profile.criteria.find((criterion) => criterion.category === category)?.key ?? null;
}

/** The screening, as the fund-fit call answers it (screeningOutputSchema). */
export function buildScreeningOutput(item: DemoCase, ctx: BuildContext): ScreeningOutput {
  return {
    schemaVersion: "interlect-screening-v1",
    fundProfileId: ctx.profile.id,
    fundProfileVersion: ctx.profile.version,
    caseId: ctx.caseId,
    assessments: ctx.profile.criteria.map((criterion) =>
      assessment(item, ctx, criterion, "screening"),
    ),
    gates: ctx.profile.gates.map((gateDef) => gate(item, ctx, gateDef)),
    risks: item.risks.map((value) => risk(item, ctx, value)),
    strengths: item.strengths,
    weaknesses: item.weaknesses,
    openQuestions: item.openQuestions,
    overallAssessment: item.summary,
    contraryCase: item.contrary,
    proposedRecommendation: item.recommendation,
    companyProfile: item.profile,
    keyFindings: item.keyFindings.flatMap((finding) => {
      const criterionKey = criterionKeyFor(ctx, finding.category);
      return criterionKey
        ? [
            {
              statement: finding.statement,
              direction: finding.direction,
              criterionKey,
              importance: finding.importance,
            },
          ]
        : [];
    }),
    nextSteps: item.nextSteps.flatMap((step, index) => {
      const linkedKey = criterionKeyFor(ctx, step.category);
      return [
        {
          title: step.title,
          question: step.question,
          why: step.why,
          kind: step.kind,
          linkedKind: linkedKey ? "criterion" : null,
          linkedKey,
          priority: index + 1,
        },
      ];
    }),
    companyLabel: {
      stage: stageWords(item.stage, true),
      sector: item.sectorLabel,
      country: countryWords(item.geography).replace(/^the /, ""),
    },
  };
}

function deepFindings(item: DemoCase, ctx: BuildContext): DeepAnalysisOutput["findings"] {
  const deep = requireDeep(item);
  return DEEP_FINDING_CATEGORIES.flatMap((category) => {
    const fact = item.facts[category];
    const score = item.scores[category];
    const rows: DeepAnalysisOutput["findings"] = [];
    if (fact) {
      rows.push({
        category,
        findingType: score === undefined ? "assessment" : score >= 65 ? "strength" : "weakness",
        statement: fact.text,
        confidence: fact.confidence ?? 0.7,
        nature: fact.nature ?? "company_claim",
        evidenceIds: evidenceIdsOf(item, ctx, fact.evidence),
      });
    }
    const note = deep.notes[category];
    if (note) {
      rows.push({
        category,
        findingType: "assessment",
        statement: note,
        confidence: 0.6,
        nature: "judgement",
        evidenceIds: fact ? evidenceIdsOf(item, ctx, fact.evidence.slice(0, 1)) : [],
      });
    }
    if (!rows.length) {
      rows.push({
        category,
        findingType: "unknown",
        statement: `The material on ${item.name} does not cover this area yet.`,
        confidence: 0.2,
        nature: "judgement",
        evidenceIds: [],
      });
    }
    return rows;
  });
}

function requireDeep(item: DemoCase): NonNullable<DemoCase["deep"]> {
  if (!item.deep) throw new Error(`${item.key} has no deep analysis`);
  return item.deep;
}

function financialInputs(item: DemoCase, ctx: BuildContext): DeepAnalysisOutput["financialInputs"] {
  return requireDeep(item).finance.map((row) => ({
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    evidenceId: evidenceIdsOf(item, ctx, [row.evidence])[0]!,
  }));
}

function cardData(item: DemoCase, ctx: BuildContext, moduleId: string): CardData | null {
  const deep = requireDeep(item);
  const ids = (keys: readonly string[]) => evidenceIdsOf(item, ctx, keys);
  if (moduleId === "people_team") {
    return {
      kind: "team",
      people: item.people.slice(0, 6).map((person) => ({
        name: person.name,
        role: person.role,
        scores: Object.fromEntries(
          TEAM_AXES.map((axis, index) => [axis, person.scores[index] ?? null]),
        ) as Record<(typeof TEAM_AXES)[number], number | null>,
        evidenceIds: ids(person.evidence),
      })),
      notFound: null,
    };
  }
  if (moduleId === "product_market_gtm") {
    return {
      kind: "market",
      label: deep.market.label,
      scope: deep.market.scope,
      geography: deep.market.geography,
      currency: "EUR",
      unit: deep.market.unit,
      points: deep.market.points.map(([year, value, basis]) => ({
        year,
        value,
        basis,
        evidenceIds: ids([deep.market.evidence]),
      })),
      notFound: null,
    };
  }
  if (moduleId === "technology_risk") {
    return {
      kind: "techBenchmarks",
      items: deep.tech.map((row) => ({
        metric: row.metric,
        unit: row.unit,
        company: row.company,
        industry: row.industry,
        higherIsBetter: row.higherIsBetter,
        evidenceIds: ids([row.evidence]),
      })),
      notFound: null,
    };
  }
  if (moduleId === FINANCE_MODULE) {
    return {
      kind: "ownership",
      holders: deep.ownership.holders.map((holder) => ({
        holder: holder.holder,
        holderType: holder.type,
        percent: holder.percent,
        asOf: deep.ownership.asOf,
        evidenceIds: ids([deep.ownership.evidence]),
      })),
      rounds: deep.ownership.rounds.map((round) => ({
        name: round.name,
        date: round.date,
        amount: round.amount,
        currency: "EUR",
        investors: round.investors,
        evidenceIds: ids([deep.ownership.evidence]),
      })),
      notFound: null,
    };
  }
  // A fund's own specialist draws the figures it found.
  return {
    kind: "highlights",
    items: deep.finance.slice(0, 4).map((row) => ({
      label: row.label,
      value: row.value,
      unit: row.unit,
      period: row.periodEnd?.slice(0, 7) ?? null,
      evidenceIds: ids([row.evidence]),
    })),
    notFound: null,
  };
}

/** One specialist's packet per module of the run (specialistOutputSchema). */
export function buildSpecialistPackets(
  item: DemoCase,
  ctx: BuildContext,
  modules: readonly DemoModule[],
): SpecialistOutput[] {
  const deep = requireDeep(item);
  const findings = deepFindings(item, ctx);
  return modules.map((module) => {
    const owns = (category: ScoreCategory) => module.categories.includes(category);
    const criteria = ctx.profile.criteria.filter((criterion) => owns(criterion.category));
    const words = deep.specialists[module.id];
    const scored = module.categories.flatMap((category) => {
      const score = item.scores[category];
      const fact = item.facts[category];
      return score === undefined || !fact ? [] : [{ score, fact }];
    });
    return {
      schemaVersion: "interlect-specialist-v1",
      moduleId: module.id,
      caseId: ctx.caseId,
      assessments: criteria.map((criterion) => assessment(item, ctx, criterion, "specialist")),
      summary: words?.summary ?? null,
      headline: words?.headline ?? null,
      findings: findings.filter((finding) => owns(finding.category)),
      risks: item.risks
        .filter((value) => value.module === module.id)
        .map((value) => risk(item, ctx, value)),
      strengths: scored.filter((row) => row.score >= 70).map((row) => row.fact.up ?? row.fact.text),
      weaknesses: scored
        .filter((row) => row.score < 60)
        .map((row) => row.fact.down ?? row.fact.text),
      unknowns: scored.flatMap((row) => (row.fact.unknown ? [row.fact.unknown] : [])),
      questions: words?.questions ?? [],
      financialInputs: module.id === FINANCE_MODULE ? financialInputs(item, ctx) : [],
      cardData: cardData(item, ctx, module.id),
    };
  });
}

/** The committee synthesis (deepAnalysisOutputSchema), with the specialists' long texts merged in. */
export function buildDeepOutput(
  item: DemoCase,
  ctx: BuildContext,
  packets: readonly SpecialistOutput[],
): DeepAnalysisOutput {
  const deep = requireDeep(item);
  const screening = buildScreeningOutput(item, ctx);
  const synthesisAssessments = ctx.profile.criteria.map((criterion) =>
    assessment(item, ctx, criterion, "synthesis"),
  );
  const finance = packets.find((packet) => packet.moduleId === FINANCE_MODULE);
  return {
    ...screening,
    schemaVersion: "interlect-deep-v1",
    assessments: mergeSpecialistRationales(synthesisAssessments, packets),
    overallAssessment: deep.overall,
    contraryCase: deep.contrary,
    proposedRecommendation: deep.recommendation,
    investmentCondition: deep.investmentCondition,
    findings: deepFindings(item, ctx),
    // The synthesis may only carry the finance specialist's figures (validateSynthesized…).
    financialInputs: finance?.financialInputs ?? [],
    risks: item.risks.map((value) => ({ ...risk(item, ctx, value), mitigation: value.mitigation })),
    nextSteps: screening.nextSteps?.slice(0, 10),
  };
}

function stageWords(stage: DemoCase["stage"], capital = false): string {
  const words = { pre_seed: "pre-seed", seed: "seed", series_a: "Series A" }[stage];
  return capital ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

function countryWords(code: string): string {
  return (
    {
      DK: "Denmark",
      SE: "Sweden",
      NO: "Norway",
      FI: "Finland",
      DE: "Germany",
      NL: "the Netherlands",
    }[code] ?? code
  );
}

function likelihoodWords(value: number): string {
  return ["very low", "low", "moderate", "high", "very high"][value - 1] ?? "moderate";
}

function impactWords(value: number): string {
  return ["minor", "limited", "significant", "serious", "severe"][value - 1] ?? "significant";
}
