/**
 * Screeningens opslag i et udenlandsk register, for et selskab med hovedkontor i et
 * land med en adapter (Norge i dag). Samme forløb som det danske CVR-opslag i
 * `applyDiscoveredCompanyProfile`: find selskabet (nummer i casens materiale, et tidligere gemt
 * nummer, ellers navneopslag), vurder identiteten i kode, gem nummeret på selskabet, og hent
 * regnskaberne. Mangler regnskaber i registret, er det "ikke tilgængeligt", og analysen bruger
 * websøgningens tal. Fejl her stopper aldrig screeningen; det er berigelse.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAndStoreForeignFinancials,
  FinancialsNotFoundError,
  retireCaseFinancials,
} from "../financial-statements.ts";
import { assessIdentity, type IdentitySignal } from "../identity.ts";
import type { NameContext } from "../identity-resolve.ts";
import type { CvrLookupOutcome } from "../public-research.ts";
import { chooseRegistryMatch, registryMatchSignals, registryNameAgrees } from "./match.ts";
import { registryAdapter, type ForeignRegistryCountry, type RegistryCompany } from "./index.ts";

import { serverText } from "../../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.registries.${key}` as MessageKey, vars);
}

export interface ForeignLookupInput {
  fundId: string;
  caseId: string;
  companyId: string;
  actorId: string;
  country: ForeignRegistryCountry;
  company: {
    cvr_number: string | null;
    registry_country: string | null;
    registry_number: string | null;
    legal_name: string | null;
    domains: string[] | null;
    profile_source: Record<string, string> | null;
  };
  /**
   * Et menneske har afgjort identiteten, så identitetsvurderingen røres ikke. Kun et gemt
   * nummer bruges, undtagen når mennesket sagde "ikke dansk": så søges registret stadig.
   */
  humanDecided: boolean;
  identityStatus: string | null;
  /**
   * Websøgningen fandt selskabet i flere kilder. Som for CVR slås registret kun op på navn
   * da; ellers kunne et andet selskab med samme navn blive valgt og hænge ved.
   */
  identityConfident: boolean;
  nameContext: NameContext;
  websiteHost: string | null;
  /** Signaler, der ikke afhænger af registret (domænet passer, websøgningen fandt selskabet). */
  baseSignals: IdentitySignal[];
  /** Casens deck og website, hvor et registernummer kan stå. */
  material: string;
  problems: string[];
}

