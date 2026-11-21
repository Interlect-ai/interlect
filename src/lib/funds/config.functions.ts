import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "@vercel/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { redactOverrides } from "./override-redaction";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { hasCapability, type Capability } from "@/lib/domain/workflow";
import { isFundMemoryEnabled } from "@/lib/analysis/gateway-security";
import { writeHistoricalMemoryEntry } from "@/lib/analysis/memory";
import type { FundStrategyType } from "@/lib/funds/config-templates";
import { saveDraftRpcArgs } from "./save-draft-args";
import { fundConfigErrorText, saveInputIssueText } from "./db-errors";
import { checkConfigLimits, limitViolationsMessage, type LimitViolation } from "./config-limits";
import type { DraftFields } from "./config-ops";
import {
  readScreeningCards,
  readScreeningInstruction,
  type ScreeningCardId,
} from "./screening-setup";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import type { MessageKey } from "@/lib/i18n/translate";
import { chosenThesis } from "@/lib/funds/thesis-scope.server";
import { isSetupStage, type SetupStage } from "@/lib/analysis/setup-stage";
import {
  hasSetup,
  readStoredSetup,
  setupInputSchema,
  setupStageSchema,
  type SetupInput,
} from "./setup-input";
import type { ThesisStatus } from "@/lib/funds/theses";

const fundIdSchema = z.guid();
export const scoreCategorySchema = z.enum([
  "fund_thesis_fit",
  "founder_market_fit",
  "team_market_fit",
  "product_market_fit",
  "product_technology",
  "market_timing",
  "traction_gtm",
  "financial_strength",
  "evidence_quality",
]);
const gateSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().max(160),
  description: z.string().trim().max(1000),
  treatment: z.enum(["hard", "review"]),
  /** The stage the rule belongs to; left out (or null) = shared by every stage. */
  stage: setupStageSchema.nullable().optional(),
});
const criterionSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().max(160),
  description: z.string().trim().max(1000),
  category: scoreCategorySchema,
  weight: z.number().positive().max(100),
  /** Kun financial_strength: om kriteriet scores fra regnskaberne (0028). */
  codeAnchor: z.boolean().optional(),
  /** The stage the criterion belongs to; left out (or null) = shared by every stage. */
  stage: setupStageSchema.nullable().optional(),
});

export interface EditableFundConfig {
  id: string;
  fundId: string;
  fundName: string;
  profileKey: string;
  version: number;
  status: "draft" | "active" | "superseded";
  canEdit: boolean;
  /** Hele fonden kan kun slettes af en administrator (ikke partnere). */
  canDelete: boolean;
  strategyType: FundStrategyType;
  thesis: string;
  stages: string[];
  geographies: string[];
  sectors: string[];
  /** E2b: fondens samlede størrelse i EUR (valgfri). */
  fundSizeEur: number | null;
  ticketMinEur: number | null;
  ticketMaxEur: number | null;
  ticketNote: string;
  analysisThreshold: number;
  approvalMode: "partner_approval" | "automatic";
  riskPosture: string;
  stageExpectations: Record<string, string>;
  dealbreakers: string[];
  gates: Array<z.infer<typeof gateSchema>>;
  criteria: Array<z.infer<typeof criterionSchema>>;
  /** Fondens egne tilpasninger af specialistmodulernes AI-instruktioner, hvis nogen. */
  moduleOverrides: Record<
    string,
    { mandate: string[]; evidenceTests: string[]; riskAreas: string[] }
  >;
  /** Fondens egne tilpasninger af research-modulernes spørgsmål, nøglet
   * `${mode}:${moduleId}`, hvis nogen. */
  researchModuleOverrides: Record<string, { questions: string[] }>;
  /** Fondens "sådan screener vi"-instruktion til screeningsprompten (tom = ingen). */
  screeningInstruction: string;
  /** De ekstra screeningskort, fonden har valgt (de tre faste vises altid). */
  screeningCards: ScreeningCardId[];
  /**
   * The version has anything per stage (a row with a stage or a filled `setup`). Such a
   * version is saved whole (with `setup`); an old version is read and saved exactly as before.
   */
  perStage: boolean;
  /** `fund_mandates.setup` in the editor's shape (`{}` for an old version). */
  setup: SetupInput;
  /** The stages' own module texts (`moduleOverrides` holds the shared ones). */
  stageModuleOverrides: Partial<
    Record<
      SetupStage,
      Record<string, { mandate: string[]; evidenceTests: string[]; riskAreas: string[] }>
    >
  >;
}

