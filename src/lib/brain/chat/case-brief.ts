/**
 * The case brief (exam package D1): every finding, risk and figure Brain holds about one
 * case in one list, the most serious first, so the model does not have to guess which searches to
 * run to see the whole case. Pure (tested in case-brief.test.ts); tools.server.ts reads the rows.
 *
 * Severity is read from the labels L0 writes into the episode text (db/migrations/0044): the risk
 * level ("[kategori · kritisk] …"), the finding type ("svaghed") and the evidence status
 * ("Status: modstridende."). A row without a label gets the weight of its kind.
 */

export const BRIEF_KINDS = [
  "risk",
  "finding",
  "evidence",
  "calculation",
  "category_score",
  "recommendation",
  "analysis_summary",
  "case_note",
] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];
/** The kinds that can rank highest: read apart from the many evidence rows. */
export const BRIEF_SERIOUS_KINDS: readonly BriefKind[] = [
  "risk",
  "finding",
  "recommendation",
  "analysis_summary",
];

export type BriefRow = {
  kind: string;
  title: string | null;
  content: string;
  /** ISO date or timestamp (world time, else recorded). */
  at: string | null;
};

const RISK_LEVELS: Array<[RegExp, number]> = [
  [/^\[[^\]]*·\s*kritisk\]/i, 100],
  [/^\[[^\]]*·\s*høj\]/i, 90],
  [/^\[[^\]]*·\s*middel\]/i, 60],
  [/^\[[^\]]*·\s*lav\]/i, 30],
];
const FINDING_TYPES: Array<[RegExp, number]> = [
  [/^\[[^\]]*·\s*svaghed\]/i, 70],
  [/^\[[^\]]*·\s*ukendt\]/i, 55],
  [/^\[[^\]]*·\s*spørgsmål\]/i, 50],
  [/^\[[^\]]*·\s*vurdering\]/i, 25],
  [/^\[[^\]]*·\s*styrke\]/i, 20],
];
const KIND_WEIGHT: Record<string, number> = {
  risk: 60,
  finding: 40,
  evidence: 30,
  calculation: 45,
  category_score: 35,
  recommendation: 75,
  analysis_summary: 65,
  case_note: 28,
};

/** 0-100: how much a reader of the case needs to see this row. Pure. */
export function briefSeverity(row: Pick<BriefRow, "kind" | "content">): number {
  const text = row.content.trimStart();
  if (row.kind === "risk") {
    for (const [pattern, weight] of RISK_LEVELS) if (pattern.test(text)) return weight;
  }
  if (row.kind === "finding") {
    for (const [pattern, weight] of FINDING_TYPES) if (pattern.test(text)) return weight;
  }
  if (row.kind === "evidence") {
    if (/Status:\s*modstridende\.?\s*$/i.test(text)) return 85;
    if (/Status:\s*oplyst af selskabet\.?\s*$/i.test(text)) return 40;
    if (/Status:\s*ukendt\.?\s*$/i.test(text)) return 35;
    if (/Status:\s*(verificeret|korroboreret)\.?\s*$/i.test(text)) return 30;
  }
  return KIND_WEIGHT[row.kind] ?? 0;
}

/** Most serious first; newer first among equals; stable otherwise. */
export function sortBrief<T extends BriefRow>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, severity: briefSeverity(row) }))
    .sort(
      (a, b) =>
        b.severity - a.severity ||
        (b.row.at ?? "").localeCompare(a.row.at ?? "") ||
        a.index - b.index,
    )
    .map((entry) => entry.row);
}

/** The most rows one brief returns; the rest are counted, not sent. */
export const BRIEF_MAX_ITEMS = 40;

export function severityLabel(severity: number): "kritisk" | "høj" | "middel" | "lav" {
  if (severity >= 90) return "kritisk";
  if (severity >= 70) return "høj";
  if (severity >= 40) return "middel";
  return "lav";
}
