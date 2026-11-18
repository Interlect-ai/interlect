import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatCitation } from "../chat-contract.ts";
import type { HistoryRow } from "./prompt.ts";

/**
 * Everything the chat engine reads and writes, behind one interface so the engine can be tested
 * without a database. The Supabase version uses the service client: the route has checked the
 * user's membership and `brain_chat` first, and every query here is scoped by `fundId`, which
 * comes from the server, never from the model.
 */
export type ChatThreadRow = { id: string; userId: string; caseId: string | null };

export type ChatMessageInsert = {
  id: string;
  fundId: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  toolCalls?: Array<{ name: string; input: unknown }>;
  model?: string | null;
  costUsd?: number;
};

export interface ChatStore {
  loadThread(fundId: string, threadId: string): Promise<ChatThreadRow | null>;
  /** The case's company name; null when the case is not in the fund. */
  caseName(fundId: string, caseId: string): Promise<string | null>;
  /** Active entities of the fund among the ids (others are dropped). */
  entities(
    fundId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string; type: string }>>;
  /** Questions the user asked in the fund since the given time. */
  recentQuestions(fundId: string, userId: string, since: Date): Promise<number>;
  thesis(fundId: string, full: boolean): Promise<string | null>;
  history(fundId: string, threadId: string, limit: number): Promise<HistoryRow[]>;
  createThread(input: {
    fundId: string;
    userId: string;
    caseId: string | null;
    title: string;
  }): Promise<string>;
  insertMessage(input: ChatMessageInsert): Promise<void>;
  /** Reserves the question's cap in the fund's chat budget; null when the month's limit is reached. */
  reserve(input: {
    fundId: string;
    userId: string;
    usd: number;
    model: string;
    refId: string;
  }): Promise<string | null>;
  finalize(input: {
    fundId: string;
    usageId: string;
    usd: number;
    inputTokens?: number;
    outputTokens?: number;
    requests: number;
  }): Promise<boolean>;
  /** False when the reservation was not found (already settled or another fund's). */
  release(fundId: string, usageId: string): Promise<boolean>;
  caseNames(fundId: string, caseIds: readonly string[]): Promise<Map<string, string>>;
  /** The answer's searches get the message id and `cited` on the cited rows. */
  markCited(fundId: string, messageId: string, citedKeys: ReadonlySet<string>): Promise<void>;
}

const THESIS_CHARS = { short: 3_000, full: 8_000 };

type CompanyJoin = { name: string } | Array<{ name: string }> | null;
const companyName = (value: CompanyJoin) =>
  (Array.isArray(value) ? value[0]?.name : value?.name) ?? null;

