/**
 * Bekræft: mandate-fit preview BEFORE the case exists. Only gates that known facts can
 * decide in code are shown as met; every other gate is "afklares i screeningen" (unknown).
 * Never invented green, never a breach: a mismatch against the fund's free-text lists is a
 * question for the screening, not a verdict made from a registry country (principle 7: missing data
 * is uncertainty).
 *
 * Pure and client-safe (no server imports). Gate keys that are decidable come from the fund
 * templates (`geography_fit`, `stage_fit`); custom gates are always unknown here.
 */
import { fundAllowsStage } from "../domain/stages.ts";
import { geographyText, stageKey, stageText } from "../funds/basis-labels.ts";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export interface PreviewGateInput {
  key: string;
  label: string;
}

export interface MandateSnapshot {
  fundId: string;
  fundName: string;
  /** The active mandate's lists: keys ("series_a", "DK", "nordics") or the team's own text. */
  stages: string[];
  geographies: string[];
  gates: PreviewGateInput[];
}

export type IntakeStage =
  "pre_seed" | "seed" | "series_a" | "series_b" | "later" | "growth" | "buyout" | "unknown";

export interface KnownFacts {
  /** Country as written (e.g. "Danmark" from CVR); null when not known. */
  country: string | null;
  stage: IntakeStage;
}

export type PreviewStatus = "passed" | "unknown";

export interface PreviewGate {
  key: string;
  label: string;
  status: PreviewStatus;
  /** Why the code could decide it (shown as the tooltip); empty for unknown. */
  basis: string;
}

const NORDIC = [
  "danmark",
  "denmark",
  "sverige",
  "sweden",
  "norge",
  "norway",
  "finland",
  "island",
  "iceland",
];
const NORDIC_WORDS = /\b(norden|nordic|nordisk[a-z]*|skandinavi[a-z]*|scandinavi[a-z]*)\b/i;

const STAGE_PATTERNS: Record<"pre_seed" | "seed" | "series_a" | "series_b" | "later", RegExp> = {
  pre_seed: /pre[-\s]?seed/i,
  // "seed" but not as part of "pre-seed" / "pre seed".
  seed: /(?<!pre[-\s]?)\bseed\b/i,
  series_a: /\bserie[s]?\s?a\b/i,
  series_b: /\bserie[s]?\s?b\b/i,
  later: /\bserie[s]?\s?[c-z]\b|\bsenere\b|\blate[r]?\b/i,
};

function fold(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
}

/** Does the country appear in the fund's geography list (directly or through "Norden")? */
export function geographyMatches(country: string | null, geographies: string[]): boolean {
  if (!country || !country.trim()) return false;
  const wanted = fold(country);
  const alias: Record<string, string> = {
    denmark: "danmark",
    sweden: "sverige",
    norway: "norge",
    iceland: "island",
  };
  const canonical = alias[wanted] ?? wanted;
  const matches = (entry: string) => {
    const text = fold(entry);
    if (!text) return false;
    if (text.includes(canonical) || canonical.includes(text)) return true;
    return NORDIC_WORDS.test(entry) && NORDIC.includes(wanted);
  };
  // A key or country code ("DK", "nordics") is read as its names ("Danmark", "Norden").
  return geographies.some(
    (entry) =>
      matches(entry) || matches(geographyText(entry, "da")) || matches(geographyText(entry, "en")),
  );
}

/** Is the stage one of the fund's stages? `unknown` is never decided. */
export function stageMatches(stage: IntakeStage, stages: string[]): boolean {
  if (stage === "unknown") return false;
  if (stage === "growth" || stage === "buyout") return fundAllowsStage(stages, stage);
  // A key ("series_b_plus") is also read as its English name ("Series B+").
  return stages.some(
    (entry) =>
      stageKey(entry) === stage ||
      STAGE_PATTERNS[stage].test(entry) ||
      STAGE_PATTERNS[stage].test(stageText(entry, "en")),
  );
}

export function previewMandate(
  snapshot: MandateSnapshot,
  facts: KnownFacts,
  language: Language = "da",
): PreviewGate[] {
  return snapshot.gates.map((gate) => {
    if (gate.key === "geography_fit" && geographyMatches(facts.country, snapshot.geographies)) {
      return {
        key: gate.key,
        label: gate.label,
        status: "passed" as const,
        basis: translate(language, "intake.mandate.geographyBasis", {
          country: facts.country ?? "",
        }),
      };
    }
    if (gate.key === "stage_fit" && stageMatches(facts.stage, snapshot.stages)) {
      return {
        key: gate.key,
        label: gate.label,
        status: "passed" as const,
        basis: translate(language, "intake.mandate.stageBasis"),
      };
    }
    return { key: gate.key, label: gate.label, status: "unknown" as const, basis: "" };
  });
}

/** "1 af 4 krav kan afgøres nu" for the card header. */
export function previewSummary(gates: PreviewGate[], language: Language = "da"): string {
  if (gates.length === 0) return translate(language, "intake.mandate.noGates");
  const decided = gates.filter((gate) => gate.status === "passed").length;
  return translate(language, "intake.mandate.summary", { decided, total: gates.length });
}
