import { createServerFn } from "@tanstack/react-start";
import { enqueueBrainCapture } from "@/lib/brain/queue.server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import {
  fetchAndStoreCompanyFinancials,
  fetchAndStoreForeignFinancials,
  FinancialsNotFoundError,
  computeFinancialRatios,
  retireCaseFinancials,
  toMetricsInput,
  type FinancialRatio,
} from "@/lib/analysis/financial-statements";
import {
  computeFinancialMetrics,
  type FinancialMetricsReport,
} from "@/lib/analysis/financial-metrics";
import {
  lookupCvrByNumber,
  searchCvrByName,
  type CvrCompanyMatch,
} from "@/lib/analysis/cvr-lookup";
import { identitySignal } from "@/lib/analysis/identity";
import { registryAdapter } from "@/lib/analysis/registries";
import {
  FOREIGN_REGISTRY_COUNTRIES,
  type RegistryCompany,
  type RegistryCountry,
} from "@/lib/analysis/registries/types";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import {
  MANUAL_FINANCIAL_METRICS,
  inputYearAllowed,
  maxInputYear,
  withManualInputs,
  type ManualFinancialMetric,
} from "@/lib/analysis/manual-financials";
import { fromDemoView, teamRegisterHits, withDemoView } from "@/lib/display/display-names.server";

export type { FinancialRatio, CvrCompanyMatch, FinancialMetricsReport };

const fundIdSchema = z.guid();

export interface FinancialLineItemView {
  metric: string;
  value: number;
  unit: string;
}

export interface FinancialStatementView {
  id: string;
  /** Registernummeret i `registryCountry` (DK: CVR, NO: org.nr.). */
  cvrNumber: string;
  registryCountry: RegistryCountry;
  reportingClassText: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  sourceDocumentUrl: string;
  fetchedAt: string;
  lineItems: FinancialLineItemView[];
}

export interface FinancialStatementsResult {
  statements: FinancialStatementView[];
  ratios: FinancialRatio[];
  /** Alle nøgletal for alle år, regnet i kode (masterplan C2). */
  metrics: FinancialMetricsReport;
  /** Ikke-blokerende advarsler fra seneste hentning (tom ved visning). */
  warnings?: string[];
  /**
   * Tal, nogen har skrevet ind på casens Økonomi, i regnskabernes valuta. De er allerede
   * regnet med i `metrics`, hvor regnskabet ikke selv har tallet.
   */
  manualInputs?: ManualFinancialInputView[];
  /** Valutaen, et nyt indtastet tal gemmes i (regnskabernes, ellers DKK). */
  inputCurrency?: string;
  /** Indtastede tal i en anden valuta end regnskabernes (bruges ikke; siden siger det). */
  hiddenInputCount?: number;
  /** Det seneste år, et tal kan indtastes for (se `maxInputYear`). */
  maxInputYear?: number;
  /** De indtastede tal kunne ikke læses: regnskaberne vises alene, og siden siger det. */
  manualInputsError?: boolean;
}

export interface ManualFinancialInputView {
  id: string;
  metric: ManualFinancialMetric;
  fiscalYear: number;
  value: number;
  currency: string;
  enteredByName: string | null;
  enteredAt: string;
  /** "entered" = typed in; "brain" = found by Brain and confirmed by `enteredByName`. */
  sourceKind: "entered" | "brain";
  sourceUrl: string | null;
  sourceNote: string | null;
}

/**
 * Henter et selskabs offentlige regnskaber fra Erhvervsstyrelsen (op til 8
 * regnskabsår), gemmer de rå tal, og beregner nøgletal deterministisk
 * ud fra dem. Ingen AI involveret -- kun struktureret udtræk + regning.
 */
