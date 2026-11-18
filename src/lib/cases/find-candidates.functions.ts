/**
 * "Find selskabet" i Opret case. Slår selskabet op, før casen findes, så et menneske kan
 * vælge det rigtige selskab (eller springe valget over, når det er entydigt).
 *
 * - Kræver `create_case` i fonden og er begrænset pr. bruger (opslagene er langsomme og nogle
 *   koster penge).
 * - Datafordelerens nøgle bruges kun her på serveren og sendes aldrig til klienten.
 * - Fejl fra registeret eller modellen vises aldrig som rå tekst (logges); brugeren får en
 *   kort dansk besked og kan prøve igen eller oprette manuelt.
 * - Intet gemmes. Intet herfra er evidens, før et menneske har bekræftet selskabet.
 */
import { registryAdapter } from "@/lib/analysis/registries";
import { FOREIGN_REGISTRY_COUNTRIES } from "@/lib/analysis/registries/types";
import { findForeignCandidates } from "./find-candidates.foreign";
import { requestLanguage } from "@/lib/i18n/server-text";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { rateLimit, requireFundCapability } from "@/lib/auth/access.server";
import {
  fetchCvrRegistryProfile,
  lookupCvrByNumber,
  searchCvrByNames,
} from "@/lib/analysis/cvr-lookup";
import { AiUseLimitError } from "@/lib/ai/usage-limits.server";
import {
  CreditsExhaustedError,
  reserveCallCredits,
  type CallCredits,
} from "@/lib/ai/credits.server";
import {
  lookupCandidatesOnWeb,
  WEB_LOOKUP_CAP_USD,
  WEB_LOOKUP_MODEL,
} from "@/lib/cases/candidate-web-lookup.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import {
  isHomepageRedirect,
  peekHomepage,
  websiteUrlFromInput,
} from "@/lib/cases/homepage-peek.server";
import { hostOf } from "@/lib/analysis/identity";
import {
  findCandidatesCore,
  type FindDeps,
  type FindResult,
} from "@/lib/cases/find-candidates.core";

export type { FindResult } from "@/lib/cases/find-candidates.core";

const WINDOW_MS = 10 * 60_000;
const LIMIT_PER_WINDOW = 15;
/** Registeret er langsomt (15-25 s); et opslag, der hænger, må ikke holde siden fanget. */
const REGISTRY_TIMEOUT_MS = 30_000;
const PROFILE_TIMEOUT_MS = 20_000;

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} tog for lang tid.`)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function realDeps(who: { fundId: string; userId: string }): FindDeps {
  return {
    searchNames: (names) =>
      // i18n-keep: names in a log line; the person reads FindInput.language notes.
      withTimeout(searchCvrByNames(names), REGISTRY_TIMEOUT_MS, "Navnesøgningen"),
    lookupCvr: (cvrNumber) =>
      withTimeout(lookupCvrByNumber(cvrNumber), REGISTRY_TIMEOUT_MS, "CVR-opslaget"),
    profile: async (cvrNumber) => {
      const profile = await withTimeout(
        fetchCvrRegistryProfile(cvrNumber),
        PROFILE_TIMEOUT_MS,
        "Stamdataopslaget",
      );
      if (!profile) return null;
      return {
        startDate: profile.startDate,
        industryText: profile.industryText,
        legalFormText: profile.legalFormText,
        city: profile.location?.city ?? null,
      };
    },
    peek: async (website) => {
      const page = await peekHomepage(website);
      if (isHomepageRedirect(page)) return page;
      return page ? { host: page.host, text: page.text, cvrNumbers: page.cvrNumbers } : null;
    },
    webLookup: async (name) => {
      // The search costs money, so it reserves in the credit ledger like any AI call. An
      // empty balance skips it: the free registry search has run, and the case can still be made.
      let credits: CallCredits;
      try {
        credits = await reserveCallCredits(getServiceClient(), {
          scope: "analysis",
          fundId: who.fundId,
          userId: who.userId,
          maxUsd: WEB_LOOKUP_CAP_USD,
          loop: "case:web_lookup",
          model: WEB_LOOKUP_MODEL,
        });
      } catch (cause) {
        console.warn("[find-candidates] web lookup skipped", {
          fundId: who.fundId,
          cause: cause instanceof Error ? cause.message : cause,
        });
        return {
          candidates: [],
          failed: true,
          skippedForCredits: cause instanceof CreditsExhaustedError,
          // The limit's own text reaches the user instead of a plain failed search.
          ...(cause instanceof AiUseLimitError ? { skippedForLimit: cause.message } : {}),
        };
      }
      try {
        const outcome = await lookupCandidatesOnWeb(name, who.fundId);
        if (outcome.chargeUsd > 0) credits.charge(outcome.chargeUsd);
        return { candidates: outcome.candidates, failed: outcome.failed };
      } finally {
        await credits.settle();
      }
    },
    pageText: async (website) => {
      const page = await peekHomepage(website);
      return page && !isHomepageRedirect(page)
        ? { host: page.host, text: `${page.title} ${page.text}` }
        : null;
    },
    websiteHost: (raw) => {
      const url = websiteUrlFromInput(raw);
      return url ? hostOf(url) : null;
    },
    log: (message, detail) => console.warn(`[find-candidates] ${message}`, detail ?? ""),
  };
}

export const findCompanyCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: z.guid(),
        query: z.string().max(200),
        website: z.string().max(300).default(""),
        /** Another country searches that country's register (fx Enhetsregisteret). */
        country: z.enum(["DK", ...FOREIGN_REGISTRY_COUNTRIES]).default("DK"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FindResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "create_case");
    await rateLimit(`find-candidates:${context.userId}`, LIMIT_PER_WINDOW, WINDOW_MS);
    if (data.country !== "DK") {
      return findForeignCandidates(registryAdapter(data.country), {
        country: data.country,
        query: data.query,
        language: requestLanguage(),
      });
    }
    return findCandidatesCore(realDeps({ fundId: data.fundId, userId: context.userId }), {
      query: data.query,
      website: data.website,
    });
  });