type MandateRow = {
  strategy_type: FundStrategyType;
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
  stage_expectations: Record<string, string> | null;
  dealbreakers: string[] | null;
  /** 0078; absent where a query does not select it. */
  screening_instruction?: string | null;
  screening_cards?: string[] | null;
  /** 0133; absent where a query does not select it. */
  setup?: unknown;
};

type ConfigRow = {
  id: string;
  fund_id: string;
  profile_key: string;
  version: number;
  status: "draft" | "active" | "superseded";
  funds: { name: string } | { name: string }[];
  fund_mandates: MandateRow | MandateRow[] | null;
  mandate_gates: Array<{
    stage?: string | null;
    gate_key: string;
    label: string;
    description: string;
    treatment: "hard" | "review";
    sort_order: number;
  }>;
  assessment_criteria: Array<{
    stage?: string | null;
    criterion_key: string;
    label: string;
    description: string;
    score_category: z.infer<typeof scoreCategorySchema>;
    weight: number;
    sort_order: number;
    code_anchor: boolean | null;
  }>;
  prompt_module_overrides: Array<{
    stage?: string | null;
    module_id: string;
    mandate: string[];
    evidence_tests: string[];
    risk_areas: string[];
  }>;
  research_module_overrides: Array<{
    mode: string;
    module_id: string;
    questions: string[];
  }>;
};

const CONFIG_COLUMNS = `
        id, fund_id, profile_key, version, status,
        funds(name),
        fund_mandates(thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur, ticket_max_eur,
          ticket_note, analysis_threshold, approval_mode, risk_posture, strategy_type, stage_expectations, dealbreakers,
          screening_instruction, screening_cards, setup),
        mandate_gates(stage, gate_key, label, description, treatment, sort_order),
        assessment_criteria(stage, criterion_key, label, description, score_category, weight, sort_order, code_anchor),
        prompt_module_overrides(stage, module_id, mandate, evidence_tests, risk_areas),
        research_module_overrides(mode, module_id, questions)
      `;

/** The setup pages read one thesis: the chosen one, else the team's default thesis. */
const thesisScopeSchema = z.object({ fundId: fundIdSchema, thesisId: z.guid().optional() });

export const getFundConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => thesisScopeSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      /** The thesis the versions belong to. */
      thesis: { id: string; name: string; status: ThesisStatus };
      active: EditableFundConfig | null;
      draft: EditableFundConfig | null;
      /** E6: den seneste tidligere publicerede version (til "Ændret siden vN"). */
      previous: EditableFundConfig | null;
    }> => {
      // The current versions, the previous one and the access are asked for at the same time
      // ("Fortsæt kladde" waited for three round trips in a row).
      const { loadAccessForFund } = await import("@/lib/auth/access.server");
      const thesis = await chosenThesis(context.supabase, data.fundId, data.thesisId);
      if (!thesis) throw new Error(serverText("fundServer.config.noSetup"));
      const [{ data: rows, error }, { data: previousRows, error: previousError }, accessResult] =
        await Promise.all([
          context.supabase
            .from("fund_config_versions")
            .select(CONFIG_COLUMNS)
            .eq("fund_id", data.fundId)
            .eq("thesis_id", thesis.id)
            .in("status", ["active", "draft"])
            .order("version", { ascending: false }),
          context.supabase
            .from("fund_config_versions")
            .select(CONFIG_COLUMNS)
            .eq("fund_id", data.fundId)
            .eq("thesis_id", thesis.id)
            .eq("status", "superseded")
            .order("version", { ascending: false })
            .limit(1),
          loadAccessForFund(context.supabase, context.userId, data.fundId).then(
            (value) => ({ ok: true as const, value }),
            (reason: unknown) => ({ ok: false as const, reason }),
          ),
        ]);
      if (error) throw new Error(serverText("fundServer.common.setupNotLoaded"));

      const configs = (rows ?? []) as unknown as ConfigRow[];
      // Sammenligningen er en bekvemmelighed; en fejl her må ikke vælte siden.
      if (previousError)
        console.warn("[fund-config] previous version unavailable", previousError.message);
      const previousRow = previousError
        ? null
        : ((previousRows ?? [])[0] as unknown as ConfigRow | undefined);
      const activeRow = configs.find((row) => row.status === "active") ?? null;
      const anyRow = activeRow ?? configs[0];
      if (!anyRow) throw new Error(serverText("fundServer.config.noSetup"));
      if (!accessResult.ok) throw accessResult.reason;
      const access = accessResult.value;
      const canEdit = access
        ? hasCapability(access.roles, "configure_fund", access.settings)
        : false;
      const canDelete = access
        ? hasCapability(access.roles, "manage_users", access.settings)
        : false;
      // 0104: the database gives the override rows only to who configures the fund. The others
      // still see which modules are customised (empty texts, see redactOverrides), so the keys are
      // read with the service role for the versions they were just given.
      if (!canEdit)
        await fillOverrideKeys([anyRow, ...configs, ...(previousRow ? [previousRow] : [])]);
      // M1: the override texts are prompt text; only configure_fund holders may read them.
      const shown = (row: ConfigRow, edit: boolean) =>
        redactOverrides(mapConfig(row, edit, canDelete), canEdit);
      const draftRow = configs.find((row) => row.status === "draft");
      return {
        thesis: { id: thesis.id, name: thesis.name, status: thesis.status },
        active: activeRow ? shown(activeRow, canEdit) : null,
        previous: previousRow ? shown(previousRow, false) : null,
        draft: draftRow ? shown(draftRow, canEdit) : null,
      };
    },
  );