export const fetchCompanyFinancials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseId: z.guid(),
        cvrNumber: z
          .string()
          .trim()
          .regex(/^\d{8}$/, serverText("caseServer.financials.cvrDigits")),
      })
      .parse(input),
  )
  .handler(
    withDemoView(async ({ data: shown, context }): Promise<FinancialStatementsResult> => {
      // Demo view: what the screen showed goes back to the real value before it is used.
      const data = { ...shown, cvrNumber: await fromDemoView(shown.fundId, shown.cvrNumber) };
      await requireFundCapability(context.supabase, context.userId, data.fundId, "start_analysis");
      const service = getServiceClient();
      // Casen skal tilhøre fonden, FØR der skrives noget med service-nøglen.
      const { data: caseRow, error: caseError } = await service
        .from("cases")
        .select("company_id")
        .eq("id", data.caseId)
        .eq("fund_id", data.fundId)
        .maybeSingle();
      if (caseError) throw new Error(serverText("caseServer.common.caseNotLookedUp"));
      if (!caseRow) throw new Error(serverText("caseServer.common.caseNotInFund"));
      const companyId = caseRow["company_id"] as string | null;
      const result = await fetchAndStoreCompanyFinancials(service, {
        fundId: data.fundId,
        caseId: data.caseId,
        cvrNumber: data.cvrNumber,
        actorId: context.userId,
      });
      // Et menneske har valgt dette CVR: det bliver selskabets CVR, og automatikken må
      // ikke skifte tilbage. Regnskaber fra et tidligere, forkert CVR fjernes.
      if (!companyId) {
        console.error(`[financials] case ${data.caseId} has no company after manual fetch`);
        return {
          ...result,
          warnings: [...result.warnings, serverText("caseServer.financials.cvrNotSaved")],
        };
      }
      // Identiteten følger det valgte CVR: juridisk navn fra registret og nye signaler,
      // så kortet aldrig viser det gamle selskabs navn ved siden af det nye CVR.
      let registryName: string | null = null;
      let registryLookupOk = false;
      try {
        registryName = (await lookupCvrByNumber(data.cvrNumber))?.name ?? null;
        registryLookupOk = true;
      } catch (cause) {
        console.warn(
          "[financials] registry name lookup failed",
          cause instanceof Error ? cause.message : cause,
        );
      }
      const now = new Date().toISOString();
      const { error: companyError } = await service
        .from("companies")
        .update({
          cvr_number: data.cvrNumber,
          // Et selskab har højst ét registernummer (0083): det danske CVR afløser et udenlandsk.
          registry_country: null,
          registry_number: null,
          // Kun når registret svarede; ellers bevares navnet frem for at blive tømt.
          ...(registryLookupOk ? { legal_name: registryName } : {}),
          identity_status: "confirmed",
          identity_confidence: 1,
          identity_signals: {
            signals: [identitySignal("human_confirmed", `CVR ${data.cvrNumber} valgt manuelt`)],
            problems: [],
            assessedAt: now,
          },
          identity_confirmed_by: context.userId,
          identity_confirmed_at: now,
          updated_at: now,
        })
        .eq("id", companyId)
        .eq("fund_id", data.fundId);
      // After the write, so L0 builds the company entity on the CVR the human just chose.
      await enqueueBrainCapture(data.fundId, data.caseId);
      if (companyError) {
        console.error("[financials] company CVR update failed", companyError.message);
        return {
          ...result,
          warnings: [...result.warnings, serverText("caseServer.financials.cvrNotSaved")],
        };
      }
      try {
        await retireCaseFinancials(service, {
          fundId: data.fundId,
          caseId: data.caseId,
          keepRegistryNumber: data.cvrNumber,
        });
      } catch (cause) {
        console.error(
          "[financials] retiring other CVRs failed",
          cause instanceof Error ? cause.message : cause,
        );
        return {
          ...result,
          warnings: [...result.warnings, serverText("caseServer.financials.oldNotRemoved")],
        };
      }
      return result;
    }),
  );

/**
 * Samme som `fetchCompanyFinancials` for et udenlandsk selskab. Et menneske vælger land og
 * registernummer (fx norsk org.nr.); nummeret tjekkes i landets register, regnskaberne hentes
 * derfra, og nummeret bliver selskabets (`human_confirmed`), så screeningen ikke skifter tilbage.
 */