export async function lookupForeignRegistry(
  service: SupabaseClient,
  input: ForeignLookupInput,
): Promise<CvrLookupOutcome> {
  const adapter = registryAdapter(input.country);
  const { company, nameContext, problems } = input;
  const nameAgrees = registryNameAgrees(nameContext, input.country);
  const describe = (number: string) =>
    adapter.describeNumber?.(number) ?? `${adapter.numberLabel} ${number}`;
  const storedNumber = company.registry_country === input.country ? company.registry_number : null;
  // `problems` (fx et nummer i materialet, der tilhører et andet selskab) lægges på af kalderen.
  const done = (outcome: Omit<CvrLookupOutcome, "cvrNumber">): CvrLookupOutcome => ({
    ...outcome,
    cvrNumber: null,
  });

  // Et register, der mangler sin nøgle (Sverige), er "ikke tilgængeligt": screeningen
  // går videre som for et selskab uden register, og intet gemt ændres.
  if (!adapter.configured()) {
    return done({
      status: "not_found",
      message: msg("lookup.notSetUp", { registry: adapter.registryName }),
      identity: null,
    });
  }

  const mayFind = !input.humanDecided || input.identityStatus === "not_danish";
  let match: RegistryCompany | null = null;
  let fromMaterial = false;
  let materialNumber: string | null = null;
  let searchedName: string | null = null;
  let materialHadNumbers = false;
  try {
    if (!mayFind) {
      if (storedNumber) match = await adapter.lookupByNumber(storedNumber);
    } else {
      const materialNumbers = adapter.findNumbersInText(input.material).slice(0, 3);
      materialHadNumbers = materialNumbers.length > 0;
      for (const number of materialNumbers) {
        const found = await adapter.lookupByNumber(number);
        if (!found) {
          problems.push(
            msg("lookup.numberNotFound", {
              number: describe(number),
              registry: adapter.registryName,
            }),
          );
          continue;
        }
        if (nameAgrees(found.name)) {
          match = found;
          fromMaterial = true;
          materialNumber = number;
          break;
        }
        problems.push(
          msg("lookup.numberOtherCompany", {
            number: describe(number),
            owner: found.name,
            name: nameContext.brandName,
          }),
        );
      }
      // Et tidligere gemt nummer, der stadig passer, går forud for et nyt navneopslag.
      if (!match && storedNumber) {
        const stored = await adapter.lookupByNumber(storedNumber);
        if (stored && nameAgrees(stored.name)) match = stored;
      }
      if (!match && input.identityConfident && adapter.supportsNameSearch) {
        searchedName = company.legal_name ?? nameContext.discoveredName ?? nameContext.brandName;
        const chosen = chooseRegistryMatch({
          candidates: await adapter.searchByName(searchedName),
          context: nameContext,
          websiteHost: input.websiteHost,
        });
        match = chosen.match;
        if (!match && chosen.ambiguous.length > 1) {
          return done({
            status: "ambiguous",
            message: msg("lookup.ambiguous", {
              count: chosen.ambiguous.length,
              registry: adapter.registryName,
              name: searchedName,
            }),
            identity: null,
          });
        }
      }
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : msg("common.unknownError");
    console.error(`[registry:${input.country}] lookup failed`, detail);
    return done({
      status: "failed",
      message: msg("lookup.failed", { registry: adapter.registryName, reason: detail }),
      identity: null,
    });
  }

  if (!match) {
    const message = !mayFind
      ? storedNumber
        ? msg("lookup.approvedGone", {
            numberLabel: adapter.numberLabel,
            number: storedNumber,
            registry: adapter.registryName,
          })
        : msg("lookup.humanDecided", {
            numberLabel: adapter.numberLabel,
            registry: adapter.registryName,
          })
      : searchedName
        ? msg("lookup.noNameMatch", { registry: adapter.registryName, name: searchedName })
        : adapter.supportsNameSearch
          ? msg("lookup.notSureEnough", {
              numberLabel: adapter.numberLabel,
              registry: adapter.registryName,
            })
          : msg(materialHadNumbers ? "lookup.noMatchingNumber" : "lookup.noNumber", {
              numberLabel: adapter.numberLabel,
              registry: adapter.registryName,
            });
    return done({ status: "not_found", message, identity: null });
  }

  const signals = [
    ...input.baseSignals,
    ...registryMatchSignals({
      company: match,
      registryName: adapter.registryName,
      numberLabel: adapter.numberLabel,
      context: nameContext,
      websiteHost: input.websiteHost,
      fromMaterial,
      materialNumberText:
        materialNumber && adapter.describeNumber ? describe(materialNumber) : null,
    }),
  ];
  const assessment = assessIdentity(signals);
  const identity = {
    status: assessment.status,
    confidence: assessment.confidence,
    signals,
  };

  // Et andet selskabs regnskaber (et tidligere dansk CVR eller et andet nummer) fjernes, så de
  // aldrig blandes med det rigtige selskabs tal.
  const previous = company.cvr_number ?? storedNumber;
  if (mayFind && previous && previous !== match.registryNumber) {
    try {
      await retireCaseFinancials(service, {
        fundId: input.fundId,
        caseId: input.caseId,
        keepRegistryNumber: match.registryNumber,
      });
      problems.push(msg("lookup.numberChanged", { from: previous, to: match.registryNumber }));
    } catch (cause) {
      console.error(`[registry:${input.country}] retire old financials failed`, cause);
      problems.push(msg("lookup.oldNotRemoved"));
    }
  }
  if (mayFind) {
    const update: Record<string, unknown> = {
      // Et selskab har højst ét registernummer (0083).
      cvr_number: null,
      registry_country: input.country,
      registry_number: match.registryNumber,
      updated_at: new Date().toISOString(),
    };
    // Et menneskes afgørelse ("ikke dansk") står; ellers gemmes kodens vurdering.
    if (!input.humanDecided) {
      update["identity_status"] = identity.status;
      update["identity_confidence"] = identity.confidence;
      update["identity_signals"] = { signals, problems, assessedAt: new Date().toISOString() };
      update["domains"] = [
        ...new Set([...(company.domains ?? []), ...(input.websiteHost ? [input.websiteHost] : [])]),
      ];
    }
    if (!company.legal_name) update["legal_name"] = match.name;
    // Registrets land afgør landet, medmindre et menneske har rettet det (som CVR, 0080).
    if (company.profile_source?.["hq_country"] !== "human") {
      update["hq_country"] = input.country;
      update["profile_source"] = { ...(company.profile_source ?? {}), hq_country: "registry" };
    }
    const { error } = await service
      .from("companies")
      .update(update)
      .eq("id", input.companyId)
      .eq("fund_id", input.fundId);
    if (error) {
      console.error(`[registry:${input.country}] company not updated`, error.message);
      problems.push(msg("lookup.notSaved"));
    }
  }

  const label = `${adapter.numberLabel} ${match.registryNumber} (${adapter.registryName})`;
  try {
    const result = await fetchAndStoreForeignFinancials(service, {
      fundId: input.fundId,
      caseId: input.caseId,
      country: input.country,
      registryNumber: match.registryNumber,
      actorId: input.actorId,
    });
    problems.push(...result.warnings);
    return done({
      status: "fetched",
      message: msg("lookup.fetched", { label, count: result.statements.length }),
      identity,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : msg("common.unknownError");
    if (cause instanceof FinancialsNotFoundError) {
      return done({
        status: "not_found",
        message: msg("lookup.foundNoStatements", { label, detail }),
        identity,
      });
    }
    console.warn(`[registry:${input.country}] financials not fetched`, detail);
    return done({
      status: "failed",
      message: msg("lookup.foundNotFetched", { label, reason: detail }),
      identity,
    });
  }
}