export interface FundConfigVersionEntry {
  id: string;
  version: number;
  status: "active" | "draft" | "archived" | string;
  sourceBasis: string;
  activatedAt: string | null;
  createdAt: string;
  /**
   * An earlier version can be restored as a new draft (Admin/Lead, the thesis is not
   * archived, and the thesis has no draft already: a restore never overwrites one).
   */
  canRestore: boolean;
}

/** Hele versionshistorikken for tesen (den valgte, ellers standardtesen) — vises på /fond. */
export const listFundConfigVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => thesisScopeSchema.parse(input))
  .handler(async ({ data, context }): Promise<FundConfigVersionEntry[]> => {
    const thesis = await chosenThesis(context.supabase, data.fundId, data.thesisId);
    if (!thesis) return [];
    const { data: rows, error } = await context.supabase
      .from("fund_config_versions")
      .select("id, version, status, source_basis, activated_at, created_at")
      .eq("fund_id", data.fundId)
      .eq("thesis_id", thesis.id)
      .order("version", { ascending: false })
      .limit(20);
    if (error) throw new Error(serverText("fundServer.config.versionsNotLoaded"));
    const hasDraft = (rows ?? []).some((row) => row.status === "draft");
    // The button is only a shortcut; the database checks the same again (0129).
    const { loadAccessForFund } = await import("@/lib/auth/access.server");
    const access =
      hasDraft || thesis.status === "archived"
        ? null
        : await loadAccessForFund(context.supabase, context.userId, data.fundId).catch(
            (cause: unknown) => {
              // Only the "Gendan" button is hidden; the list itself still shows.
              console.warn(
                "[fund-config] access for restore not loaded",
                cause instanceof Error ? cause.message : cause,
              );
              return null;
            },
          );
    const mayRestore = access
      ? hasCapability(access.roles, "configure_fund", access.settings)
      : false;
    return (rows ?? []).map((row) => ({
      id: row.id as string,
      version: Number(row.version),
      status: row.status as string,
      sourceBasis: (row.source_basis as string) ?? "",
      activatedAt: row.activated_at as string | null,
      createdAt: row.created_at as string,
      canRestore: mayRestore && row.status === "superseded",
    }));
  });

// i18n-keep: the database's own messages (0129), matched to recognise them; never shown.
const RESTORE_REFUSALS: Readonly<Record<string, MessageKey>> = {
  "Versionen blev ikke fundet.": "fundServer.common.versionNotFoundProfile",
  "Der er allerede en kladde. Udgiv eller slet den, før en ældre version gendannes.":
    "fundServer.config.restoreDraftExists",
  "Tesen er arkiveret. Genaktivér den for at redigere.": "fundServer.config.restoreArchived",
};