export const fetchForeignCompanyFinancials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseId: z.guid(),
        country: z.enum(FOREIGN_REGISTRY_COUNTRIES),
        registryNumber: z.string().trim().min(1).max(40),
      })
      .parse(input),
  )
  .handler(
    withDemoView(async ({ data: shown, context }): Promise<FinancialStatementsResult> => {
      // Demo view: what the screen showed goes back to the real value before it is used.
      const data = {
        ...shown,
        registryNumber: await fromDemoView(shown.fundId, shown.registryNumber),
      };
      await requireFundCapability(context.supabase, context.userId, data.fundId, "start_analysis");
      const adapter = registryAdapter(data.country);
      const labels = { registry: adapter.registryName, label: adapter.numberLabel };
      const number = adapter.normalizeNumber(data.registryNumber);
      if (!number) {
        throw new Error(
          serverText("caseServer.financials.numberInvalid", {
            ...labels,
            number: data.registryNumber,
          }),
        );
      }
      if (!adapter.configured()) {
        throw new Error(serverText("caseServer.financials.registryNotConfigured", labels));
      }
      const service = getServiceClient();
      // Casen skal tilhøre fonden, FØR der skrives noget med service-nøglen.
      const { data: caseRow, error: caseError } = await service
        .from("cases")
        .select("company_id")
        .eq("id", data.caseId)
        .eq("fund_id", data.fundId)
        .maybeSingle();
      if (caseError) throw new Error(serverText("caseServer.common.caseNotLookedUp"));
      if (!caseRow) throw new Error(serverText("caseServer.common.caseNotInFund"));
      const companyId = caseRow["company_id"] as string | null;
      let company: RegistryCompany | null;
      try {
        company = await adapter.lookupByNumber(number);
      } catch (cause) {
        console.warn(
          `[financials] ${data.country} registry lookup failed`,
          cause instanceof Error ? cause.message : cause,
        );
        throw new Error(serverText("caseServer.financials.registryUnavailable", labels));
      }
      if (!company) {
        throw new Error(
          serverText("caseServer.financials.registryNotFound", { ...labels, number }),
        );
      }
      // Identiteten gemmes først: et menneske har valgt selskabet, også når registret ikke har
      // regnskaber, det kan levere (så bruger analysen websøgningens tal).
      const warnings: string[] = [];
      if (!companyId) {
        console.error(
          `[financials] case ${data.caseId} has no company for a manual registry choice`,
        );
        warnings.push(serverText("caseServer.financials.numberNotSaved"));
      } else {
        const now = new Date().toISOString();
        const { error: companyError } = await service
          .from("companies")
          .update({
            // Et selskab har højst ét registernummer (0083): det udenlandske afløser et dansk CVR.
            cvr_number: null,
            registry_country: data.country,
            registry_number: number,
            legal_name: company.name,
            identity_status: "confirmed",
            identity_confidence: 1,
            identity_signals: {
              signals: [
                identitySignal(
                  "human_confirmed",
                  `${adapter.numberLabel} ${number} (${data.country}) valgt manuelt`,
                ),
              ],
              problems: [],
              assessedAt: now,
            },
            identity_confirmed_by: context.userId,
            identity_confirmed_at: now,
            updated_at: now,
          })
          .eq("id", companyId)
          .eq("fund_id", data.fundId);
        await enqueueBrainCapture(data.fundId, data.caseId);
        if (companyError) {
          console.error("[financials] company registry number update failed", companyError.message);
          warnings.push(serverText("caseServer.financials.numberNotSaved"));
        } else {
          try {
            await retireCaseFinancials(service, {
              fundId: data.fundId,
              caseId: data.caseId,
              keepRegistryNumber: number,
            });
          } catch (cause) {
            console.error(
              "[financials] retiring other registry numbers failed",
              cause instanceof Error ? cause.message : cause,
            );
            warnings.push(serverText("caseServer.financials.oldNotRemoved"));
          }
        }
      }
      try {
        const result = await fetchAndStoreForeignFinancials(service, {
          fundId: data.fundId,
          caseId: data.caseId,
          country: data.country,
          registryNumber: number,
          actorId: context.userId,
        });
        return { ...result, warnings: [...result.warnings, ...warnings] };
      } catch (cause) {
        // The choice is already saved; a missing or failed fetch is a warning, not a failure.
        if (!(cause instanceof FinancialsNotFoundError)) {
          console.error(
            `[financials] ${data.country} statements fetch failed`,
            cause instanceof Error ? cause.message : cause,
          );
        }
        return {
          statements: [],
          ratios: [],
          metrics: computeFinancialMetrics([], new Date().toISOString().slice(0, 10), {
            registryCountry: data.country,
            language: requestLanguage(),
          }),
          warnings: [
            cause instanceof FinancialsNotFoundError
              ? cause.message
              : serverText("caseServer.financials.registryUnavailable", labels),
            ...warnings,
          ],
        };
      }
    }),
  );

