import type { ScoreCategory } from "@/lib/domain/types";
import type { Language } from "@/lib/i18n/language";
import type { SetupStageChoice } from "@/lib/analysis/setup-stage";
import type { FixedRuleEdits } from "@/lib/funds/fixed-rules";
import type { EconomySetup } from "@/lib/funds/economy-points";

export interface FundProfileSource {
  label: string;
  url: string;
  supports: string;
  sourceType: "official_website" | "official_legal_document";
}

export interface FundCriterion {
  key: string;
  label: string;
  description: string;
  weight: number;
  category: ScoreCategory;
  /** Kun financial_strength: false = scores af AI'en fra evidens, ikke fra regnskaberne (0028). */
  codeAnchor?: boolean | undefined;
}

export interface FundGate {
  key: string;
  label: string;
  description: string;
  treatment: "hard" | "review";
}

export interface FundProfile {
  id: string;
  name: string;
  shortThesis: string;
  thesis: string;
  stages: string[];
  geographies: string[];
  sectors: string[];
  ticket: { minEur: number | null; maxEur: number | null; note: string };
  /** E2b: fondens samlede størrelse i EUR, hvis den er angivet. */
  fundSizeEur: number | null;
  analysisThreshold: number;
  approvalMode: "partner_approval" | "automatic";
  riskPosture: string;
  /**
   * The fund's own "sådan screener vi" instruction (0078), only in the screening prompt,
   * which is a confidential (ZDR) call; never in research briefs or search queries. Empty = none.
   */
  screeningInstruction?: string;
  /** The language everything AI writes for this fund is in (0085). Missing = Danish. */
  language?: Language;
  distinctiveLens: string[];
  gates: FundGate[];
  criteria: FundCriterion[];
  sources: FundProfileSource[];
  version: string;
  researchedAt: string;
  /**
   * Teamopsætning pr. stadie (0133). Missing on a version with nothing per stage and an
   * empty `setup` (every version from): it then reads exactly as before, also in the
   * prompts. `criteria`, `gates` and `analysisThreshold` above are already the chosen stage's.
   */
  teamSetup?: FundTeamSetup;
}

export interface FundTeamSetup {
  /** The stage the case is analysed with; null when the version has nothing per stage. */
  stage: SetupStageChoice | null;
  /** "Hvem er I, og hvordan tænker I?" (cleaned); replaces the risk lens and the instruction. */
  about: string;
  /** The team's edits to the 9 editable fixed rules; what the team changed reaches the AI. */
  fixedRuleEdits: FixedRuleEdits;
  /**
   * The stage's economy points, own questions and what a missing figure gives; null
   * without a stage (a version whose only new content is "about" or fixed rules).
   */
  economy?: EconomySetup | null;
}