/**
 * (TS-21): "Gendan" an earlier version. It never changes or deletes a version: the
 * database copies the old version's content into a NEW draft with the next number, so the history
 * only grows. The draft is published as any other draft.
 */
export const restoreFundConfigVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ configId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    const config = await requireConfigAdmin(context.supabase, context.userId, data.configId);
    const { data: draftId, error } = await context.supabase.rpc("restore_fund_config_version", {
      _source_config_id: config.id,
    });
    if (error || !draftId) {
      const known = error?.code === "P0001" ? RESTORE_REFUSALS[error.message] : undefined;
      if (known) throw new Error(serverText(known));
      if (error?.code === "P0001")
        throw new Error(
          fundConfigErrorText(error, serverText("fundServer.config.restoreFailed"), {
            language: requestLanguage(),
          }),
        );
      console.error("[restore_fund_config_version]", error?.code, error?.message);
      throw new Error(serverText("fundServer.config.restoreFailed"));
    }
    return { draftId: String(draftId) };
  });

export const createFundConfigDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ activeConfigId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    const config = await requireConfigAdmin(context.supabase, context.userId, data.activeConfigId);
    const { data: draftId, error } = await context.supabase.rpc("create_fund_config_draft", {
      _source_config_id: config.id,
    });
    if (error || !draftId) {
      if (error?.code === "P0001") throw new Error(error.message);
      console.error("[create_fund_config_draft]", error);
      throw new Error(serverText("fundServer.config.draftNotCreated"));
    }
    return { draftId: String(draftId) };
  });

const saveInputSchema = z.object({
  configId: z.guid(),
  fundName: z.string().trim().min(1).max(160),
  strategyType: z.enum(["venture", "growth", "thematic", "custom"]),
  thesis: z.string().trim().max(5000),
  stages: z.array(z.string().trim().min(1).max(80)),
  geographies: z.array(z.string().trim().min(1).max(120)),
  sectors: z.array(z.string().trim().min(1).max(120)),
  fundSizeEur: z.number().positive().finite().nullable(),
  ticketMinEur: z.number().nonnegative().nullable(),
  ticketMaxEur: z.number().nonnegative().nullable(),
  ticketNote: z.string().max(1000),
  analysisThreshold: z.number().min(0).max(100),
  approvalMode: z.enum(["partner_approval", "automatic"]),
  riskPosture: z.string().trim().max(3000),
  stageExpectations: z.record(z.string(), z.string().max(2000)),
  dealbreakers: z.array(z.string().trim().min(1).max(500)),
  gates: z.array(gateSchema),
  criteria: z.array(criterionSchema),
  /**
   * The whole setup per stage. Given, the save replaces every rule and criterion (each with
   * its own stage) and `fund_mandates.setup`; left out (every editor from), only the
   * shared rules and criteria are replaced and the rows per stage stay (0134).
   */
  setup: setupInputSchema.optional(),
});

export type SaveFundConfigInput = z.infer<typeof saveInputSchema>;

export const saveFundConfigDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    // The person sees one Danish sentence about the field, never zod's raw report.
    const parsed = saveInputSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(saveInputIssueText(parsed.error.issues[0], requestLanguage()));
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    await requireConfigAdmin(context.supabase, context.userId, data.configId, "draft");
    // A row per stage belongs to the whole setup: saved alone, the database would refuse it (0134).
    if (!data.setup && [...data.gates, ...data.criteria].some((item) => item.stage))
      throw new Error(serverText("fundServer.config.stagesNeedSetup"));
    const { error } = await context.supabase.rpc("save_fund_config_draft", saveDraftRpcArgs(data));
    if (error) {
      if (error.code !== "P0001")
        console.error("[save_fund_config_draft]", error.code, error.message);
      throw new Error(
        fundConfigErrorText(error, serverText("fundServer.config.draftNotSaved"), {
          language: requestLanguage(),
        }),
      );
    }
    return { ok: true as const };
  });