/** Matchende selskaber for et navn i landets register (DK: Erhvervsstyrelsens CVR-register). */
async function searchRegisterByName(
  name: string,
  country: RegistryCountry | undefined,
): Promise<CvrCompanyMatch[]> {
  if (!country || country === "DK") return searchCvrByName(name);
  const adapter = registryAdapter(country);
  if (!adapter.supportsNameSearch || !adapter.configured()) return [];
  try {
    const found = await adapter.searchByName(name);
    return found.map((item) => ({
      cvrNumber: item.registryNumber,
      name: item.name,
      status: item.status,
    }));
  } catch (cause) {
    console.warn(
      `[financials] ${country} name search failed`,
      cause instanceof Error ? cause.message : cause,
    );
    throw new Error(
      serverText("caseServer.financials.registryUnavailable", {
        registry: adapter.registryName,
        label: adapter.numberLabel,
      }),
    );
  }
}

/** Slår et selskabsnavn op i Erhvervsstyrelsens CVR-register og returnerer matchende CVR-numre. */
export const lookupCvrByName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseId: z.guid(),
        name: z.string().trim().min(1).max(200),
        // Et andet land søger i landets eget register (fx Enhetsregisteret for NO).
        country: z.enum(["DK", ...FOREIGN_REGISTRY_COUNTRIES]).optional(),
      })
      .parse(input),
  )
  .handler(
    withDemoView(async ({ data: shown, context }): Promise<CvrCompanyMatch[]> => {
      // Demo view: what the screen showed goes back to the real value before it is used.
      const data = { ...shown, name: await fromDemoView(shown.fundId, shown.name) };
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
      const hits = await searchRegisterByName(data.name, data.country);
      // In the demo view only the team's own companies, so no real name or number shows.
      return teamRegisterHits(getServiceClient(), data.fundId, data.country ?? "DK", hits);
    }),
  );

export const listFinancialStatements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, caseId: z.guid() }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<FinancialStatementsResult> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
      const statements = await loadCompanyStatements(context.supabase, data.fundId, data.caseId);
      const periodsForRatios = statements.slice(0, 2).map((statement) => ({
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        facts: statement.lineItems.map((item) => ({
          metric: item.metric,
          value: item.value,
          unit: item.unit,
          periodStart: statement.periodStart,
          periodEnd: statement.periodEnd,
        })),
      }));
      const ratios =
        periodsForRatios.length > 0
          ? computeFinancialRatios(periodsForRatios[0]!, periodsForRatios[1] ?? null)
          : [];
      const inputCurrency = statements[0]?.currency ?? "DKK";
      // An entered figure is an addition: if they cannot be read, the reports still show and the
      // page says the entered figures are missing (never silently).
      let manualInputs: ManualFinancialInputView[] = [];
      let manualInputsError = false;
      try {
        manualInputs = await loadManualInputs(context.supabase, data.fundId, data.caseId);
      } catch {
        manualInputsError = true;
      }
      const metrics = computeFinancialMetrics(
        withManualInputs(statements.map(toMetricsInput), manualInputs, inputCurrency),
        new Date().toISOString().slice(0, 10),
        {
          currency: statements[0]?.currency,
          registryCountry: statements[0]?.registryCountry,
          language: requestLanguage(),
        },
      );
      return {
        statements,
        ratios,
        metrics,
        manualInputs: manualInputs.filter((input) => input.currency === inputCurrency),
        inputCurrency,
        // Figures entered in another currency (before reports in a new currency came) are not
        // used: the page says how many, so none disappears silently.
        hiddenInputCount: manualInputs.filter((input) => input.currency !== inputCurrency).length,
        maxInputYear: maxInputYear(statements, Date.now()),
        ...(manualInputsError ? { manualInputsError } : {}),
      };
    }),
  );

