/**
 * Self-host demo data: ten fictional cases in a fund, so every screen has content from the first
 * sign-in. No AI is called: the results are pre-written (lib/demo-cases.ts), built into the
 * model's answer shapes (lib/demo-build.ts) and saved with the product's own code
 * (analysis-persist.server.ts, scoring, ai-tasks), so a demo case is stored as a real run is.
 *
 *   npm run seed:demo -- --fund <fundId>       (or the installation's only fund)
 *   npm run seed:demo -- --dry-run             (prints the plan, writes nothing)
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment (npm run setup passes
 * them) or from .env.local; never prints a key. Idempotent: every id comes from the fund and a
 * fixed name, rows that exist are left alone, a run whose result is incomplete is written again,
 * and a case is only moved while it stands where the seed left it.
 *
 * Every company, case and person is marked in demo_data_rows (0900), together with the demo
 * analyst: a user without a password who can never sign in and is the author of the demo rows.
 * "Delete demo data" in the app (admins) deletes exactly those rows (delete_demo_data).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { screeningOutputSchema } from "../../src/lib/analysis/contracts.ts";
import { deepAnalysisOutputSchema } from "../../src/lib/analysis/deep.contracts.ts";
import { specialistOutputSchema } from "../../src/lib/analysis/specialist.contracts.ts";
import {
  auditDeepOutput,
  validateReferences,
  validateSpecialistPacket,
} from "../../src/lib/analysis/deep-checks.ts";
import {
  validateConfiguredCoverage,
  validateEvidenceReferences,
} from "../../src/lib/analysis/screening-checks.ts";
import {
  screeningStatuses,
  writeDeepResultRows,
  writeScreeningResultRows,
} from "../../src/lib/analysis/analysis-persist.server.ts";
import { CONFIG_SELECT, mapProfile, type ConfigData } from "../../src/lib/analysis/fund-profile.ts";
import {
  financeScoreAudit,
  scoreScreening,
  SCORING_FORMULA_VERSION,
} from "../../src/lib/analysis/scoring.ts";
import { loadSpecialistSet } from "../../src/lib/analysis/specialist-set.server.ts";
import { specialistSetSummary } from "../../src/lib/analysis/specialist-set.ts";
import { FINANCE_FORMULA_VERSION } from "../../src/lib/analysis/finance.ts";
import { writeAiTasks } from "../../src/lib/cases/ai-tasks.server.ts";
import { deepTaskSource } from "../../src/lib/cases/deep-tasks.ts";
import { MAX_SCREENING_NEXT_STEPS, sanitizeNextSteps } from "../../src/lib/cases/tasks.ts";
import { withLanguage } from "../../src/lib/i18n/language-scope.server.ts";
import type { FundProfile } from "../../src/lib/funds/profiles.ts";
import {
  buildDeepOutput,
  buildScreeningOutput,
  buildSpecialistPackets,
  DEMO_PROMPT_NAME,
  DEMO_WORKFLOW_VERSION,
  demoCompanyName,
  demoIds,
  type BuildContext,
  type DemoIds,
} from "./lib/demo-build.ts";
import { DEMO_CASES, DEMO_PATH_MOVES, hasDeepAnalysis, type DemoCase } from "./lib/demo-cases.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const DRY_RUN = process.argv.includes("--dry-run");
const FUND_ARG = (() => {
  const index = process.argv.indexOf("--fund");
  return index >= 0 ? (process.argv[index + 1] ?? "").trim() : "";
})();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEMO_ANALYST_NAME = "Demo analyst (fictional)";
/** 100 years: the demo analyst exists only as the author of the demo rows. */
const NEVER_SIGNS_IN = "876000h";

type Service = SupabaseClient;

