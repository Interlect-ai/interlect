/**
 * Row mapping for Overblik's reads, kept free of any database client so it is tested on its
 * own. PostgREST answers an embedded one-to-one row as an object or as a one-element array
 * depending on how the relation is declared, so `one()` accepts both.
 */
import type { CasePhase, CaseStatus } from "../cases/lifecycle.ts";
import { sectorText } from "../funds/basis-labels.ts";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import type { TransitionEvent } from "./funnel.ts";
import type { CaseRow, OpenTaskRow, RecalcRow, RunRow } from "./snapshot.ts";

export type Row = Record<string, unknown>;

export function one<T>(value: unknown): T | null {
  return ((Array.isArray(value) ? value[0] : value) ?? null) as T | null;
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapCaseRow(row: Row, language: Language = DEFAULT_LANGUAGE): CaseRow {
  const company = one<{
    name: string;
    stage: string | null;
    hq_country: string | null;
    sector_key: string | null;
    sector_taxonomy: { label_da: string } | Array<{ label_da: string }> | null;
  }>(row["companies"]);
  const taxonomy = one<{ label_da: string }>(company?.sector_taxonomy);
  return {
    id: row["id"] as string,
    name: company?.name ?? translate(language, "overview.shared.unidentified"),
    phase: row["phase"] as CasePhase,
    status: row["status"] as CaseStatus,
    createdAt: row["created_at"] as string,
    lastActionAt: row["last_action_at"] as string,
    ...(typeof row["thesis_id"] === "string" ? { thesisId: row["thesis_id"] } : {}),
    country: company?.hq_country ?? null,
    sector:
      language !== "da" && company?.sector_key
        ? sectorText(company.sector_key, language)
        : (taxonomy?.label_da ?? null),
    stage: company?.stage ?? null,
  };
}

export function mapRunRow(row: Row): RunRow {
  const recommendation = one<{
    overall_score: number | string | null;
    evidence_confidence: number | string | null;
  }>(row["recommendations"]);
  return {
    id: row["id"] as string,
    caseId: row["case_id"] as string,
    kind: row["kind"] as "screening" | "deep",
    status: row["status"] as string,
    previousRunId: (row["previous_run_id"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
    completedAt: (row["completed_at"] as string | null) ?? null,
    overallScore: numberOrNull(recommendation?.overall_score),
    evidenceConfidence: numberOrNull(recommendation?.evidence_confidence),
  };
}

export function mapRecalcRow(row: Row): RecalcRow {
  return {
    runId: row["run_id"] as string,
    overallScore: numberOrNull(row["overall_score"]),
    createdAt: row["created_at"] as string,
  };
}

export function mapEventRow(row: Row): TransitionEvent {
  return {
    id: row["id"] as string,
    caseId: row["case_id"] as string,
    field: row["field"] as string,
    toPhase: (row["to_phase"] as string | null) ?? null,
    toStatus: (row["to_status"] as string | null) ?? null,
    occurredAt: row["occurred_at"] as string,
    undoOf: (row["undo_of"] as string | null) ?? null,
  };
}

export function mapOpenTaskRow(row: Row): OpenTaskRow {
  return {
    caseId: row["case_id"] as string,
    assigneeId: (row["assignee_id"] as string | null) ?? null,
    dueOn: (row["due_on"] as string | null)?.slice(0, 10) ?? null,
  };
}