/**
 * The case's annual reports as the Økonomi tab shows them: one company at a time (its registry
 * number, else the newest report's) and only years in the newest report's currency. Shared by the
 * list and by "Udfyld", so an entered figure is saved in the currency the page shows.
 */
async function loadCompanyStatements(
  supabase: Parameters<typeof requireFundCapability>[0],
  fundId: string,
  caseId: string,
): Promise<FinancialStatementView[]> {
  const { data: statementRows, error } = await supabase
    .from("financial_statements")
    .select(
      "id, cvr_number, registry_country, reporting_class_text, period_start, period_end, currency, source_document_url, fetched_at, financial_statement_line_items(metric, value, unit)",
    )
    .eq("case_id", caseId)
    .eq("fund_id", fundId)
    .order("period_end", { ascending: false });
  if (error) throw new Error(serverText("caseServer.financials.notLoaded"));
  // Ét selskab ad gangen: selskabets registernummer (dansk CVR eller udenlandsk org.nr.,
  // et menneskes valg eller det automatiske match); uden et gemt nummer det, det seneste
  // regnskab tilhører.
  const { data: caseRow, error: caseError } = await supabase
    .from("cases")
    .select("companies(cvr_number, registry_number)")
    .eq("id", caseId)
    .eq("fund_id", fundId)
    .maybeSingle();
  if (caseError) {
    console.error(
      `[financials] company CVR unreadable (case ${caseId}); using latest statement's CVR`,
      caseError.message,
    );
  }
  const rawCompany = caseRow?.["companies"] as unknown;
  const companyRow = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
    cvr_number: string | null;
    registry_number: string | null;
  } | null;
  const companyCvr = companyRow?.cvr_number ?? companyRow?.registry_number;
  const storedCvrs = new Set((statementRows ?? []).map((row) => row["cvr_number"] as string));
  const currentCvr =
    companyCvr && storedCvrs.has(companyCvr)
      ? companyCvr
      : ((statementRows?.[0]?.["cvr_number"] as string | undefined) ?? null);
  const ofCompany = (statementRows ?? []).filter((row) => row["cvr_number"] === currentCvr);
  // Kun år i det seneste regnskabs valuta, så en vækstrate aldrig blander to valutaer.
  const currency = ofCompany[0]?.["currency"];
  const statements: FinancialStatementView[] = ofCompany
    .filter((row) => row["currency"] === currency)
    .map((row) => ({
      id: row["id"] as string,
      cvrNumber: row["cvr_number"] as string,
      registryCountry: row["registry_country"] as RegistryCountry,
      reportingClassText: row["reporting_class_text"] as string | null,
      periodStart: row["period_start"] as string,
      periodEnd: row["period_end"] as string,
      currency: row["currency"] as string,
      sourceDocumentUrl: row["source_document_url"] as string,
      fetchedAt: row["fetched_at"] as string,
      lineItems: (
        (row["financial_statement_line_items"] as Array<{
          metric: string;
          value: number;
          unit: string;
        }>) ?? []
      ).map((item) => ({ metric: item.metric, value: Number(item.value), unit: item.unit })),
    }));
  return statements;
}

/** The figures entered on the case (RLS: members of the fund only), with who entered them. */
async function loadManualInputs(
  supabase: Parameters<typeof requireFundCapability>[0],
  fundId: string,
  caseId: string,
): Promise<ManualFinancialInputView[]> {
  const { data: rows, error } = await supabase
    .from("case_financial_inputs")
    .select(
      "id, metric, fiscal_year, value, currency, entered_by, entered_at, source_kind, source_url, source_note",
    )
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .order("fiscal_year", { ascending: true });
  if (error) {
    console.error("[financials] entered figures unreadable", error.message);
    throw new Error(serverText("caseServer.financials.inputsNotLoaded"));
  }
  const ids = [...new Set((rows ?? []).map((row) => row["entered_by"] as string | null))].filter(
    (id): id is string => Boolean(id),
  );
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    if (profilesError) console.error("[financials] profiles", profilesError.message);
    for (const profile of profiles ?? []) {
      if (profile["full_name"]) names.set(profile["id"] as string, profile["full_name"] as string);
    }
  }
  return (rows ?? []).map((row) => ({
    id: row["id"] as string,
    metric: row["metric"] as ManualFinancialMetric,
    fiscalYear: Number(row["fiscal_year"]),
    value: Number(row["value"]),
    currency: row["currency"] as string,
    enteredByName: names.get(row["entered_by"] as string) ?? null,
    enteredAt: row["entered_at"] as string,
    sourceKind: row["source_kind"] === "brain" ? "brain" : "entered",
    sourceUrl: (row["source_url"] as string | null) ?? null,
    sourceNote: (row["source_note"] as string | null) ?? null,
  }));
}