export const publishFundConfigDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ configId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Udgivelse: Admin og Lead, Medlem kun med "Medlem må udgive fondsopsætning" (0032).
    await requireConfigAdmin(
      context.supabase,
      context.userId,
      data.configId,
      "draft",
      "publish_fund_config",
    );
    // De faste grænser: serveren afviser med en klar besked, og databasen håndhæver
    // vægtgrænserne igen ved skiftet til aktiv (0051).
    const violations = checkConfigLimits(
      await loadDraftFields(context.supabase, data.configId),
      requestLanguage(),
    );
    if (violations.length > 0) throw new Error(limitViolationsMessage(violations));
    const { error } = await context.supabase.rpc("activate_fund_config", {
      _config_version_id: data.configId,
    });
    if (error) {
      if (error.code !== "P0001")
        console.error("[activate_fund_config]", error.code, error.message);
      throw new Error(
        fundConfigErrorText(error, serverText("fundServer.config.draftNotPublished"), {
          duplicateNames: false,
          language: requestLanguage(),
        }),
      );
    }
    return { ok: true as const };
  });

/** What would stop a publish of the draft, for the editor to show live (Admin, Lead and Medlem may read). */
export const validateFundConfigDraft = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ configId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ violations: LimitViolation[] }> => {
    const { data: row } = await context.supabase
      .from("fund_config_versions")
      .select("fund_id, status")
      .eq("id", data.configId)
      .maybeSingle();
    if (!row) throw new Error(serverText("fundServer.common.versionNotFoundProfile"));
    await requireFundCapability(
      context.supabase,
      context.userId,
      row["fund_id"] as string,
      "view_case",
    );
    return {
      violations: checkConfigLimits(
        await loadDraftFields(context.supabase, data.configId),
        requestLanguage(),
      ),
    };
  });

/** One version's fields in the shape the editor saves (server side, with the caller's own client). */
export async function loadDraftFields(
  supabase: SupabaseClient,
  configId: string,
): Promise<DraftFields> {
  const { data: row, error } = await supabase
    .from("fund_config_versions")
    .select(CONFIG_COLUMNS)
    .eq("id", configId)
    .maybeSingle();
  if (error || !row) throw new Error(serverText("fundServer.config.versionNotLoaded"));
  return toDraftFields(mapConfig(row as unknown as ConfigRow, false, false));
}

export function toDraftFields(config: EditableFundConfig): DraftFields {
  return {
    fundName: config.fundName,
    strategyType: config.strategyType,
    thesis: config.thesis,
    stages: config.stages,
    geographies: config.geographies,
    sectors: config.sectors,
    fundSizeEur: config.fundSizeEur,
    ticketMinEur: config.ticketMinEur,
    ticketMaxEur: config.ticketMaxEur,
    ticketNote: config.ticketNote,
    analysisThreshold: config.analysisThreshold,
    approvalMode: config.approvalMode,
    riskPosture: config.riskPosture,
    stageExpectations: config.stageExpectations,
    dealbreakers: config.dealbreakers,
    gates: config.gates,
    criteria: config.criteria,
    screeningInstruction: config.screeningInstruction,
    screeningCards: config.screeningCards,
    // Only a version with anything per stage carries its setup, so an old draft (and the
    // fingerprints of the proposals made on it) reads exactly as before, and saves as before.
    ...(config.perStage ? { setup: config.setup } : {}),
  };
}

async function requireConfigAdmin(
  supabase: SupabaseClient,
  userId: string,
  configId: string,
  expectedStatus?: "draft" | "active",
  capability: Capability = "configure_fund",
): Promise<{ id: string; fundId: string }> {
  const query = supabase
    .from("fund_config_versions")
    .select("id, fund_id, status")
    .eq("id", configId);
  const { data } = await query.maybeSingle();
  if (!data || (expectedStatus && data["status"] !== expectedStatus)) {
    throw new Error(serverText("fundServer.common.versionNotFoundProfile"));
  }
  const { requireFundCapability } = await import("@/lib/auth/access.server");
  await requireFundCapability(supabase, userId, data["fund_id"] as string, capability);
  return { id: data["id"] as string, fundId: data["fund_id"] as string };
}

