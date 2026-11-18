/**
 * The fund's own specialists' "hvad den skal teste" as questions for the deep analysis's
 * public research, so the research looks for what the fund's own experts must assess. The text is
 * the fund's own and Perplexity has no ZDR, so every question goes through the neutral filter
 * (`neutralQuestions`) and is checked against the brief, the fund's screening
 * instruction and the specialist's purpose and mandate; a question that copies any of them, or
 * carries a number (a threshold), is left out. No new research calls: the questions are added to
 * the deep research module that covers the specialist's first score area, a few per module.
 */
import type { ScoreCategory } from "@/lib/domain/types";
import { neutralQuestions, type TopicsBrief } from "./search-topics.ts";
import type { DeepSpecialist } from "./specialist-prompts.ts";

/** At most this many of the fund's questions per research module, so the defaults keep room. */
export const MAX_SPECIALIST_QUESTIONS_PER_MODULE = 3;
/** A longer test is a description, not a question to search for. */
export const MAX_SPECIALIST_QUESTION_CHARS = 240;

const STANDALONE_NUMBER = /(^|[^\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{L}])/u;

/** The deep research module (public-research.ts `researchModules`) that covers a score area. */
export const RESEARCH_MODULE_FOR_CATEGORY: Record<ScoreCategory, string> = {
  fund_thesis_fit: "market_competition",
  founder_market_fit: "founders_team",
  team_market_fit: "founders_team",
  product_market_fit: "traction_customers_gtm",
  product_technology: "product_technology",
  market_timing: "market_competition",
  traction_gtm: "traction_customers_gtm",
  financial_strength: "filings_financials",
  evidence_quality: "legal_regulatory_reputation",
};
/** A specialist that scores no criteria still researches: market and competition is the widest. */
const FALLBACK_RESEARCH_MODULE = "market_competition";

/**
 * Research module id → the fund's own specialists' neutral questions for it. Empty when the run has
 * no own specialists, so the research is then unchanged.
 */
export function specialistResearchQuestions(
  specialists: readonly DeepSpecialist[],
  brief: TopicsBrief,
  screeningInstruction?: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const specialist of specialists) {
    if (specialist.kind !== "custom") continue;
    const moduleId = specialist.categories[0]
      ? RESEARCH_MODULE_FOR_CATEGORY[specialist.categories[0]]
      : FALLBACK_RESEARCH_MODULE;
    const candidates = [...specialist.evidenceTests, ...(specialist.questions ?? [])]
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => text && text.length <= MAX_SPECIALIST_QUESTION_CHARS)
      // A number is a threshold or a target ("ARR over 5 mio."); a digit inside a word ("CO2") is fine.
      .filter((text) => !STANDALONE_NUMBER.test(text));
    // The confidential text this specialist's questions are checked against: the brief, plus the
    // instruction (it never goes to research) and the specialist's purpose and mandate.
    const vetted = neutralQuestions(candidates, {
      ...brief,
      distinctiveLens: [
        ...brief.distinctiveLens,
        ...(screeningInstruction ? [screeningInstruction] : []),
        ...(specialist.purpose ? [specialist.purpose] : []),
        ...specialist.mandate,
      ],
    });
    const list = out.get(moduleId) ?? [];
    for (const question of vetted) {
      if (list.length >= MAX_SPECIALIST_QUESTIONS_PER_MODULE) break;
      if (!list.includes(question)) list.push(question);
    }
    if (list.length) out.set(moduleId, list);
  }
  return out;
}