const manualInputSchema = z.object({
  fundId: fundIdSchema,
  caseId: z.guid(),
  metric: z.enum(MANUAL_FINANCIAL_METRICS),
  fiscalYear: z.number().int().min(1990).max(2100),
});

/**
 * "Udfyld" on Økonomi: saves one figure on the case (replacing the same figure and year)
 * in the reports' currency. Admin, Lead and Medlem (correct_evidence); audited.
 */
export const saveFinancialInput = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    manualInputSchema.extend({ value: z.number().finite().gt(-1e15).lt(1e15) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "correct_evidence");
    const service = getServiceClient();
    // The currency and the years the page shows (same rule as the list).
    const statements = await loadCompanyStatements(context.supabase, data.fundId, data.caseId);
    const currency = statements[0]?.currency ?? "DKK";
    if (!inputYearAllowed(data.fiscalYear, statements, Date.now())) {
      throw new Error(serverText("caseServer.financials.inputYearNotAllowed"));
    }
    const { data: row, error } = await service
      .from("case_financial_inputs")
      .upsert(
        {
          fund_id: data.fundId,
          case_id: data.caseId,
          metric: data.metric,
          fiscal_year: data.fiscalYear,
          value: data.value,
          currency,
          entered_by: context.userId,
          entered_at: new Date().toISOString(),
          // A typed figure replaces a Brain one completely, source and all.
          source_kind: "entered",
          source_url: null,
          source_note: null,
          proposal_id: null,
        },
        { onConflict: "case_id,metric,fiscal_year" },
      )
      .select("id")
      .single();
    if (error || !row) {
      // 23503: the case is not in this fund (composite foreign key).
      if (error?.code === "23503")
        throw new Error(serverText("caseServer.common.caseNotFoundInFund"));
      console.error("[saveFinancialInput]", error?.message);
      throw new Error(serverText("caseServer.financials.inputNotSaved"));
    }
    await writeAudit(service, {
      fundId: data.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "financial_input_saved",
      entity: "case_financial_inputs",
      entityId: row["id"] as string,
      payload: {
        caseId: data.caseId,
        metric: data.metric,
        fiscalYear: data.fiscalYear,
        value: data.value,
        currency,
      },
    });
    return { id: row["id"] as string };
  });

/** Removes an entered figure again (the report's figure, if any, shows as before). */
export const deleteFinancialInput = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => manualInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ removed: boolean }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "correct_evidence");
    const service = getServiceClient();
    const { data: rows, error } = await service
      .from("case_financial_inputs")
      .delete()
      .eq("fund_id", data.fundId)
      .eq("case_id", data.caseId)
      .eq("metric", data.metric)
      .eq("fiscal_year", data.fiscalYear)
      .select("id");
    if (error) {
      console.error("[deleteFinancialInput]", error.message);
      throw new Error(serverText("caseServer.financials.inputNotRemoved"));
    }
    const removed = (rows ?? [])[0]?.["id"] as string | undefined;
    if (removed) {
      await writeAudit(service, {
        fundId: data.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "financial_input_removed",
        entity: "case_financial_inputs",
        entityId: removed,
        payload: { caseId: data.caseId, metric: data.metric, fiscalYear: data.fiscalYear },
      });
    }
    return { removed: Boolean(removed) };
  });

export interface FieldProposalView {
  id: string;
  metric: ManualFinancialMetric;
  fiscalYear: number;
  value: number;
  currency: string;
  /** Brain never says "verified": a register does that. */
  certainty: "likely" | "company_stated";
  sourceKind: "case_material" | "web";
  sourceTitle: string | null;
  sourceUrl: string | null;
  quote: string;
}

export type FindFieldResult =
  | { status: "found"; proposal: FieldProposalView }
  | { status: "not_found"; searched: Array<"case_material" | "web"> };

