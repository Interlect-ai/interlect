import type { ScreeningOutput } from "./contracts";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

/**
 * Task-svar → score: teamets svar på et krav erstatter AI'ens
 * vurdering af netop det krav, før koden regner scoren igen. Pure file (tested).
 */

export interface GateAnswer {
  gateKey: string;
  passed: boolean;
  rationale: string;
  evidenceId: string | null;
}

/** A resolved gate task as stored in case_tasks (answer_value.gatePassed / .override). */
export interface StoredGateAnswer extends GateAnswer {
  resolvedAt: string;
  /** Set when an Admin or Lead turned a failed requirement into met (override_mandate_gate). */
  override: boolean;
  /**
   * The fund setup version of the screening the answer was given against. A gate key can keep
   * its name while its meaning changes with a new setup, so an answer only counts against
   * screenings under the same version. null for answers without it: they never count against a
   * screening that names its version.
   */
  configVersionId?: string | null;
}

/**
 * The answers that count against one screening (pure; tested).
 * - Within the screening's setup version: of the answers that count, the latest per gate wins.
 *   "Opfyldt" never beats a breach the screening itself found, unless it is an override given
 *   after that screening, so a binding stop cannot be bought back by an older answer. Answers
 *   that do not count are dropped before the latest is picked, so a later plain "Opfyldt"
 *   cannot cancel a valid override.
 * - Across versions (harden round 2, S4R2-1): a gate key can keep its name while its meaning
 *   changes with a new setup, so "Opfyldt" and overrides only count under the version they were
 *   given against. A recorded breach ("Ikke opfyldt") fails closed instead: while it is the
 *   latest answer to the gate, it counts under every version (also answers saved without a
 *   version), until someone answers again. Lifting it then needs an override (Admin/Lead).
 */
export function effectiveGateAnswers(
  answers: StoredGateAnswer[],
  screening: {
    completedAt: string;
    verdicts: Map<string, boolean | null>;
    configVersionId?: string | null;
  },
): GateAnswer[] {
  const at = (value: string) => Date.parse(value);
  const sameVersion = (answer: StoredGateAnswer) =>
    screening.configVersionId === undefined ||
    (answer.configVersionId ?? null) === screening.configVersionId;
  const countsHere = (answer: StoredGateAnswer) =>
    !answer.passed ||
    screening.verdicts.get(answer.gateKey) !== false ||
    (answer.override && at(answer.resolvedAt) > at(screening.completedAt));

  const byGate = new Map<string, StoredGateAnswer[]>();
  for (const answer of [...answers].sort((a, b) => at(a.resolvedAt) - at(b.resolvedAt))) {
    byGate.set(answer.gateKey, [...(byGate.get(answer.gateKey) ?? []), answer]);
  }
  const chosen: StoredGateAnswer[] = [];
  for (const history of byGate.values()) {
    const latest = history[history.length - 1]!;
    if (!latest.passed && !sameVersion(latest)) {
      chosen.push(latest);
      continue;
    }
    let pick: StoredGateAnswer | null = null;
    for (const answer of history) {
      if (sameVersion(answer) && countsHere(answer)) pick = answer;
    }
    if (pick) chosen.push(pick);
  }
  return chosen.map(({ gateKey, passed, rationale, evidenceId }) => ({
    gateKey,
    passed,
    rationale,
    evidenceId,
  }));
}

/**
 * The team's answers that count for a new run (screening or deep analysis) scored now under its
 * own setup version. A new run applies them before the code score, so a breach the team recorded
 * is never hidden behind a new AI verdict (principles 4 and 5, harden F2).
 */
export function teamAnswersForNewRun(
  answers: StoredGateAnswer[],
  run: { configVersionId: string; verdicts: Map<string, boolean | null>; now?: Date },
): GateAnswer[] {
  return effectiveGateAnswers(answers, {
    completedAt: (run.now ?? new Date()).toISOString(),
    verdicts: run.verdicts,
    configVersionId: run.configVersionId,
  });
}

/** The team's answers replace the AI's view of those gates (pure; tested). */
export function applyGateAnswers(output: ScreeningOutput, answers: GateAnswer[]): ScreeningOutput {
  const byKey = new Map(answers.map((answer) => [answer.gateKey, answer]));
  const gates = output.gates.map((gate) => {
    const answer = byKey.get(gate.gateKey);
    if (!answer) return gate;
    byKey.delete(gate.gateKey);
    return {
      ...gate,
      passed: answer.passed,
      confidence: 1,
      rationale: answer.rationale,
      evidenceIds: answer.evidenceId ? [answer.evidenceId] : [],
    };
  });
  for (const answer of byKey.values()) {
    gates.push({
      gateKey: answer.gateKey,
      passed: answer.passed,
      confidence: 1,
      rationale: answer.rationale,
      evidenceIds: answer.evidenceId ? [answer.evidenceId] : [],
    });
  }
  return { ...output, gates };
}

/**
 * The team's gate answers a run was scored with (validation_result.teamGateAnswers), so the view
 * shows the same gates as the score (pure; tested). Anything malformed is ignored.
 */
export function storedTeamGateAnswers(validationResult: unknown): GateAnswer[] {
  const list = (validationResult as { teamGateAnswers?: unknown } | null)?.teamGateAnswers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const value = item as Partial<GateAnswer> | null;
    if (typeof value?.gateKey !== "string" || typeof value.passed !== "boolean") return [];
    return [
      {
        gateKey: value.gateKey,
        passed: value.passed,
        rationale: typeof value.rationale === "string" ? value.rationale : "",
        evidenceId: typeof value.evidenceId === "string" ? value.evidenceId : null,
      },
    ];
  });
}

/** A resolved gate task row (case_tasks), as the rescore and the case page read it. */
export interface GateTaskRow {
  linked_key: unknown;
  answer_value: unknown;
  answer_text: unknown;
  answer_evidence_id: unknown;
  resolved_at: unknown;
}

/**
 * A resolved gate task as a stored gate answer; null when the task holds no Opfyldt/Ikke
 * opfyldt (pure; tested). One mapping for the rescore and the case page, so both count the
 * same answers.
 */
export function gateAnswerFromTask(
  row: GateTaskRow,
  /** The language of the rationale's frame; the team's own text stays as written. */
  language: Language = "da",
): StoredGateAnswer | null {
  const value = row.answer_value as {
    gatePassed?: unknown;
    override?: unknown;
    configVersionId?: unknown;
  } | null;
  if (typeof value?.gatePassed !== "boolean" || typeof row.linked_key !== "string") return null;
  if (typeof row.resolved_at !== "string") return null;
  const text =
    typeof row.answer_text === "string" && row.answer_text.trim() ? row.answer_text : null;
  return {
    gateKey: row.linked_key,
    passed: value.gatePassed,
    rationale: translate(language, "analysisServer.gateAnswers.teamAnswer", {
      answer:
        text ??
        translate(
          language,
          value.gatePassed ? "analysisServer.gateAnswers.met" : "analysisServer.gateAnswers.notMet",
        ),
    }),
    evidenceId: typeof row.answer_evidence_id === "string" ? row.answer_evidence_id : null,
    resolvedAt: row.resolved_at,
    override: value.override === true,
    configVersionId: typeof value.configVersionId === "string" ? value.configVersionId : null,
  };
}
