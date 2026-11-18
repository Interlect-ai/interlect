import type { ScoreCategory } from "@/lib/domain/types";
import type { Language } from "@/lib/i18n/language";

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
}
