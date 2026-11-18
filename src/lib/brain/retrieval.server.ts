import type { SupabaseClient } from "@supabase/supabase-js";
import { EMBEDDING_MODEL, embeddingCostUsd, estimateEmbeddingUsd } from "./capture";
import { embedWithGateway, type BrainEmbedder } from "./embeddings.server";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { BrainBudgetReachedError } from "./errors";
import type { BudgetScope } from "./jobs";
import {
  ftsQuery,
  parseRankingWeights,
  questionType,
  rankCandidates,
  type QuestionType,
  type RankedCandidate,
} from "./retrieval";

/**
 * Brain's search engine without chat, pages, lessons and themes (they come with their
 * tickets): chunks, facts and entities are searched in parallel (FTS/trigram + vector), the top
 * entities and the case are expanded one hop in the graph, the lists are merged in code with
 * the fund's ranking weights, and every search is logged in brain_retrieval_events. Callers
 * check access; fundId always comes from the server.
 */

const LIST_LIMIT = 30;
const GRAPH_LIMIT = 50;
const RESULT_LIMIT = 20;
const LOGGED_CANDIDATES = 50;

export type RetrievalRequest = {
  fundId: string;
  query: string;
  /** The case the question is about (panel, chat on a case): graph anchor and distance 0. */
  caseId?: string | null;
  /** @-mentioned entities (the UI sends their ids). */
  entityIds?: readonly string[];
  /** Questions about the past: facts valid on this date (YYYY-MM-DD). */
  validAt?: string | null;
  /** Which monthly budget pays for the query embedding. */
  scope: BudgetScope;
  /** The chat answer this search serves (brain_retrieval_events.message_id); null for loops. */
  messageId?: string | null;
};

export type RetrievedItem = {
  kind: "chunk" | "fact" | "entity";
  id: string;
  text: string;
  trustTier: string | null;
  date: string | null;
  score: number;
  lists: string[];
  /** "table:id" of the raw rows behind the item (episode sources), for citations and eval. */
  refs: string[];
  caseId: string | null;
  /** Chunks: the episode's kind (case_note, evidence ...) and title, for the citation label. */
  episodeKind: string | null;
  title: string | null;
  /** The instruction flag L1 stored on the item's episode(s); null when none. */
  instructionFlag: string[] | null;
};

export type RetrievalResult = {
  questionType: QuestionType;
  items: RetrievedItem[];
  costUsd: number;
  logged: boolean;
};

type Candidate = RankedCandidate & {
  kind: RetrievedItem["kind"];
  id: string;
  text: string;
  refs: string[];
  caseId: string | null;
  episodeKind: string | null;
  title: string | null;
  instructionFlag: string[] | null;
};

