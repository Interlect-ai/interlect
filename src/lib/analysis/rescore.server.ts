import type { SupabaseClient } from "@supabase/supabase-js";
import { screeningOutputSchema } from "./contracts";
import {
  applyGateAnswers,
  effectiveGateAnswers,
  gateAnswerFromTask,
  type StoredGateAnswer,
} from "./gate-answers";
import type { FinancialScore } from "./financial-score";
import { scoreScreening, SCORING_FORMULA_VERSION } from "./scoring";
import { CONFIG_SELECT, mapProfile, type ConfigData } from "./fund-profile";
import { readSetupStageChoice } from "./setup-stage.ts";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import { caseThesis } from "@/lib/funds/thesis-scope.server";

/**
 * Task-svar → score: koden regner scoren igen på den seneste
 * screenings gemte AI-svar med teamets gate-svar lagt ovenpå. Intet AI-kald. Resultatet
 * gemmes i case_score_recalculations (0034); screeningskørslen selv ændres aldrig.
 */

export { CONFIG_SELECT };

export interface Recalculation {
  runId: string;
  previousScore: number | null;
  overallScore: number | null;
  outcome: string;
}

/**
 * Returns null when there is nothing to recalculate (no finished screening). Throws when the
 * screening's stored answer cannot be read or the result cannot be saved, so the caller reports
 * that the team's answer was not applied.
 */
export async function recalculateScreeningScore(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; taskId: string | null; actorId: string },
): Promise<Recalculation | null> {
  const { data: run, error: runError } = await service
    .from("analysis_runs")
    .select(
      "id, config_version_id, completed_at, raw_response, validation_result, recommendations(overall_score)",
    )
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .eq("kind", "screening")
    .in("status", ["complete", "awaiting_approval"])
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) {
    console.error("[rescore] run", runError.message);
    throw new Error(serverText("analysisServer.rescore.failed"));
  }
  if (!run) return null;

  const parsed = screeningOutputSchema.safeParse(run["raw_response"]);
  if (!parsed.success) {
    console.error(`[rescore] run ${run["id"] as string}: stored answer could not be read`);
    throw new Error(serverText("analysisServer.rescore.screeningNotRead"));
  }

  const [
    { data: config, error: configError },
    { data: caseRow, error: caseError },
    answers,
    { data: last, error: lastError },
  ] = await Promise.all([
    service
      .from("fund_config_versions")
      .select(CONFIG_SELECT)
      .eq("id", run["config_version_id"] as string)
      .eq("fund_id", input.fundId)
      .single(),
    service
      .from("cases")
      .select("companies(stage)")
      .eq("id", input.caseId)
      .eq("fund_id", input.fundId)
      .single(),
    loadGateAnswers(service, input),
    service
      .from("case_score_recalculations")
      .select("overall_score")
      .eq("fund_id", input.fundId)
      .eq("case_id", input.caseId)
      .eq("run_id", run["id"] as string)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (configError || !config || caseError || !caseRow || lastError) {
    console.error(
      "[rescore] load",
      configError?.message ?? caseError?.message ?? lastError?.message ?? "missing row",
    );
    throw new Error(serverText("analysisServer.rescore.failed"));
  }

  const rawCompany = caseRow["companies"] as unknown;
  const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
    stage: string | null;
  } | null;
  const validation = run["validation_result"] as {
    financeScore?: unknown;
    setupStage?: unknown;
  } | null;
  // The same stage's setup as the screening (its criteria are the keys in the stored
  // answer), even if the case's stage changed since.
  const profile = mapProfile(config as unknown as ConfigData, {
    caseStage: company?.stage ?? null,
    runChoice: readSetupStageChoice(validation?.setupStage),
  });
  const financeScore = (validation?.financeScore ?? null) as FinancialScore | null;
  const counted = effectiveGateAnswers(answers, {
    completedAt: run["completed_at"] as string,
    verdicts: new Map(parsed.data.gates.map((gate) => [gate.gateKey, gate.passed])),
    configVersionId: run["config_version_id"] as string,
  });
  const result = scoreScreening(
    profile,
    applyGateAnswers(parsed.data, counted),
    company?.stage ?? "unknown",
    financeScore,
  );

  const rawRecommendation = run["recommendations"] as unknown;
  const recommendation = (
    Array.isArray(rawRecommendation) ? rawRecommendation[0] : rawRecommendation
  ) as { overall_score: number | null } | null;
  const previousScore =
    last?.["overall_score"] != null
      ? Number(last["overall_score"])
      : recommendation?.overall_score != null
        ? Number(recommendation.overall_score)
        : null;

  const { error: insertError } = await service.from("case_score_recalculations").insert({
    fund_id: input.fundId,
    case_id: input.caseId,
    run_id: run["id"],
    task_id: input.taskId,
    previous_score: previousScore,
    overall_score: result.overallScore,
    outcome: result.outcome,
    failed_gate_keys: result.failedHardGateKeys,
    unresolved_gate_keys: result.unresolvedGateKeys,
    formula_version: SCORING_FORMULA_VERSION,
    result,
    created_by: input.actorId,
  });
  if (insertError) {
    console.error("[rescore] insert", insertError.message);
    throw new Error(serverText("analysisServer.rescore.notSaved"));
  }
  return {
    runId: run["id"] as string,
    previousScore,
    overallScore: result.overallScore,
    outcome: result.outcome,
  };
}