function readEnv(): { url: string; key: string } {
  const env: Record<string, string | undefined> = { ...process.env };
  const local = join(ROOT, ".env.local");
  if ((!env["SUPABASE_URL"] || !env["SUPABASE_SERVICE_ROLE_KEY"]) && existsSync(local)) {
    for (const line of readFileSync(local, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !env[match[1]!]) env[match[1]!] = match[2]!.replace(/^"|"$/g, "");
    }
  }
  const url = env["SUPABASE_URL"];
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (environment or .env.local).",
    );
  }
  return { url, key };
}

async function must<T>(
  label: string,
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function resolveFund(service: Service): Promise<{ id: string; name: string }> {
  if (FUND_ARG) {
    if (!UUID.test(FUND_ARG)) throw new Error(`--fund ${FUND_ARG} is not a fund id`);
    const fund = (await must(
      "fund",
      service.from("funds").select("id, name").eq("id", FUND_ARG).maybeSingle(),
    )) as { id: string; name: string } | null;
    if (!fund) throw new Error(`No fund with id ${FUND_ARG}`);
    return fund;
  }
  const funds = (await must("funds", service.from("funds").select("id, name").limit(2))) as Array<{
    id: string;
    name: string;
  }>;
  if (funds.length !== 1) {
    throw new Error(
      funds.length === 0
        ? "The installation has no fund yet: run npm run setup first."
        : "The installation has several funds: name one with --fund <id>.",
    );
  }
  return funds[0]!;
}

/** The setup the demo is scored with: the active one, else the newest draft (setup's first). */
async function loadSetup(service: Service, fundId: string) {
  const rows = (await must(
    "setup",
    service
      .from("fund_config_versions")
      .select(`${CONFIG_SELECT}, status`)
      .eq("fund_id", fundId)
      .in("status", ["active", "draft"])
      .order("version", { ascending: false }),
  )) as unknown as Array<ConfigData & { status: string }>;
  const config = rows.find((row) => row.status === "active") ?? rows[0];
  if (!config) throw new Error("The fund has no setup yet: run npm run setup first.");
  return { config, profile: mapProfile(config) };
}

async function findAuthUserId(service: Service, email: string): Promise<string | null> {
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`demo analyst lookup: ${error.message}`);
    const hit = data.users.find((user) => user.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
  }
  throw new Error("demo analyst lookup: too many users to search");
}

/** The fictional author of every demo row; never a member, never able to sign in. */
async function ensureDemoAnalyst(service: Service, fundId: string): Promise<string> {
  const email = `demo-analyst-${fundId.slice(0, 8)}@example.com`;
  let userId = await findAuthUserId(service, email);
  if (!userId) {
    const created = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      ban_duration: NEVER_SIGNS_IN,
      user_metadata: { full_name: DEMO_ANALYST_NAME },
    });
    if (created.error || !created.data.user) {
      throw new Error(`demo analyst: ${created.error?.message ?? "not created"}`);
    }
    userId = created.data.user.id;
  }
  await must(
    "demo analyst profile",
    service
      .from("profiles")
      .upsert(
        { id: userId, full_name: DEMO_ANALYST_NAME, email_normalized: email },
        { onConflict: "id" },
      ),
  );
  await mark(service, fundId, "user", [userId]);
  return userId;
}

async function mark(
  service: Service,
  fundId: string,
  entity: "company" | "case" | "person" | "user",
  ids: string[],
) {
  if (!ids.length) return;
  await must(
    `mark ${entity}`,
    service.from("demo_data_rows").upsert(
      ids.map((entityId) => ({ fund_id: fundId, entity, entity_id: entityId })),
      { onConflict: "fund_id,entity,entity_id", ignoreDuplicates: true },
    ),
  );
}

