/**
 * The rows behind a new fund's first setup: version 1 as a draft from a template, never published.
 * Shared by createFund (a fund made in the app) and customer:new (a customer's first fund),
 * so both start from a template in exactly the same way. No I/O; the caller adds the ids.
 */
import type { Language } from "../i18n/language.ts";
import type { FundConfigTemplate } from "./config-templates";
import { stageExpectationKeys, stageKeys } from "./basis-labels.ts";

export function fundDraftRows(
  template: FundConfigTemplate,
  profileKey: string,
  language: Language = "da",
) {
  return {
    config: {
      version: 1,
      profile_key: profileKey,
      status: "draft" as const,
      // i18n-keep: saved in the fund's setup as the fund's own text.
      source_basis:
        language === "en"
          ? `${template.label} template created in Interlect.ai. Requires human review and publishing.`
          : `${template.label}-skabelon oprettet i Interlect.ai. Kræver menneskelig gennemgang og publicering.`,
    },
    mandate: {
      thesis: "",
      // The template names its stages; the setup stores their keys.
      stages: stageKeys(template.stages),
      geographies: [] as string[],
      sectors: template.sectors ?? [],
      ticket_min_eur: null,
      ticket_max_eur: null,
      ticket_note: "",
      analysis_threshold: template.analysisThreshold,
      approval_mode: "partner_approval" as const,
      risk_posture: template.riskPosture,
      strategy_type: template.strategyType,
      stage_expectations: stageExpectationKeys(template.stageExpectations),
      dealbreakers: [] as string[],
    },
    gates: template.gates.map((gate, index) => ({
      gate_key: gate.key,
      label: gate.label,
      description: gate.description,
      treatment: gate.treatment,
      sort_order: index + 1,
    })),
    criteria: template.criteria.map((criterion, index) => ({
      criterion_key: criterion.key,
      label: criterion.label,
      description: criterion.description,
      score_category: criterion.category,
      weight: criterion.weight,
      sort_order: index + 1,
    })),
  };
}
