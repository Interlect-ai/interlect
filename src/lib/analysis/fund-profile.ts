/**
 * A fund config version as the analysis reads it, and its mapping to a FundProfile. Moved out of
 * screening.functions.ts so scripts (the research eval) can load a fund's profile with the
 * same code as the screening; screening.functions.ts and rescore.server.ts re-export from here.
 */
import { fundLanguageOf } from "@/lib/i18n/language";
import { serverText } from "@/lib/i18n/server-text";
import type { FundProfile } from "@/lib/funds/profiles";
import type { ScoreCategory } from "@/lib/domain/types";
import { readScreeningInstruction } from "@/lib/funds/screening-setup";

/** The columns `mapProfile` needs from a fund config version. */
export const CONFIG_SELECT = `id, fund_id, profile_key, version, funds(name, language),
  fund_mandates(thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur, ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture, strategy_type, stage_expectations, dealbreakers, screening_instruction),
  mandate_gates(gate_key, label, description, treatment, sort_order),
  assessment_criteria(criterion_key, label, description, score_category, weight, sort_order, code_anchor)`;

export type ConfigData = {
  id: string;
  fund_id: string;
  profile_key: string;
  version: number;
  funds: { name: string; language?: string } | { name: string; language?: string }[];
  fund_mandates: Array<{
    thesis: string;
    stages: string[];
    geographies: string[];
    sectors: string[];
    fund_size_eur: number | null;
    ticket_min_eur: number | null;
    ticket_max_eur: number | null;
    ticket_note: string;
    analysis_threshold: number;
    approval_mode: "partner_approval" | "automatic";
    risk_posture: string;
    strategy_type: "venture" | "growth" | "thematic" | "custom";
    stage_expectations: Record<string, string> | null;
    dealbreakers: string[] | null;
    /** (0078); only selected where the screening prompt is built. */
    screening_instruction?: string | null;
  }>;
  mandate_gates: Array<{
    gate_key: string;
    label: string;
    description: string;
    treatment: "hard" | "review";
    sort_order: number;
  }>;
  assessment_criteria: Array<{
    criterion_key: string;
    label: string;
    description: string;
    score_category: ScoreCategory;
    weight: number;
    sort_order: number;
    code_anchor?: boolean | null;
  }>;
};

export function mapProfile(config: ConfigData): FundProfile {
  const fund = Array.isArray(config.funds) ? config.funds[0] : config.funds;
  const rawMandate = config.fund_mandates as unknown;
  const mandate = (Array.isArray(rawMandate) ? rawMandate[0] : rawMandate) as
    ConfigData["fund_mandates"][number] | undefined;
  if (!mandate) throw new Error(serverText("analysisServer.common.noMandate"));
  return {
    id: config.profile_key,
    name: fund?.name ?? config.profile_key,
    shortThesis: mandate.thesis.slice(0, 240),
    thesis: mandate.thesis,
    stages: mandate.stages,
    geographies: mandate.geographies,
    sectors: mandate.sectors,
    ticket: {
      minEur: mandate.ticket_min_eur,
      maxEur: mandate.ticket_max_eur,
      note: mandate.ticket_note,
    },
    fundSizeEur: mandate.fund_size_eur == null ? null : Number(mandate.fund_size_eur),
    analysisThreshold: mandate.analysis_threshold,
    approvalMode: mandate.approval_mode,
    riskPosture: mandate.risk_posture,
    screeningInstruction: readScreeningInstruction(mandate.screening_instruction),
    language: fundLanguageOf(config.funds),
    distinctiveLens: [
      `Investeringsmodel: ${mandate.strategy_type ?? "custom"}`,
      ...Object.entries(mandate.stage_expectations ?? {}).map(
        ([stage, text]) => `${stage}: ${text}`,
      ),
      ...(mandate.dealbreakers ?? []).map((item) => `Dealbreaker: ${item}`),
    ],
    gates: [...config.mandate_gates]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        key: item.gate_key,
        label: item.label,
        description: item.description,
        treatment: item.treatment,
      })),
    criteria: [...config.assessment_criteria]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        key: item.criterion_key,
        label: item.label,
        description: item.description,
        category: item.score_category,
        weight: Number(item.weight),
        codeAnchor: item.code_anchor !== false,
      })),
    sources: [],
    version: `config-v${config.version}`,
    researchedAt: new Date().toISOString().slice(0, 10),
  };
}
