/**
 * "Mangler før komiteen" (spec): what an
 * investment memo normally contains and this case lacks, each with a key (stored in
 * `case_memo_gap_answers`), a title and what it is for. The sheet lists them with
 * *Udfyld* / *Ikke nødvendigt*; the memo shows the open ones as a short "Not yet known"
 * box in their section. A gap never blocks the memo; only an unanswered mandate requirement does.
 *
 * Pure: reads only the memo model (memo-model.ts).
 */
import type { MessageKey } from "../i18n/translate.ts";
import type { MemoGapState } from "./memo.ts";
import {
  MEMO_SECTIONS,
  MEMO_SECTION_FIELDS,
  memoFieldStatus,
  type MemoFieldKey,
  type MemoFieldStatus,
  type MemoModel,
  type MemoSectionKey,
} from "./memo-model.ts";

/** In the order the sheet lists them (memo-v5 sheet: references, competitors, terms, legal first). */
const GAPS = [
  { key: "customer_references", field: "customer_references", text: "customerReferences" },
  { key: "competitor_map", field: "competitor_map", text: "competitorMap" },
  { key: "round_terms", field: "round_terms", text: "roundTerms" },
  { key: "legal_review", field: "legal_review", text: "legalReview" },
  { key: "unit_economics_inputs", field: "unit_economics", text: "unitEconomicsInputs" },
  { key: "financial_statements", field: "financial_statements", text: "financialStatements" },
  { key: "market_size", field: "market_size", text: "marketSize" },
  { key: "team_background", field: "team_people", text: "teamBackground" },
  { key: "funding_history", field: "funding_history", text: "fundingHistory" },
] as const satisfies readonly { key: string; field: MemoFieldKey; text: string }[];

export type MemoGapKey = (typeof GAPS)[number]["key"];
export const MEMO_GAP_KEYS: readonly MemoGapKey[] = GAPS.map((gap) => gap.key);

export interface MemoGap {
  key: MemoGapKey;
  section: MemoSectionKey;
  /** 1–13: the memo section the gap belongs to. */
  sectionNumber: number;
  titleKey: MessageKey;
  purposeKey: MessageKey;
  /** `missing`: the analysis could have it but does not; `human_only`: only a person can give it. */
  fieldStatus: Exclude<MemoFieldStatus, "found">;
  /** What exactly is missing, where the model knows it (unit economics: the inputs, e.g. "mrr"). */
  details: string[];
  /** The team's answer (`filled` or `not_needed` with a reason); null while the gap is open. */
  answer: { state: MemoGapState; reason: string | null; answeredAt: string } | null;
}

function sectionOf(field: MemoFieldKey): { key: MemoSectionKey; number: number } {
  const index = MEMO_SECTIONS.findIndex((section) =>
    (MEMO_SECTION_FIELDS[section.key] as readonly string[]).includes(field),
  );
  return { key: MEMO_SECTIONS[index]!.key, number: index + 1 };
}

/** The memo's gaps for this case, in the sheet's order; a field the analysis has is never a gap. */
export function memoGaps(model: MemoModel): MemoGap[] {
  const answers = new Map(model.gapAnswers.map((answer) => [answer.gapKey, answer]));
  return GAPS.flatMap((gap): MemoGap[] => {
    const status = memoFieldStatus(model, gap.field);
    if (status === "found") return [];
    const section = sectionOf(gap.field);
    const answer = answers.get(gap.key);
    return [
      {
        key: gap.key,
        section: section.key,
        sectionNumber: section.number,
        titleKey: `memo.gaps.${gap.text}.title`,
        purposeKey: `memo.gaps.${gap.text}.purpose`,
        fieldStatus: status,
        details: gap.key === "unit_economics_inputs" ? [...model.finance.unitEconomicsInputs] : [],
        answer: answer
          ? { state: answer.state, reason: answer.reason, answeredAt: answer.answeredAt }
          : null,
      },
    ];
  });
}

/** The gaps nobody has answered yet (the memo lists them as "Not yet known"). */
export function openMemoGaps(gaps: readonly MemoGap[]): MemoGap[] {
  return gaps.filter((gap) => gap.answer === null);
}