export async function searchBrain(
  service: SupabaseClient,
  request: RetrievalRequest,
  embed: BrainEmbedder = embedWithGateway,
  now = new Date(),
): Promise<RetrievalResult> {
  const query = request.query.trim().slice(0, 4000);
  if (!query) throw new Error("searchBrain: empty query");
  const type = questionType(query);
  const { vector, costUsd } = await embedQuery(service, request, query, embed);
  const embedding = JSON.stringify(vector);

  const text = ftsQuery(query);
  const [chunkHits, caseChunkHits, factHits, entityHits, settings, caseEntity] = await Promise.all([
    rpcHits(service, "brain_search_chunks", {
      _fund_id: request.fundId,
      _query: text,
      _query_embedding: embedding,
      _case_id: null,
      _kinds: null,
      _limit: LIST_LIMIT,
    }),
    // On a case (panel, chat on the case page) the case's own text is searched as well: many
    // cases say similar things, and fund-wide lists would not reach this one's.
    request.caseId
      ? rpcHits(
          service,
          "brain_search_chunks",
          {
            _fund_id: request.fundId,
            _query: text,
            _query_embedding: embedding,
            _case_id: request.caseId,
            _kinds: null,
            _limit: LIST_LIMIT,
          },
          "chunk_case",
        )
      : Promise.resolve([]),
    rpcHits(service, "brain_search_facts", {
      _fund_id: request.fundId,
      _query: text,
      _query_embedding: embedding,
      _valid_at: request.validAt ?? null,
      _subject_ids: null,
      _limit: LIST_LIMIT,
    }),
    rpcHits(service, "brain_search_entities", {
      _fund_id: request.fundId,
      _query: query,
      _query_embedding: embedding,
      _types: null,
      _limit: LIST_LIMIT,
    }),
    service
      .from("brain_fund_settings")
      .select("ranking_weights")
      .eq("fund_id", request.fundId)
      .maybeSingle(),
    request.caseId
      ? service
          .from("brain_entities")
          .select("id")
          .eq("fund_id", request.fundId)
          .eq("ref_table", "cases")
          .eq("ref_id", request.caseId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (settings.error) throw new Error(`brain_fund_settings: ${settings.error.message}`);
  if (caseEntity.error) throw new Error(`case entity: ${caseEntity.error.message}`);

  // One hop from the top entities, the case and the @-entities.
  const anchors = new Set<string>(request.entityIds ?? []);
  if (caseEntity.data) anchors.add(caseEntity.data["id"] as string);
  const topEntities = [...new Set(entityHits.map((hit) => hit.id))].slice(0, 5);
  const graphFrom = [...new Set([...anchors, ...topEntities])];
  const graphHits = graphFrom.length
    ? await graphNeighbors(service, request.fundId, graphFrom, request.validAt ?? null)
    : [];

  const candidates = await buildCandidates(service, request, {
    chunkHits: [...chunkHits, ...caseChunkHits],
    factHits: [...factHits, ...graphHits],
    entityHits,
    anchors,
  });
  const ranked = rankCandidates(
    candidates,
    parseRankingWeights(settings.data?.["ranking_weights"]),
    now,
  );
  const logged = await logSearch(service, request.fundId, query, ranked, request.messageId ?? null);

  return {
    questionType: type,
    items: ranked.slice(0, RESULT_LIMIT).map((candidate) => ({
      kind: candidate.kind,
      id: candidate.id,
      // i18n-keep: the claim marker is read by the chat model (prompt rule 4), not by people.
      text:
        candidate.trustTier === "company_claim"
          ? `[påstand fra selskabet] ${candidate.text}`
          : candidate.text,
      trustTier: candidate.trustTier,
      date: candidate.date ? candidate.date.toISOString().slice(0, 10) : null,
      score: Number(candidate.score.toFixed(4)),
      lists: Object.keys(candidate.ranks),
      refs: candidate.refs,
      caseId: candidate.caseId,
      episodeKind: candidate.episodeKind,
      title: candidate.title,
      instructionFlag: candidate.instructionFlag,
    })),
    costUsd,
    logged,
  };
}

/** The query's embedding, reserved and booked in the caller's budget (rule 3). */
export async function embedQuery(
  service: SupabaseClient,
  request: RetrievalRequest,
  query: string,
  embed: BrainEmbedder,
): Promise<{ vector: number[]; costUsd: number }> {
  // The query is masked like the stored texts it is compared with.
  const redactor = await redactorForFund(request.fundId, "brain_search", service);
  const { data: usageId, error } = await service.rpc("brain_reserve_budget", {
    _fund_id: request.fundId,
    _scope: request.scope,
    _max_usd: estimateEmbeddingUsd([query]),
    _loop: null,
    _ref_id: null,
    _model: EMBEDDING_MODEL,
  });
  if (error) throw new Error(`brain_reserve_budget: ${error.message}`);
  if (usageId === null || usageId === undefined) throw new BrainBudgetReachedError(request.scope);
  let result: { embeddings: number[][]; tokens: number };
  try {
    result = await embed([query], redactor);
  } catch (cause) {
    const { error: releaseError } = await service.rpc("brain_release_usage", {
      _usage_id: usageId,
      _fund_id: request.fundId,
    });
    if (releaseError) console.error("[brain] search reservation not released", releaseError.code);
    throw cause;
  }
  const costUsd = embeddingCostUsd(result.tokens);
  const { error: finalizeError } = await service.rpc("brain_finalize_usage", {
    _usage_id: usageId,
    _fund_id: request.fundId,
    _cost_usd: costUsd,
    _input_tokens: result.tokens,
    _output_tokens: null,
  });
  if (finalizeError) throw new Error(`brain_finalize_usage: ${finalizeError.message}`);
  const vector = result.embeddings[0];
  if (!vector) throw new Error("searchBrain: no query embedding");
  return { vector, costUsd };
}

type Hit = { id: string; list: string; rank: number };

async function rpcHits(
  service: SupabaseClient,
  fn: "brain_search_chunks" | "brain_search_facts" | "brain_search_entities",
  args: Record<string, unknown>,
  listPrefix?: string,
): Promise<Hit[]> {
  const { data, error } = await service.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  const idField =
    fn === "brain_search_chunks"
      ? "chunk_id"
      : fn === "brain_search_facts"
        ? "fact_id"
        : "entity_id";
  const prefix =
    listPrefix ??
    (fn === "brain_search_chunks" ? "chunk" : fn === "brain_search_facts" ? "fact" : "entity");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row[idField] as string,
    list: `${prefix}_${row["list"] as string}`,
    rank: row["rank"] as number,
  }));
}

