/**
 * "Brain om denne case", the shape the panel gets and its pure parts. The server builds
 * it from the fund's own Brain rows (case-panel.server.ts); every section carries its own empty
 * state, so the panel never has to guess why a list is empty. Pure file, tested with node --test.
 */

import type { MessageKey } from "../i18n/translate.ts";

export const PANEL_SIMILAR_LIMIT = 5;
export const PANEL_PRIOR_LIMIT = 10;
export const PANEL_CONTRADICTION_LIMIT = 10;

export type PanelDecisionKind = "reject" | "decline_ic" | "invest";

// i18n-keep: the panel shows DECISION_LABEL_KEYS in the page's language; this is only sent along.
export const DECISION_LABELS: Record<PanelDecisionKind, string> = {
  reject: "Fravalgt",
  decline_ic: "Nej i komitéen",
  invest: "Investeret",
};

/** What the panel shows for a decision kind; `DECISION_LABELS` is the Danish text the server sends along. */
export const DECISION_LABEL_KEYS: Record<PanelDecisionKind, MessageKey> = {
  reject: "brainChat.casePanel.decision.reject",
  decline_ic: "brainChat.casePanel.decision.decline_ic",
  invest: "brainChat.casePanel.decision.invest",
};

export interface PanelDecision {
  kind: PanelDecisionKind;
  label: string;
  /** ISO date (YYYY-MM-DD). */
  decidedOn: string;
  /** The fund's own reason labels, in the order the team gave them. */
  reasons: string[];
}

export interface PanelPriorCase {
  caseId: string;
  createdOn: string;
  phase: string;
  status: string;
  /**
   * The other thesis's name when this earlier case is the same company under another thesis
   * (spec flere-teser-i-et-team §4.4: "Samme selskab under …", not an earlier case).
   */
  otherThesis?: string;
  decision: PanelDecision | null;
}

export interface PanelSimilarCase {
  caseId: string;
  company: string;
  decision: PanelDecision | null;
}

export interface PanelContradiction {
  id: string;
  title: string;
  status: "new" | "seen";
  createdOn: string;
}

export type SimilarState =
  /** Cases found. */
  | "ok"
  /** Brain has no profile of this case yet (the profile is built when the screening is done). */
  | "no_profile"
  /** A profile, but no other case resembles it: "Brain har for få cases endnu". */
  | "too_few";

export interface BrainCasePanel {
  caseId: string;
  company: string | null;
  /** Other cases of the same company; empty = "Første gang I ser dette selskab". */
  previouslySeen: PanelPriorCase[];
  similar: { state: SimilarState; cases: PanelSimilarCase[] };
  /** Empty = the section is hidden. */
  contradictions: PanelContradiction[];
}

const isDecisionKind = (kind: unknown): kind is PanelDecisionKind =>
  kind === "reject" || kind === "decline_ic" || kind === "invest";

/** One row of brain_case_decisions as the panel shows it; null when it is no fund decision. */
export function panelDecision(
  row: { decision_kind: unknown; decided_at: unknown; reason_codes: unknown } | undefined,
  reasonLabels: ReadonlyMap<string, string>,
): PanelDecision | null {
  if (!row || !isDecisionKind(row.decision_kind) || typeof row.decided_at !== "string") return null;
  const codes = Array.isArray(row.reason_codes) ? row.reason_codes : [];
  return {
    kind: row.decision_kind,
    label: DECISION_LABELS[row.decision_kind],
    decidedOn: row.decided_at.slice(0, 10),
    reasons: codes
      .filter((code): code is string => typeof code === "string")
      .map((code) => reasonLabels.get(code) ?? code),
  };
}

/**
 * The similar cases in the search's order, without the case itself, one row per case, cut at the
 * limit. `ids` are the search's entity ids in rank order; `byEntity` maps an entity id to the case
 * it stands for.
 */
export function rankSimilarCases(
  ids: readonly string[],
  byEntity: ReadonlyMap<string, { caseId: string; company: string }>,
  ownCaseId: string,
  limit = PANEL_SIMILAR_LIMIT,
): Array<{ caseId: string; company: string }> {
  const seen = new Set<string>([ownCaseId]);
  const ranked: Array<{ caseId: string; company: string }> = [];
  for (const id of ids) {
    const found = byEntity.get(id);
    if (!found || seen.has(found.caseId)) continue;
    seen.add(found.caseId);
    ranked.push(found);
    if (ranked.length >= limit) break;
  }
  return ranked;
}

/** The insight key the evidence contradiction is stored under (L1, brain_insights.dedupe_key). */
export const contradictionKey = (evidenceId: string) => `contradiction:evidence:${evidenceId}`;