function mapConfig(row: ConfigRow, canEdit: boolean, canDelete: boolean): EditableFundConfig {
  const fund = Array.isArray(row.funds) ? row.funds[0] : row.funds;
  // PostgREST returnerer en indlejret 1:1-relation som objekt, ikke array.
  const mandate: MandateRow = (Array.isArray(row.fund_mandates)
    ? row.fund_mandates[0]
    : row.fund_mandates) ?? {
    thesis: "",
    stages: [],
    geographies: [],
    sectors: [],
    fund_size_eur: null,
    ticket_min_eur: null,
    ticket_max_eur: null,
    ticket_note: "",
    analysis_threshold: 75,
    approval_mode: "partner_approval",
    risk_posture: "",
    strategy_type: "custom",
    stage_expectations: {},
    dealbreakers: [],
  };
  const setup = readStoredSetup(mandate.setup);
  return {
    id: row.id,
    fundId: row.fund_id,
    fundName: fund?.name ?? "",
    profileKey: row.profile_key,
    version: row.version,
    status: row.status,
    canEdit,
    canDelete,
    strategyType: mandate.strategy_type ?? "custom",
    thesis: mandate.thesis,
    stages: mandate.stages,
    geographies: mandate.geographies,
    sectors: mandate.sectors,
    fundSizeEur: mandate.fund_size_eur == null ? null : Number(mandate.fund_size_eur),
    ticketMinEur: mandate.ticket_min_eur,
    ticketMaxEur: mandate.ticket_max_eur,
    ticketNote: mandate.ticket_note,
    analysisThreshold: mandate.analysis_threshold,
    approvalMode: mandate.approval_mode,
    riskPosture: mandate.risk_posture,
    stageExpectations: mandate.stage_expectations ?? {},
    dealbreakers: mandate.dealbreakers ?? [],
    gates: [...row.mandate_gates]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((gate) => ({
        key: gate.gate_key,
        label: gate.label,
        description: gate.description,
        treatment: gate.treatment,
        ...(isSetupStage(gate.stage) ? { stage: gate.stage } : {}),
      })),
    criteria: [...row.assessment_criteria]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((criterion) => ({
        key: criterion.criterion_key,
        label: criterion.label,
        description: criterion.description,
        category: criterion.score_category,
        weight: Number(criterion.weight),
        codeAnchor: criterion.code_anchor !== false,
        ...(isSetupStage(criterion.stage) ? { stage: criterion.stage } : {}),
      })),
    moduleOverrides: Object.fromEntries(
      row.prompt_module_overrides
        .filter((override) => !isSetupStage(override.stage))
        .map((override) => [override.module_id, overrideTexts(override)]),
    ),
    stageModuleOverrides: stageOverrides(row.prompt_module_overrides),
    setup,
    perStage:
      hasSetup(setup) ||
      [...row.mandate_gates, ...row.assessment_criteria, ...row.prompt_module_overrides].some(
        (item) => isSetupStage(item.stage),
      ),
    screeningInstruction: readScreeningInstruction(mandate.screening_instruction),
    screeningCards: readScreeningCards(mandate.screening_cards),
    researchModuleOverrides: Object.fromEntries(
      row.research_module_overrides.map((override) => [
        `${override.mode}:${override.module_id}`,
        {
          questions: override.questions,
        },
      ]),
    ),
  };
}

function overrideTexts(override: ConfigRow["prompt_module_overrides"][number]) {
  return {
    mandate: override.mandate,
    evidenceTests: override.evidence_tests,
    riskAreas: override.risk_areas,
  };
}

function stageOverrides(
  rows: ConfigRow["prompt_module_overrides"],
): EditableFundConfig["stageModuleOverrides"] {
  const byStage: EditableFundConfig["stageModuleOverrides"] = {};
  for (const override of rows) {
    if (!isSetupStage(override.stage)) continue;
    (byStage[override.stage] ??= {})[override.module_id] = overrideTexts(override);
  }
  return byStage;
}

/**
 * Fondens egne tidligere investeringer, logget manuelt -- typisk historik
 * fra før Interlect.ai blev taget i brug. Uafhængig af draft/publish-cyklen,
 * da den ikke er knyttet til en config-version.
 */
export interface HistoricalInvestmentEntry {
  id: string;
  companyName: string;
  website: string | null;
  investedAt: string | null;
  stage: string | null;
  sector: string | null;
  geography: string | null;
  note: string;
  createdAt: string;
}

