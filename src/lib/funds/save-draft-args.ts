/**
 * Argumenterne til RPC'en save_fund_config_draft. Ren fil, så den kan testes med node --test.
 * _set_fund_size skal altid være true: uden flaget lader databasen den gemte fondsstørrelse
 * stå (0026), så en ældre udrulning på den delte database ikke sletter den.
 */
import type { SaveFundConfigInput } from "./config.functions";
import { toStoredSetup } from "./setup-input.ts";

export function saveDraftRpcArgs(data: SaveFundConfigInput) {
  return {
    _config_version_id: data.configId,
    _fund_name: data.fundName,
    _thesis: data.thesis,
    _stages: data.stages,
    _geographies: data.geographies,
    _sectors: data.sectors,
    _ticket_min_eur: data.ticketMinEur,
    _ticket_max_eur: data.ticketMaxEur,
    _ticket_note: data.ticketNote,
    _analysis_threshold: data.analysisThreshold,
    _approval_mode: data.approvalMode,
    _risk_posture: data.riskPosture,
    _strategy_type: data.strategyType,
    _stage_expectations: data.stageExpectations,
    _dealbreakers: data.dealbreakers,
    _gates: data.gates,
    // Altid et eksplicit valg, der svarer til guidens afkrydsning (udeladt = forankret);
    // databasens "behold tidligere valg" er kun til ældre kode på den delte database.
    _criteria: data.criteria.map((criterion) => ({
      ...criterion,
      codeAnchor: criterion.codeAnchor !== false,
    })),
    _fund_size_eur: data.fundSizeEur,
    _set_fund_size: true,
    // Only a save of the whole setup per stage sends it (0134); without it the database
    // replaces only the shared rules and criteria, as every save did.
    ...(data.setup ? { _setup: toStoredSetup(data.setup, data.stages) } : {}),
  };
}