/**
 * "Find med Brain" on a missing figure: Brain looks for this one figure in the case's own
 * material and then on the web, and returns a proposal with its source and certainty, or "not
 * found". Nothing is saved on the case. It uses credits; the price is booked in the fund's chat
 * budget but not shown. Admin, Lead and Medlem (correct_evidence).
 */
export const findFieldWithBrain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => manualInputSchema.strict().parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<FindFieldResult> => {
      await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "correct_evidence",
      );
      const { isBrainEnabled } = await import("@/lib/brain/flags");
      if (!isBrainEnabled()) throw new Error(serverText("caseServer.financials.findNotAvailable"));
      // The years the page lets a person fill in (same rule as "Udfyld").
      const statements = await loadCompanyStatements(context.supabase, data.fundId, data.caseId);
      if (!inputYearAllowed(data.fiscalYear, statements, Date.now())) {
        throw new Error(serverText("caseServer.financials.inputYearNotAllowed"));
      }
      const service = getServiceClient();
      const { findFieldWithBrain: find } = await import("@/lib/brain/find-field.server");
      const { countFieldSearch } = await import("@/lib/brain/find-field-limit.server");
      const { QUESTIONS_PER_MINUTE } = await import("@/lib/brain/chat/prompt");
      const counted = await countFieldSearch(service, {
        fundId: data.fundId,
        userId: context.userId,
        perMinute: QUESTIONS_PER_MINUTE,
      });
      if (!counted) {
        throw new Error(serverText("caseServer.financials.findRateLimited"));
      }
      try {
        const outcome = await find(service, {
          fundId: data.fundId,
          caseId: data.caseId,
          userId: context.userId,
          metric: data.metric,
          fiscalYear: data.fiscalYear,
          language: requestLanguage(),
        });
        if (outcome.status === "not_found") {
          return { status: "not_found", searched: outcome.searched };
        }
        const { proposal } = outcome;
        return {
          status: "found",
          proposal: {
            id: proposal.id,
            metric: proposal.metric,
            fiscalYear: proposal.fiscalYear,
            value: proposal.value,
            currency: proposal.currency,
            certainty: proposal.certainty,
            sourceKind: proposal.sourceKind,
            sourceTitle: proposal.sourceTitle,
            sourceUrl: proposal.sourceUrl,
            quote: proposal.quote,
          },
        };
      } catch (cause) {
        const { BrainBudgetReachedError } = await import("@/lib/brain/errors");
        if (cause instanceof BrainBudgetReachedError) {
          throw new Error(serverText("caseServer.financials.findBudget"));
        }
        console.error("[findFieldWithBrain]", cause instanceof Error ? cause.message : cause);
        throw new Error(serverText("caseServer.financials.findFailed"));
      }
    }),
  );

const proposalIdSchema = z
  .object({ fundId: fundIdSchema, caseId: z.guid(), proposalId: z.guid() })
  .strict();

/**
 * "Sæt ind på casen": saves exactly what Brain found (value, currency, source and quote
 * come from the stored proposal, never from the browser) as the case's figure, with the source
 * "Brain" and the person who confirmed it. Nothing is guessed: a proposal can be used once.
 */
