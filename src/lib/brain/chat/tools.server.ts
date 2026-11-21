import type { SupabaseClient } from "@supabase/supabase-js";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { DECISION_STATS_GROUPS, decisionStats } from "../decision-stats.server";
import { isStandingMove, undoneMoveIds } from "../movement";
import { embedWithGateway } from "../embeddings.server";
import type { WebResult } from "../web/search.server";
import { instructionFlagFields } from "../injection";
import { embedQuery, searchBrain } from "../retrieval.server";
import { entityTimeline } from "../timeline.server";
import {
  BRIEF_KINDS,
  BRIEF_SERIOUS_KINDS,
  BRIEF_MAX_ITEMS,
  briefSeverity,
  severityLabel,
  sortBrief,
} from "./case-brief";
import { isNameTwin, rerankSimilar } from "./similar-rerank";
import { clip, episodeLabel, type SourceRegistry } from "./sources";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";

/**
 * The chat's tools, the ones that exist in phase 2: search, case, find cases, decision
 * statistics, similar cases, timeline and the graph. Pages, playbook, themes and web come with
 * their tickets. Every tool gets `fundId` and the case from the server; the model can neither
 * choose the fund nor write anything. Ids the model passes are checked against the fund by the
 * queries themselves (every query is scoped by fund_id). Rows that may be cited get a number
 * from the answer's source registry; entities never do (their summary is not a source).
 */
export type ChatToolContext = {
  fundId: string;
  /** The case the question is about: graph anchor and default for get_case. */
  caseId: string | null;
  /** @-chosen entities. */
  entityIds: readonly string[];
  /** The answer's message id, written on the searches it caused (brain_retrieval_events). */
  messageId: string;
  registry: SourceRegistry;
  /** Embedding costs the tools book in the chat budget, so the engine counts them in the cap. */
  addCost(usd: number): void;
  /** The results of the web searches the user approved for this question, if any. */
  webResults?: readonly WebResult[];
  /** The team's language; Danish when missing. */
  language?: Language;
};

const uuid = z.guid();
/** public.company_stage (0004, 0023): a free-text stage would make Postgres refuse the query. */
const stageSchema = z
  .enum(["pre_seed", "seed", "series_a", "series_b", "later", "growth", "buyout", "unknown"])
  .describe("The company's stage");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

const MOVEMENTS = [
  "advance",
  "hold",
  "reject",
  "decline_ic",
  "invest",
  "reopen",
  "system",
] as const;
const RECOMMENDATIONS = ["go_forward", "follow", "reject", "outside_thesis_interesting"] as const;
/** The seeded reason codes (0033): told in the team's language, not the stored Danish label. */
const SEEDED_REASONS = [
  "outside_sector",
  "outside_geography",
  "wrong_stage",
  "ticket_mismatch",
  "dealbreaker_hit",
  "weak_founder_market_fit",
  "missing_key_competence",
  "team_risk",
  "small_market",
  "wrong_timing",
  "strong_competition",
  "unclear_solution",
  "technology_risk",
  "no_differentiation",
  "too_early",
  "weak_growth",
  "awaiting_milestone",
  "valuation_too_high",
  "runway_risk",
  "weak_financials",
  "portfolio_overlap",
  "portfolio_construction",
  "founder_withdrew",
  "lost_to_other_investor",
  "deadline",
  "strong_team",
  "large_market",
  "clear_traction",
  "thesis_fit",
  "other",
] as const;
const isOneOf = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value);