/** The case's resolved gate answers (answer_value.gatePassed), oldest first. */
async function loadGateAnswers(
  service: SupabaseClient,
  input: { fundId: string; caseId: string },
): Promise<StoredGateAnswer[]> {
  const { data, error } = await service
    .from("case_tasks")
    .select("linked_key, answer_value, answer_text, answer_evidence_id, resolved_at")
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .eq("linked_kind", "gate")
    .eq("status", "resolved")
    .is("deleted_at", null)
    .order("resolved_at", { ascending: true });
  if (error) {
    console.error("[rescore] gate answers", error.message);
    throw new Error(serverText("analysisServer.rescore.answersNotLoaded"));
  }
  return (data ?? []).flatMap((row) => {
    const answer = gateAnswerFromTask(row, requestLanguage());
    return answer ? [answer] : [];
  });
}

/**
 * The gate's current verdict for the case: the team's answer where it counts against the
 * latest screening (effectiveGateAnswers), else that screening's AI answer (null = unknown or
 * no screening). Used to decide whether an answer overrides a failed requirement, which only
 * Admin and Lead may do (override_mandate_gate). Returns the setup version an answer given now is
 * tied to from the same reads, so the check and the stamp cannot disagree (harden G27). A
 * screening whose stored answer cannot be read counts as "not met", so it can only be lifted
 * with the override right (fail closed, harden G12).
 */
export async function currentGateVerdict(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; gateKey: string },
): Promise<{ verdict: boolean | null; configVersionId: string | null }> {
  const [answers, { data: run, error: runError }] = await Promise.all([
    loadGateAnswers(service, input),
    service
      .from("analysis_runs")
      .select("id, completed_at, raw_response, config_version_id")
      .eq("fund_id", input.fundId)
      .eq("case_id", input.caseId)
      .eq("kind", "screening")
      .in("status", ["complete", "awaiting_approval"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (runError) {
    console.error("[gate-verdict]", runError.message);
    throw new Error(serverText("analysisServer.rescore.verdictNotLoaded"));
  }
  let aiVerdict: boolean | null = null;
  if (run) {
    const parsed = screeningOutputSchema.safeParse(run["raw_response"]);
    if (parsed.success) {
      aiVerdict = parsed.data.gates.find((gate) => gate.gateKey === input.gateKey)?.passed ?? null;
    } else {
      console.error(`[gate-verdict] run ${run["id"] as string}: stored answer could not be read`);
      aiVerdict = false;
    }
  }
  const configVersionId = await answerConfigVersion(service, input, run);
  const counted = effectiveGateAnswers(
    answers.filter((answer) => answer.gateKey === input.gateKey),
    {
      completedAt: (run?.["completed_at"] as string | null) ?? "",
      verdicts: new Map([[input.gateKey, aiVerdict]]),
      configVersionId,
    },
  );
  return { verdict: counted[0]?.passed ?? aiVerdict, configVersionId };
}

/**
 * The setup version a gate answer given now is tied to: the latest finished screening's version,
 * or the fund's active version when the case has not been screened yet (the next screening
 * uses it).
 */
export async function answerConfigVersion(
  service: SupabaseClient,
  input: { fundId: string; caseId: string },
  latestRun?: Record<string, unknown> | null,
): Promise<string | null> {
  let run = latestRun;
  if (run === undefined) {
    const { data, error } = await service
      .from("analysis_runs")
      .select("config_version_id")
      .eq("fund_id", input.fundId)
      .eq("case_id", input.caseId)
      .eq("kind", "screening")
      .in("status", ["complete", "awaiting_approval"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[answer-config]", error.message);
      throw new Error(serverText("analysisServer.rescore.verdictNotLoaded"));
    }
    run = data;
  }
  if (run?.["config_version_id"]) return run["config_version_id"] as string;
  // The active version of the case's own thesis (the one its next screening uses).
  const thesis = await caseThesis(service, input.fundId, input.caseId);
  if (!thesis) return null;
  const { data: active, error: activeError } = await service
    .from("fund_config_versions")
    .select("id")
    .eq("fund_id", input.fundId)
    .eq("thesis_id", thesis.id)
    .eq("status", "active")
    .maybeSingle();
  if (activeError) {
    console.error("[answer-config] active", activeError.message);
    throw new Error(serverText("analysisServer.rescore.verdictNotLoaded"));
  }
  return (active?.["id"] as string | undefined) ?? null;
}

/**
 * The case's resolved gate answers, for a new run (screening or deep analysis). Read before the
 * paid AI call, so a failed read never wastes a run that is already paid for (harden G11); the
 * run applies them with teamAnswersForNewRun once the AI has answered.
 */
export async function loadTeamGateAnswers(
  service: SupabaseClient,
  input: { fundId: string; caseId: string },
): Promise<StoredGateAnswer[]> {
  return loadGateAnswers(service, input);
}
