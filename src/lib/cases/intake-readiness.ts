/**
 * Informationsmåleren på Opret case (prototypen "Opret case.dc.html", `ready()`):
 * Kun navnet → Klar til screening → Stærkt grundlag. Rene regler, ingen AI.
 *
 * - hvem: navn eller CVR (påkrævet);
 * - hvad: deck, hjemmeside eller noter på mindst 30 ord;
 * - en kilde tæller: deck, hjemmeside, noter på mindst 10 ord;
 * - niveau 3 ("Stærkt grundlag"): hvem + hvad + mindst to kilder.
 */
import { parseCompanyQuery } from "../analysis/identity-resolve.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

export type ReadinessLevel = 0 | 1 | 2 | 3;

export interface IntakeReadinessInput {
  /** Navn eller CVR, som indtastet. */
  query: string;
  deckCount: number;
  website: string;
  notes: string;
}

export interface IntakeReadiness {
  who: boolean;
  what: boolean;
  /** Kan "Find selskabet" bruges? Kun når hvem er udfyldt. */
  ok: boolean;
  sources: number;
  words: number;
  level: ReadinessLevel;
  label: string;
  hint: string;
}

/** Dictionary keys for the level labels; level 0 has no label. */
export const READINESS_LABEL_KEYS: Record<ReadinessLevel, MessageKey | null> = {
  0: null,
  1: "intake.readiness.level1",
  2: "intake.readiness.level2",
  3: "intake.readiness.level3",
};

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function intakeReadiness(
  input: IntakeReadinessInput,
  language: Language = "da",
): IntakeReadiness {
  const words = countWords(input.notes);
  const hasWebsite = input.website.trim().length > 0;
  const sources = (input.deckCount > 0 ? 1 : 0) + (hasWebsite ? 1 : 0) + (words >= 10 ? 1 : 0);
  const who = parseCompanyQuery(input.query).kind !== "empty";
  const what = input.deckCount > 0 || hasWebsite || words >= 30;
  const level: ReadinessLevel = !who ? 0 : !what ? 1 : sources >= 2 ? 3 : 2;
  let hint = "";
  if (!who) {
    // Hjemmeside, deck eller noter uden navn: venlig forklaring i stedet for et gæt.
    hint =
      input.deckCount > 0 || hasWebsite || words > 0
        ? translate(language, "intake.readiness.hintNoWho")
        : "";
  } else if (!what) {
    hint = translate(language, "intake.readiness.hintNoWhat");
  } else if (level === 2) {
    hint = translate(language, "intake.readiness.hintReady");
  } else {
    hint = translate(language, "intake.readiness.hintStrong");
  }
  const labelKey = READINESS_LABEL_KEYS[level];
  return {
    who,
    what,
    ok: who,
    sources,
    words,
    level,
    label: labelKey ? translate(language, labelKey) : "",
    hint,
  };
}