async function graphNeighbors(
  service: SupabaseClient,
  fundId: string,
  entityIds: string[],
  validAt: string | null,
): Promise<Hit[]> {
  const { data, error } = await service.rpc("brain_graph_neighbors", {
    _fund_id: fundId,
    _entity_ids: entityIds,
    _valid_at: validAt,
    _limit: GRAPH_LIMIT,
  });
  if (error) throw new Error(`brain_graph_neighbors: ${error.message}`);
  return ((data ?? []) as Array<{ fact_id: string }>).map((row, index) => ({
    id: row.fact_id,
    list: "fact_graph",
    rank: index + 1,
  }));
}

type EpisodeRow = {
  id: string;
  kind: string;
  title: string | null;
  trust_tier: string;
  occurred_at: string | null;
  recorded_at: string;
  ref_table: string | null;
  ref_id: string | null;
  case_id: string | null;
  instruction_flag: string[] | null;
};

/** The reasons stored on any of the episodes, each once; null when none is flagged. */
function storedFlag(episodes: ReadonlyArray<EpisodeRow | undefined>): string[] | null {
  const reasons = [...new Set(episodes.flatMap((episode) => episode?.instruction_flag ?? []))];
  return reasons.length ? reasons : null;
}

async function buildCandidates(
  service: SupabaseClient,
  request: RetrievalRequest,
  hits: { chunkHits: Hit[]; factHits: Hit[]; entityHits: Hit[]; anchors: Set<string> },
): Promise<Candidate[]> {
  const fundId = request.fundId;
  const ranks = (list: Hit[]) => {
    const byId = new Map<string, Record<string, number>>();
    for (const hit of list) {
      const entry = byId.get(hit.id) ?? {};
      entry[hit.list] = Math.min(entry[hit.list] ?? Number.POSITIVE_INFINITY, hit.rank);
      byId.set(hit.id, entry);
    }
    return byId;
  };
  const chunkRanks = ranks(hits.chunkHits);
  const factRanks = ranks(hits.factHits);
  const entityRanks = ranks(hits.entityHits);

  const [chunks, facts, entities, usefulness] = await Promise.all([
    selectIn(service, "brain_chunks", "id, episode_id, content", fundId, [...chunkRanks.keys()]),
    selectIn(
      service,
      "brain_facts",
      "id, subject_id, object_id, statement, trust_tier, status, valid_from, recorded_at",
      fundId,
      [...factRanks.keys()],
    ),
    selectIn(
      service,
      "brain_entities",
      "id, type, name, summary, ref_table, ref_id, last_seen_at",
      fundId,
      [...entityRanks.keys()],
    ),
    usefulnessFor(service, fundId, [
      ...[...chunkRanks.keys()].map((id) => `chunk:${id}`),
      ...[...factRanks.keys()].map((id) => `fact:${id}`),
    ]),
  ]);
  const factSources = await factEpisodes(
    service,
    fundId,
    facts.map((fact) => fact["id"] as string),
  );
  const episodeIds = [
    ...new Set([
      ...chunks.map((chunk) => chunk["episode_id"] as string),
      ...[...factSources.values()].flat(),
    ]),
  ];
  const episodes = new Map(
    (
      (await selectIn(
        service,
        "brain_episodes",
        "id, kind, title, trust_tier, occurred_at, recorded_at, ref_table, ref_id, case_id, instruction_flag",
        fundId,
        episodeIds,
      )) as unknown as EpisodeRow[]
    ).map((episode) => [episode.id, episode]),
  );
  const episodeRefs = (episode: EpisodeRow | undefined) =>
    episode?.ref_table && episode.ref_id ? [`${episode.ref_table}:${episode.ref_id}`] : [];

  const out: Candidate[] = [];
  for (const chunk of chunks) {
    const id = chunk["id"] as string;
    const episode = episodes.get(chunk["episode_id"] as string);
    out.push({
      kind: "chunk",
      id,
      key: `chunk:${id}`,
      ranks: chunkRanks.get(id) ?? {},
      text: chunk["content"] as string,
      trustTier: episode?.trust_tier ?? null,
      date: toDate(episode?.occurred_at ?? episode?.recorded_at ?? null),
      hops: request.caseId && episode?.case_id === request.caseId ? 0 : null,
      usefulness: usefulness.get(`chunk:${id}`) ?? null,
      refs: [`episode:${episode?.id ?? ""}`, ...episodeRefs(episode)],
      caseId: episode?.case_id ?? null,
      episodeKind: episode?.kind ?? null,
      title: episode?.title ?? null,
      instructionFlag: storedFlag([episode]),
    });
  }
  for (const fact of facts) {
    const id = fact["id"] as string;
    // A proposed fact (web, chat note, upload decision) never enters an answer as a fact.
    if (fact["status"] !== "active") continue;
    const sources = (factSources.get(id) ?? []).map((episodeId) => episodes.get(episodeId));
    const touchesAnchor =
      hits.anchors.has(fact["subject_id"] as string) ||
      hits.anchors.has((fact["object_id"] as string | null) ?? "");
    out.push({
      kind: "fact",
      id,
      key: `fact:${id}`,
      ranks: factRanks.get(id) ?? {},
      text: fact["statement"] as string,
      trustTier: fact["trust_tier"] as string,
      date: toDate((fact["valid_from"] as string | null) ?? (fact["recorded_at"] as string)),
      hops: touchesAnchor ? 0 : factRanks.get(id)?.["fact_graph"] !== undefined ? 1 : null,
      usefulness: usefulness.get(`fact:${id}`) ?? null,
      refs: [`fact:${id}`, ...sources.flatMap((episode) => episodeRefs(episode))],
      caseId: sources.find((episode) => episode?.case_id)?.case_id ?? null,
      episodeKind: null,
      title: null,
      instructionFlag: storedFlag(sources),
    });
  }
  for (const entity of entities) {
    const id = entity["id"] as string;
    const summary = (entity["summary"] as string | null) ?? "";
    out.push({
      kind: "entity",
      id,
      key: `entity:${id}`,
      ranks: entityRanks.get(id) ?? {},
      text: summary ? `${entity["name"] as string}: ${summary}` : (entity["name"] as string),
      trustTier: null,
      date: toDate(entity["last_seen_at"] as string | null),
      hops: hits.anchors.has(id) ? 0 : null,
      usefulness: null,
      refs: [
        `entity:${id}`,
        ...(entity["ref_table"] && entity["ref_id"]
          ? [`${entity["ref_table"] as string}:${entity["ref_id"] as string}`]
          : []),
      ],
      caseId: entity["ref_table"] === "cases" ? (entity["ref_id"] as string) : null,
      episodeKind: null,
      title: null,
      instructionFlag: null,
    });
  }
  return out;
}