export const listHistoricalInvestments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<HistoricalInvestmentEntry[]> => {
    const { data: rows, error } = await context.supabase
      .from("historical_investments")
      .select("id, company_name, website, invested_at, stage, sector, geography, note, created_at")
      .eq("fund_id", data.fundId)
      .order("invested_at", { ascending: false, nullsFirst: false });
    if (error) throw new Error(serverText("fundServer.config.investmentsNotLoaded"));
    return (rows ?? []).map((row) => ({
      id: row["id"] as string,
      companyName: row["company_name"] as string,
      website: row["website"] as string | null,
      investedAt: row["invested_at"] as string | null,
      stage: row["stage"] as string | null,
      sector: row["sector"] as string | null,
      geography: row["geography"] as string | null,
      note: row["note"] as string,
      createdAt: row["created_at"] as string,
    }));
  });

const saveHistoricalInvestmentSchema = z.object({
  fundId: fundIdSchema,
  companyName: z.string().trim().min(1).max(200),
  website: z.union([z.string().url(), z.literal("")]).default(""),
  investedAt: z.union([z.string().date(), z.literal("")]).default(""),
  stage: z.string().trim().max(160).default(""),
  sector: z.string().trim().max(160).default(""),
  geography: z.string().trim().max(160).default(""),
  note: z.string().trim().max(2000).default(""),
});

export const saveHistoricalInvestment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => saveHistoricalInvestmentSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { data: row, error } = await context.supabase
      .from("historical_investments")
      .insert({
        fund_id: data.fundId,
        company_name: data.companyName,
        website: data.website || null,
        invested_at: data.investedAt || null,
        stage: data.stage || null,
        sector: data.sector || null,
        geography: data.geography || null,
        note: data.note,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(serverText("fundServer.config.investmentExists"));
      throw new Error(serverText("fundServer.config.investmentNotSaved"));
    }
    const historicalInvestmentId = row["id"] as string;
    if (isFundMemoryEnabled()) {
      waitUntil(
        writeHistoricalMemoryEntry({
          service: getServiceClient(),
          fundId: data.fundId,
          historicalInvestmentId,
          companyName: data.companyName,
          sector: data.sector || null,
          geography: data.geography || null,
          stage: data.stage || null,
          investedAt: data.investedAt || null,
          note: data.note,
        }),
      );
    }
    return { id: historicalInvestmentId };
  });

const deleteHistoricalInvestmentSchema = z.object({
  fundId: fundIdSchema,
  id: z.guid(),
});

export const deleteHistoricalInvestment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => deleteHistoricalInvestmentSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { error } = await context.supabase
      .from("historical_investments")
      .delete()
      .eq("id", data.id)
      .eq("fund_id", data.fundId);
    if (error) throw new Error(serverText("fundServer.config.investmentNotRemoved"));
    return { id: data.id };
  });

/**
 * Puts the keys of a version's text overrides, with empty texts, into rows read by someone who
 * may not read the texts (0104). The ids come from rows the caller's own session was just given.
 */
async function fillOverrideKeys(rows: ConfigRow[]): Promise<void> {
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  if (unique.length === 0) return;
  const ids = unique.map((row) => row.id);
  const service = getServiceClient();
  const [prompts, research] = await Promise.all([
    service
      .from("prompt_module_overrides")
      .select("config_version_id, stage, module_id")
      .in("config_version_id", ids),
    service
      .from("research_module_overrides")
      .select("config_version_id, mode, module_id")
      .in("config_version_id", ids),
  ]);
  if (prompts.error || research.error) {
    // Without the keys the overview would claim "no own texts": fail loudly instead.
    throw new Error(serverText("fundServer.common.setupNotLoaded"));
  }
  for (const row of unique) {
    row.prompt_module_overrides = (prompts.data ?? [])
      .filter((entry) => entry.config_version_id === row.id)
      .map((entry) => ({
        stage: (entry.stage as string | null) ?? null,
        module_id: entry.module_id as string,
        mandate: [],
        evidence_tests: [],
        risk_areas: [],
      }));
    row.research_module_overrides = (research.data ?? [])
      .filter((entry) => entry.config_version_id === row.id)
      .map((entry) => ({
        mode: entry.mode as string,
        module_id: entry.module_id as string,
        questions: [],
      }));
  }
}