type CompanyRow = { name: string; sector: string | null; stage: string | null } | null;
const hostOf = (url: string, language: Language): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return translate(language, "brainServer.chat.web");
  }
};
const one = <T>(value: T | T[] | null | undefined): T | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export function createChatTools(service: SupabaseClient, ctx: ChatToolContext): ToolSet {
  const { fundId, registry } = ctx;
  // Labels saved with the answer and words the model reads follow the team's language.
  const language = ctx.language ?? DEFAULT_LANGUAGE;
  const movementLabel = (kind: string): string =>
    translate(language, `brainServer.chat.movement.${isOneOf(MOVEMENTS, kind) ? kind : "other"}`);
  const recommendationLabel = (value: string): string =>
    isOneOf(RECOMMENDATIONS, value)
      ? translate(language, `brainServer.chat.recommendationLabel.${value}`)
      : value;

  /** The company name of each case, so a note or fact can be told by its case. */
  const caseNames = async (ids: readonly (string | null)[]): Promise<Map<string, string>> => {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const { data, error } = await service
      .from("cases")
      .select("id, companies(name)")
      .eq("fund_id", fundId)
      .in("id", unique);
    // Only a label: a failed lookup leaves the names out instead of failing a paid search.
    if (error) {
      console.warn(`[brain] chat case names: ${error.message}`);
      return new Map();
    }
    return new Map(
      (data ?? []).flatMap((row) => {
        const name = one(row["companies"] as { name: string } | { name: string }[] | null)?.name;
        return name ? [[row["id"] as string, name] as const] : [];
      }),
    );
  };

  return {
    search_brain: tool({
      description:
        "Search all of the team's memory at once: notes, analyses, evidence, uploaded sources and extracted facts. Returns numbered results to cite, and entities (context only).",
      inputSchema: z.object({
        query: z.string().min(2).max(500).describe("What to look for, in the user's words"),
        validAt: day
          .optional()
          .describe("Only for questions about the past: facts valid on this date"),
      }),
      execute: async ({ query, validAt }) => {
        const result = await searchBrain(service, {
          fundId,
          query,
          caseId: ctx.caseId,
          entityIds: ctx.entityIds,
          validAt: validAt ?? null,
          scope: "chat",
          messageId: ctx.messageId,
        });
        ctx.addCost(result.costUsd);
        const nameOf = await caseNames(result.items.map((item) => item.caseId));
        const results: unknown[] = [];
        const entities: unknown[] = [];
        for (const item of result.items) {
          if (item.kind === "entity") {
            entities.push({ entityId: item.id, caseId: item.caseId, text: clip(item.text, 300) });
            continue;
          }
          const quote = item.text.replace(/^\[påstand fra selskabet\] /, "");
          const n = registry.add({
            kind: item.kind,
            id: item.id,
            label:
              item.kind === "fact"
                ? clip(quote, 120)
                : [episodeLabel(item.episodeKind, language), item.title]
                    .filter(Boolean)
                    .join(" · "),
            quote,
            trustTier: item.trustTier,
            ref: item.refs.find((ref) => !/^(episode|fact|entity):/.test(ref)) ?? null,
            caseId: item.caseId,
            at: item.date,
          });
          if (n === null) continue;
          results.push({
            n,
            kind: item.kind,
            text: clip(item.text, 900),
            trust: item.trustTier,
            date: item.date,
            caseId: item.caseId,
            ...(item.caseId && nameOf.has(item.caseId) ? { case: nameOf.get(item.caseId) } : {}),
            ...instructionFlagFields(item.text, item.instructionFlag),
          });
        }
        return {
          questionType: result.questionType,
          results,
          entities,
          ...(result.questionType === "aggregate"
            ? { hint: "For counts and shares, call decision_stats." }
            : {}),
        };
      },
    }),

    get_case: tool({
      description:
        "One case of this team: company, phase and status, the latest screening and deep analysis (score and recommendation) and the case's movements with reasons and notes.",
      inputSchema: z.object({
        caseId: uuid.optional().describe("Defaults to the case in context"),
      }),
      execute: async ({ caseId }) => {
        const id = caseId ?? ctx.caseId;
        if (!id) return { error: "No case given." };
        const { data: row, error } = await service
          .from("cases")
          .select("id, thesis_id, phase, status, created_at, companies(name, sector, stage)")
          .eq("fund_id", fundId)
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(`get_case: ${error.message}`);
        if (!row) return { error: "The case does not exist in this team's data." };
        const company = one(row["companies"] as CompanyRow | CompanyRow[]);
        const name = company?.name ?? translate(language, "brainServer.chat.theCase");
        const [runs, events, undos, labels, thesis] = await Promise.all([
          service
            .from("analysis_runs")
            .select("kind, completed_at, recommendations(overall_score, recommendation, rationale)")
            .eq("fund_id", fundId)
            .eq("case_id", id)
            .eq("status", "complete")
            .order("completed_at", { ascending: false, nullsFirst: false })
            .limit(10),
          service
            .from("case_transition_events")
            .select(
              "id, movement_kind, from_phase, to_phase, from_status, to_status, reason_codes, note, occurred_at, undo_of",
            )
            .eq("fund_id", fundId)
            .eq("case_id", id)
            .not("movement_kind", "is", null)
            .neq("movement_kind", "system")
            // The newest 40, so a case with many moves keeps its standing decision.
            .order("occurred_at", { ascending: false })
            .limit(40),
          // The undo rows are "system" moves, so the query above never sees them.
          service
            .from("case_transition_events")
            .select("undo_of")
            .eq("fund_id", fundId)
            .eq("case_id", id)
            .not("undo_of", "is", null),
          reasonLabels(service, fundId),
          // The thesis the case is judged under (a team can have more than one).
          row["thesis_id"]
            ? service
                .from("fund_theses")
                .select("name, status")
                .eq("fund_id", fundId)
                .eq("id", row["thesis_id"] as string)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (runs.error) throw new Error(`get_case runs: ${runs.error.message}`);
        if (events.error) throw new Error(`get_case events: ${events.error.message}`);
        if (undos.error) throw new Error(`get_case undos: ${undos.error.message}`);

        const latest = new Map<string, Record<string, unknown>>();
        for (const run of runs.data ?? []) {
          if (!latest.has(run["kind"] as string)) latest.set(run["kind"] as string, run);
        }
        const n = registry.add({
          kind: "case",
          id,
          label: name,
          ref: `cases:${id}`,
          caseId: id,
          at: row["created_at"] as string,
        });
        // The case's own number also covers its latest analyses (score, recommendation, reason).
        const analysis = (kind: string) => {
          const run = latest.get(kind);
          const rec = one<Record<string, unknown>>(
            run?.["recommendations"] as Record<string, unknown> | Record<string, unknown>[] | null,
          );
          if (!run || !rec) return null;
          return {
            n,
            completedAt: String(run["completed_at"] ?? "").slice(0, 10),
            score: rec["overall_score"] === null ? null : Number(rec["overall_score"]),
            recommendation: recommendationLabel(rec["recommendation"] as string),
            rationale: clip(String(rec["rationale"] ?? ""), 600),
            ...instructionFlagFields(String(rec["rationale"] ?? "")),
          };
        };
        // An undone move is no decision: it is left out, so it can neither be told nor cited.
        const undone = undoneMoveIds(undos.data ?? []);
        const standing = [...(events.data ?? [])]
          .reverse()
          .filter((event) =>
            isStandingMove({ id: event["id"], undo_of: event["undo_of"] }, undone),
          );
        const movements = standing.map((event) => {
          const reasons = ((event["reason_codes"] as string[] | null) ?? []).map(
            // A seeded code in the team's language; a code without a label is never
            // handed to the model raw.
            (code) =>
              isOneOf(SEEDED_REASONS, code)
                ? translate(language, `brainServer.chat.reason.${code}`)
                : (labels.get(code) ?? reasonCodeText(code)),
          );
          const kind = movementLabel(event["movement_kind"] as string);
          const date = String(event["occurred_at"]).slice(0, 10);
          const note = (event["note"] as string | null)?.trim() || null;
          const eventN = registry.add({
            kind: "event",
            id: event["id"] as string,
            label: `${kind} · ${date}`,
            quote:
              [
                reasons.length
                  ? translate(language, "brainServer.chat.reasons", { reasons: reasons.join(", ") })
                  : null,
                note,
              ]
                .filter(Boolean)
                .join(". ") || null,
            ref: `case_transition_events:${event["id"] as string}`,
            caseId: id,
            at: event["occurred_at"] as string,
          });
          return {
            n: eventN,
            movement: kind,
            date,
            from: `${event["from_phase"] ?? ""}/${event["from_status"] ?? ""}`,
            to: `${event["to_phase"] ?? ""}/${event["to_status"] ?? ""}`,
            reasons,
            note: note ? clip(note, 400) : null,
            ...instructionFlagFields(note ?? ""),
          };
        });
        return {
          n,
          caseId: id,
          company: name,
          sector: company?.sector ?? null,
          stage: company?.stage ?? null,
          phase: row["phase"],
          status: row["status"],
          // Only a label: a failed lookup leaves it out instead of failing the answer.
          thesis: (thesis.data?.["name"] as string | undefined) ?? null,
          thesisArchived: thesis.data?.["status"] === "archived",
          created: String(row["created_at"]).slice(0, 10),
          screening: analysis("screening"),
          deepAnalysis: analysis("deep"),
          movements,
        };
      },
    }),

    ...(ctx.webResults && ctx.webResults.length > 0
      ? {
          web_search: tool({
            description:
              "The web searches the user approved for this question, already run: for each query a short answer and the sources it rests on. Takes no arguments; you cannot search for anything yourself. Public web material, never verified.",
            inputSchema: z.object({}),
            execute: async () => ({
              results: (ctx.webResults ?? []).map((result) => {
                const numbers = result.sources.flatMap((source) => {
                  const n = registry.add({
                    kind: "web",
                    id: source.url,
                    label: source.title ?? hostOf(source.url, language),
                    quote: clip(result.text, 600),
                    trustTier: "public_web",
                  });
                  return n === null ? [] : [n];
                });
                return { query: result.query, answer: result.text, sources: numbers };
              }),
              note: "Web claims are public and unverified. Cite a claim with the number of one of its sources.",
            }),
          }),
        }
      : {}),
    case_brief: tool({
      description:
        "Everything Brain holds about one case in one list, the most serious first: risks, weaknesses, contradictory evidence, calculations, analysis summaries and notes. Call this first for any question about what to know, watch or do on a case. Each row has a number to cite.",
      inputSchema: z.object({
        caseId: uuid.optional().describe("Defaults to the case in context"),
      }),
      execute: async ({ caseId }) => {
        const id = caseId ?? ctx.caseId;
        if (!id) return { error: "No case given." };
        // The serious kinds are read on their own, newest first, so a case with many
        // evidence rows can never push a critical risk out of the rows that are sorted below.
        const read = (kinds: readonly string[], limit: number) =>
          service
            .from("brain_episodes")
            .select(
              "id, kind, title, trust_tier, occurred_at, recorded_at, ref_table, ref_id, content, instruction_flag",
            )
            .eq("fund_id", fundId)
            .eq("case_id", id)
            .in("kind", [...kinds])
            .is("superseded_at", null)
            .order("recorded_at", { ascending: false })
            .limit(limit);
        const [serious, rest] = await Promise.all([
          read(BRIEF_SERIOUS_KINDS, 300),
          read(
            BRIEF_KINDS.filter((kind) => !BRIEF_SERIOUS_KINDS.includes(kind)),
            400,
          ),
        ]);
        const error = serious.error ?? rest.error;
        if (error) throw new Error(`case_brief: ${error.message}`);
        const episodes = [...(serious.data ?? []), ...(rest.data ?? [])];
        if (!episodes.length) {
          return { caseId: id, items: [], note: "Brain holds nothing about this case yet." };
        }
        // The first chunk of an episode is the row a citation points to (as in search_brain).
        const { data: chunks, error: chunkError } = await service
          .from("brain_chunks")
          .select("id, episode_id")
          .eq("fund_id", fundId)
          .eq("ordinal", 0)
          .in(
            "episode_id",
            episodes.map((episode) => episode["id"] as string),
          );
        if (chunkError) throw new Error(`case_brief chunks: ${chunkError.message}`);
        const chunkOf = new Map(
          (chunks ?? []).map((chunk) => [chunk["episode_id"] as string, chunk["id"] as string]),
        );
        const rows = sortBrief(
          episodes.flatMap((episode) => {
            const chunkId = chunkOf.get(episode["id"] as string);
            if (!chunkId) return [];
            return [
              {
                kind: episode["kind"] as string,
                title: (episode["title"] as string | null) ?? null,
                content: String(episode["content"] ?? ""),
                at: String(episode["occurred_at"] ?? episode["recorded_at"] ?? "") || null,
                episode,
                chunkId,
              },
            ];
          }),
        );
        const items: unknown[] = [];
        for (const row of rows) {
          if (items.length >= BRIEF_MAX_ITEMS) break;
          const { episode } = row;
          const quote = row.content.replace(/^\[påstand fra selskabet\] /, "");
          const n = registry.add({
            kind: "chunk",
            id: row.chunkId,
            label: [episodeLabel(row.kind, language), row.title].filter(Boolean).join(" · "),
            quote,
            trustTier: episode["trust_tier"] as string | null,
            ref:
              episode["ref_table"] && episode["ref_id"]
                ? `${episode["ref_table"] as string}:${episode["ref_id"] as string}`
                : null,
            caseId: id,
            at: row.at,
          });
          if (n === null) break;
          items.push({
            n,
            kind: row.kind,
            seriousness: severityLabel(briefSeverity(row)),
            text: clip(quote, 600),
            trust: episode["trust_tier"],
            date: row.at?.slice(0, 10) ?? null,
            ...instructionFlagFields(quote, episode["instruction_flag"] as string[] | null),
          });
        }
        return {
          caseId: id,
          items,
          ...(rows.length > items.length
            ? { omitted: rows.length - items.length, note: "Less serious rows are left out." }
            : {}),
        };
      },
    }),

    find_cases: tool({
      description:
        "List this team's cases by company name, phase, status, sector or stage. Newest first.",
      inputSchema: z.object({
        name: z.string().min(1).max(80).optional(),
        phase: z.enum(["screening", "deep_analysis", "committee", "decided"]).optional(),
        status: z.enum(["active", "on_hold", "closed", "invested"]).optional(),
        sector: z.string().max(80).optional(),
        stage: stageSchema.optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async (input) => {
        let query = service
          .from("cases")
          .select("id, phase, status, created_at, companies!inner(name, sector, stage)")
          .eq("fund_id", fundId)
          .order("created_at", { ascending: false })
          .limit(input.limit ?? 15);
        if (input.name) query = query.ilike("companies.name", likePattern(input.name));
        if (input.phase) query = query.eq("phase", input.phase);
        if (input.status) query = query.eq("status", input.status);
        if (input.sector) query = query.ilike("companies.sector", likePattern(input.sector));
        if (input.stage) query = query.eq("companies.stage", input.stage);
        const { data, error } = await query;
        if (error) throw new Error(`find_cases: ${error.message}`);
        return {
          cases: (data ?? []).map((row) => {
            const company = one(row["companies"] as CompanyRow | CompanyRow[]);
            const id = row["id"] as string;
            return {
              n: registry.add({
                kind: "case",
                id,
                label: company?.name ?? translate(language, "brainServer.chat.theCase"),
                ref: `cases:${id}`,
                caseId: id,
                at: row["created_at"] as string,
              }),
              caseId: id,
              company: company?.name ?? null,
              sector: company?.sector ?? null,
              stage: company?.stage ?? null,
              phase: row["phase"],
              status: row["status"],
              created: String(row["created_at"]).slice(0, 10),
            };
          }),
        };
      },
    }),

    decision_stats: tool({
      description:
        "Fixed statistics over the team's own decisions, computed by code: funnel (cases per phase and status), reasons (why cases were rejected, declined or invested), score_vs_decision (scores per decision) and time_in_phase (average days per phase).",
      inputSchema: z.object({
        groupBy: z.enum(DECISION_STATS_GROUPS),
        sector: z.string().max(80).optional(),
        stage: stageSchema.optional(),
        from: day.optional(),
        to: day.optional().describe("Exclusive"),
      }),
      execute: async ({ groupBy, sector, stage, from, to }) =>
        decisionStats(service, fundId, groupBy, {
          sector: sector ?? null,
          stage: stage ?? null,
          from: from ?? null,
          to: to ?? null,
        }),
    }),

    similar_cases: tool({
      description:
        "Earlier cases of this team that resemble a case (by its profile) or a description.",
      inputSchema: z.object({
        caseId: uuid
          .optional()
          .describe("Find cases like this one (defaults to the case in context)"),
        text: z.string().min(3).max(500).optional().describe("Or: a description to match"),
      }),
      execute: async ({ caseId, text }) => {
        const id = caseId ?? (text ? null : ctx.caseId);
        let embedding: string | null = null;
        if (id) {
          const { data, error } = await service
            .from("brain_entities")
            .select("embedding")
            .eq("fund_id", fundId)
            .eq("ref_table", "cases")
            .eq("ref_id", id)
            .maybeSingle();
          if (error) throw new Error(`similar_cases: ${error.message}`);
          embedding = (data?.["embedding"] as string | null) ?? null;
          if (!embedding) return { cases: [], note: "Brain has no profile of this case yet." };
        } else if (text) {
          const { vector, costUsd } = await embedQuery(
            service,
            { fundId, query: text, scope: "chat" },
            text,
            embedWithGateway,
          );
          ctx.addCost(costUsd);
          embedding = JSON.stringify(vector);
        } else {
          return { error: "Give a caseId or a text." };
        }
        const { data: hits, error } = await service.rpc("brain_search_entities", {
          _fund_id: fundId,
          _query: null,
          _query_embedding: embedding,
          _types: ["case"],
          // A wider pool than the ten shown, so the sector bonus can reach a close match below rank 10.
          _limit: 31,
        });
        if (error) throw new Error(`similar_cases search: ${error.message}`);
        const ids = ((hits ?? []) as Array<{ entity_id: string }>).map((hit) => hit.entity_id);
        if (ids.length === 0) return { cases: [] };
        const { data: entities, error: entityError } = await service
          .from("brain_entities")
          .select("id, name, ref_id")
          .eq("fund_id", fundId)
          .eq("status", "active")
          .eq("ref_table", "cases")
          .in("id", ids);
        if (entityError) throw new Error(`similar_cases entities: ${entityError.message}`);
        const byId = new Map((entities ?? []).map((row) => [row["id"] as string, row]));
        const matches = ids
          .map((entityId) => byId.get(entityId))
          .filter((row): row is NonNullable<typeof row> => !!row && row["ref_id"] !== id);
        if (matches.length === 0) return { cases: [] };
        // Same sector (and stage) lifts a look-alike a little; a text query has no focus.
        const profileIds = [
          ...new Set([...(id ? [id] : []), ...matches.map((row) => row["ref_id"] as string)]),
        ];
        const { data: profileRows, error: profileError } = await service
          .from("cases")
          .select("id, phase, status, company_id, companies(name, sector, stage, description)")
          .eq("fund_id", fundId)
          .in("id", profileIds);
        if (profileError) throw new Error(`similar_cases profiles: ${profileError.message}`);
        const profileOf = new Map(
          (profileRows ?? []).map((row) => {
            const company = one(
              row["companies"] as
                | (CompanyRow & { description: string | null })
                | (CompanyRow & { description: string | null })[],
            );
            return [
              row["id"] as string,
              {
                sector: company?.sector ?? null,
                stage: company?.stage ?? null,
                name: company?.name ?? null,
                description: company?.description ?? null,
                companyId: row["company_id"] as string,
                phase: row["phase"] as string,
                status: row["status"] as string,
              },
            ] as const;
          }),
        );
        const focus = id ? (profileOf.get(id) ?? null) : null;
        const cases = rerankSimilar(
          focus,
          matches.map((row) => ({
            row,
            ...(profileOf.get(row["ref_id"] as string) ?? { sector: null, stage: null }),
          })),
        )
          .map((entry) => entry.row)
          .slice(0, 10)
          .map((row, index) => {
            const similarCase = row["ref_id"] as string;
            const profile = profileOf.get(similarCase);
            const company = profile?.name ?? (row["name"] as string);
            // What the company does is what makes it alike; the name never is.
            const does = profile?.description ? clip(profile.description, 300) : null;
            return {
              n: registry.add({
                kind: "case",
                id: similarCase,
                label: company,
                ref: `cases:${similarCase}`,
                caseId: similarCase,
              }),
              caseId: similarCase,
              company,
              does,
              sector: profile?.sector ?? null,
              stage: profile?.stage ?? null,
              phase: profile?.phase ?? null,
              status: profile?.status ?? null,
              rank: index + 1,
              ...(focus?.name &&
              profile &&
              isNameTwin(
                { name: focus.name, companyId: focus.companyId },
                { name: company, companyId: profile.companyId },
              )
                ? { sameNameOnly: true }
                : {}),
              ...(does ? instructionFlagFields(does) : {}),
            };
          });
        return {
          cases,
          note: "Judge likeness by what the companies do (does) and their sector, never by name; sameNameOnly marks another company that only shares the case's name. Call get_case for what happened to the ones that really resemble it.",
        };
      },
    }),

    timeline: tool({
      description:
        "All facts Brain knows about one entity (company, person ...) in time order, including facts that were later replaced. For questions about how something developed.",
      inputSchema: z.object({
        entityId: uuid,
        from: day.optional(),
        to: day.optional(),
      }),
      execute: async ({ entityId, from, to }) => {
        const entries = await entityTimeline(service, fundId, entityId, {
          from: from ?? null,
          to: to ?? null,
        });
        return {
          facts: entries.slice(-60).map((entry) => ({
            n: registry.add({
              kind: "fact",
              id: entry.factId,
              label: clip(entry.statement, 120),
              quote: entry.statement,
              trustTier: entry.trustTier,
              at: entry.validFrom ?? entry.recordedAt,
            }),
            statement: clip(entry.statement, 400),
            ...instructionFlagFields(entry.statement),
            validFrom: entry.validFrom,
            validTo: entry.validTo,
            state: entry.state,
            trust: entry.trustTier,
          })),
        };
      },
    }),

    graph_neighbors: tool({
      description:
        "Facts that connect an entity to others (one or two hops), e.g. founders, investors, sectors.",
      inputSchema: z.object({
        entityId: uuid,
        predicate: z.string().max(60).optional(),
        depth: z.number().int().min(1).max(2).optional(),
      }),
      execute: async ({ entityId, predicate, depth }) => {
        const facts = new Map<string, NeighborRow>();
        let frontier = [entityId];
        for (let hop = 0; hop < (depth ?? 1) && frontier.length > 0; hop += 1) {
          const rows = await neighbors(service, fundId, frontier, 200);
          const next = new Set<string>();
          for (const row of rows) {
            if (predicate && row.predicate !== predicate) continue;
            if (facts.size >= 200) break;
            facts.set(row.fact_id, row);
            for (const other of [row.subject_id, row.object_id]) {
              if (other && !frontier.includes(other)) next.add(other);
            }
          }
          frontier = [...next].slice(0, 25);
        }
        return {
          facts: await describeFacts(service, fundId, [...facts.values()].slice(0, 60), registry),
        };
      },
    }),

    graph_path: tool({
      description:
        "The shortest chain of facts between two entities (at most 4 steps), e.g. how a founder is connected to a rejected case.",
      inputSchema: z.object({
        fromEntityId: uuid,
        toEntityId: uuid,
        maxDepth: z.number().int().min(1).max(4).optional(),
      }),
      execute: async ({ fromEntityId, toEntityId, maxDepth }) => {
        const { data, error } = await service.rpc("brain_graph_path", {
          _fund_id: fundId,
          _from_entity: fromEntityId,
          _to_entity: toEntityId,
          _max_depth: maxDepth ?? 4,
        });
        if (error) throw new Error(`graph_path: ${error.message}`);
        const steps = (data ?? []) as Array<{
          step: number;
          entity_id: string;
          fact_id: string | null;
        }>;
        if (steps.length === 0) return { path: [], note: "No connection found." };
        const factIds = steps.map((step) => step.fact_id).filter((id): id is string => !!id);
        const { data: factRows, error: factError } = factIds.length
          ? await service
              .from("brain_facts")
              .select(
                "id, subject_id, predicate, object_id, statement, valid_from, trust_tier, recorded_at",
              )
              .eq("fund_id", fundId)
              .in("id", factIds)
          : { data: [], error: null };
        if (factError) throw new Error(`graph_path facts: ${factError.message}`);
        const described = await describeFacts(
          service,
          fundId,
          (factRows ?? []).map((row) => ({
            fact_id: row["id"] as string,
            subject_id: row["subject_id"] as string,
            predicate: row["predicate"] as string,
            object_id: row["object_id"] as string | null,
            statement: row["statement"] as string,
            valid_from: row["valid_from"] as string | null,
            trust_tier: row["trust_tier"] as string,
            recorded_at: row["recorded_at"] as string,
          })),
          registry,
        );
        const byFact = new Map(described.map((fact) => [fact.factId, fact]));
        return {
          path: steps.map((step) => ({
            step: step.step,
            entityId: step.entity_id,
            fact: step.fact_id ? (byFact.get(step.fact_id) ?? null) : null,
          })),
        };
      },
    }),
  };
}

type NeighborRow = {
  fact_id: string;
  subject_id: string;
  predicate: string;
  object_id: string | null;
  statement: string;
  valid_from: string | null;
  trust_tier: string;
  recorded_at: string;
};

async function neighbors(
  service: SupabaseClient,
  fundId: string,
  entityIds: string[],
  limit: number,
): Promise<NeighborRow[]> {
  const { data, error } = await service.rpc("brain_graph_neighbors", {
    _fund_id: fundId,
    _entity_ids: entityIds,
    _valid_at: null,
    _limit: limit,
  });
  if (error) throw new Error(`graph_neighbors: ${error.message}`);
  return (data ?? []) as NeighborRow[];
}

/** Facts with the names of both ends, each numbered as a source. */
async function describeFacts(
  service: SupabaseClient,
  fundId: string,
  rows: NeighborRow[],
  registry: SourceRegistry,
) {
  const entityIds = [
    ...new Set(rows.flatMap((row) => [row.subject_id, row.object_id]).filter(Boolean) as string[]),
  ];
  const names = new Map<string, string>();
  if (entityIds.length > 0) {
    const { data, error } = await service
      .from("brain_entities")
      .select("id, name")
      .eq("fund_id", fundId)
      .in("id", entityIds);
    if (error) throw new Error(`graph names: ${error.message}`);
    for (const row of data ?? []) names.set(row["id"] as string, row["name"] as string);
  }
  return rows.map((row) => ({
    n: registry.add({
      kind: "fact",
      id: row.fact_id,
      label: clip(row.statement, 120),
      quote: row.statement,
      trustTier: row.trust_tier,
      at: row.valid_from ?? row.recorded_at,
    }),
    factId: row.fact_id,
    subject: { entityId: row.subject_id, name: names.get(row.subject_id) ?? null },
    predicate: row.predicate,
    object: row.object_id
      ? { entityId: row.object_id, name: names.get(row.object_id) ?? null }
      : null,
    statement: clip(row.statement, 300),
    trust: row.trust_tier,
  }));
}

async function reasonLabels(service: SupabaseClient, fundId: string): Promise<Map<string, string>> {
  const { data, error } = await service
    .from("brain_reason_codes")
    .select("code, label")
    .eq("fund_id", fundId);
  if (error) throw new Error(`reason codes: ${error.message}`);
  return new Map((data ?? []).map((row) => [row["code"] as string, row["label"] as string]));
}

/** A reason code without a label as words ("outside_sector" -> "outside sector"). */
export function reasonCodeText(code: string): string {
  return code.replace(/_+/g, " ").trim();
}

/** Escapes what means something in an ilike pattern. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_,()]/g, " ").trim()}%`;
}