async function selectIn(
  service: SupabaseClient,
  table: string,
  columns: string,
  fundId: string,
  ids: string[],
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  const { data, error } = await service
    .from(table)
    .select(columns)
    .eq("fund_id", fundId)
    .in("id", ids);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

async function factEpisodes(
  service: SupabaseClient,
  fundId: string,
  factIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (factIds.length === 0) return out;
  const { data, error } = await service
    .from("brain_fact_episodes")
    .select("fact_id, episode_id")
    .eq("fund_id", fundId)
    .in("fact_id", factIds);
  if (error) throw new Error(`brain_fact_episodes: ${error.message}`);
  for (const row of data ?? []) {
    const list = out.get(row["fact_id"] as string) ?? [];
    list.push(row["episode_id"] as string);
    out.set(row["fact_id"] as string, list);
  }
  return out;
}

async function usefulnessFor(
  service: SupabaseClient,
  fundId: string,
  keys: string[],
): Promise<Map<string, { alpha: number; beta: number }>> {
  const out = new Map<string, { alpha: number; beta: number }>();
  if (keys.length === 0) return out;
  const { data, error } = await service
    .from("brain_usefulness")
    .select("item_kind, item_key, alpha, beta")
    .eq("fund_id", fundId)
    .in(
      "item_key",
      keys.map((key) => key.slice(key.indexOf(":") + 1)),
    );
  if (error) throw new Error(`brain_usefulness: ${error.message}`);
  for (const row of data ?? []) {
    out.set(`${row["item_kind"] as string}:${row["item_key"] as string}`, {
      alpha: Number(row["alpha"]),
      beta: Number(row["beta"]),
    });
  }
  return out;
}

/** Every candidate with its rank; `cited` follows when the chat has answered. */
async function logSearch(
  service: SupabaseClient,
  fundId: string,
  query: string,
  ranked: Array<Candidate & { score: number }>,
  messageId: string | null,
): Promise<boolean> {
  const { error } = await service.from("brain_retrieval_events").insert({
    fund_id: fundId,
    message_id: messageId,
    query,
    candidates: ranked.slice(0, LOGGED_CANDIDATES).map((candidate, index) => ({
      kind: candidate.kind,
      id: candidate.id,
      rank: index + 1,
      score: Number(candidate.score.toFixed(4)),
      lists: Object.keys(candidate.ranks),
    })),
  });
  // The answer does not depend on the log; a missing row is reported, not a reason to fail.
  if (error) console.error("[brain] retrieval event not logged", error.code, error.message);
  return !error;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