async function seedCaseRows(
  service: Service,
  fundId: string,
  analystId: string,
  item: DemoCase,
  ids: DemoIds,
) {
  // Marked first: a run that stops half-way still leaves rows "Delete demo data" can find.
  await mark(service, fundId, "company", [ids.company]);
  await mark(service, fundId, "case", [ids.case]);
  await mark(
    service,
    fundId,
    "person",
    item.people.map((person) => ids.person(person.key)),
  );
  await must(
    `company ${item.key}`,
    service.from("companies").upsert(
      {
        id: ids.company,
        fund_id: fundId,
        name: demoCompanyName(item),
        website: item.website,
        sector: item.sector,
        geography: item.geography,
        stage: item.stage,
        description: item.description,
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  await must(
    `case ${item.key}`,
    service.from("cases").upsert(
      {
        id: ids.case,
        fund_id: fundId,
        company_id: ids.company,
        primary_origin: "manual",
        created_by: analystId,
        source_note: "Fictional demo case (npm run seed:demo).",
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  await must(
    `people ${item.key}`,
    service.from("people").upsert(
      item.people.map((person) => ({
        id: ids.person(person.key),
        fund_id: fundId,
        full_name: person.name,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  await must(
    `roles ${item.key}`,
    service.from("company_people").upsert(
      item.people.map((person) => ({
        fund_id: fundId,
        company_id: ids.company,
        person_id: ids.person(person.key),
        role_title: person.role,
        is_founder: person.founder,
        is_current: true,
        verification_status: "claimed",
      })),
      { onConflict: "company_id,person_id", ignoreDuplicates: true },
    ),
  );
  await must(
    `evidence ${item.key}`,
    service.from("evidence_items").upsert(
      item.evidence.map((row) => ({
        id: ids.evidence(row.key),
        fund_id: fundId,
        case_id: ids.case,
        claim: row.claim,
        value_text: row.value,
        stated_by: row.statedBy,
        excerpt: row.excerpt ?? null,
        status: row.status,
        confidence: row.status === "verified" ? 0.9 : row.status === "corroborated" ? 0.75 : 0.6,
        observation_date: row.observed,
        created_by: analystId,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  if (item.notes.length) {
    await must(
      `notes ${item.key}`,
      service.from("case_notes").upsert(
        item.notes.map((body, index) => ({
          id: ids.note(index),
          fund_id: fundId,
          case_id: ids.case,
          author_id: analystId,
          body,
        })),
        { onConflict: "id", ignoreDuplicates: true },
      ),
    );
  }
}

/** True when the run's result rows are all there (the recommendation is written last). */
async function runComplete(service: Service, fundId: string, runId: string): Promise<boolean> {
  const row = await must(
    "recommendation",
    service
      .from("recommendations")
      .select("id")
      .eq("fund_id", fundId)
      .eq("run_id", runId)
      .maybeSingle(),
  );
  return row !== null;
}

/** Removes what an interrupted earlier seed left of a run's result, so it is written once. */
async function clearPartial(service: Service, fundId: string, runId: string) {
  for (const table of ["category_scores", "risks", "analysis_findings", "calculation_results"]) {
    await must(
      `clear ${table}`,
      service.from(table).delete().eq("fund_id", fundId).eq("run_id", runId),
    );
  }
}

async function recordCaseResult(
  service: Service,
  input: {
    fundId: string;
    caseId: string;
    runId: string;
    executionStatus: string;
    previous: string;
    recommendation: string;
    reason: string;
    evidenceIds: string[];
  },
) {
  // Recorded once: a rerun never overwrites what the team did with the case since.
  const existing = await must(
    "case history",
    service
      .from("case_transition_events")
      .select("id")
      .eq("fund_id", input.fundId)
      .eq("analysis_run_id", input.runId)
      .eq("field", "execution_status")
      .limit(1),
  );
  if ((existing as unknown[]).length) return;
  await must(
    "case status",
    service
      .from("cases")
      .update({
        execution_status: input.executionStatus,
        pap_recommendation: input.recommendation,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.caseId)
      .eq("fund_id", input.fundId),
  );
  await must(
    "case history",
    service.from("case_transition_events").insert({
      fund_id: input.fundId,
      case_id: input.caseId,
      field: "execution_status",
      actor_type: "pap",
      actor_id: input.runId,
      previous_value: input.previous,
      new_value: input.executionStatus,
      reason: input.reason,
      analysis_run_id: input.runId,
      evidence_ids: input.evidenceIds,
    }),
  );
}

async function upsertSteps(
  service: Service,
  fundId: string,
  runId: string,
  steps: Array<{ key: string; output?: unknown }>,
  completedAt: string,
) {
  await must(
    "run steps",
    service.from("analysis_run_steps").upsert(
      steps.map((step, index) => ({
        fund_id: fundId,
        run_id: runId,
        step_key: step.key,
        step_order: index + 1,
        status: "complete",
        prompt_version: DEMO_PROMPT_NAME,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        actual_cost: 0,
        output_json: step.output ?? null,
        started_at: completedAt,
        completed_at: completedAt,
      })),
      { onConflict: "run_id,step_key", ignoreDuplicates: true },
    ),
  );
}

async function seedScreening(
  service: Service,
  input: {
    fundId: string;
    analystId: string;
    configId: string;
    profile: FundProfile;
    item: DemoCase;
    ids: DemoIds;
  },
) {
  const { fundId, analystId, configId, profile, item, ids } = input;
  const ctx: BuildContext = { caseId: ids.case, profile, ids };
  const evidenceIds = item.evidence.map((row) => ids.evidence(row.key));
  const output = screeningOutputSchema.parse(buildScreeningOutput(item, ctx));
  validateConfiguredCoverage(output, profile);
  validateEvidenceReferences(output, new Set(evidenceIds));
  const result = scoreScreening(profile, output, item.stage);
  const { runStatus, caseStatus } = screeningStatuses(result);
  const runId = ids.screeningRun;
  const completedAt = new Date().toISOString();
  await must(
    `screening ${item.key}`,
    service.from("analysis_runs").upsert(
      {
        id: runId,
        fund_id: fundId,
        case_id: ids.case,
        config_version_id: configId,
        kind: "screening",
        status: runStatus,
        workflow_version: DEMO_WORKFLOW_VERSION,
        prompt_template_name: DEMO_PROMPT_NAME,
        prompt_template_version: "1",
        requested_by: analystId,
        input_evidence_ids: evidenceIds,
        raw_response: output,
        validation_result: {
          ok: true,
          formulaVersion: SCORING_FORMULA_VERSION,
          outcome: result.outcome,
          fundMemory: "off",
          teamGateAnswers: [],
          blockers: result.blockers,
          financeScore: financeScoreAudit(null, result),
          costCurrency: "USD",
          demo: true,
        },
        token_usage: 0,
        input_tokens: 0,
        output_tokens: 0,
        actual_cost: 0,
        completed_at: completedAt,
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  if (!(await runComplete(service, fundId, runId))) {
    await clearPartial(service, fundId, runId);
    await writeScreeningResultRows(service, { fundId, runId, profile, output, result });
  }
  await upsertSteps(
    service,
    fundId,
    runId,
    [{ key: "screening_research" }, { key: "fund_screening", output }],
    completedAt,
  );
  await recordCaseResult(service, {
    fundId,
    caseId: ids.case,
    runId,
    executionStatus: caseStatus,
    previous: "queued",
    recommendation: result.recommendation,
    reason: "Fictional demo screening (npm run seed:demo).",
    evidenceIds,
  });
  await writeAiTasks(service, {
    fundId,
    caseId: ids.case,
    runId,
    runKind: "screening",
    createdBy: analystId,
    source: {
      language: "en",
      configVersionId: configId,
      gates: profile.gates,
      criteria: profile.criteria,
      unresolvedGateKeys: result.unresolvedGateKeys,
      missingCriterionKeys: result.missingCriterionKeys,
      assessments: output.assessments,
      openQuestions: output.openQuestions,
      nextSteps: sanitizeNextSteps(
        output.nextSteps ?? [],
        {
          gates: profile.gates.map((gate) => gate.key),
          criteria: profile.criteria.map((criterion) => criterion.key),
        },
        MAX_SCREENING_NEXT_STEPS,
      ),
    },
  });
  return result;
}

async function seedDeep(
  service: Service,
  input: {
    fundId: string;
    analystId: string;
    configId: string;
    profile: FundProfile;
    item: DemoCase;
    ids: DemoIds;
    specialists: Awaited<ReturnType<typeof loadSpecialistSet>>["set"];
  },
) {
  const { fundId, analystId, configId, profile, item, ids, specialists } = input;
  const ctx: BuildContext = { caseId: ids.case, profile, ids };
  const evidenceIds = item.evidence.map((row) => ids.evidence(row.key));
  const allowed = new Set(evidenceIds);
  const packets = buildSpecialistPackets(item, ctx, specialists).map((packet, index) => {
    const parsed = specialistOutputSchema.parse(packet);
    validateSpecialistPacket(parsed, specialists[index]!, profile, ids.case, allowed);
    return parsed;
  });
  const output = deepAnalysisOutputSchema.parse(buildDeepOutput(item, ctx, packets));
  validateReferences(output, allowed);
  const qualityAudit = auditDeepOutput(output, profile);
  if (qualityAudit.blockingErrors.length) {
    throw new Error(`${item.key}: ${qualityAudit.blockingErrors.join(" ")}`);
  }
  const result = scoreScreening(
    profile,
    { ...output, schemaVersion: "interlect-screening-v1" },
    item.stage,
  );
  const runId = ids.deepRun;
  const completedAt = new Date().toISOString();
  await must(
    `deep analysis ${item.key}`,
    service.from("analysis_runs").upsert(
      {
        id: runId,
        fund_id: fundId,
        case_id: ids.case,
        config_version_id: configId,
        previous_run_id: ids.screeningRun,
        kind: "deep",
        status: "complete",
        workflow_version: DEMO_WORKFLOW_VERSION,
        prompt_template_name: DEMO_PROMPT_NAME,
        prompt_template_version: "1",
        requested_by: analystId,
        input_evidence_ids: evidenceIds,
        raw_response: {
          schemaVersion: "interlect-deep-orchestrated-v1",
          publicResearch: null,
          specialists: packets,
          specialistSet: specialistSetSummary(specialists),
          synthesis: output,
        },
        validation_result: {
          ok: true,
          formulaVersion: SCORING_FORMULA_VERSION,
          teamGateAnswers: [],
          financeScore: financeScoreAudit(null, result),
          financeFormulaVersion: FINANCE_FORMULA_VERSION,
          fundMemory: "off",
          blockers: result.blockers,
          qualityAudit,
          executionMode: "durable-phases-v1",
          costCurrency: "USD",
          demo: true,
        },
        token_usage: 0,
        input_tokens: 0,
        output_tokens: 0,
        actual_cost: 0,
        completed_at: completedAt,
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  if (!(await runComplete(service, fundId, runId))) {
    await writeDeepResultRows(service, { fundId, caseId: ids.case, runId, output, result });
  }
  await upsertSteps(
    service,
    fundId,
    runId,
    [
      { key: "public_research" },
      ...packets.map((packet) => ({ key: packet.moduleId, output: packet })),
      { key: "synthesis", output },
    ],
    completedAt,
  );
  await recordCaseResult(service, {
    fundId,
    caseId: ids.case,
    runId,
    executionStatus: "complete",
    previous: "deep_analysis_in_progress",
    recommendation: result.recommendation,
    reason: "Fictional demo deep analysis (npm run seed:demo).",
    evidenceIds,
  });
  await writeAiTasks(service, {
    fundId,
    caseId: ids.case,
    runId,
    runKind: "deep",
    createdBy: analystId,
    source: deepTaskSource({
      configVersionId: configId,
      profile: { ...profile, language: "en" },
      modules: specialists,
      unresolvedGateKeys: result.unresolvedGateKeys,
      missingCriterionKeys: result.missingCriterionKeys,
      output,
      specialists: packets,
    }),
  });
}

/** Moves the case along its path through transition_case, step by step (idempotent). */
async function moveCase(
  service: Service,
  fundId: string,
  analystId: string,
  item: DemoCase,
  ids: DemoIds,
  steps: (typeof DEMO_PATH_MOVES)[keyof typeof DEMO_PATH_MOVES],
  reasonCodes: Array<{ code: string; applies_to: string[] }>,
) {
  for (const step of steps) {
    const current = (await must(
      `case state ${item.key}`,
      service.from("cases").select("phase, status").eq("id", ids.case).single(),
    )) as { phase: string; status: string };
    if (current.phase !== step.from || current.status !== "active") continue;
    const code = step.reason
      ? reasonCodes.find((row) => row.applies_to.includes(step.reason!) && row.code !== "other")
          ?.code
      : undefined;
    if (step.reason && !code) throw new Error(`No reason code for ${step.reason}`);
    await must(
      `move ${item.key}`,
      service.rpc("transition_case", {
        _fund_id: fundId,
        _case_id: ids.case,
        _actor_id: analystId,
        _to_phase: step.toPhase,
        _to_status: step.toStatus,
        _reason_codes: code ? [code] : [],
        _note: step.reason
          ? (item.decision ?? "Fictional demo decision.")
          : "Moved on (fictional demo).",
        _expected_phase: step.from,
        _expected_status: "active",
        // The seed moves the case, not a person: the demo analyst is in no team, and the
        // database's role check applies to people only (transition_case, 0033/0039).
        _actor_type: "system",
      }),
    );
  }
}

async function main() {
  const plan = {
    cases: DEMO_CASES.length,
    deepAnalyses: DEMO_CASES.filter(hasDeepAnalysis).length,
    paths: Object.fromEntries(
      Object.keys(DEMO_PATH_MOVES).map((path) => [
        path,
        DEMO_CASES.filter((item) => item.path === path).map((item) => item.name),
      ]),
    ),
  };
  console.log("Demo data (fictional):", JSON.stringify(plan));
  if (DRY_RUN) {
    console.log("Dry run: nothing written.");
    return;
  }
  const { url, key } = readEnv();
  const service = createClient(url, key, { auth: { persistSession: false } });
  const fund = await resolveFund(service);
  const { config, profile } = await loadSetup(service, fund.id);
  const { set: specialists } = await loadSpecialistSet(service, config.id);
  const reasonCodes = (await must(
    "reason codes",
    service
      .from("brain_reason_codes")
      .select("code, applies_to")
      .eq("fund_id", fund.id)
      .eq("is_active", true)
      .order("sort_order"),
  )) as Array<{ code: string; applies_to: string[] }>;
  const analystId = await ensureDemoAnalyst(service, fund.id);

  for (const item of DEMO_CASES) {
    const ids = demoIds(fund.id, item);
    await seedCaseRows(service, fund.id, analystId, item, ids);
    await seedScreening(service, {
      fundId: fund.id,
      analystId,
      configId: config.id,
      profile,
      item,
      ids,
    });
    const moves = DEMO_PATH_MOVES[item.path];
    // A deep analysis is run once the case is in deep analysis, before it moves on.
    const intoDeep = moves.findIndex((step) => step.toPhase === "deep_analysis");
    await moveCase(
      service,
      fund.id,
      analystId,
      item,
      ids,
      intoDeep >= 0 ? moves.slice(0, intoDeep + 1) : moves,
      reasonCodes,
    );
    if (hasDeepAnalysis(item)) {
      await seedDeep(service, {
        fundId: fund.id,
        analystId,
        configId: config.id,
        profile,
        item,
        ids,
        specialists,
      });
      await moveCase(
        service,
        fund.id,
        analystId,
        item,
        ids,
        moves.slice(intoDeep + 1),
        reasonCodes,
      );
    }
    console.log(`  ${demoCompanyName(item)}: ${item.path}`);
  }
  console.log(
    `Done: ${DEMO_CASES.length} fictional cases in "${fund.name}". Admins can remove them with "Delete demo data" in the app.`,
  );
}

withLanguage("en", main).catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