export const acceptFieldProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => proposalIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "correct_evidence");
    const service = getServiceClient();
    const { data: proposal, error: readError } = await service
      .from("case_field_proposals")
      .select(
        "id, metric, fiscal_year, value, currency, certainty, source_kind, source_title, source_url, quote, status",
      )
      .eq("id", data.proposalId)
      .eq("fund_id", data.fundId)
      .eq("case_id", data.caseId)
      .maybeSingle();
    if (readError) {
      console.error("[acceptFieldProposal] read", readError.message);
      throw new Error(serverText("caseServer.financials.proposalNotSaved"));
    }
    if (!proposal || proposal["status"] !== "proposed") {
      throw new Error(serverText("caseServer.financials.proposalNotFound"));
    }
    const statements = await loadCompanyStatements(context.supabase, data.fundId, data.caseId);
    const shownCurrency = statements[0]?.currency ?? "DKK";
    const foundCurrency = proposal["currency"] as string;
    if (foundCurrency !== shownCurrency) {
      throw new Error(
        serverText("caseServer.financials.proposalCurrencyDiffers", {
          found: foundCurrency,
          shown: shownCurrency,
        }),
      );
    }
    const fiscalYear = Number(proposal["fiscal_year"]);
    if (!inputYearAllowed(fiscalYear, statements, Date.now())) {
      throw new Error(serverText("caseServer.financials.inputYearNotAllowed"));
    }
    // Claim the proposal first, so two clicks (or two tabs) cannot both save it.
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await service
      .from("case_field_proposals")
      .update({ status: "accepted", resolved_by: context.userId, resolved_at: now })
      .eq("id", data.proposalId)
      .eq("status", "proposed")
      .select("id");
    if (claimError) {
      console.error("[acceptFieldProposal] claim", claimError.message);
      throw new Error(serverText("caseServer.financials.proposalNotSaved"));
    }
    if (!claimed || claimed.length === 0) {
      throw new Error(serverText("caseServer.financials.proposalNotFound"));
    }
    const { data: previous } = await service
      .from("case_financial_inputs")
      .select("value, source_kind")
      .eq("case_id", data.caseId)
      .eq("metric", proposal["metric"])
      .eq("fiscal_year", fiscalYear)
      .maybeSingle();
    const note = [proposal["source_title"], proposal["quote"]]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(": ")
      .slice(0, 600);
    const { data: row, error } = await service
      .from("case_financial_inputs")
      .upsert(
        {
          fund_id: data.fundId,
          case_id: data.caseId,
          metric: proposal["metric"],
          fiscal_year: fiscalYear,
          value: proposal["value"],
          currency: foundCurrency,
          entered_by: context.userId,
          entered_at: now,
          source_kind: "brain",
          source_url: proposal["source_url"] ?? null,
          source_note: note || null,
          proposal_id: data.proposalId,
        },
        { onConflict: "case_id,metric,fiscal_year" },
      )
      .select("id")
      .single();
    if (error || !row) {
      // Give the proposal back, so the person can try again.
      const { error: undoError } = await service
        .from("case_field_proposals")
        .update({ status: "proposed", resolved_by: null, resolved_at: null })
        .eq("id", data.proposalId)
        .eq("status", "accepted")
        .eq("resolved_by", context.userId);
      if (undoError) console.error("[acceptFieldProposal] undo", undoError.message);
      if (error?.code === "23503")
        throw new Error(serverText("caseServer.common.caseNotFoundInFund"));
      console.error("[acceptFieldProposal] save", error?.message);
      throw new Error(serverText("caseServer.financials.proposalNotSaved"));
    }
    await writeAudit(service, {
      fundId: data.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "financial_input_from_brain",
      entity: "case_financial_inputs",
      entityId: row["id"] as string,
      payload: {
        caseId: data.caseId,
        proposalId: data.proposalId,
        metric: proposal["metric"],
        fiscalYear,
        value: proposal["value"],
        currency: foundCurrency,
        sourceUrl: proposal["source_url"] ?? null,
        previousValue: previous ? Number(previous["value"]) : null,
        previousSourceKind: previous ? previous["source_kind"] : null,
      },
    }).catch((cause) => {
      // The figure is saved; a missing audit row is logged with the ids, not shown as a failure.
      console.error("[acceptFieldProposal] audit not written", {
        proposalId: data.proposalId,
        inputId: row["id"],
        error: cause instanceof Error ? cause.message : cause,
      });
    });
    return { id: row["id"] as string };
  });

/** "Afvis": the proposal is not used. It stays for the record (status dismissed). */
export const dismissFieldProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => proposalIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ dismissed: boolean }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "correct_evidence");
    const service = getServiceClient();
    const { data: rows, error } = await service
      .from("case_field_proposals")
      .update({
        status: "dismissed",
        resolved_by: context.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", data.proposalId)
      .eq("fund_id", data.fundId)
      .eq("case_id", data.caseId)
      .eq("status", "proposed")
      .select("id");
    if (error) {
      console.error("[dismissFieldProposal]", error.message);
      throw new Error(serverText("caseServer.financials.proposalNotDismissed"));
    }
    return { dismissed: (rows ?? []).length > 0 };
  });
