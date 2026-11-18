import { z } from "zod";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

/**
 * The fund's own screening: the free "sådan screener vi" instruction and the extra
 * screening cards, both per fund setup version. Criteria, weights, gates, risk posture and the
 * screening's research questions already live in the setup. Pure file (no database), so it can be
 * tested with node --test.
 */

/** The extra cards a fund can add to the screening (the three fixed cards are always shown). */
export const SCREENING_CARD_IDS = ["finance", "team", "market", "technology"] as const;
export type ScreeningCardId = (typeof SCREENING_CARD_IDS)[number];

/** Danish names and one line each, as in the prototype "Ny investeringstese v3". */
// i18n-keep: Danish source; the page shows it via the *In(…, language) helper below.
export const SCREENING_CARDS: Record<ScreeningCardId, { label: string; description: string }> = {
  finance: { label: "Finanser", description: "Nøgletal fra regnskaberne." },
  team: { label: "Team", description: "Founders og nøgleroller." },
  market: { label: "Marked", description: "Markedsstørrelse og konkurrenter." },
  technology: { label: "Teknologi", description: "Patenter og teknisk risiko." },
};

/** Same limit as the database (fund_mandates_screening_instruction_length). */
export const SCREENING_INSTRUCTION_MAX = 3000;

/** A version without a choice shows Finanser, as the screening always has (0078 default). */
export const DEFAULT_SCREENING_CARDS: readonly ScreeningCardId[] = ["finance"];

export const screeningSetupSchema = z.object({
  instruction: z.string().trim().max(SCREENING_INSTRUCTION_MAX),
  cards: z
    .array(z.enum(SCREENING_CARD_IDS))
    .max(SCREENING_CARD_IDS.length)
    .refine(
      (cards) => new Set(cards).size === cards.length,
      // i18n-keep: a validator's message; the page checks first, and a ZodError reaches no one as text.
      "Et screeningskort er valgt to gange.",
    ),
});

/**
 * The cards as stored, read tolerantly: unknown or repeated ids are dropped, and the order is
 * always the fixed one, so the page and the diff never depend on how they were saved. A missing
 * column (a row read before 0078) gives the default.
 */
export function readScreeningCards(raw: unknown): ScreeningCardId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SCREENING_CARDS];
  const chosen = new Set(raw.filter((item): item is string => typeof item === "string"));
  return SCREENING_CARD_IDS.filter((id) => chosen.has(id));
}

/** The instruction as stored; anything else than text counts as none. */
export function readScreeningInstruction(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function screeningCardLabels(cards: readonly ScreeningCardId[]): string[] {
  return cards.map((id) => SCREENING_CARDS[id].label);
}

/** The card's name and one line in the fund's language (the page; `SCREENING_CARDS` stays Danish). */
export function screeningCardIn(
  id: ScreeningCardId,
  language: Language = DEFAULT_LANGUAGE,
): { label: string; description: string } {
  return {
    label: translate(language, `specialists.setup.card.${id}.label`),
    description: translate(language, `specialists.setup.card.${id}.description`),
  };
}