export function createSupabaseChatStore(service: SupabaseClient): ChatStore {
  return {
    async loadThread(fundId, threadId) {
      const { data, error } = await service
        .from("brain_threads")
        .select("id, user_id, case_id")
        .eq("fund_id", fundId)
        .eq("id", threadId)
        .maybeSingle();
      if (error) throw new Error(`brain_threads: ${error.message}`);
      if (!data) return null;
      return {
        id: data["id"] as string,
        userId: data["user_id"] as string,
        caseId: (data["case_id"] as string | null) ?? null,
      };
    },

    async caseName(fundId, caseId) {
      const { data, error } = await service
        .from("cases")
        .select("id, companies(name)")
        .eq("fund_id", fundId)
        .eq("id", caseId)
        .maybeSingle();
      if (error) throw new Error(`cases: ${error.message}`);
      if (!data) return null;
      return companyName(data["companies"] as CompanyJoin) ?? "Casen";
    },

    async entities(fundId, ids) {
      if (ids.length === 0) return [];
      const { data, error } = await service
        .from("brain_entities")
        .select("id, name, type")
        .eq("fund_id", fundId)
        .eq("status", "active")
        .in("id", [...ids]);
      if (error) throw new Error(`brain_entities: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row["id"] as string,
        name: row["name"] as string,
        type: row["type"] as string,
      }));
    },

    async recentQuestions(fundId, userId, since) {
      const { count, error } = await service
        .from("brain_messages")
        .select("id, brain_threads!inner(user_id)", { count: "exact", head: true })
        .eq("fund_id", fundId)
        .eq("role", "user")
        .eq("brain_threads.user_id", userId)
        .gte("created_at", since.toISOString());
      if (error) throw new Error(`brain_messages count: ${error.message}`);
      return count ?? 0;
    },

    async thesis(fundId, full) {
      const { data, error } = await service
        .from("fund_config_versions")
        .select(
          `version,
          fund_mandates(thesis, stages, geographies, sectors, ticket_min_eur, ticket_max_eur, risk_posture, dealbreakers),
          mandate_gates(label, description, treatment, sort_order),
          assessment_criteria(label, description, weight, sort_order)`,
        )
        .eq("fund_id", fundId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error(`fund_config_versions: ${error.message}`);
      if (!data) return null;
      return clipText(
        thesisText(data as unknown as ThesisRow, full),
        full ? THESIS_CHARS.full : THESIS_CHARS.short,
      );
    },

    async history(fundId, threadId, limit) {
      const { data, error } = await service
        .from("brain_messages")
        .select("role, content, created_at")
        .eq("fund_id", fundId)
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`brain_messages: ${error.message}`);
      return (data ?? [])
        .map((row) => ({
          role: row["role"] as HistoryRow["role"],
          content: row["content"] as string,
        }))
        .reverse();
    },

    async createThread(input) {
      const { data, error } = await service
        .from("brain_threads")
        .insert({
          fund_id: input.fundId,
          user_id: input.userId,
          case_id: input.caseId,
          title: input.title,
          visibility: "private",
        })
        .select("id")
        .single();
      if (error) throw new Error(`brain_threads insert: ${error.message}`);
      return data["id"] as string;
    },

    async insertMessage(input) {
      const { error } = await service.from("brain_messages").insert({
        id: input.id,
        fund_id: input.fundId,
        thread_id: input.threadId,
        role: input.role,
        content: input.content,
        citations: input.citations ?? [],
        tool_calls: input.toolCalls?.length ? input.toolCalls : null,
        used_web: false,
        model: input.model ?? null,
        cost_usd: input.costUsd ?? 0,
      });
      if (error) throw new Error(`brain_messages insert: ${error.message}`);
    },

    async reserve(input) {
      const { data, error } = await service.rpc("brain_reserve_budget", {
        _fund_id: input.fundId,
        _scope: "chat",
        _max_usd: input.usd,
        _loop: null,
        _ref_id: input.refId,
        _model: input.model,
        _user_id: input.userId,
      });
      if (error) throw new Error(`brain_reserve_budget: ${error.message}`);
      return data === null || data === undefined ? null : String(data);
    },

    async finalize(input) {
      const { data, error } = await service.rpc("brain_finalize_usage", {
        _usage_id: input.usageId,
        _fund_id: input.fundId,
        _cost_usd: input.usd,
        _input_tokens: input.inputTokens ?? null,
        _output_tokens: input.outputTokens ?? null,
        _requests: input.requests,
      });
      if (error) throw new Error(`brain_finalize_usage: ${error.message}`);
      return data === true;
    },

    async release(fundId, usageId) {
      const { data, error } = await service.rpc("brain_release_usage", {
        _usage_id: usageId,
        _fund_id: fundId,
      });
      if (error) throw new Error(`brain_release_usage: ${error.message}`);
      return data === true;
    },

    async caseNames(fundId, caseIds) {
      const out = new Map<string, string>();
      if (caseIds.length === 0) return out;
      const { data, error } = await service
        .from("cases")
        .select("id, companies(name)")
        .eq("fund_id", fundId)
        .in("id", [...caseIds]);
      if (error) throw new Error(`cases: ${error.message}`);
      for (const row of data ?? []) {
        const name = companyName(row["companies"] as CompanyJoin);
        if (name) out.set(row["id"] as string, name);
      }
      return out;
    },

    async markCited(fundId, messageId, citedKeys) {
      const { data, error } = await service
        .from("brain_retrieval_events")
        .select("id, candidates")
        .eq("fund_id", fundId)
        .eq("message_id", messageId);
      if (error) throw new Error(`brain_retrieval_events: ${error.message}`);
      for (const row of data ?? []) {
        const candidates = Array.isArray(row["candidates"]) ? row["candidates"] : [];
        let changed = false;
        const next = candidates.map((candidate: Record<string, unknown>) => {
          const cited = citedKeys.has(`${String(candidate["kind"])}:${String(candidate["id"])}`);
          if (cited) changed = true;
          return cited ? { ...candidate, cited: true } : candidate;
        });
        if (!changed) continue;
        const { error: updateError } = await service
          .from("brain_retrieval_events")
          .update({ candidates: next })
          .eq("fund_id", fundId)
          .eq("id", row["id"] as number);
        if (updateError) throw new Error(`brain_retrieval_events update: ${updateError.message}`);
      }
    },
  };
}

type ThesisRow = {
  version: number | null;
  fund_mandates: MandateRow | MandateRow[] | null;
  mandate_gates: Array<{
    label: string;
    description: string | null;
    treatment: string;
    sort_order: number | null;
  }> | null;
  assessment_criteria: Array<{
    label: string;
    description: string | null;
    weight: number | null;
    sort_order: number | null;
  }> | null;
};
type MandateRow = {
  thesis: string | null;
  stages: string[] | null;
  geographies: string[] | null;
  sectors: string[] | null;
  ticket_min_eur: number | null;
  ticket_max_eur: number | null;
  risk_posture: string | null;
  dealbreakers: unknown;
};

const bySort = <T extends { sort_order: number | null }>(rows: T[] | null) =>
  [...(rows ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

/** The active fund set-up as plain text for the system prompt (exported for tests). */
export function thesisText(row: ThesisRow, full: boolean): string {
  const mandate = Array.isArray(row.fund_mandates) ? row.fund_mandates[0] : row.fund_mandates;
  const lines: string[] = [];
  if (row.version !== null) lines.push(`Version ${row.version}.`);
  if (mandate?.thesis?.trim()) lines.push(`Tese: ${mandate.thesis.trim()}`);
  const list = (label: string, values: string[] | null | undefined) => {
    if (values && values.length > 0) lines.push(`${label}: ${values.join(", ")}`);
  };
  list("Stadier", mandate?.stages);
  list("Geografi", mandate?.geographies);
  list("Sektorer", mandate?.sectors);
  if (mandate?.ticket_min_eur || mandate?.ticket_max_eur) {
    lines.push(`Ticket: ${mandate.ticket_min_eur ?? "?"}-${mandate.ticket_max_eur ?? "?"} EUR`);
  }
  if (full && mandate?.risk_posture?.trim())
    lines.push(`Risikoprofil: ${mandate.risk_posture.trim()}`);
  const dealbreakers = Array.isArray(mandate?.dealbreakers)
    ? (mandate.dealbreakers as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  list("Dealbreakers", dealbreakers);
  const gates = bySort(row.mandate_gates);
  if (gates.length > 0) {
    lines.push("Mandatkrav:");
    for (const gate of gates) {
      const kind = gate.treatment === "hard" ? "bindende" : "til vurdering";
      const detail = full && gate.description?.trim() ? `: ${gate.description.trim()}` : "";
      lines.push(`- ${gate.label} (${kind})${detail}`);
    }
  }
  const criteria = bySort(row.assessment_criteria);
  if (criteria.length > 0) {
    lines.push("Kriterier og vægte:");
    for (const criterion of criteria) {
      const weight = criterion.weight === null ? "" : ` ${Number(criterion.weight)} %`;
      const detail =
        full && criterion.description?.trim() ? `: ${criterion.description.trim()}` : "";
      lines.push(`- ${criterion.label}${weight}${detail}`);
    }
  }
  return lines.join("\n");
}

function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
